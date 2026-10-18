import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimExecution } from '../src/storage';

vi.mock('../src/storage', () => ({ claimExecution: vi.fn(async () => {}) }));
beforeEach(() =>
  vi.mocked(claimExecution).mockReset().mockResolvedValue(undefined),
);
import { emptyLibrary, type Library, type Video } from '../src/model';
import {
  acknowledgeLiveStage,
  approveExecution,
  confirmExport,
  executeApproved,
  operationState,
  type MembershipEvidence,
  type WriteAdapter,
} from '../src/operations';

const target = 'PL1234567890123456';
const timestamp = () => new Date().toISOString();
const evidence = (state: MembershipEvidence['state']): MembershipEvidence => ({
  state,
  observedAt: timestamp(),
  source: 'native-dialog',
});
function fixture(count = 1, kind: 'archive' | 'remove' = 'remove') {
  const lib = emptyLibrary();
  const videos: Video[] = Array.from({ length: count }, (_, i) => ({
    id: String(i).padStart(11, '0'),
    url: '',
    title: null,
    channel: null,
    thumbnail: null,
    durationSeconds: null,
    publishedAt: null,
    position: i + 1,
    availability: 'available',
    evidence: null,
    scannedAt: timestamp(),
    originalPlaylist: 'WL',
  }));
  lib.scans = [
    {
      id: 'scan',
      status: 'complete',
      startedAt: timestamp(),
      finishedAt: timestamp(),
      videos,
      expectedCount: count,
      unidentifiableRows: 0,
      message: '',
    },
  ];
  lib.decisions = videos.map((v, i) => ({
    id: `decision-${i}`,
    videoId: v.id,
    sessionId: 'session',
    createdAt: timestamp(),
    kind,
    status: 'pending',
    targetPlaylist: kind === 'archive' ? target : null,
  }));
  confirmExport(lib, 'scan');
  return lib;
}
function batch(lib: Library, limit: 5 | 25 = 5) {
  lib.operations!.limit = limit;
  lib.operations!.attestations = [
    { limit: 5, decisionId: 'pilot', confirmedAt: timestamp() },
  ];
  if (limit === 25)
    lib.operations!.attestations.push({
      limit: 25,
      decisionId: 'pilot5',
      confirmedAt: timestamp(),
    });
}
function harness(lib: Library) {
  const wl = new Set(lib.scans[0].videos.map((v) => v.id));
  const archived = new Set<string>();
  const events: string[] = [];
  const commits: Library[] = [];
  const adapter: WriteAdapter = {
    getAvailablePlaylists: vi.fn(async () => [
      { id: target, title: 'Archive', writable: true },
    ]),
    getPlaylistMembership: vi.fn(async (id, playlist) => {
      events.push(`read:${playlist}`);
      return evidence(
        (playlist === 'WL' ? wl : archived).has(id) ? 'present' : 'absent',
      );
    }),
    addToPlaylist: vi.fn(async (id) => {
      events.push('add');
      archived.add(id);
      return { changed: true };
    }),
    removeFromWatchLater: vi.fn(async (id) => {
      events.push('remove');
      wl.delete(id);
      return { changed: true };
    }),
  };
  const commit = vi.fn(async (state: Library) => {
    events.push(
      `commit:${state.decisions[0].journal?.add?.status ?? '-'}:${state.decisions[0].journal?.remove.status}`,
    );
    commits.push(structuredClone(state));
  });
  const waits: number[] = [];
  const wait = vi.fn(async (milliseconds: number) => {
    waits.push(milliseconds);
  });
  const run = (stop = () => false) =>
    executeApproved(
      lib,
      approveExecution(
        lib,
        lib.decisions.map((d) => d.id),
      ),
      adapter,
      commit,
      stop,
      { wait },
    );
  return { wl, archived, events, commits, adapter, commit, wait, run };
}
afterEach(() => vi.restoreAllMocks());

describe('approval gates', () => {
  it('reads migration defaults without effects', () => {
    const lib = fixture();
    delete lib.operations;
    lib.schemaVersion = 2;
    const before = structuredClone(lib);
    expect(operationState(lib)).toEqual({ limit: 1, attestations: [] });
    expect(lib).toEqual(before);
  });
  it('requires an export of the latest complete CURRENT scan', () => {
    const lib = fixture();
    delete lib.operations!.exportConfirmation;
    expect(() => approveExecution(lib, ['decision-0'])).toThrow(/Export/);
    expect(() => confirmExport(lib, 'wrong')).toThrow();
    confirmExport(lib, 'scan');
    lib.scans.push({ ...lib.scans[0], id: 'new', status: 'incomplete' });
    expect(() => confirmExport(lib, 'scan')).toThrow();
    expect(() => approveExecution(lib, ['decision-0'])).toThrow();
    lib.scans[1].status = 'complete';
    expect(() => approveExecution(lib, ['decision-0'])).toThrow(/Export/);
  });
  it.each([
    'empty',
    'duplicate-selection',
    'defer',
    'missing',
    'invalid-video',
    'duplicate-video',
    'duplicate-decision',
    'invalid-target',
    'running',
    'cap',
    'unattested',
  ])('rejects %s before starting', (mode) => {
    const lib = fixture(2, 'archive');
    let ids = ['decision-0'];
    if (mode === 'empty') ids = [];
    if (mode === 'duplicate-selection') ids = ['decision-0', 'decision-0'];
    if (mode === 'defer') lib.decisions[0].kind = 'defer';
    if (mode === 'missing') lib.scans[0].videos.shift();
    if (mode === 'invalid-video')
      lib.decisions[0].videoId = lib.scans[0].videos[0].id = 'invalid';
    if (mode === 'duplicate-video')
      lib.decisions[1].videoId = lib.decisions[0].videoId;
    if (mode === 'duplicate-decision')
      lib.decisions[1].id = lib.decisions[0].id;
    if (mode === 'invalid-target') lib.decisions[0].targetPlaylist = 'WL';
    if (mode === 'running') lib.decisions[0].status = 'running';
    if (mode === 'cap') ids.push('decision-1');
    if (mode === 'unattested') lib.operations!.limit = 5;
    expect(() => approveExecution(lib, ids)).toThrow();
  });
  it('enforces TTL and exact approved actions again at execution', async () => {
    const lib = fixture();
    const h = harness(lib);
    const approval = approveExecution(lib, ['decision-0']);
    expect(
      Date.parse(approval.expiresAt) - Date.parse(approval.createdAt),
    ).toBe(900000);
    await expect(
      executeApproved(
        lib,
        { ...approval, expiresAt: '2000-01-01' },
        h.adapter,
        h.commit,
      ),
    ).rejects.toThrow();
    approval.actions[0].videoId = 'xxxxxxxxxxx';
    await expect(
      executeApproved(lib, approval, h.adapter, h.commit),
    ).rejects.toThrow();
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.adapter.removeFromWatchLater).not.toHaveBeenCalled();
  });
  it.each(['unknown', 'restricted'] as const)(
    'blocks legacy cleanup with %s availability before and after approval',
    async (availability) => {
      const lib = fixture();
      lib.decisions[0].sessionId = `cleanup-${crypto.randomUUID()}`;
      expect(lib.decisions[0].source).toBeUndefined();
      lib.scans[0].videos[0].availability = availability;
      expect(() => approveExecution(lib, ['decision-0'])).toThrow(/Cleanup/);
      lib.scans[0].videos[0].availability = 'private';
      const approval = approveExecution(lib, ['decision-0']);
      lib.scans[0].videos[0].availability = availability;
      const h = harness(lib);
      await expect(
        executeApproved(lib, approval, h.adapter, h.commit),
      ).rejects.toThrow(/Cleanup/);
      expect(h.commit).not.toHaveBeenCalled();
      expect(h.adapter.getPlaylistMembership).not.toHaveBeenCalled();
      expect(lib.decisions[0].source).toBeUndefined();
    },
  );
  it.each(['unknown', 'restricted'] as const)(
    'allows explicit ordinary swipe decisions with %s availability',
    (availability) => {
      const lib = fixture();
      lib.decisions[0].source = 'swipe';
      lib.scans[0].videos[0].availability = availability;
      expect(approveExecution(lib, ['decision-0']).actions[0].decisionId).toBe(
        'decision-0',
      );
    },
  );
  it.each(['private', 'removed'] as const)(
    'allows safe legacy cleanup with %s availability',
    (availability) => {
      const lib = fixture();
      lib.decisions[0].sessionId = `cleanup-${crypto.randomUUID()}`;
      lib.scans[0].videos[0].availability = availability;
      expect(approveExecution(lib, ['decision-0']).actions[0].decisionId).toBe(
        'decision-0',
      );
    },
  );
  it('rechecks cleanup evidence at approval and at execution', async () => {
    const lib = fixture();
    lib.decisions[0].source = 'cleanup';
    expect(() => approveExecution(lib, ['decision-0'])).toThrow(/Cleanup/);
    lib.scans[0].videos[0].availability = 'private';
    const approval = approveExecution(lib, ['decision-0']);
    lib.scans[0].videos[0].availability = 'unknown';
    const h = harness(lib);
    await expect(
      executeApproved(lib, approval, h.adapter, h.commit),
    ).rejects.toThrow(/Cleanup/);
    expect(h.commit).not.toHaveBeenCalled();
  });
});

describe('serial fail-closed executor', () => {
  it('claims durably before the first WAL or adapter call and propagates claim failure', async () => {
    const lib = fixture();
    const h = harness(lib);
    vi.mocked(claimExecution).mockRejectedValueOnce(new Error('claim abort'));
    await expect(h.run()).rejects.toThrow('claim abort');
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.adapter.getPlaylistMembership).not.toHaveBeenCalled();
    expect(h.adapter.getAvailablePlaylists).not.toHaveBeenCalled();
    expect(h.adapter.removeFromWatchLater).not.toHaveBeenCalled();
  });
  it('does not count a remove no-op race as a real live pilot', async () => {
    const lib = fixture();
    const h = harness(lib);
    vi.mocked(h.adapter.removeFromWatchLater).mockImplementation(async (id) => {
      h.wl.delete(id);
      return { changed: false };
    });
    const result = await h.run();
    expect(result.decisions[0].journal?.remove).toMatchObject({
      status: 'verified',
      outcome: 'already_absent',
    });
    expect(() => acknowledgeLiveStage(result, 5, 'decision-0')).toThrow();
  });
  it('records archive no-op as already_present, not changed', async () => {
    const lib = fixture(1, 'archive');
    const h = harness(lib);
    vi.mocked(h.adapter.addToPlaylist).mockImplementation(async (id) => {
      h.archived.add(id);
      return { changed: false };
    });
    const result = await h.run();
    expect(result.decisions[0].journal?.add).toMatchObject({
      status: 'verified',
      outcome: 'already_present',
    });
  });
  it.each([undefined, {}, { changed: 'true' }])(
    'missing/invalid mutation result is unknown (%j)',
    async (invalid) => {
      const lib = fixture();
      const h = harness(lib);
      vi.mocked(h.adapter.removeFromWatchLater).mockImplementation(
        async (id) => {
          h.wl.delete(id);
          return invalid as unknown as { changed: boolean };
        },
      );
      const result = await h.run();
      expect(result.decisions[0].status).toBe('unknown');
      expect(result.decisions[0].journal?.remove.outcome).toBeUndefined();
      expect(() => acknowledgeLiveStage(result, 5, 'decision-0')).toThrow();
    },
  );
  it('persists run and running steps before clicks; verifies and persists add before removal', async () => {
    const lib = fixture(1, 'archive');
    const before = structuredClone(lib);
    const h = harness(lib);
    const result = await h.run();
    expect(lib).toEqual(before);
    expect(result.decisions[0].status).toBe('verified');
    const add = h.events.indexOf('add'),
      remove = h.events.indexOf('remove');
    expect(h.events.slice(0, add)).toContain('commit:running:pending');
    expect(h.events.slice(add + 1, remove)).toContain(
      'commit:verified:pending',
    );
    expect(
      h.events.slice(add + 1, remove).filter((e) => e === `read:${target}`)
        .length,
    ).toBeGreaterThanOrEqual(2);
    expect(h.events[remove - 1]).toBe('commit:verified:running');
    expect(h.wait).toHaveBeenCalled();
    expect(h.wait.mock.calls[0][0]).toBeGreaterThan(900);
    const journal = result.decisions[0].journal!;
    expect(journal.add?.id).not.toBe(journal.remove.id);
    expect(journal.remove.id).toMatch(/^[\da-f-]{36}$/);
    expect(result.operations?.limit).toBe(1);
    expect(result.operations?.attestations).toEqual([]);
  });
  it('keeps successful add durable when remove is observed to fail and stops the batch', async () => {
    const lib = fixture(2, 'archive');
    batch(lib);
    const h = harness(lib);
    vi.mocked(h.adapter.removeFromWatchLater).mockImplementation(async () => ({
      changed: true,
    }));
    const result = await h.run();
    expect(result.decisions[0].journal?.add).toMatchObject({
      status: 'verified',
      outcome: 'changed',
    });
    expect(result.decisions[0].journal?.remove.status).toBe('failed');
    expect(result.decisions[1].status).toBe('pending');
    expect(h.adapter.addToPlaylist).toHaveBeenCalledTimes(1);
    expect(result.operations?.lastRun?.status).toBe('stopped');
  });
  it('skips existing target but freshly verifies it before remove', async () => {
    const lib = fixture(1, 'archive');
    const h = harness(lib);
    h.archived.add(lib.decisions[0].videoId);
    const result = await h.run();
    expect(h.adapter.addToPlaylist).not.toHaveBeenCalled();
    expect(result.decisions[0].journal?.add).toMatchObject({
      status: 'verified',
      attempts: 0,
      outcome: 'already_present',
    });
    expect(h.events.filter((e) => e === `read:${target}`)).toHaveLength(2);
  });
  it('never removes when the target disappears after verified add', async () => {
    const lib = fixture(1, 'archive');
    const h = harness(lib);
    let targetReads = 0;
    vi.mocked(h.adapter.getPlaylistMembership).mockImplementation(
      async (_, playlist) => {
        if (playlist === 'WL') return evidence('present');
        return evidence(++targetReads === 2 ? 'present' : 'absent');
      },
    );
    const result = await h.run();
    expect(result.decisions[0].status).toBe('unknown');
    expect(h.adapter.removeFromWatchLater).not.toHaveBeenCalled();
  });
  it('does not claim a change for already absent WL', async () => {
    const lib = fixture();
    const h = harness(lib);
    h.wl.clear();
    const result = await h.run();
    expect(result.decisions[0].journal?.remove).toMatchObject({
      attempts: 0,
      outcome: 'already_absent',
      status: 'verified',
    });
    expect(h.adapter.removeFromWatchLater).not.toHaveBeenCalled();
    expect(() => acknowledgeLiveStage(result, 5, 'decision-0')).toThrow();
  });
  it('stops unknown preflight without mutation', async () => {
    const lib = fixture();
    const h = harness(lib);
    vi.mocked(h.adapter.getPlaylistMembership).mockResolvedValue(
      evidence('unknown'),
    );
    expect((await h.run()).decisions[0].status).toBe('unknown');
    expect(h.adapter.removeFromWatchLater).not.toHaveBeenCalled();
  });
  it('requires a freshly writable archive target', async () => {
    const lib = fixture(1, 'archive');
    const h = harness(lib);
    vi.mocked(h.adapter.getAvailablePlaylists).mockResolvedValue([
      { id: target, writable: false, title: '' },
    ]);
    expect((await h.run()).decisions[0].status).toBe('unknown');
    expect(h.adapter.addToPlaylist).not.toHaveBeenCalled();
    expect(h.adapter.removeFromWatchLater).not.toHaveBeenCalled();
  });
  it('disconnect is unknown, no automatic retry; explicit new approval rereads before clicking', async () => {
    const lib = fixture();
    const h = harness(lib);
    vi.mocked(h.adapter.removeFromWatchLater).mockImplementation(async (id) => {
      h.wl.delete(id);
      throw new Error('disconnect');
    });
    const approval = approveExecution(lib, ['decision-0']);
    const result = await executeApproved(lib, approval, h.adapter, h.commit);
    expect(result.decisions[0].status).toBe('unknown');
    expect(h.adapter.removeFromWatchLater).toHaveBeenCalledTimes(1);
    await expect(
      executeApproved(result, approval, h.adapter, h.commit),
    ).rejects.toThrow(/bereits/);
    const retried = await executeApproved(
      result,
      approveExecution(result, ['decision-0']),
      h.adapter,
      h.commit,
    );
    expect(retried.decisions[0].journal?.remove.outcome).toBe('already_absent');
    expect(h.adapter.removeFromWatchLater).toHaveBeenCalledTimes(1);
  });
  it('never trusts an old verified archive add on explicit retry', async () => {
    const lib = fixture(1, 'archive');
    const h = harness(lib);
    lib.decisions[0].status = 'unknown';
    lib.decisions[0].journal = {
      add: {
        id: crypto.randomUUID(),
        status: 'verified',
        attempts: 1,
        outcome: 'changed',
      },
      remove: { id: crypto.randomUUID(), status: 'unknown', attempts: 0 },
    };
    vi.mocked(h.adapter.getPlaylistMembership).mockResolvedValue(
      evidence('unknown'),
    );
    const result = await h.run();
    expect(result.decisions[0].journal?.add).toEqual(
      lib.decisions[0].journal.add,
    );
    expect(result.decisions[0].status).toBe('unknown');
    expect(h.adapter.removeFromWatchLater).not.toHaveBeenCalled();
    expect(h.adapter.addToPlaylist).not.toHaveBeenCalled();
  });
  it('unknown post-add verification stops before removal without retry', async () => {
    const lib = fixture(1, 'archive');
    const h = harness(lib);
    vi.mocked(h.adapter.addToPlaylist).mockImplementation(async (id) => {
      h.archived.add(id);
      vi.mocked(h.adapter.getPlaylistMembership).mockResolvedValue(
        evidence('unknown'),
      );
      return { changed: true };
    });
    const result = await h.run();
    expect(result.decisions[0].journal?.add?.status).toBe('unknown');
    expect(h.adapter.addToPlaylist).toHaveBeenCalledTimes(1);
    expect(h.adapter.removeFromWatchLater).not.toHaveBeenCalled();
  });
  it('does not remove after verified-add storage failure', async () => {
    const lib = fixture(1, 'archive');
    const h = harness(lib);
    h.commit.mockImplementation(async (state) => {
      if (state.decisions[0].journal?.add?.status === 'verified')
        throw new Error('persist add');
      h.commits.push(structuredClone(state));
    });
    await expect(h.run()).rejects.toThrow('persist add');
    expect(h.commits.at(-1)?.decisions[0].journal?.add?.status).toBe('running');
    expect(h.adapter.addToPlaylist).toHaveBeenCalledTimes(1);
    expect(h.adapter.removeFromWatchLater).not.toHaveBeenCalled();
    expect(h.commit).toHaveBeenCalledTimes(3);
  });
  it('stops on a missing previously verified target even with another fresh approval', async () => {
    const lib = fixture(1, 'archive');
    const h = harness(lib);
    vi.mocked(h.adapter.removeFromWatchLater).mockImplementationOnce(
      async () => ({ changed: true }),
    );
    const failed = await h.run();
    h.archived.clear();
    const result = await executeApproved(
      failed,
      approveExecution(failed, ['decision-0']),
      h.adapter,
      h.commit,
      undefined,
      { wait: h.wait },
    );
    expect(result.decisions[0].status).toBe('unknown');
    expect(result.decisions[0].journal?.add).toMatchObject({
      status: 'verified',
      attempts: 1,
      outcome: 'changed',
    });
    expect(result.decisions[0].journal?.add?.message).toContain('Manuell');
    expect(h.adapter.addToPlaylist).toHaveBeenCalledTimes(1);
    expect(h.adapter.removeFromWatchLater).toHaveBeenCalledTimes(1);
    const again = await executeApproved(
      result,
      approveExecution(result, ['decision-0']),
      h.adapter,
      h.commit,
      undefined,
      { wait: h.wait },
    );
    expect(again.decisions[0].status).toBe('unknown');
    expect(h.adapter.addToPlaylist).toHaveBeenCalledTimes(1);
    expect(h.adapter.removeFromWatchLater).toHaveBeenCalledTimes(1);
  });
  it('never deletes WL again when a previously verified remove contradicts fresh presence', async () => {
    const lib = fixture();
    const h = harness(lib);
    lib.decisions[0].status = 'unknown';
    lib.decisions[0].journal = {
      remove: {
        id: crypto.randomUUID(),
        status: 'verified',
        attempts: 1,
        outcome: 'changed',
        evidence: evidence('absent'),
      },
    };
    const result = await h.run();
    expect(result.decisions[0].status).toBe('unknown');
    expect(result.decisions[0].journal?.remove).toMatchObject({
      status: 'verified',
      attempts: 1,
      outcome: 'changed',
    });
    const again = await executeApproved(
      result,
      approveExecution(result, ['decision-0']),
      h.adapter,
      h.commit,
      undefined,
      { wait: h.wait },
    );
    expect(again.decisions[0].status).toBe('unknown');
    expect(h.adapter.removeFromWatchLater).not.toHaveBeenCalled();
  });
  it('preserves verified evidence and outcome on a consistent resume without repeating the add', async () => {
    const lib = fixture(1, 'archive');
    const h = harness(lib);
    const add = {
      id: crypto.randomUUID(),
      status: 'verified' as const,
      attempts: 1,
      outcome: 'changed' as const,
      evidence: evidence('present'),
    };
    lib.decisions[0].status = 'unknown';
    lib.decisions[0].journal = {
      add,
      remove: { id: crypto.randomUUID(), status: 'unknown', attempts: 0 },
    };
    h.archived.add(lib.decisions[0].videoId);
    const result = await h.run();
    expect(result.decisions[0].status).toBe('verified');
    expect(result.decisions[0].journal?.add).toEqual(add);
    expect(h.adapter.addToPlaylist).not.toHaveBeenCalled();
    expect(h.adapter.removeFromWatchLater).toHaveBeenCalledTimes(1);
  });
  it('keeps missing WL classified as already_absent even when the archive is missing', async () => {
    const lib = fixture(1, 'archive');
    const h = harness(lib);
    h.wl.clear();
    const result = await h.run();
    expect(result.decisions[0].journal?.remove.outcome).toBe('already_absent');
    expect(h.adapter.addToPlaylist).not.toHaveBeenCalled();
    expect(h.adapter.removeFromWatchLater).not.toHaveBeenCalled();
  });
  it('does not permit a sub-second configured mutation interval', async () => {
    const lib = fixture(1, 'archive');
    const h = harness(lib);
    await executeApproved(
      lib,
      approveExecution(lib, ['decision-0']),
      h.adapter,
      h.commit,
      undefined,
      { wait: h.wait, mutationIntervalMs: 0 },
    );
    expect(h.wait.mock.calls.at(-1)![0]).toBeGreaterThanOrEqual(990);
  });
  it('honors stop only after the current complete archive operation', async () => {
    const lib = fixture(2, 'archive');
    batch(lib);
    const h = harness(lib);
    let stop = false;
    vi.mocked(h.adapter.addToPlaylist).mockImplementation(async (id) => {
      h.archived.add(id);
      stop = true;
      return { changed: true };
    });
    const result = await h.run(() => stop);
    expect(result.decisions.map((d) => d.status)).toEqual([
      'verified',
      'pending',
    ]);
    expect(h.adapter.removeFromWatchLater).toHaveBeenCalledTimes(1);
    expect(result.operations?.lastRun?.status).toBe('stopped');
  });
  it('can stop before any click', async () => {
    const lib = fixture();
    const h = harness(lib);
    expect((await h.run(() => true)).operations?.lastRun?.status).toBe(
      'stopped',
    );
    expect(h.adapter.removeFromWatchLater).not.toHaveBeenCalled();
  });
  it.each([1, 2])(
    'storage failure at pre-mutation commit %i means NO CLICK',
    async (at) => {
      const lib = fixture();
      const h = harness(lib);
      h.commit.mockImplementation(async () => {
        if (h.commit.mock.calls.length === at) throw new Error('storage');
      });
      await expect(h.run()).rejects.toThrow('storage');
      expect(h.adapter.removeFromWatchLater).not.toHaveBeenCalled();
      expect(h.commit).toHaveBeenCalledTimes(at);
    },
  );
  it('storage failure after a click leaves durable running and makes no further write', async () => {
    const lib = fixture(2);
    batch(lib);
    const h = harness(lib);
    const commit = vi.fn(async (state: Library) => {
      if (state.decisions[0].journal?.remove.status === 'verified')
        throw new Error('storage-after');
      h.commits.push(structuredClone(state));
    });
    await expect(
      executeApproved(
        lib,
        approveExecution(
          lib,
          lib.decisions.map((d) => d.id),
        ),
        h.adapter,
        commit,
      ),
    ).rejects.toThrow('storage-after');
    expect(commit).toHaveBeenCalledTimes(3);
    expect(h.commits.at(-1)?.decisions[0].journal?.remove.status).toBe(
      'running',
    );
    expect(h.adapter.removeFromWatchLater).toHaveBeenCalledTimes(1);
  });
  it('globally rejects a concurrent executor even with another library', async () => {
    const lib = fixture();
    const h = harness(lib);
    let release!: () => void;
    h.commit.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const first = h.run();
    const other = fixture();
    const otherH = harness(other);
    await expect(otherH.run()).rejects.toThrow(/Executor/);
    release();
    await first;
    expect(otherH.commit).not.toHaveBeenCalled();
  });
});

describe('explicit live stage attestation', () => {
  it('never upgrades automatically; requires real verified change and sequential user calls', async () => {
    const lib = fixture();
    const h = harness(lib);
    const result = await h.run();
    expect(result.operations?.limit).toBe(1);
    expect(() => acknowledgeLiveStage(result, 25, 'decision-0')).toThrow();
    acknowledgeLiveStage(result, 5, 'decision-0');
    expect(result.operations?.limit).toBe(5);
    expect(result.operations?.attestations).toHaveLength(1);
    expect(() => acknowledgeLiveStage(result, 25, 'decision-0')).toThrow();
  });
  it('requires the full previous stage and a new verified pilot', async () => {
    const lib = fixture(5);
    batch(lib);
    const h = harness(lib);
    const result = await h.run();
    acknowledgeLiveStage(result, 25, 'decision-0');
    expect(result.operations?.limit).toBe(25);
    expect(result.operations?.attestations.at(-1)?.confirmedAt).toBeTruthy();
  });
  it('rejects pending, failed or journal-free evidence', () => {
    const lib = fixture();
    expect(() => acknowledgeLiveStage(lib, 5, 'decision-0')).toThrow();
    lib.operations!.lastRun = {
      id: 'run',
      decisionIds: ['decision-0'],
      status: 'complete',
      startedAt: timestamp(),
    };
    lib.decisions[0].status = 'verified';
    expect(() => acknowledgeLiveStage(lib, 5, 'decision-0')).toThrow();
  });
});
