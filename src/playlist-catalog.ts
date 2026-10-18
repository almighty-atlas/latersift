import type { PlaylistEntry } from './adapter/playlists';

export function playlistDisplayName(entry: PlaylistEntry): string {
  return entry.nameStatus !== 'unknown' && entry.name?.trim()
    ? entry.name
    : 'Playlist ohne bestätigten Namen';
}

export function playlistNameLabel(entry: PlaylistEntry): string {
  if (entry.nameStatus === 'confirmed' && entry.name?.trim())
    return 'Name: bestätigt';
  if (entry.nameStatus === undefined && entry.name?.trim())
    return 'Name: gespeichert (älterer Katalog)';
  return 'Name: unbekannt';
}

/** Historical names stay stale; they are never promoted into fresh scan evidence. */
export function mergePlaylistHistory(
  previous: PlaylistEntry[],
  current: PlaylistEntry[],
): PlaylistEntry[] {
  const entries = new Map(previous.map((entry) => [entry.id, entry]));
  for (const entry of current) {
    const prior = entries.get(entry.id);
    const hasName = entry.nameStatus !== 'unknown' && !!entry.name?.trim();
    if (!prior || hasName || !prior.name?.trim()) entries.set(entry.id, entry);
  }
  return [...entries.values()];
}
