import { describe, it, expect } from 'vitest';
import { emptyLibrary, type Video } from '../src/model';
import {
  candidates,
  catalog,
  currentVideo,
  decide,
  playlistId,
  stageCleanup,
  startSession,
  undo,
} from '../src/session';
export const video = (n: number): Video => ({
  id: String(n).padStart(11, '0'),
  url: `https://www.youtube.com/watch?v=${String(n).padStart(11, '0')}`,
  title: `Video ${n}`,
  channel: null,
  thumbnail: null,
  durationSeconds: n * 60,
  publishedAt: null,
  position: n,
  availability: 'unknown',
  evidence: null,
  scannedAt: '2026-10-17T00:00:00Z',
  originalPlaylist: 'WL',
});
function library() {
  const lib = emptyLibrary();
  lib.scans = [
    {
      id: 'scan',
      startedAt: 'now',
      finishedAt: 'now',
      status: 'complete',
      expectedCount: 3,
      videos: [video(1), video(2), video(3)],
      unidentifiableRows: 0,
      message: '',
    },
  ];
  return lib;
}
describe('sessions', () => {
  it('supports all three decisions, stable targets and undo', () => {
    const lib = library();
    lib.archivePlaylist = 'PL1234567890123456';
    startSession(lib, 3, 'position-asc');
    decide(lib, video(1).id, 'remove');
    decide(lib, video(2).id, 'archive');
    decide(lib, video(3).id, 'defer');
    expect(currentVideo(lib)).toBeUndefined();
    expect(lib.decisions.map((d) => d.kind)).toEqual([
      'remove',
      'archive',
      'defer',
    ]);
    expect(lib.decisions[1].targetPlaylist).toBe('PL1234567890123456');
    expect(lib.decisions.every((d) => d.status === 'pending')).toBe(true);
    expect(undo(lib)).toBe(true);
    expect(currentVideo(lib)?.id).toBe(video(3).id);
  });
  it('defers only until a later round', () => {
    const lib = library();
    startSession(lib, 2, 'position-asc');
    decide(lib, video(1).id, 'defer');
    expect(currentVideo(lib)?.id).toBe(video(2).id);
    decide(lib, video(2).id, 'remove');
    expect(currentVideo(lib)).toBeUndefined();
    startSession(lib, 2, 'deferred');
    expect(currentVideo(lib)?.id).toBe(video(1).id);
  });
  it('resumes serialized sessions and prevents double decisions', () => {
    const lib = library();
    startSession(lib, 25, 'position-asc');
    decide(lib, video(1).id, 'remove');
    const resumed = JSON.parse(JSON.stringify(lib));
    expect(currentVideo(resumed)?.id).toBe(video(2).id);
    expect(() => decide(resumed, video(1).id, 'remove')).toThrow();
    expect(resumed.decisions).toHaveLength(1);
    resumed.session.paused = true;
    expect(currentVideo(resumed)).toBeUndefined();
    expect(() => decide(resumed, video(2).id, 'remove')).toThrow();
  });
  it('rejects archive without a valid configured playlist', () => {
    const lib = library();
    startSession(lib, 25, 'position-asc');
    expect(() => decide(lib, video(1).id, 'archive')).toThrow();
    expect(lib.decisions).toHaveLength(0);
    expect(
      playlistId('https://evil.test/playlist?list=PL1234567890'),
    ).toBeNull();
    expect(playlistId('WL')).toBeNull();
  });
  it('does not claim undo after an applied or uncertain operation', () => {
    const lib = library();
    startSession(lib, 2, 'position-asc');
    decide(lib, video(1).id, 'remove');
    lib.decisions[0].status = 'unknown';
    expect(() => undo(lib)).toThrow();
  });
  it('reconciles complete scans without losing decisions, partial scans retain catalog', () => {
    const lib = library();
    startSession(lib, 2, 'position-asc');
    decide(lib, video(1).id, 'remove');
    lib.scans.push({
      ...lib.scans[0],
      id: 'partial',
      status: 'incomplete',
      videos: [video(4)],
    });
    expect(catalog(lib)).toHaveLength(4);
    lib.scans.push({ ...lib.scans[0], id: 'complete2', videos: [video(3)] });
    expect(catalog(lib)).toHaveLength(1);
    expect(lib.decisions[0].status).toBe('pending');
  });
  it('filters only on known metadata and validates size', () => {
    const lib = library();
    lib.scans[0].videos[0].durationSeconds = null;
    expect(candidates(lib, 'short').map((v) => v.id)).toEqual([
      video(2).id,
      video(3).id,
    ]);
    expect(candidates(lib, 'position-desc')[0].id).toBe(video(3).id);
    expect(() => startSession(lib, 0, 'short')).toThrow();
  });
  it('cleanup requires explicit private/deleted evidence, deduplicates candidates', () => {
    const lib = library();
    expect(() => stageCleanup(lib, [video(1).id])).toThrow();
    lib.scans[0].videos[0].availability = 'private';
    stageCleanup(lib, [video(1).id, video(1).id]);
    stageCleanup(lib, [video(1).id]);
    expect(lib.decisions).toHaveLength(1);
  });
});
