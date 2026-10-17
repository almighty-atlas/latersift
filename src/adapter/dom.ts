import type { Availability, Video } from '../model';
export const ROW = 'ytd-playlist-video-renderer';
const text = (root: ParentNode, selector: string) =>
  root.querySelector(selector)?.textContent?.trim() || null;
export function duration(value: string | null): number | null {
  if (!value || !/^\d+(?::[0-5]\d){1,2}$/.test(value)) return null;
  return value.split(':').reduce((n, part) => n * 60 + Number(part), 0);
}
export function classify(
  title: string | null,
  detail: string | null,
  playable: boolean,
): { availability: Availability; evidence: string | null } {
  const evidence = [title, detail].filter(Boolean).join(' ').trim();
  // Only explicit notices count. Unlisted / Nicht gelistet is not a failure.
  if (/^(\[?private video\]?|\[?privates video\]?)$/i.test(title || ''))
    return { availability: 'private', evidence };
  if (/^(\[?deleted video\]?|\[?gelöschtes video\]?)$/i.test(title || ''))
    return { availability: 'removed', evidence };
  if (
    /age.restricted|altersbeschränkt|not available in your country|in deinem land nicht verfügbar/i.test(
      detail || '',
    )
  )
    return { availability: 'restricted', evidence };
  if (
    /video unavailable|video nicht verfügbar|temporar|try again|erneut versuchen/i.test(
      detail || '',
    )
  )
    return { availability: 'unknown', evidence };
  // A thumbnail/title/link alone does not establish playback availability.
  return { availability: playable ? 'available' : 'unknown', evidence: detail };
}
export function parseRow(
  row: Element,
  now = new Date().toISOString(),
): Video | null {
  const anchor = row.querySelector<HTMLAnchorElement>(
    'a[id="video-title"][href], a[id="thumbnail"][href]',
  );
  let url: URL;
  try {
    if (!anchor) return null;
    url = new URL(anchor.getAttribute('href')!, 'https://www.youtube.com');
  } catch {
    return null;
  }
  if (url.origin !== 'https://www.youtube.com' || url.pathname !== '/watch')
    return null;
  const id = url.searchParams.get('v');
  if (!id || !/^[\w-]{11}$/.test(id)) return null;
  const title =
    row.querySelector('[id="video-title"]')?.getAttribute('title')?.trim() ||
    text(row, '[id="video-title"]');
  const detail = text(
    row,
    '[id="unplayableText"], [id="unplayable-text"], .unplayable-text',
  );
  const image = row.querySelector<HTMLImageElement>('img');
  const source = image?.getAttribute('src');
  const thumbnail =
    source && /^https:\/\/(i\.ytimg\.com|img\.youtube\.com)\//.test(source)
      ? source
      : null;
  const index = text(row, '[id="index"]');
  const channel = text(row, '[id="channel-name"] a, ytd-channel-name a');
  const durationSeconds = duration(
    text(row, 'ytd-thumbnail-overlay-time-status-renderer [id="text"]'),
  );
  const status = classify(title, detail, false);
  // An ordinary video can itself be named '[Private video]'. Playable rows
  // or normal channel/duration metadata contradict an unavailable placeholder.
  if (
    (status.availability === 'private' || status.availability === 'removed') &&
    (row.hasAttribute('is-playable') ||
      channel !== null ||
      durationSeconds !== null)
  )
    status.availability = 'unknown';
  return {
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    title,
    channel,
    thumbnail,
    durationSeconds,
    publishedAt: null,
    position: index && /^\d+$/.test(index) ? Number(index) : null,
    ...status,
    scannedAt: now,
    originalPlaylist: 'WL',
  };
}
export function expectedCount(doc: Document): number | null {
  const roots = doc.querySelectorAll(
    'ytd-playlist-header-renderer [id="stats"], ytd-playlist-header-renderer [id="stats"] > yt-formatted-string, ytd-playlist-header-renderer .metadata-stats, yt-page-header-renderer .yt-content-metadata-view-model__metadata-row, yt-page-header-renderer .yt-content-metadata-view-model__metadata-text',
  );
  const counts = new Set<number>();
  for (const root of roots) {
    const match = root.textContent?.match(
      /(?:^|\s)(\d[\d.,\s\u00a0\u202f]*)\s+(?:videos?|Videos?)(?:\s|$)/i,
    );
    if (match) {
      const n = Number(match[1].replace(/\D/g, ''));
      if (Number.isSafeInteger(n)) counts.add(n);
    }
  }
  return counts.size === 1 ? [...counts][0] : null;
}
export function hasContinuation(doc: Document) {
  return [
    ...doc.querySelectorAll(
      'ytd-playlist-video-list-renderer ytd-continuation-item-renderer',
    ),
  ].some((el) => !el.hasAttribute('hidden'));
}
export function emptyNotice(doc: Document) {
  return /(?:This playlist has no videos|Diese Playlist enthält keine Videos|Keine Videos in dieser Playlist)/i.test(
    doc.querySelector('ytd-message-renderer')?.textContent || '',
  );
}
export function watchLaterLocation(url: string) {
  const parsed = new URL(url);
  return (
    parsed.origin === 'https://www.youtube.com' &&
    parsed.pathname === '/playlist' &&
    parsed.searchParams.get('list') === 'WL'
  );
}
