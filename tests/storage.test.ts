import 'fake-indexeddb/auto';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { deleteDB, openDB } from 'idb';
import { emptyLibrary, type Scan, type Video } from '../src/model';
import {
  loadLibrary,
  saveCheckpoint,
  saveLibrary,
  exportBackup,
} from '../src/storage';
beforeEach(async () => {
  await deleteDB('latersift');
});
afterEach(() => {
  vi.restoreAllMocks();
});

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
  const lib = await loadLibrary();
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

const fullScan = (): Scan => ({
  id: 'scan',
  startedAt: 'start',
  finishedAt: 'finish',
  status: 'complete',
  expectedCount: 1,
  videos: [video],
  unidentifiableRows: 0,
  message: 'count checked',
});

async function readStored() {
  const conn = await openDB('latersift');
  try {
    return {
      version: conn.version,
      stores: Array.from(conn.objectStoreNames),
      library: await conn.get('state', 'library'),
      snapshot: await conn.get('snapshots', 'scan'),
    };
  } finally {
    conn.close();
  }
}

it('migrates a real IndexedDB v1 library without upgrading or losing data', async () => {
  const full = fullScan();
  const legacy = {
    ...emptyLibrary(),
    schemaVersion: 1,
    scans: [full, { ...full, id: 'active', status: 'running' }],
    decisions: [
      {
        id: 'decision',
        videoId: video.id,
        sessionId: 'session',
        kind: 'remove',
        status: 'running',
        targetPlaylist: null,
        createdAt: 'now',
      },
    ],
    session: {
      id: 'session',
      size: 25,
      paused: true,
      createdAt: 'now',
      videoIds: [video.id],
    },
    archivePlaylist: 'archive-id',
  };
  const legacyConn = await openDB('latersift', 1, {
    upgrade(db) {
      db.createObjectStore('state');
      db.createObjectStore('snapshots', { keyPath: 'id' });
    },
  });
  try {
    const tx = legacyConn.transaction(['state', 'snapshots'], 'readwrite');
    await tx.objectStore('state').put(legacy, 'library');
    await tx.objectStore('snapshots').put(full);
    await tx.done;
    // Leave a v1 tab open: document migration must not need a version upgrade.
    const loaded = await loadLibrary();
    expect(loaded).toEqual({
      ...legacy,
      schemaVersion: 2,
      scans: [full, { ...legacy.scans[1], status: 'interrupted' }],
    });
    expect(await readStored()).toEqual({
      version: 1,
      stores: ['snapshots', 'state'],
      library: loaded,
      snapshot: full,
    });
    expect(await loadLibrary()).toEqual(loaded);
  } finally {
    legacyConn.close();
  }
});

it.each(['running', 'waiting', 'needs_attention'] as const)(
  'persists %s checkpoints, then marks them interrupted on restart',
  async (status) => {
    const library = await loadLibrary();
    const full = fullScan();
    await saveCheckpoint(library, full);
    const diagnostics = {
      reason: 'retry',
      recoveryAttempts: 2,
      lastProgressAt: full.startedAt,
      visibility: 'visible',
      highestPosition: 0,
      missingPositions: [],
      scroll: null,
      continuation: false,
      confirmedCount: 0,
    };
    const checkpoint = {
      ...full,
      status,
      finishedAt: null,
      message: 'progress retained',
      diagnostics,
    };
    await saveCheckpoint(library, checkpoint);
    expect(library.scans).toEqual([checkpoint]);
    expect((await readStored()).library.scans).toEqual([checkpoint]);
    const loaded = await loadLibrary();
    expect(loaded.scans).toEqual([{ ...checkpoint, status: 'interrupted' }]);
    expect(await readStored()).toMatchObject({
      library: loaded,
      snapshot: full,
    });
  },
);

it('preserves terminal scan statuses and decision statuses on load', async () => {
  const library = await loadLibrary();
  library.scans = ['complete', 'interrupted', 'incomplete', 'failed'].map(
    (status) => ({
      ...fullScan(),
      id: status,
      status: status as Scan['status'],
    }),
  );
  library.decisions = [
    'pending',
    'running',
    'verified',
    'failed',
    'unknown',
  ].map((status) => ({
    id: status,
    videoId: video.id,
    sessionId: 'session',
    kind: 'remove',
    targetPlaylist: null,
    createdAt: 'now',
    status: status as (typeof library.decisions)[number]['status'],
  }));
  await saveLibrary(library);
  expect(await loadLibrary()).toEqual(library);
});

it.each([false, true])(
  'does not mutate caller or stored data when checkpoint commit aborts (existing: %s)',
  async (existing) => {
    const library = await loadLibrary();
    const full = fullScan();
    await saveCheckpoint(library, full);
    const prior = library.scans[0];
    const before = structuredClone(library);
    const checkpoint = {
      ...full,
      id: existing ? full.id : 'new-scan',
      message: 'must not be saved',
    };
    const put = IDBObjectStore.prototype.put;
    let observedBeforeCommit;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value,
      key,
    ) {
      const request =
        key === undefined ? put.call(this, value) : put.call(this, value, key);
      if (this.name === 'snapshots') {
        request.addEventListener('success', () => {
          observedBeforeCommit = structuredClone(library);
          this.transaction.abort();
        });
      }
      return request;
    });
    await expect(saveCheckpoint(library, checkpoint)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(observedBeforeCommit).toEqual(before);
    expect(library).toEqual(before);
    expect(library.scans[0]).toBe(prior);
    expect(await readStored()).toMatchObject({
      library: before,
      snapshot: full,
    });
  },
);

it('does not mutate the library when opening IndexedDB fails', async () => {
  const library = emptyLibrary();
  const before = structuredClone(library);
  vi.spyOn(indexedDB, 'open').mockImplementation(() => {
    throw new DOMException('Storage unavailable', 'SecurityError');
  });
  await expect(saveCheckpoint(library, fullScan())).rejects.toMatchObject({
    name: 'SecurityError',
  });
  expect(library).toEqual(before);
});

it('rolls back the state write if writing the snapshot throws', async () => {
  const library = await loadLibrary();
  await saveCheckpoint(library, fullScan());
  const before = structuredClone(library);
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    value,
    key,
  ) {
    if (this.name === 'snapshots')
      throw new DOMException('Storage full', 'QuotaExceededError');
    return key === undefined
      ? put.call(this, value)
      : put.call(this, value, key);
  });
  await expect(
    saveCheckpoint(library, { ...fullScan(), message: 'unsaved' }),
  ).rejects.toMatchObject({ name: 'QuotaExceededError' });
  expect(library).toEqual(before);
  expect(await readStored()).toMatchObject({
    library: before,
    snapshot: fullScan(),
  });
});

it('rejects a failed migration instead of returning an unpersisted library', async () => {
  await loadLibrary();
  const conn = await openDB('latersift');
  const legacy = {
    ...emptyLibrary(),
    schemaVersion: 1,
    scans: [{ ...fullScan(), status: 'running' }],
  };
  try {
    await conn.put('state', legacy, 'library');
  } finally {
    conn.close();
  }
  const put = IDBObjectStore.prototype.put;
  const spy = vi
    .spyOn(IDBObjectStore.prototype, 'put')
    .mockImplementation(function (this: IDBObjectStore, value, key) {
      const request =
        key === undefined ? put.call(this, value) : put.call(this, value, key);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
  await expect(loadLibrary()).rejects.toMatchObject({ name: 'AbortError' });
  expect((await readStored()).library).toEqual(legacy);
  spy.mockRestore();
  expect(await loadLibrary()).toMatchObject({
    schemaVersion: 2,
    scans: [{ status: 'interrupted' }],
  });
});

it('preserves the existing scan reference after a successful commit', async () => {
  const library = await loadLibrary();
  await saveCheckpoint(library, fullScan());
  const prior = library.scans[0];
  const checkpoint = { ...fullScan(), status: 'incomplete' as const };
  await saveCheckpoint(library, checkpoint);
  expect(library.scans[0]).toBe(prior);
  expect(prior).toEqual(checkpoint);
  expect((await readStored()).snapshot).toEqual(fullScan());
});
