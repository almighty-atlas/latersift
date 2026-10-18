import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Scan } from '../src/model';
import type { PlaylistCatalog } from '../src/adapter/playlists';
const port = vi.hoisted(() => ({
  onMessage: { addListener: vi.fn() },
  onDisconnect: { addListener: vi.fn() },
  postMessage: vi.fn(),
  disconnect: vi.fn(),
}));
const browser = vi.hoisted(() => ({
  tabs: { connect: vi.fn(() => port), update: vi.fn() },
  windows: { update: vi.fn() },
}));
vi.mock('webextension-polyfill', () => ({ default: browser }));
import { activateYouTubeTab, connectRead, connectScan } from '../src/bridge';
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const scan: Scan = {
  id: 'checkpoint',
  startedAt: 'now',
  finishedAt: null,
  status: 'running',
  expectedCount: 5000,
  videos: [],
  unidentifiableRows: 0,
  message: 'test fixture',
};
it('acknowledges a checkpoint only after the database commit resolves', async () => {
  let commit: (() => void) | undefined;
  const storage = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        commit = resolve;
      }),
  );
  const finish = vi.fn();
  await connectScan(123, storage, finish);
  const receive = port.onMessage.addListener.mock.calls[0][0];
  receive({ type: 'checkpoint', scan, id: 'ack-1' });
  await vi.waitFor(() => expect(storage).toHaveBeenCalledOnce());
  expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'scan' });
  commit!();
  await vi.waitFor(() =>
    expect(port.postMessage).toHaveBeenCalledWith({ ack: 'ack-1' }),
  );
  receive({ type: 'done' });
  await vi.waitFor(() => expect(finish).toHaveBeenCalledWith(undefined));
});
it('disconnects on storage failure without acknowledging unsaved data', async () => {
  const finish = vi.fn();
  await connectScan(
    123,
    async () => {
      throw new Error('quota');
    },
    finish,
  );
  const receive = port.onMessage.addListener.mock.calls[0][0];
  receive({ type: 'checkpoint', scan, id: 'ack-fail' });
  await vi.waitFor(() => expect(finish).toHaveBeenCalledOnce());
  expect(port.disconnect).toHaveBeenCalledOnce();
  expect(port.postMessage).not.toHaveBeenCalledWith({ ack: 'ack-fail' });
});
it('sends the full resume scan only when supplied, without focusing the tab', async () => {
  const resume = {
    ...scan,
    status: 'interrupted' as const,
    diagnostics: {
      lastProgressAt: '2026-10-17T12:00:00.000Z',
      visibility: 'hidden',
      reason: 'paused',
      highestPosition: 4,
      missingPositions: [2],
      recoveryAttempts: 1,
      scroll: { container: 'document', top: 10, height: 100, viewport: 50 },
      continuation: true,
      confirmedCount: 3,
    },
  };
  await connectScan(123, async () => {}, vi.fn(), resume);
  expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({
    type: 'scan',
    resume,
  });
  expect(browser.tabs.connect).toHaveBeenCalledWith(123, {
    name: 'latersift-readonly-v1',
  });
  expect(browser.tabs.update).not.toHaveBeenCalled();
  expect(browser.windows.update).not.toHaveBeenCalled();
});
it('serializes full checkpoints and waits for all commits before finishing', async () => {
  let commit: (() => void) | undefined;
  const storage = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          commit = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const finish = vi.fn();
  await connectScan(123, storage, finish);
  const receive = port.onMessage.addListener.mock.calls[0][0];
  const waiting = { ...scan, status: 'waiting' };
  const attention = { ...scan, status: 'needs_attention' };
  receive({ type: 'checkpoint', scan: waiting, id: 'first' });
  receive({ type: 'checkpoint', scan: attention, id: 'second' });
  receive({ type: 'done' });
  await vi.waitFor(() => expect(storage).toHaveBeenCalledOnce());
  expect(storage).toHaveBeenNthCalledWith(1, waiting);
  expect(finish).not.toHaveBeenCalled();
  commit!();
  await vi.waitFor(() =>
    expect(finish).toHaveBeenCalledExactlyOnceWith(undefined),
  );
  expect(storage).toHaveBeenNthCalledWith(2, attention);
  expect(port.postMessage.mock.calls.slice(1)).toEqual([
    [{ ack: 'first' }],
    [{ ack: 'second' }],
  ]);
});
it('does not persist queued checkpoints after a failed commit or finish twice', async () => {
  const storage = vi.fn().mockRejectedValue(new Error('quota'));
  const finish = vi.fn();
  await connectScan(123, storage, finish);
  const receive = port.onMessage.addListener.mock.calls[0][0];
  receive({ type: 'checkpoint', scan, id: 'first' });
  receive({ type: 'checkpoint', scan, id: 'second' });
  receive({ type: 'done' });
  await vi.waitFor(() => expect(finish).toHaveBeenCalledOnce());
  port.onDisconnect.addListener.mock.calls[0][0]();
  expect(storage).toHaveBeenCalledOnce();
  expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'scan' });
  expect(finish).toHaveBeenCalledWith(expect.stringContaining('quota'));
});
it('waits for an in-flight commit on disconnect without acknowledging a closed port', async () => {
  let commit: (() => void) | undefined;
  const storage = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        commit = resolve;
      }),
  );
  const finish = vi.fn();
  await connectScan(123, storage, finish);
  port.onMessage.addListener.mock.calls[0][0]({
    type: 'checkpoint',
    scan,
    id: 'pending',
  });
  await vi.waitFor(() => expect(storage).toHaveBeenCalledOnce());
  port.onDisconnect.addListener.mock.calls[0][0]();
  expect(finish).not.toHaveBeenCalled();
  commit!();
  await vi.waitFor(() => expect(finish).toHaveBeenCalledOnce());
  expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'scan' });
});
it('activates the requested tab and focuses its window only on explicit request', async () => {
  browser.tabs.update.mockResolvedValue({ windowId: 456 });
  await activateYouTubeTab(123);
  expect(browser.tabs.update).toHaveBeenCalledExactlyOnceWith(123, {
    active: true,
  });
  expect(browser.windows.update).toHaveBeenCalledExactlyOnceWith(456, {
    focused: true,
  });
});
it('propagates activation errors without focusing another window', async () => {
  browser.tabs.update.mockRejectedValue(new Error('closed tab'));
  await expect(activateYouTubeTab(123)).rejects.toThrow('closed tab');
  expect(browser.windows.update).not.toHaveBeenCalled();
});
it('rejects activation when the tab has no window', async () => {
  browser.tabs.update.mockResolvedValue({});
  await expect(activateYouTubeTab(123)).rejects.toThrow(
    'YouTube-Fenster nicht gefunden',
  );
  expect(browser.windows.update).not.toHaveBeenCalled();
});
it('disconnects and rejects when the initial scan message cannot be sent', async () => {
  port.postMessage.mockImplementationOnce(() => {
    throw new Error('closed port');
  });
  const finish = vi.fn();
  await expect(connectScan(123, async () => {}, finish)).rejects.toThrow(
    'closed port',
  );
  expect(port.disconnect).toHaveBeenCalledOnce();
  port.onDisconnect.addListener.mock.calls[0][0]();
  expect(finish).not.toHaveBeenCalled();
});
it('reports disconnect without claiming completion', async () => {
  const finish = vi.fn();
  await connectScan(123, async () => {}, finish);
  port.onDisconnect.addListener.mock.calls[0][0]();
  await vi.waitFor(() =>
    expect(finish).toHaveBeenCalledWith(
      expect.stringContaining('Verbindung getrennt'),
    ),
  );
});

it.each([undefined, false, true])(
  'sends experimental background only for explicit scan opt-in (%s), never from resume',
  async (experimentalBackground) => {
    const resume: Scan = {
      ...scan,
      status: 'interrupted',
      diagnostics: {
        lastProgressAt: '2026-10-17T12:00:00.000Z',
        visibility: 'hidden',
        reason: 'paused',
        highestPosition: 0,
        missingPositions: [],
        recoveryAttempts: 0,
        scroll: null,
        continuation: false,
        confirmedCount: 0,
        backgroundMode: 'experimental',
      },
    };
    await connectScan(
      123,
      async () => {},
      vi.fn(),
      resume,
      experimentalBackground,
    );
    expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'scan',
      resume,
      ...(experimentalBackground ? { background: 'experimental' } : {}),
    });
    expect(resume.diagnostics?.backgroundMode).toBe('experimental');
    expect(browser.tabs.update).not.toHaveBeenCalled();
    expect(browser.windows.update).not.toHaveBeenCalled();
  },
);

it('can opt into experimental scanning without a resume or focus change', async () => {
  await connectScan(123, async () => {}, vi.fn(), undefined, true);
  expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({
    type: 'scan',
    background: 'experimental',
  });
  expect(browser.tabs.update).not.toHaveBeenCalled();
  expect(browser.windows.update).not.toHaveBeenCalled();
});

it.each(['scan', 'playlists'] as const)(
  'forwards an explicit experimental %s read request without focusing',
  async (type) => {
    const request = { type, background: 'experimental' as const };
    const connected = await connectRead(123, async () => {}, vi.fn(), request);
    expect(connected).toBe(port);
    expect(browser.tabs.connect).toHaveBeenCalledExactlyOnceWith(123, {
      name: 'latersift-readonly-v1',
    });
    expect(port.postMessage).toHaveBeenCalledExactlyOnceWith(request);
    expect(browser.tabs.update).not.toHaveBeenCalled();
    expect(browser.windows.update).not.toHaveBeenCalled();
  },
);

const catalog: PlaylistCatalog = {
  entries: [
    {
      id: 'PL_one',
      name: 'Synthetic playlist',
      url: 'https://www.youtube.com/playlist?list=PL_one',
      visibility: 'unknown',
      ownership: 'unknown',
    },
  ],
  status: 'running',
  updatedAt: '2026-10-17T12:00:00.000Z',
  message: 'test fixture',
  diagnostics: {
    reason: 'scanning',
    rounds: 1,
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

it.each(['done', 'error', 'disconnect'] as const)(
  'saves playlist checkpoints before ack and waits for all pending commits on %s',
  async (terminal) => {
    let commitFirst!: () => void;
    let commitSecond!: () => void;
    const storage = vi
      .fn<(value: PlaylistCatalog) => Promise<void>>()
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (commitFirst = resolve)),
      )
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (commitSecond = resolve)),
      );
    const finish = vi.fn();
    await connectRead<PlaylistCatalog>(123, storage, finish, {
      type: 'playlists',
    });
    const receive = port.onMessage.addListener.mock.calls[0][0];
    const disconnect = port.onDisconnect.addListener.mock.calls[0][0];
    const interrupted: PlaylistCatalog = {
      ...catalog,
      status: 'interrupted',
      message: 'YouTube tab lost',
    };
    receive({ type: 'checkpoint', scan: catalog, id: 'catalog-1' });
    receive({ type: 'checkpoint', scan: interrupted, id: 'catalog-2' });
    await vi.waitFor(() => expect(storage).toHaveBeenCalledOnce());
    expect(storage).toHaveBeenNthCalledWith(1, catalog);
    expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'playlists',
    });
    if (terminal === 'disconnect') disconnect();
    else
      receive({
        type: terminal,
        ...(terminal === 'error' ? { message: 'YouTube tab lost' } : {}),
      });
    receive({ type: 'checkpoint', scan: catalog, id: 'too-late' });
    expect(finish).not.toHaveBeenCalled();

    commitFirst();
    await vi.waitFor(() => expect(storage).toHaveBeenCalledTimes(2));
    expect(storage).toHaveBeenNthCalledWith(2, interrupted);
    expect(finish).not.toHaveBeenCalled();
    expect(port.postMessage.mock.calls.slice(1)).toEqual(
      terminal === 'disconnect' ? [] : [[{ ack: 'catalog-1' }]],
    );

    commitSecond();
    await vi.waitFor(() => expect(finish).toHaveBeenCalledOnce());
    expect(finish).toHaveBeenCalledWith(
      terminal === 'disconnect'
        ? expect.stringContaining('Verbindung getrennt')
        : terminal === 'error'
          ? 'YouTube tab lost'
          : undefined,
    );
    expect(port.postMessage.mock.calls.slice(1)).toEqual(
      terminal === 'disconnect'
        ? []
        : [[{ ack: 'catalog-1' }], [{ ack: 'catalog-2' }]],
    );
    expect(port.disconnect).toHaveBeenCalledTimes(
      terminal === 'disconnect' ? 0 : 1,
    );
    disconnect();
    receive({ type: 'done' });
    receive({ type: 'error', message: 'duplicate terminal event' });
    receive({ type: 'checkpoint', scan: catalog, id: 'after-finish' });
    await Promise.resolve();
    expect(storage).toHaveBeenCalledTimes(2);
    expect(finish).toHaveBeenCalledOnce();
    expect(browser.tabs.update).not.toHaveBeenCalled();
    expect(browser.windows.update).not.toHaveBeenCalled();
  },
);

it.each(['scan', 'playlists'] as const)(
  'disconnects silent %s content after 60 seconds with an inactivity warning, not success',
  async (type) => {
    const storage = vi.fn().mockResolvedValue(undefined);
    const finish = vi.fn();
    await connectRead(123, storage, finish, { type });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(finish).not.toHaveBeenCalled();
    expect(port.disconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(port.disconnect).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(
        /60 Sekunden.*inaktiv.*gedrosselt.*nicht abgeschlossen/,
      ),
    );
    expect(storage).not.toHaveBeenCalled();
    expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type });
    port.onDisconnect.addListener.mock.calls[0][0]();
    port.onMessage.addListener.mock.calls[0][0]({ type: 'done' });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(finish).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(browser.tabs.update).not.toHaveBeenCalled();
    expect(browser.windows.update).not.toHaveBeenCalled();
  },
);

it('resets the watchdog on each received checkpoint, even without new scan progress', async () => {
  const storage = vi.fn().mockResolvedValue(undefined);
  const finish = vi.fn();
  await connectScan(123, storage, finish);
  const receive = port.onMessage.addListener.mock.calls[0][0];
  for (let id = 0; id < 3; id++) {
    await vi.advanceTimersByTimeAsync(59_000);
    receive({ type: 'checkpoint', scan, id });
    await vi.advanceTimersByTimeAsync(0);
    expect(port.postMessage).toHaveBeenCalledWith({ ack: id });
    expect(finish).not.toHaveBeenCalled();
  }
  await vi.advanceTimersByTimeAsync(59_999);
  expect(finish).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(storage).toHaveBeenCalledTimes(3);
  expect(finish).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining('kein Checkpoint'),
  );
  expect(port.disconnect).toHaveBeenCalledOnce();
});

it('does not keep silent content alive with malformed or unrelated messages', async () => {
  const storage = vi.fn().mockResolvedValue(undefined);
  const finish = vi.fn();
  await connectRead(123, storage, finish, { type: 'playlists' });
  const receive = port.onMessage.addListener.mock.calls[0][0];
  await vi.advanceTimersByTimeAsync(59_000);
  for (const message of [
    null,
    'checkpoint',
    {},
    { type: 'ping' },
    { type: 'checkpoint', scan: catalog },
    { type: 'checkpoint', id: 'missing-payload' },
  ])
    receive(message);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(storage).not.toHaveBeenCalled();
  expect(finish).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining('kein Checkpoint'),
  );
});

it('drains all queued playlist commits before disconnecting on inactivity', async () => {
  let commitFirst!: () => void;
  let commitSecond!: () => void;
  const storage = vi
    .fn()
    .mockImplementationOnce(
      () => new Promise<void>((resolve) => (commitFirst = resolve)),
    )
    .mockImplementationOnce(
      () => new Promise<void>((resolve) => (commitSecond = resolve)),
    );
  const finish = vi.fn();
  await connectRead<PlaylistCatalog>(123, storage, finish, {
    type: 'playlists',
  });
  const receive = port.onMessage.addListener.mock.calls[0][0];
  receive({ type: 'checkpoint', scan: catalog, id: 'first' });
  await vi.advanceTimersByTimeAsync(30_000);
  receive({ type: 'checkpoint', scan: catalog, id: 'second' });
  await vi.advanceTimersByTimeAsync(59_999);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(vi.getTimerCount()).toBe(0);
  expect(storage).toHaveBeenCalledOnce();
  expect(finish).not.toHaveBeenCalled();
  expect(port.disconnect).not.toHaveBeenCalled();
  receive({ type: 'checkpoint', scan: catalog, id: 'too-late' });
  receive({ type: 'done' });
  commitFirst();
  await vi.advanceTimersByTimeAsync(0);
  expect(storage).toHaveBeenCalledTimes(2);
  expect(port.postMessage).toHaveBeenCalledWith({ ack: 'first' });
  expect(finish).not.toHaveBeenCalled();
  expect(port.disconnect).not.toHaveBeenCalled();
  commitSecond();
  await vi.advanceTimersByTimeAsync(0);
  expect(port.postMessage.mock.calls.slice(1)).toEqual([
    [{ ack: 'first' }],
    [{ ack: 'second' }],
  ]);
  expect(finish).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining('nicht abgeschlossen'),
  );
  expect(port.disconnect).toHaveBeenCalledOnce();
  expect(port.postMessage.mock.invocationCallOrder.at(-1)).toBeLessThan(
    port.disconnect.mock.invocationCallOrder[0],
  );
  expect(port.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
    finish.mock.invocationCallOrder[0],
  );
});

it.each(['done', 'error', 'disconnect', 'storage failure', 'post failure'])(
  'clears the watchdog on %s without a later inactivity callback',
  async (terminal) => {
    let commit!: () => void;
    const storage = vi.fn(
      () => new Promise<void>((resolve) => (commit = resolve)),
    );
    const finish = vi.fn();
    if (terminal === 'post failure') {
      port.postMessage.mockImplementationOnce(() => {
        throw new Error('closed port');
      });
      await expect(connectScan(123, storage, finish)).rejects.toThrow(
        'closed port',
      );
    } else {
      if (terminal === 'storage failure')
        storage.mockRejectedValueOnce(new Error('quota'));
      await connectScan(123, storage, finish);
      const receive = port.onMessage.addListener.mock.calls[0][0];
      receive({ type: 'checkpoint', scan, id: 'pending' });
      await vi.advanceTimersByTimeAsync(0);
      if (terminal === 'disconnect')
        port.onDisconnect.addListener.mock.calls[0][0]();
      else if (terminal !== 'storage failure') receive({ type: terminal });
      expect(vi.getTimerCount()).toBe(0);
      if (terminal !== 'storage failure') {
        await vi.advanceTimersByTimeAsync(120_000);
        expect(finish).not.toHaveBeenCalled();
        commit();
        await vi.advanceTimersByTimeAsync(0);
      }
    }
    expect(vi.getTimerCount()).toBe(0);
    const calls = finish.mock.calls.slice();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(finish.mock.calls).toEqual(calls);
    expect(finish).toHaveBeenCalledTimes(terminal === 'post failure' ? 0 : 1);
    expect(finish).not.toHaveBeenCalledWith(
      expect.stringContaining('kein Checkpoint'),
    );
  },
);

it('reports a failed playlist commit instead of terminal success and never acknowledges it', async () => {
  let rejectCommit!: (error: Error) => void;
  const storage = vi.fn(
    () => new Promise<void>((_, reject) => (rejectCommit = reject)),
  );
  const finish = vi.fn();
  await connectRead<PlaylistCatalog>(123, storage, finish, {
    type: 'playlists',
  });
  const receive = port.onMessage.addListener.mock.calls[0][0];
  receive({ type: 'checkpoint', scan: catalog, id: 'unsaved' });
  receive({ type: 'done' });
  await vi.waitFor(() => expect(storage).toHaveBeenCalledOnce());
  expect(finish).not.toHaveBeenCalled();
  rejectCommit(new Error('quota'));
  await vi.waitFor(() =>
    expect(finish).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('Speicherung fehlgeschlagen: Error: quota'),
    ),
  );
  expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({
    type: 'playlists',
  });
  expect(port.disconnect).toHaveBeenCalledOnce();
  expect(browser.tabs.update).not.toHaveBeenCalled();
  expect(browser.windows.update).not.toHaveBeenCalled();
});
