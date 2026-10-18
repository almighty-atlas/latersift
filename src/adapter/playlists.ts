export interface PlaylistEntry {
  id: string;
  name: string | null;
  /** Optional for stored legacy entries; every newly scanned entry sets these. */
  nameStatus?: 'confirmed' | 'unknown';
  nameSource?:
    | 'playlist-heading'
    | 'aria-labelledby'
    | 'legacy-title'
    | 'unknown'
    | 'conflicting';
  identityEvidence?: 'playlist-url';
  writability?: 'unknown';
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

/** Legacy key name: title-related reasons are warnings, not identity rejections. */
export type PlaylistRejectionReason =
  | 'no_playlist_link'
  | 'conflicting_playlist_ids'
  | 'missing_title_node'
  | 'conflicting_titles'
  | 'ambiguous_title_link'
  | 'hidden_card'
  | 'incomplete_rendering';

export type PlaylistReasonCounts = Record<PlaylistRejectionReason, number>;
export type PlaylistLinkType =
  | 'playlist'
  | 'watch'
  | 'channel'
  | 'external'
  | 'other'
  | 'invalid'
  | 'missing';

export type PlaylistDiagnosticTag =
  | 'ytd-playlist-renderer'
  | 'ytd-grid-playlist-renderer'
  | 'ytd-rich-item-renderer'
  | 'yt-lockup-view-model'
  | 'ytd-badge-supported-renderer'
  | 'a'
  | 'span'
  | 'div'
  | 'h3'
  | 'img'
  | 'button'
  | 'other';

export interface PlaylistCardSample {
  /** Zero-based position in the latest candidate scan, not an identifier. */
  index: number;
  tag: PlaylistDiagnosticTag;
  reasons: PlaylistRejectionReason[];
  titleNodes: {
    playlistTitle: number;
    videoTitle: number;
    lockupTitle: number;
  };
  childTags: Partial<Record<PlaylistDiagnosticTag, number>>;
  links: Record<PlaylistLinkType, number>;
  distinctValidIds: number;
  /** Visible, same-card structure only; contains no DOM text or attribute values. */
  titleStructure?: PlaylistTitleStructure;
}

export interface PlaylistTitleStructure {
  canonicalLinkCount: number;
  linkHeadings: number;
  /** Visible headings without an exclusive canonical-link relationship. */
  metadataHeadings: number;
  ariaLabelledbyLinks: number;
  /** Valid single local heading or dedicated-title references. */
  localHeadingReferences: number;
  missingOrAmbiguousReferences: number;
  watchLinkedHeadings: number;
  canonicalLinkHasAriaLabel: number;
}

export interface PlaylistCardCounts {
  round: number;
  total: number;
  accepted: number;
  rejected: number;
  hidden: number;
}

export interface PlaylistParserDiagnostics {
  /** Per-card counts in the latest round, including naming warnings on accepted identities. */
  latest: PlaylistReasonCounts;
  peaks: PlaylistReasonCounts;
  /** Identified cards with no card-local name (including conflicts), before name retention;
   * latest round and maximum, not polling sums or unique catalog-entry counts. */
  identifiedUnnamed?: { latest: number; peak: number };
  /** First 12 rejected or naming-warning cards in the latest round. */
  samples: PlaylistCardSample[];
  samplesTruncated: boolean;
  sources: Partial<Record<PlaylistDiagnosticTag, number>>;
}

/** Trusted environment boundary; the main adapter must sanitize tags/geometry. */
export interface FeedScrollDiagnostic {
  containers: {
    tag: string;
    top: number;
    height: number;
    viewport: number;
    selected: boolean;
    scrollable: boolean;
  }[];
  inspectedElements: number;
  truncated: boolean;
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
    checkpointError?: 'checkpoint_failed';
    parser?: PlaylistParserDiagnostics;
    scrollContainers?: FeedScrollDiagnostic;
    cardCount?: {
      initial: number;
      latest: number;
      max: number;
      /** Initial observation plus changes, retaining at most 12 observations. */
      changes: PlaylistCardCounts[];
    };
    scrollAvailability?: 'unavailable' | 'not_scrollable' | 'scrollable';
    loadingEvidence?: {
      cardGrowths: number;
      heightGrowths: number;
      /** Rounds with a visible continuation, not distinct continuation nodes. */
      continuationRounds: number;
      continuationAppearances: number;
    };
    pagination?: { nextAnchors: number; nextButtons: number };
  };
}

export interface PlaylistEnvironment {
  doc: Document;
  url(): string;
  /** Perform a real, read-only scroll in the feed's scroll container. */
  advance(): void;
  wait(ms: number, signal: AbortSignal): Promise<void>;
  scrollInfo?(): PlaylistScrollInfo | null;
  scrollDiagnostics?(): FeedScrollDiagnostic;
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

type CardResult = {
  entry: PlaylistEntry | null;
  reasons: PlaylistRejectionReason[];
};

const HEADING = 'h1, h2, h3, h4, h5, h6, [role="heading"]';

function titleEvidence(card: Element, canonical?: string) {
  const sameCard = (node: Element) => node.closest(CARDS) === card;
  const visible = (selector: string) =>
    [...card.querySelectorAll(selector)].filter(
      (node) => sameCard(node) && !hidden(node),
    );
  // textContent also includes hidden and nested-card content. Neither is title evidence.
  const visibleText = (node: Node): string => {
    if (node.nodeType === 3) return node.textContent ?? '';
    if (node.nodeType !== 1) return '';
    const element = node as Element;
    if (!sameCard(element) || hidden(element)) return '';
    return [...element.childNodes].map(visibleText).join('');
  };
  const anchors = visible('a[href]');
  const canonicalLinks = anchors.filter(
    (node) =>
      !!canonical &&
      playlistURL(node.getAttribute('href')!)?.href === canonical,
  );
  const headings = visible(HEADING);
  const structure: PlaylistTitleStructure = {
    canonicalLinkCount: canonicalLinks.length,
    linkHeadings: 0,
    metadataHeadings: 0,
    ariaLabelledbyLinks: 0,
    localHeadingReferences: 0,
    missingOrAmbiguousReferences: 0,
    watchLinkedHeadings: 0,
    canonicalLinkHasAriaLabel: canonicalLinks.filter((node) =>
      node.hasAttribute('aria-label'),
    ).length,
  };
  const names = new Map<string, NonNullable<PlaylistEntry['nameSource']>>();
  let ambiguous = false;
  let empty = false;
  const linked = (node: Element) => {
    const parent = node.closest('a[href]');
    const links = [
      ...(parent ? [parent] : []),
      ...node.querySelectorAll('a[href]'),
    ].filter((link) => sameCard(link) && !hidden(link));
    return (
      !!canonical &&
      links.length > 0 &&
      links.every(
        (link) => playlistURL(link.getAttribute('href')!)?.href === canonical,
      )
    );
  };
  const add = (
    node: Element,
    source: NonNullable<PlaylistEntry['nameSource']>,
  ) => {
    const name = visibleText(node).replace(/\s+/g, ' ').trim();
    if (name) names.set(name, names.get(name) ?? source);
    else empty = true;
  };
  for (const heading of headings) {
    const parent = heading.closest('a[href]');
    const links = [
      ...(parent ? [parent] : []),
      ...heading.querySelectorAll('a[href]'),
    ].filter((link) => sameCard(link) && !hidden(link));
    if (links.some((link) => linkType(link.getAttribute('href')) === 'watch'))
      structure.watchLinkedHeadings++;
    if (linked(heading)) {
      structure.linkHeadings++;
      add(heading, 'playlist-heading');
    } else {
      structure.metadataHeadings++;
      if (links.length) ambiguous = true;
    }
  }
  for (const title of visible(TITLE)) {
    if (!visibleText(title).trim()) empty = true;
    // Dynamic lockup classes alone never establish a title relationship.
    if (!title.matches('[id="playlist-title"], [id="video-title"]')) continue;
    if (linked(title)) add(title, 'legacy-title');
    else ambiguous = true;
  }
  for (const anchor of canonicalLinks) {
    if (!anchor.hasAttribute('aria-labelledby')) continue;
    structure.ariaLabelledbyLinks++;
    const refs = anchor.getAttribute('aria-labelledby')!.trim().split(/\s+/);
    const matches =
      refs.length === 1 && refs[0]
        ? [...card.ownerDocument.querySelectorAll('[id]')].filter(
            (node) => node.id === refs[0],
          )
        : [];
    const target = matches.length === 1 ? matches[0] : null;
    const shared = anchors.some(
      (other) =>
        other !== anchor &&
        other
          .getAttribute('aria-labelledby')
          ?.trim()
          .split(/\s+/)
          .includes(refs[0]),
    );
    if (
      !target ||
      !card.contains(target) ||
      target.closest(CARDS) !== card ||
      hidden(target) ||
      !target.matches(`${HEADING}, ${TITLE}`) ||
      shared ||
      ([...target.querySelectorAll('a[href]')].some(
        (link) => sameCard(link) && !hidden(link),
      ) &&
        !linked(target)) ||
      (target.closest('a[href]') && target.closest('a[href]') !== anchor)
    ) {
      structure.missingOrAmbiguousReferences++;
      ambiguous = true;
      continue;
    }
    structure.localHeadingReferences++;
    add(target, 'aria-labelledby');
  }
  return { names, structure, ambiguous, empty };
}

function parseCard(card: Element): CardResult {
  if (hidden(card)) return { entry: null, reasons: ['hidden_card'] };
  const reasons: PlaylistRejectionReason[] = [];
  let emptyLink = false;
  // Never combine a title with an arbitrary link in a multi-playlist card.
  const urls = new Map<string, URL>();
  for (const anchor of card.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href')!;
    if (!hidden(anchor) && !href.trim()) emptyLink = true;
    const url = playlistURL(href);
    if (url && !hidden(anchor)) urls.set(url.href, url);
  }
  if (urls.size === 0) reasons.push('no_playlist_link');
  if (urls.size > 1) reasons.push('conflicting_playlist_ids');
  const url = [...urls.values()][0];
  const { names, ambiguous, empty } = titleEvidence(card, url?.href);
  if (names.size > 1) reasons.push('conflicting_titles');
  if (names.size === 0) {
    if (ambiguous) reasons.push('ambiguous_title_link');
    else if (!empty) reasons.push('missing_title_node');
    if (empty || emptyLink) reasons.push('incomplete_rendering');
  }
  // A missing/ambiguous name cannot invalidate an otherwise proven identity.
  if (urls.size !== 1) return { entry: null, reasons };
  const name = names.size === 1 ? [...names.keys()][0] : null;
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
    entry: {
      id: url.searchParams.get('list')!,
      name,
      nameStatus: name === null ? 'unknown' : 'confirmed',
      nameSource:
        name === null
          ? names.size > 1
            ? 'conflicting'
            : 'unknown'
          : names.get(name)!,
      identityEvidence: 'playlist-url',
      writability: 'unknown',
      url: url.href,
      visibility: visibility.size === 1 ? [...visibility][0] : 'unknown',
      // Feed membership, private visibility and edit controls do not prove ownership.
      ownership: 'unknown',
    },
    reasons,
  };
}

function reasonCounts(): PlaylistReasonCounts {
  return {
    no_playlist_link: 0,
    conflicting_playlist_ids: 0,
    missing_title_node: 0,
    conflicting_titles: 0,
    ambiguous_title_link: 0,
    hidden_card: 0,
    incomplete_rendering: 0,
  };
}

function safeTag(node: Element): PlaylistDiagnosticTag {
  switch (node.localName) {
    case 'ytd-playlist-renderer':
    case 'ytd-grid-playlist-renderer':
    case 'ytd-rich-item-renderer':
    case 'yt-lockup-view-model':
    case 'ytd-badge-supported-renderer':
    case 'a':
    case 'span':
    case 'div':
    case 'h3':
    case 'img':
    case 'button':
      return node.localName;
    default:
      return 'other';
  }
}

function linkType(href: string | null): PlaylistLinkType {
  if (href === null) return 'missing';
  if (!href.trim()) return 'invalid';
  if (playlistURL(href)) return 'playlist';
  try {
    const url = new URL(href, 'https://www.youtube.com');
    if (!['http:', 'https:'].includes(url.protocol)) return 'invalid';
    if (url.origin !== 'https://www.youtube.com') return 'external';
    if (url.pathname === '/watch') return 'watch';
    if (/^\/(channel\/|@|c\/|user\/)/.test(url.pathname)) return 'channel';
    if (url.pathname === '/playlist') return 'invalid';
    return 'other';
  } catch {
    return 'invalid';
  }
}

function cardSample(
  card: Element,
  index: number,
  reasons: PlaylistRejectionReason[],
): PlaylistCardSample {
  const links: Record<PlaylistLinkType, number> = {
    playlist: 0,
    watch: 0,
    channel: 0,
    external: 0,
    other: 0,
    invalid: 0,
    missing: 0,
  };
  const ids = new Set<string>();
  for (const anchor of card.querySelectorAll('a')) {
    const href = anchor.getAttribute('href');
    links[linkType(href)]++;
    const url = href === null ? null : playlistURL(href);
    if (url) ids.add(url.searchParams.get('list')!);
  }
  const childTags: PlaylistCardSample['childTags'] = {};
  for (const child of card.children) {
    const tag = safeTag(child);
    childTags[tag] = (childTags[tag] ?? 0) + 1;
  }
  return {
    index,
    tag: safeTag(card),
    reasons,
    childTags,
    links,
    distinctValidIds: ids.size,
    titleStructure: titleEvidence(
      card,
      [...card.querySelectorAll('a[href]')]
        .filter((node) => !hidden(node))
        .map((node) => playlistURL(node.getAttribute('href')!))
        .find((url) => url)?.href,
    ).structure,
    titleNodes: {
      playlistTitle: card.querySelectorAll('[id="playlist-title"]').length,
      videoTitle: card.querySelectorAll('[id="video-title"]').length,
      lockupTitle: card.querySelectorAll(
        '.yt-lockup-metadata-view-model__title',
      ).length,
    },
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
  // Evidence belongs exclusively to this scan, including virtualized prior rounds.
  const nameEvidence = new Map<string, Set<string>>();
  const nameConflicts = new Set<string>();
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
      parser: {
        latest: reasonCounts(),
        peaks: reasonCounts(),
        samples: [],
        samplesTruncated: false,
        sources: {},
        identifiedUnnamed: { latest: 0, peak: 0 },
      },
      cardCount: { initial: 0, latest: 0, max: 0, changes: [] },
      loadingEvidence: {
        cardGrowths: 0,
        heightGrowths: 0,
        continuationRounds: 0,
        continuationAppearances: 0,
      },
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
      catalog.diagnostics.checkpointError = 'checkpoint_failed';
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
      let hiddenCards = 0;
      let accepted = 0;
      const parser = diagnostics.parser!;
      parser.latest = reasonCounts();
      parser.samples = [];
      parser.sources = {};
      const cards = [...env.doc.querySelectorAll(CARDS)];
      const results = cards.map((card) => parseCard(card));
      for (const { entry, reasons } of results) {
        if (!entry) continue;
        const names = nameEvidence.get(entry.url) ?? new Set<string>();
        if (entry.name !== null) names.add(entry.name);
        nameEvidence.set(entry.url, names);
        if (names.size > 1 || reasons.includes('conflicting_titles'))
          nameConflicts.add(entry.url);
      }
      let sampledCards = 0;
      parser.identifiedUnnamed!.latest = 0;
      for (const [index, card] of cards.entries()) {
        const source = safeTag(card);
        parser.sources[source] = (parser.sources[source] ?? 0) + 1;
        const { entry, reasons } = results[index];
        if (entry && nameConflicts.has(entry.url)) {
          entry.name = null;
          entry.nameStatus = 'unknown';
          entry.nameSource = 'conflicting';
          if (!reasons.includes('conflicting_titles'))
            reasons.push('conflicting_titles');
        }
        for (const reason of reasons) parser.latest[reason]++;
        if (!entry || reasons.length) {
          sampledCards++;
          if (parser.samples.length < 12)
            parser.samples.push(cardSample(card, index, reasons));
        }
        if (entry?.name === null) parser.identifiedUnnamed!.latest++;
        if (!entry) {
          if (reasons.includes('hidden_card')) hiddenCards++;
          else unsupported++;

          continue;
        }
        accepted++;
        const previous = entries.get(entry.url);
        if (
          entry.name === null &&
          previous?.name &&
          !nameConflicts.has(entry.url)
        ) {
          entry.name = previous.name;
          entry.nameStatus = previous.nameStatus;
          entry.nameSource = previous.nameSource;
        }
        if (!previous || JSON.stringify(previous) !== JSON.stringify(entry)) {
          entries.set(entry.url, entry);
          progress = true;
        }
      }
      parser.samplesTruncated = sampledCards > parser.samples.length;
      parser.identifiedUnnamed!.peak = Math.max(
        parser.identifiedUnnamed!.peak,
        parser.identifiedUnnamed!.latest,
      );
      for (const reason of Object.keys(
        parser.latest,
      ) as PlaylistRejectionReason[]) {
        parser.peaks[reason] = Math.max(
          parser.peaks[reason],
          parser.latest[reason],
        );
      }
      const counts = diagnostics.cardCount!;
      const evidence = diagnostics.loadingEvidence!;
      const observation = {
        round: diagnostics.rounds,
        total: cards.length,
        accepted,
        rejected: cards.length - accepted,
        hidden: hiddenCards,
      };
      const last = counts.changes.at(-1);
      const cardGrowth = diagnostics.rounds > 1 && cards.length > counts.latest;
      if (cardGrowth) evidence.cardGrowths++;
      if (diagnostics.rounds === 1) counts.initial = cards.length;
      counts.latest = cards.length;
      counts.max = Math.max(counts.max, cards.length);
      if (
        !last ||
        last.total !== observation.total ||
        last.accepted !== accepted ||
        last.rejected !== observation.rejected ||
        last.hidden !== hiddenCards
      ) {
        counts.changes.push(observation);
        if (counts.changes.length > 12) counts.changes.shift();
      }
      diagnostics.unsupportedCards = Math.max(
        diagnostics.unsupportedCards,
        unsupported,
      );
      const previousContinuation = diagnostics.continuation;
      diagnostics.continuation = [
        ...env.doc.querySelectorAll('ytd-continuation-item-renderer'),
      ].some((node) => !hidden(node));
      diagnostics.continuationSeen ||= diagnostics.continuation;
      if (diagnostics.continuation) evidence.continuationRounds++;
      if (diagnostics.continuation && !previousContinuation)
        evidence.continuationAppearances++;
      // Explicit next relation only; never inspect button text or arbitrary labels.
      diagnostics.pagination = { nextAnchors: 0, nextButtons: 0 };
      for (const node of env.doc.querySelectorAll(
        'a[rel], button[rel], [role="button"][rel]',
      )) {
        if (
          hidden(node) ||
          !node.getAttribute('rel')?.split(/\s+/).includes('next')
        )
          continue;
        if (node.localName === 'a') diagnostics.pagination.nextAnchors++;
        else diagnostics.pagination.nextButtons++;
      }
      if (env.scrollDiagnostics)
        diagnostics.scrollContainers = env.scrollDiagnostics();
      const scroll = env.scrollInfo?.() ?? null;
      const moved =
        !!scroll && !!previousScroll && scroll.top !== previousScroll.top;
      const grew =
        !!scroll && !!previousScroll && scroll.height > previousScroll.height;
      if (moved) diagnostics.observedScrolls++;
      if (grew) evidence.heightGrowths++;
      diagnostics.scrollAvailability = !scroll
        ? 'unavailable'
        : scroll.height > scroll.viewport + 2
          ? 'scrollable'
          : 'not_scrollable';
      diagnostics.scroll = scroll ? { ...scroll } : null;
      previousScroll = scroll ? { ...scroll } : null;
      idle = progress || moved || grew || cardGrowth ? 0 : idle + 1;
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
  // Only normal bounded endings are reclassified, never abort/navigation/errors.
  if (catalog.status === 'partial' && entries.size === 0) {
    const observed = (catalog.diagnostics.cardCount?.max ?? 0) > 0;
    finish(
      'failed',
      observed ? 'unsupported_dom' : 'no_card_containers',
      observed
        ? 'Playlist-Karten wurden gefunden, konnten aber nach begrenzter Wartezeit nicht sicher gelesen werden. Die DOM-Struktur wird nicht unterstützt; Details stehen in der Parser-Diagnose.'
        : 'Nach begrenzter Wartezeit wurden keine unterstützten Playlist-Kartencontainer gefunden. Ein leerer Playlist-Bestand ist damit nicht belegt.',
    );
  }
  try {
    await persist();
  } catch (error) {
    if (
      catalog.status !== 'interrupted' &&
      catalog.diagnostics.reason !== 'scanner_error'
    ) {
      finish(
        'failed',
        'checkpoint_error',
        `Teilbestand vorhanden, Speicherung fehlgeschlagen: ${String(error)}`,
      );
    }
  }
  return catalog;
}
