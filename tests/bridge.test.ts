import { beforeEach, expect, it, vi } from 'vitest';
import type { Scan } from '../src/model';
const port = vi.hoisted(() => ({
  onMessage: { addListener: vi.fn() },
  onDisconnect: { addListener: vi.fn() },
  postMessage: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock('webextension-polyfill', () => ({
  default: { tabs: { connect: () => port } },
}));
import { connectScan } from '../src/bridge';
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
