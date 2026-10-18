import 'fake-indexeddb/auto';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { deleteDB, openDB } from 'idb';
import type { WriteRequest } from '../src/write-protocol';
import {
  emptyLibrary,
  type Library,
  type Scan,
  type Video,
} from '../src/model';
import {
  approveExecution,
  confirmExport,
  executeApproved,
  type WriteAdapter,
  type MembershipEvidence,
} from '../src/operations';
import {
  loadLibrary,
  claimExecution,
  authorizeMutation,
  loadSnapshot,
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
      schemaVersion: 3,
      scans: [full, { ...legacy.scans[1], status: 'interrupted' }],
      decisions: [{ ...legacy.decisions[0], status: 'unknown' }],
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
  const expected = structuredClone(library);
  expected.decisions[1].status = 'unknown';
  expect(await loadLibrary()).toEqual(expected);
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
    schemaVersion: 3,
    scans: [{ status: 'interrupted' }],
  });
});

it('loads the actual immutable complete snapshot, not a later incomplete checkpoint', async () => {
  const lib = emptyLibrary();
  await saveCheckpoint(lib, fullScan());
  await saveCheckpoint(lib, {
    ...fullScan(),
    status: 'incomplete',
    videos: [],
  });
  const snapshot = await loadSnapshot('scan');
  expect(snapshot).toEqual(fullScan());
  snapshot!.videos[0].title = 'local edit';
  expect(await loadSnapshot('scan')).toEqual(fullScan());
  expect(await loadSnapshot('missing')).toBeUndefined();
});

it('migrates v2 journals and running run to unknown without losing evidence or steps', async () => {
  const lib = emptyLibrary();
  lib.schemaVersion = 2;
  lib.scans = [fullScan()];
  lib.operations = {
    limit: 5,
    attestations: [{ limit: 5, confirmedAt: 'before', decisionId: 'pilot' }],
    exportConfirmation: { snapshotId: 'scan', confirmedAt: 'export' },
    lastRun: {
      id: 'run',
      decisionIds: ['decision'],
      status: 'running',
      startedAt: 'start',
    },
  };
  lib.decisions = [
    {
      id: 'decision',
      videoId: video.id,
      sessionId: 'session',
      kind: 'archive',
      targetPlaylist: 'PL1234567890123456',
      createdAt: 'before',
      status: 'pending',
      source: 'swipe',
      journal: {
        add: { id: 'add', status: 'verified', attempts: 1, outcome: 'changed' },
        remove: {
          id: 'remove',
          status: 'running',
          attempts: 1,
          evidence: {
            state: 'present',
            observedAt: 'before',
            source: 'native-dialog',
          },
        },
      },
    },
  ];
  await loadLibrary();
  const conn = await openDB('latersift');
  await conn.put('state', lib, 'library');
  conn.close();
  const result = await loadLibrary();
  const expected = structuredClone(lib);
  expected.schemaVersion = 3;
  expected.operations!.lastRun!.status = 'unknown';
  expected.decisions[0].status = 'unknown';
  expected.decisions[0].journal!.remove.status = 'unknown';
  expect(result).toEqual(expected);
  expect((await readStored()).library).toEqual(expected);
  expect(await loadLibrary()).toEqual(expected);
});

it.each([1, 2, 3] as const)(
  'migrates source-less cleanup sessions in schema %i without changing history or explicit provenance',
  async (schemaVersion) => {
    const { lib } = await executionFixture();
    lib.schemaVersion = schemaVersion;
    const decision = lib.decisions[0];
    lib.decisions = [
      {
        ...decision,
        sessionId: `cleanup-${crypto.randomUUID()}`,
        status: 'verified',
        journal: {
          remove: {
            id: crypto.randomUUID(),
            status: 'verified',
            attempts: 1,
            outcome: 'changed',
            updatedAt: 'historical',
          },
        },
      },
      { ...decision, id: 'ordinary-legacy', sessionId: 'ordinary-session' },
      {
        ...decision,
        id: 'explicit-swipe',
        sessionId: 'ordinary-swipe',
        source: 'swipe',
      },
      {
        ...decision,
        id: 'explicit-cleanup',
        sessionId: 'historical-session',
        source: 'cleanup',
      },
    ];
    const expected = structuredClone(lib);
    expected.schemaVersion = 3;
    expected.decisions[0].source = 'cleanup';
    const conn = await openDB('latersift');
    await conn.put('state', lib, 'library');
    conn.close();
    expect(await loadLibrary()).toEqual(expected);
    expect((await readStored()).library).toEqual(expected);
    expect((await readStored()).snapshot).toEqual(fullScan());
    expect(await loadLibrary()).toEqual(expected);
  },
);

it.each(['unknown', 'restricted'] as const)(
  'rejects an unmigrated legacy cleanup with %s availability inside the durable claim',
  async (availability) => {
    const { lib, approval } = await executionFixture();
    lib.decisions[0].sessionId = `cleanup-${crypto.randomUUID()}`;
    lib.scans[0].videos[0] = { ...video, availability };
    await saveCheckpoint(lib, lib.scans[0]);
    expect(lib.decisions[0].source).toBeUndefined();
    await expect(claimExecution(lib, approval)).rejects.toThrow(/Cleanup/);
    expect((await readStored()).library).toEqual(lib);
    const conn = await openDB('latersift');
    expect(await conn.get('state', 'execution-ledger')).toBeUndefined();
    conn.close();
  },
);

it('normalizes schema 3 only after a confirmed saveLibrary commit', async () => {
  const lib = emptyLibrary();
  lib.schemaVersion = 2;
  delete lib.operations;
  const before = structuredClone(lib);
  const put = IDBObjectStore.prototype.put;
  const spy = vi
    .spyOn(IDBObjectStore.prototype, 'put')
    .mockImplementation(function (this: IDBObjectStore, value, key) {
      const request =
        key === undefined ? put.call(this, value) : put.call(this, value, key);
      request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
  await expect(saveLibrary(lib)).rejects.toMatchObject({ name: 'AbortError' });
  expect(lib).toEqual(before);
  spy.mockRestore();
  await saveLibrary(lib);
  expect(lib).toMatchObject({
    schemaVersion: 3,
    operations: { limit: 1, attestations: [] },
  });
  expect((await readStored()).library).toEqual(lib);
});

it('recovers durable running to unknown after a post-click IDB abort; only a new approval rereads', async () => {
  const lib = emptyLibrary();
  await saveCheckpoint(lib, fullScan());
  lib.decisions = [
    {
      id: 'decision',
      videoId: video.id,
      sessionId: 'session',
      kind: 'remove',
      targetPlaylist: null,
      status: 'pending',
      createdAt: 'now',
    },
  ];
  confirmExport(lib, 'scan');
  await saveLibrary(lib);
  const approval = approveExecution(lib, ['decision']);
  let present = true;
  const adapter: WriteAdapter = {
    getAvailablePlaylists: vi.fn(async () => []),
    getPlaylistMembership: vi.fn(async (): Promise<MembershipEvidence> => ({
      state: present ? 'present' : 'absent',
      source: 'native-dialog',
      observedAt: new Date().toISOString(),
    })),
    addToPlaylist: vi.fn(async () => ({ changed: true })),
    removeFromWatchLater: vi.fn(async () => {
      present = false;
      return { changed: true };
    }),
  };
  const put = IDBObjectStore.prototype.put;
  const spy = vi
    .spyOn(IDBObjectStore.prototype, 'put')
    .mockImplementation(function (this: IDBObjectStore, value: Library, key) {
      const request =
        key === undefined ? put.call(this, value) : put.call(this, value, key);
      if (
        this.name === 'state' &&
        key === 'library' &&
        value.decisions[0]?.journal?.remove.status === 'verified'
      )
        request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
  await expect(
    executeApproved(lib, approval, adapter, saveLibrary, undefined, {
      wait: async () => {},
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  spy.mockRestore();
  expect((await readStored()).library.decisions[0].journal.remove.status).toBe(
    'running',
  );
  const restarted = await loadLibrary();
  expect(restarted.decisions[0].status).toBe('unknown');
  expect(restarted.decisions[0].journal?.remove.status).toBe('unknown');
  expect(restarted.operations?.lastRun?.status).toBe('unknown');
  expect(adapter.removeFromWatchLater).toHaveBeenCalledTimes(1);
  await expect(
    executeApproved(restarted, approval, adapter, saveLibrary),
  ).rejects.toThrow(/bereits/);
  const resolved = await executeApproved(
    restarted,
    approveExecution(restarted, ['decision']),
    adapter,
    saveLibrary,
    undefined,
    { wait: async () => {} },
  );
  expect(resolved.decisions[0].journal?.remove.outcome).toBe('already_absent');
  expect(adapter.removeFromWatchLater).toHaveBeenCalledTimes(1);
});

async function executionFixture(snapshot = true) {
  const lib = emptyLibrary();
  if (snapshot) await saveCheckpoint(lib, fullScan());
  else lib.scans = [fullScan()];
  lib.decisions = [
    {
      id: 'decision',
      videoId: video.id,
      sessionId: 'session',
      kind: 'remove',
      targetPlaylist: null,
      status: 'pending',
      createdAt: 'now',
    },
  ];
  confirmExport(lib, 'scan');
  await saveLibrary(lib);
  let present = true;
  const adapter: WriteAdapter = {
    getAvailablePlaylists: vi.fn(async () => []),
    getPlaylistMembership: vi.fn(async (): Promise<MembershipEvidence> => ({
      state: present ? 'present' : 'absent',
      observedAt: new Date().toISOString(),
      source: 'native-dialog',
    })),
    addToPlaylist: vi.fn(async () => ({ changed: true })),
    removeFromWatchLater: vi.fn(async () => {
      present = false;
      return { changed: true };
    }),
  };
  return { lib, adapter, approval: approveExecution(lib, ['decision']) };
}

it.each([
  'missing',
  'incomplete',
  'different-position',
  'different-video',
  'different-dataset',
])(
  'blocks execution against an actual %s snapshot before any WAL or adapter call',
  async (mode) => {
    const { lib, adapter, approval } = await executionFixture(
      mode !== 'missing',
    );
    if (mode !== 'missing') {
      const snapshot = fullScan();
      if (mode === 'incomplete') snapshot.status = 'incomplete';
      if (mode === 'different-position')
        snapshot.videos[0] = { ...video, position: 2 };
      if (mode === 'different-video')
        snapshot.videos[0] = { ...video, id: 'bbbbbbbbbbb' };
      if (mode === 'different-dataset') snapshot.videos = [];
      const conn = await openDB('latersift');
      await conn.put('snapshots', snapshot);
      conn.close();
    }
    const commit = vi.fn(saveLibrary);
    await expect(
      executeApproved(lib, approval, adapter, commit),
    ).rejects.toThrow(/Snapshot/);
    expect(commit).not.toHaveBeenCalled();
    expect(adapter.getPlaylistMembership).not.toHaveBeenCalled();
    expect(adapter.getAvailablePlaylists).not.toHaveBeenCalled();
    expect(adapter.removeFromWatchLater).not.toHaveBeenCalled();
    expect((await readStored()).library).toEqual(lib);
  },
);

it('rejects a completed approval and a new approval from the original stale clone', async () => {
  const { lib, adapter, approval } = await executionFixture();
  const stale = structuredClone(lib);
  await executeApproved(lib, approval, adapter, saveLibrary, undefined, {
    wait: async () => {},
  });
  const durable = (await readStored()).library;
  await expect(
    executeApproved(stale, approval, adapter, saveLibrary),
  ).rejects.toThrow(/bereits/);
  await expect(
    executeApproved(
      stale,
      approveExecution(stale, ['decision']),
      adapter,
      saveLibrary,
    ),
  ).rejects.toThrow(/Veralteter/);
  expect(adapter.removeFromWatchLater).toHaveBeenCalledTimes(1);
  expect((await readStored()).library).toEqual(durable);
});

it('keeps the consumed approval ledger even when stale saveLibrary overwrites the library', async () => {
  const { lib, adapter, approval } = await executionFixture();
  await executeApproved(lib, approval, adapter, saveLibrary, undefined, {
    wait: async () => {},
  });
  await saveLibrary(lib);
  expect((await readStored()).library).toEqual(lib);
  await expect(
    executeApproved(lib, approval, adapter, saveLibrary),
  ).rejects.toThrow(/bereits/);
  const conn = await openDB('latersift');
  expect(await conn.get('state', 'execution-ledger')).toMatchObject({
    kind: 'execution-ledger',
    consumedApprovalIds: [approval.id],
  });
  conn.close();
  expect(adapter.removeFromWatchLater).toHaveBeenCalledTimes(1);
});

it('serializes simultaneous different-ID claims before the first WAL and rejects a stale claim afterward', async () => {
  const { lib, approval } = await executionFixture();
  const other = approveExecution(lib, ['decision']);
  const results = await Promise.allSettled([
    claimExecution(lib, approval),
    claimExecution(structuredClone(lib), other),
  ]);
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
  const durable = (await readStored()).library;
  expect(durable.operations.lastRun).toMatchObject({
    id: approval.id,
    status: 'running',
  });
  await expect(
    claimExecution(lib, approveExecution(lib, ['decision'])),
  ).rejects.toThrow(/Veralteter/);
  expect((await readStored()).library).toEqual(durable);
});

it('uses canonical content rather than object key order for the claim CAS', async () => {
  const { lib, approval } = await executionFixture();
  const reordered = Object.fromEntries(
    Object.entries(lib).reverse(),
  ) as unknown as Library;
  await expect(claimExecution(reordered, approval)).resolves.toBeUndefined();
});

it('validates approved actions against durable decisions inside claimExecution', async () => {
  const { lib, approval } = await executionFixture();
  approval.actions[0].videoId = 'bbbbbbbbbbb';
  await expect(claimExecution(lib, approval)).rejects.toThrow(/Freigabe/);
  expect((await readStored()).library).toEqual(lib);
});

it('rejects changed durable decisions even when a stale caller creates a fresh approval', async () => {
  const { lib, adapter } = await executionFixture();
  const updated = structuredClone(lib);
  updated.decisions[0].kind = 'defer';
  await saveLibrary(updated);
  await expect(
    executeApproved(
      lib,
      approveExecution(lib, ['decision']),
      adapter,
      saveLibrary,
    ),
  ).rejects.toThrow(/Veralteter/);
  expect(adapter.getPlaylistMembership).not.toHaveBeenCalled();
});

it('claim transaction abort rolls back ledger and reservation and makes no remote call', async () => {
  const { lib, adapter, approval } = await executionFixture();
  const put = IDBObjectStore.prototype.put;
  const spy = vi
    .spyOn(IDBObjectStore.prototype, 'put')
    .mockImplementation(function (this: IDBObjectStore, value, key) {
      const request =
        key === undefined ? put.call(this, value) : put.call(this, value, key);
      if (key === 'execution-ledger')
        request.addEventListener('success', () => this.transaction.abort());
      return request;
    });
  const commit = vi.fn(saveLibrary);
  await expect(
    executeApproved(lib, approval, adapter, commit),
  ).rejects.toMatchObject({ name: 'AbortError' });
  spy.mockRestore();
  expect(commit).not.toHaveBeenCalled();
  expect(adapter.getPlaylistMembership).not.toHaveBeenCalled();
  expect(adapter.removeFromWatchLater).not.toHaveBeenCalled();
  expect((await readStored()).library).toEqual(lib);
  const conn = await openDB('latersift');
  expect(await conn.get('state', 'execution-ledger')).toBeUndefined();
  conn.close();
  await expect(claimExecution(lib, approval)).resolves.toBeUndefined();
});

async function mutationFixture(
  kind: 'remove' | 'archive' = 'remove',
  method: 'add' | 'remove' = 'remove',
) {
  const { lib } = await executionFixture();
  lib.decisions[0].kind = kind;
  lib.decisions[0].targetPlaylist =
    kind === 'archive' ? 'PL1234567890123456' : null;
  await saveLibrary(lib);
  const approval = approveExecution(lib, ['decision']);
  await claimExecution(lib, approval);
  const running = (await readStored()).library as Library;
  const decision = running.decisions[0];
  decision.status = 'running';
  decision.journal = {
    remove: {
      id: crypto.randomUUID(),
      status: method === 'remove' ? 'running' : 'pending',
      attempts: method === 'remove' ? 1 : 0,
    },
  };
  if (kind === 'archive')
    decision.journal.add = {
      id: crypto.randomUUID(),
      status: method === 'add' ? 'running' : 'verified',
      attempts: 1,
      evidence: {
        state: 'present',
        source: 'native-dialog',
        observedAt: new Date().toISOString(),
      },
    };
  await saveLibrary(running);
  const request: WriteRequest = {
    type: 'request',
    method,
    videoId: video.id,
    approval: structuredClone(approval),
    ...(method === 'add' ? { playlistId: decision.targetPlaylist! } : {}),
  };
  return { running, approval, request };
}

it('does not authorize raw valid approvals without a durable claim and running WAL', async () => {
  const { lib, approval } = await executionFixture();
  const request: WriteRequest = {
    type: 'request',
    method: 'remove',
    videoId: video.id,
    approval,
  };
  await expect(authorizeMutation(request)).rejects.toThrow(/Freigabe/);
  await claimExecution(lib, approval);
  await expect(authorizeMutation(request)).rejects.toThrow(/WAL/);
  const conn = await openDB('latersift');
  expect(
    (await conn.get('state', 'execution-ledger')).issuedMutationKeys,
  ).toEqual([]);
  conn.close();
});

it('atomically authorizes a running attempt once across concurrent callers, despite stale saveLibrary', async () => {
  const { running, approval, request } = await mutationFixture();
  const results = await Promise.allSettled([
    authorizeMutation(request),
    authorizeMutation(structuredClone(request)),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  await saveLibrary(running);
  await expect(authorizeMutation(request)).rejects.toThrow(
    /bereits autorisiert/,
  );
  const conn = await openDB('latersift');
  const ledger = await conn.get('state', 'execution-ledger');
  conn.close();
  expect(ledger.activeApproval).toEqual(approval);
  expect(ledger.issuedMutationKeys).toEqual([
    `${approval.id}:${running.decisions[0].journal!.remove.id}:1:remove`,
  ]);
});

it.each(['playlists', 'membership'] as const)(
  'rejects nonmutation method %s at the authorization boundary',
  async (method) => {
    const { request } = await mutationFixture();
    await expect(
      authorizeMutation({ ...request, method, playlistId: 'WL' }),
    ).rejects.toThrow(/Mutationen/);
  },
);

it.each(['id', 'decision', 'timestamps'] as const)(
  'rejects a modified claimed grant (%s)',
  async (field) => {
    const { request } = await mutationFixture();
    if (field === 'id') request.approval!.id = crypto.randomUUID();
    if (field === 'decision') request.approval!.actions[0].decisionId = 'other';
    if (field === 'timestamps') {
      request.approval!.createdAt = new Date(
        Date.parse(request.approval!.createdAt) - 1,
      ).toISOString();
      request.approval!.expiresAt = new Date(
        Date.parse(request.approval!.expiresAt) - 1,
      ).toISOString();
    }
    await expect(authorizeMutation(request)).rejects.toThrow(/Freigabe/);
  },
);

it.each([
  'wrong-run',
  'complete-run',
  'stopped-run',
  'unknown-run',
  'selection',
  'kind',
  'video',
  'target',
  'decision-pending',
  'decision-verified',
  'decision-failed',
  'decision-unknown',
  'step-pending',
  'step-verified',
  'step-failed',
  'step-unknown',
  'missing-step',
  'missing-step-id',
  'no-attempt',
  'fractional-attempt',
])('rejects invalid durable mutation state: %s', async (mode) => {
  const { running, request } = await mutationFixture();
  const run = running.operations!.lastRun!;
  const decision = running.decisions[0];
  if (mode === 'wrong-run') run.id = 'other';
  if (mode === 'complete-run') run.status = 'complete';
  if (mode === 'stopped-run') run.status = 'stopped';
  if (mode === 'unknown-run') run.status = 'unknown';
  if (mode === 'selection') run.decisionIds = ['other'];
  if (mode === 'kind') decision.kind = 'defer';
  if (mode === 'video') decision.videoId = 'bbbbbbbbbbb';
  if (mode === 'target') decision.targetPlaylist = 'PL1234567890123456';
  if (mode === 'decision-pending') decision.status = 'pending';
  if (mode === 'decision-verified') decision.status = 'verified';
  if (mode === 'decision-failed') decision.status = 'failed';
  if (mode === 'decision-unknown') decision.status = 'unknown';
  if (mode === 'step-pending') decision.journal!.remove.status = 'pending';
  if (mode === 'step-verified') decision.journal!.remove.status = 'verified';
  if (mode === 'step-failed') decision.journal!.remove.status = 'failed';
  if (mode === 'step-unknown') decision.journal!.remove.status = 'unknown';
  if (mode === 'missing-step') delete decision.journal;
  if (mode === 'missing-step-id') decision.journal!.remove.id = '';
  if (mode === 'no-attempt') decision.journal!.remove.attempts = 0;
  if (mode === 'fractional-attempt') decision.journal!.remove.attempts = 1.5;
  await saveLibrary(running);
  await expect(authorizeMutation(request)).rejects.toThrow();
});

it.each([
  'missing-snapshot',
  'changed-snapshot',
  'changed-dataset-both',
  'duplicate-scan-id',
  'new-latest',
  'incomplete-latest',
  'missing-export',
  'changed-export',
])('rechecks snapshot/export at authorization (%s)', async (mode) => {
  const { running, request } = await mutationFixture();
  if (mode === 'new-latest') running.scans.push({ ...fullScan(), id: 'new' });
  if (mode === 'incomplete-latest') running.scans[0].status = 'incomplete';
  if (mode === 'missing-export') delete running.operations!.exportConfirmation;
  if (mode === 'changed-export')
    running.operations!.exportConfirmation!.confirmedAt = 'changed';
  if (mode === 'changed-dataset-both')
    running.scans[0].message = 'new dataset under same ID';
  if (mode === 'duplicate-scan-id')
    running.scans.push(structuredClone(running.scans[0]));
  await saveLibrary(running);
  const conn = await openDB('latersift');
  if (mode === 'missing-snapshot') await conn.delete('snapshots', 'scan');
  if (mode === 'changed-snapshot')
    await conn.put('snapshots', { ...fullScan(), videos: [] });
  if (mode === 'changed-dataset-both')
    await conn.put('snapshots', running.scans[0]);
  conn.close();
  await expect(authorizeMutation(request)).rejects.toThrow(/Snapshot/);
});

it.each([
  'pending',
  'running',
  'failed',
  'unknown',
  'absent',
  'unknown-evidence',
  'missing-evidence',
  'invalid-observed-at',
])(
  'blocks archive removal without persisted verified present evidence (%s)',
  async (mode) => {
    const { running, request } = await mutationFixture('archive');
    const add = running.decisions[0].journal!.add!;
    if (mode === 'pending') add.status = 'pending';
    if (mode === 'running') add.status = 'running';
    if (mode === 'failed') add.status = 'failed';
    if (mode === 'unknown') add.status = 'unknown';
    if (mode === 'absent') add.evidence!.state = 'absent';
    if (mode === 'unknown-evidence') add.evidence!.state = 'unknown';
    if (mode === 'missing-evidence') delete add.evidence;
    if (mode === 'invalid-observed-at') add.evidence!.observedAt = 'invalid';
    await saveLibrary(running);
    await expect(authorizeMutation(request)).rejects.toThrow(/Archivierung/);
  },
);

it('authorizes archive add and then remove only after the add verification and remove WAL are durable', async () => {
  const { running, request, approval } = await mutationFixture(
    'archive',
    'add',
  );
  await authorizeMutation(request);
  const remove: WriteRequest = {
    type: 'request',
    method: 'remove',
    videoId: video.id,
    approval,
  };
  await expect(authorizeMutation(remove)).rejects.toThrow(/WAL/);
  running.decisions[0].journal!.remove.status = 'running';
  running.decisions[0].journal!.remove.attempts = 1;
  await saveLibrary(running);
  await expect(authorizeMutation(remove)).rejects.toThrow(/Archivierung/);
  running.decisions[0].journal!.add!.status = 'verified';
  await saveLibrary(running);
  await expect(authorizeMutation(remove)).resolves.toBeUndefined();
});

it('rejects the previous active grant even if its old running WAL is restored', async () => {
  const { running, request } = await mutationFixture();
  const recovered = await loadLibrary();
  const next = approveExecution(recovered, ['decision']);
  await claimExecution(recovered, next);
  await saveLibrary(running);
  await expect(authorizeMutation(request)).rejects.toThrow(/Freigabe/);
});

it.each(['abort', 'throw'] as const)(
  'rolls back a mutation permit on authorization storage %s',
  async (mode) => {
    const { request } = await mutationFixture();
    const put = IDBObjectStore.prototype.put;
    const spy = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function (this: IDBObjectStore, value, key) {
        if (key === 'execution-ledger' && mode === 'throw')
          throw new DOMException('Storage full', 'QuotaExceededError');
        const req =
          key === undefined
            ? put.call(this, value)
            : put.call(this, value, key);
        if (key === 'execution-ledger')
          req.addEventListener('success', () => this.transaction.abort());
        return req;
      });
    await expect(authorizeMutation(request)).rejects.toMatchObject({
      name: mode === 'abort' ? 'AbortError' : 'QuotaExceededError',
    });
    spy.mockRestore();
    const conn = await openDB('latersift');
    expect(
      (await conn.get('state', 'execution-ledger')).issuedMutationKeys,
    ).toEqual([]);
    conn.close();
    await expect(authorizeMutation(request)).resolves.toBeUndefined();
  },
);

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
