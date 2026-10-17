import { beforeEach, expect, it, vi } from 'vitest';
import type { Scan } from '../src/model';
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
import { activateYouTubeTab, connectScan } from '../src/bridge';
beforeEach(() => vi.clearAllMocks());
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
