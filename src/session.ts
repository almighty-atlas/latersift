import {
  type Library,
  type DecisionKind,
  type Video,
  latestScan,
  safeCandidate,
} from './model';
export type Filter =
  | 'all'
  | 'position-asc'
  | 'position-desc'
  | 'short'
  | 'long'
  | 'unavailable'
  | 'deferred';
export function catalog(lib: Library): Video[] {
  const last = latestScan(lib);
  if (!last) return [];
  if (last.status === 'complete') return last.videos;
  const start = lib.scans.findLastIndex((s) => s.status === 'complete');
  const merged = new Map<string, Video>();
  for (const scan of lib.scans.slice(Math.max(0, start)))
    scan.videos.forEach((v) => merged.set(v.id, v));
  return [...merged.values()];
}
export function playlistId(input: string): string | null {
  let id = input.trim();
  if (id.startsWith('https://')) {
    try {
      const u = new URL(id);
      if (u.origin !== 'https://www.youtube.com' || u.pathname !== '/playlist')
        return null;
      id = u.searchParams.get('list') || '';
    } catch {
      return null;
    }
  }
  return /^PL[\w-]{10,100}$/.test(id) ? id : null;
}
export function candidates(lib: Library, filter: Filter): Video[] {
  const decisions = new Map(lib.decisions.map((d) => [d.videoId, d]));
  const list = catalog(lib).filter((v) => {
    const d = decisions.get(v.id);
    if (d && d.kind !== 'defer') return false;
    if (filter === 'deferred' && d?.kind !== 'defer') return false;
    if (filter === 'unavailable' && !safeCandidate(v)) return false;
    if ((filter === 'short' || filter === 'long') && v.durationSeconds === null)
      return false;
    if (
      (filter === 'position-asc' || filter === 'position-desc') &&
      v.position === null
    )
      return false;
    return true;
  });
  return list.sort((a, b) =>
    filter === 'short'
      ? a.durationSeconds! - b.durationSeconds!
      : filter === 'long'
        ? b.durationSeconds! - a.durationSeconds!
        : filter === 'position-desc'
          ? b.position! - a.position!
          : (a.position ?? Infinity) - (b.position ?? Infinity),
  );
}
export function startSession(lib: Library, size: number, filter: Filter) {
  if (!Number.isSafeInteger(size) || size < 1 || size > 5000)
    throw new Error('Wähle eine Sitzungsgröße zwischen 1 und 5.000.');
  const selected = candidates(lib, filter)
    .slice(0, size)
    .map((v) => v.id);
  lib.session = {
    id: crypto.randomUUID(),
    size,
    videoIds: selected,
    paused: false,
    createdAt: new Date().toISOString(),
  };
}
export function sessionDecisions(lib: Library) {
  return lib.decisions.filter((d) => d.sessionId === lib.session?.id);
}
export function currentVideo(lib: Library): Video | undefined {
  if (!lib.session || lib.session.paused) return;
  const done = new Set(sessionDecisions(lib).map((d) => d.videoId));
  const all = new Map(catalog(lib).map((v) => [v.id, v]));
  return lib.session.videoIds
    .map((id) => all.get(id))
    .find((v) => v && !done.has(v.id));
}
export function decide(lib: Library, videoId: string, kind: DecisionKind) {
  const current = currentVideo(lib);
  if (!current || current.id !== videoId)
    throw new Error(
      'Diese Karte wurde bereits bewertet oder ist nicht mehr aktiv.',
    );
  if (lib.decisions.some((d) => d.videoId === videoId && d.kind !== 'defer'))
    throw new Error('Es existiert bereits eine Entscheidung.');
  const target = kind === 'archive' ? playlistId(lib.archivePlaylist) : null;
  if (kind === 'archive' && !target)
    throw new Error(
      'Zuerst die URL einer bestehenden Archiv-Playlist hinterlegen. Das Ziel ist noch nicht mit YouTube geprüft.',
    );
  lib.decisions.push({
    id: crypto.randomUUID(),
    videoId,
    sessionId: lib.session!.id,
    kind,
    targetPlaylist: target,
    createdAt: new Date().toISOString(),
    status: 'pending',
  });
}
export function undo(lib: Library) {
  const index = lib.decisions.findLastIndex(
    (d) => d.sessionId === lib.session?.id,
  );
  if (index < 0) return false;
  if (lib.decisions[index].status !== 'pending')
    throw new Error(
      'Bereits ausgeführte oder unklare Änderungen können hier nicht rückgängig gemacht werden.',
    );
  lib.decisions.splice(index, 1);
  return true;
}
export function stageCleanup(lib: Library, ids: string[]) {
  const valid = catalog(lib).filter(safeCandidate);
  const unique = [...new Set(ids)];
  if (unique.some((id) => !valid.some((v) => v.id === id)))
    throw new Error(
      'Nur eindeutig private oder gelöschte Einträge dürfen ausgewählt werden.',
    );
  const sessionId = `cleanup-${crypto.randomUUID()}`;
  for (const videoId of unique) {
    if (lib.decisions.some((d) => d.videoId === videoId && d.kind !== 'defer'))
      continue;
    lib.decisions.push({
      id: crypto.randomUUID(),
      videoId,
      sessionId,
      kind: 'remove',
      targetPlaylist: null,
      createdAt: new Date().toISOString(),
      status: 'pending',
    });
  }
}
export const WRITE_GATE =
  'YouTube-Schreibzugriff gesperrt: Der angemeldete Live-Nachweis von M1 und einzeln verifizierte Schreibadapter fehlen. Deine Entscheidungen bleiben lokal vorgemerkt.';
