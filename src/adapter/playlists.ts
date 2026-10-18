export interface PlaylistEntry {
  id: string;
  name: string;
  url: string;
  visibility: 'private' | 'public' | 'unlisted' | 'unknown';
  ownership: 'owned' | 'unknown';
}

export interface PlaylistScrollInfo {
  container?: string;
  top: number;
  height: number;
  viewport: number;
}

export interface PlaylistCatalog {
  entries: PlaylistEntry[];
  status: 'running' | 'partial' | 'interrupted' | 'failed' | 'complete';
  updatedAt: string;
  message: string;
  diagnostics: {
    reason: string;
    rounds: number;
    scrollAttempts: number;
    observedScrolls: number;
    scroll: PlaylistScrollInfo | null;
    continuation: boolean;
    continuationSeen: boolean;
    unsupportedCards: number;
    expectedCount: null;
    completenessVerified: false;
    checkpointError?: string;
  };
}

export interface PlaylistEnvironment {
  doc: Document;
  url(): string;
  /** Perform a real, read-only scroll in the feed's scroll container. */
  advance(): void;
  wait(ms: number, signal: AbortSignal): Promise<void>;
  scrollInfo?(): PlaylistScrollInfo | null;
  now?(): number;
}

// Candidate structures only: no live DOM validation has been performed.
const CARDS =
  'ytd-playlist-renderer, ytd-grid-playlist-renderer, ytd-rich-item-renderer yt-lockup-view-model';
const TITLE =
  '[id="playlist-title"], [id="video-title"], .yt-lockup-metadata-view-model__title';
const INTERVAL_MS = 1000;
const MAX_SCROLLS = 60;
const MAX_MS = 120000;
const IDLE_ROUNDS = 6;
const CONTINUATION_IDLE_ROUNDS = 12;

function feedLocation(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === 'https://www.youtube.com' &&
      /^\/feed\/playlists\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function playlistURL(value: string): URL | null {
  try {
    const url = new URL(value, 'https://www.youtube.com');
    const ids = url.searchParams.getAll('list');
    if (
      url.origin !== 'https://www.youtube.com' ||
      url.pathname !== '/playlist' ||
      ids.length !== 1 ||
      !/^[A-Za-z0-9_-]+$/.test(ids[0])
    )
      return null;
    return new URL(`https://www.youtube.com/playlist?list=${ids[0]}`);
  } catch {
    return null;
  }
}

function hidden(element: Element): boolean {
  for (let node: Element | null = element; node; node = node.parentElement) {
    if (node.matches('[hidden], [aria-hidden="true"]')) return true;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === 'none' || style?.visibility === 'hidden')
      return true;
  }
  return false;
}

function parseCard(card: Element): PlaylistEntry | null {
  // Never combine a title with an arbitrary link in a multi-playlist card.
  const urls = new Map<string, URL>();
  for (const anchor of card.querySelectorAll('a[href]')) {
    const url = playlistURL(anchor.getAttribute('href')!);
    if (url && !hidden(anchor)) urls.set(url.href, url);
  }
  if (urls.size !== 1) return null;
  const url = [...urls.values()][0];
  const names = new Set<string>();
  for (const title of card.querySelectorAll(TITLE)) {
    if (hidden(title)) continue;
    const anchor = title.closest('a[href]');
    const titleLinks = [
      ...(anchor ? [anchor] : []),
      ...title.querySelectorAll('a[href]'),
    ];
    if (
      titleLinks.some(
        (link) => playlistURL(link.getAttribute('href')!)?.href !== url.href,
      )
    )
      continue;
    // A dedicated title node is required; thumbnail labels and card text are not titles.
    const name = (title.textContent || '').replace(/\s+/g, ' ').trim();
    if (name) names.add(name);
  }
  if (names.size !== 1) return null;
  const visibility = new Set<PlaylistEntry['visibility']>();
  // Only explicit structured privacy badges, never title/description/aria prose.
  for (const badge of card.querySelectorAll('ytd-badge-supported-renderer')) {
    if (hidden(badge)) continue;
    for (const value of ['private', 'public', 'unlisted'] as const) {
      if (
        [
          ...badge.querySelectorAll(
            `.badge-style-type-privacy-${value}, [badge-style-type="BADGE_STYLE_TYPE_PRIVACY_${value.toUpperCase()}"]`,
          ),
        ].some((node) => !hidden(node)) ||
        badge.getAttribute('badge-style-type') ===
          `BADGE_STYLE_TYPE_PRIVACY_${value.toUpperCase()}`
      )
        visibility.add(value);
    }
  }
  return {
    id: url.searchParams.get('list')!,
    name: [...names][0],
    url: url.href,
    visibility: visibility.size === 1 ? [...visibility][0] : 'unknown',
    // Feed membership, private visibility and edit controls do not prove ownership.
    ownership: 'unknown',
  };
}

/** Read-only, bounded DOM scan. A stable end is not proof of a complete catalog. */
export async function scanPlaylists(
  env: PlaylistEnvironment,
  signal: AbortSignal,
  checkpoint: (catalog: PlaylistCatalog) => void | Promise<void>,
): Promise<PlaylistCatalog> {
  const clock = env.now ?? Date.now;
  const started = clock();
  const entries = new Map<string, PlaylistEntry>();
  const catalog: PlaylistCatalog = {
    entries: [],
    status: 'running',
    updatedAt: new Date(started).toISOString(),
    message:
      'Playlist-Karten werden gelesen; Vollständigkeit ist nicht belegt.',
    diagnostics: {
      reason: 'scanning',
      rounds: 0,
      scrollAttempts: 0,
      observedScrolls: 0,
      scroll: null,
      continuation: false,
      continuationSeen: false,
      unsupportedCards: 0,
      expectedCount: null,
      completenessVerified: false,
    },
  };
  let checkpointFailed = false;
  const persist = async () => {
    catalog.entries = [...entries.values()];
    catalog.updatedAt = new Date(clock()).toISOString();
    try {
      await checkpoint(structuredClone(catalog));
    } catch (error) {
      checkpointFailed = true;
      catalog.diagnostics.checkpointError = String(error);
      throw error;
    }
  };
  const finish = (
    status: PlaylistCatalog['status'],
    reason: string,
    message: string,
  ) => {
    catalog.status = status;
    catalog.diagnostics.reason = reason;
    catalog.message = message;
  };
  let idle = 0;
  let previousScroll: PlaylistScrollInfo | null = null;
  try {
    for (;;) {
      if (signal.aborted) {
        finish(
          'interrupted',
          'aborted',
          'Abgebrochen; Teilbestand bleibt erhalten.',
        );
        break;
      }
      if (!feedLocation(env.url())) {
        finish(
          'interrupted',
          'navigation',
          'Nicht auf /feed/playlists; Teilbestand bleibt erhalten.',
        );
        break;
      }
      const diagnostics = catalog.diagnostics;
      diagnostics.rounds++;
      let progress = false;
      let unsupported = 0;
      for (const card of env.doc.querySelectorAll(CARDS)) {
        if (hidden(card)) continue;
        const entry = parseCard(card);
        if (!entry) {
          unsupported++;
          continue;
        }
        const previous = entries.get(entry.url);
        if (!previous || JSON.stringify(previous) !== JSON.stringify(entry)) {
          entries.set(entry.url, entry);
          progress = true;
        }
      }
      diagnostics.unsupportedCards = Math.max(
        diagnostics.unsupportedCards,
        unsupported,
      );
      diagnostics.continuation = [
        ...env.doc.querySelectorAll('ytd-continuation-item-renderer'),
      ].some((node) => !hidden(node));
      diagnostics.continuationSeen ||= diagnostics.continuation;
      const scroll = env.scrollInfo?.() ?? null;
      const moved =
        !!scroll && !!previousScroll && scroll.top !== previousScroll.top;
      const grew =
        !!scroll && !!previousScroll && scroll.height > previousScroll.height;
      if (moved) diagnostics.observedScrolls++;
      diagnostics.scroll = scroll ? { ...scroll } : null;
      previousScroll = scroll ? { ...scroll } : null;
      idle = progress || moved || grew ? 0 : idle + 1;
      if (diagnostics.rounds === 1 || progress) await persist();
      // Check again after async persistence, before invoking the scrolling boundary.
      if (signal.aborted || !feedLocation(env.url())) continue;
      const atBottom =
        !scroll || scroll.top + scroll.viewport >= scroll.height - 2;
      if (
        idle >=
          (diagnostics.continuation ? CONTINUATION_IDLE_ROUNDS : IDLE_ROUNDS) &&
        atBottom
      ) {
        finish(
          'partial',
          diagnostics.continuation
            ? 'continuation_stalled'
            : 'stable_unverified_end',
          'Keine weiteren Karten nach begrenzten Scrollversuchen; Vollständigkeit nicht belegt.',
        );
        break;
      }
      if (
        diagnostics.scrollAttempts >= MAX_SCROLLS ||
        clock() - started >= MAX_MS
      ) {
        finish(
          'partial',
          'scroll_budget',
          'Scroll-/Zeitbudget erreicht; nur Teilbestand belegt.',
        );
        break;
      }
      diagnostics.scrollAttempts++;
      env.advance();
      await env.wait(INTERVAL_MS, signal);
    }
  } catch (error) {
    finish(
      signal.aborted ? 'interrupted' : 'failed',
      signal.aborted
        ? 'aborted'
        : checkpointFailed
          ? 'checkpoint_error'
          : 'scanner_error',
      `Teilbestand bleibt erhalten: ${String(error)}`,
    );
  }
  try {
    await persist();
  } catch (error) {
    finish(
      'failed',
      'checkpoint_error',
      `Teilbestand vorhanden, Speicherung fehlgeschlagen: ${String(error)}`,
    );
  }
  return catalog;
}
