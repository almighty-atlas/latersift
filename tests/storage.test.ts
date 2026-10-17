import 'fake-indexeddb/auto';
import { it, expect } from 'vitest';
import { emptyLibrary, type Scan, type Video } from '../src/model';
import {
  loadLibrary,
  saveCheckpoint,
  saveLibrary,
  exportBackup,
} from '../src/storage';
const video: Video = {
  id: 'aaaaaaaaaaa',
  url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
  title: 'Title',
  channel: null,
  thumbnail: null,
  durationSeconds: null,
  publishedAt: null,
  position: 1,
  availability: 'unknown',
  evidence: null,
  scannedAt: 'now',
  originalPlaylist: 'WL',
};
it('persists decisions, sessions, full snapshots and incomplete checkpoints across reload', async () => {
  const lib = emptyLibrary();
  const full: Scan = {
    id: 'full',
    startedAt: 'now',
    finishedAt: 'now',
    status: 'complete',
    expectedCount: 1,
    videos: [video],
    unidentifiableRows: 0,
    message: 'count checked',
  };
  await saveCheckpoint(lib, full);
  lib.decisions.push({
    id: 'operation-id',
    videoId: video.id,
    sessionId: 'session-id',
    kind: 'remove',
    status: 'pending',
    targetPlaylist: null,
    createdAt: 'now',
  });
  lib.session = {
    id: 'session-id',
    size: 25,
    paused: true,
    createdAt: 'now',
    videoIds: [video.id],
  };
  await saveLibrary(lib);
  const reload = await loadLibrary();
  expect(reload).toEqual(lib);
  await saveCheckpoint(reload, {
    ...full,
    id: 'partial',
    status: 'interrupted',
  });
  const result = await loadLibrary();
  expect(result.scans).toHaveLength(2);
  expect(result.decisions[0].status).toBe('pending');
  expect(result.session?.paused).toBe(true);
  const backup = JSON.parse(exportBackup(result));
  expect(backup.scans[0].status).toBe('complete');
  expect(backup.scans[0].videos[0]).toMatchObject({
    id: video.id,
    url: video.url,
    originalPlaylist: 'WL',
    scannedAt: 'now',
  });
  expect(backup.notice).toContain('keine garantierte');
});
