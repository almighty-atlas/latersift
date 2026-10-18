import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Runtime } from 'webextension-polyfill';
import type {
  ExecutionApproval,
  MembershipEvidence,
  WriteAdapter,
} from '../src/operations';

function event<Args extends unknown[]>() {
  const listeners = new Set<(...args: Args) => void>();
  return {
    addListener: (listener: (...args: Args) => void) => {
      listeners.add(listener);
    },
    removeListener: (listener: (...args: Args) => void) => {
      listeners.delete(listener);
    },
    hasListener: (listener: (...args: Args) => void) => listeners.has(listener),
    hasListeners: () => listeners.size > 0,
    emit: async (...args: Args) => {
      await Promise.all([...listeners].map((listener) => listener(...args)));
    },
    clear: () => listeners.clear(),
  };
}
const browser = vi.hoisted(() => ({
  runtime: {
    id: 'latersift@test',
    getURL: vi.fn((path: string) => `moz-extension://latersift/${path}`),
    sendMessage: vi.fn<(message: unknown) => Promise<unknown>>(),
    onConnect: {
      addListener: vi.fn<(listener: (port: Runtime.Port) => void) => void>(),
    },
  },
}));
vi.mock('webextension-polyfill', () => ({ default: browser }));
vi.mock('../src/adapter/write', () => ({ createWriteAdapter: vi.fn() }));
vi.mock('../src/adapter/youtube', () => ({ createYouTubeAdapter: vi.fn() }));
vi.mock('../src/adapter/scroll', () => ({ createPlaylistScroller: vi.fn() }));
import { createWriteAdapter } from '../src/adapter/write';
import { createYouTubeAdapter } from '../src/adapter/youtube';
import { createPlaylistScroller } from '../src/adapter/scroll';
import { installWriteChannel } from '../src/write-content';
import { emptyDialogDiagnostic } from '../src/dialog-diagnostics';
import { AUTHORIZE_MUTATION, WRITE_PORT } from '../src/write-protocol';

const videoId = 'abcdefghijk';
const target = 'PL1234567890';
function approval(): ExecutionApproval {
  return {
    id: 'approval',
    snapshotId: 'snapshot',
    createdAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    actions: [
      {
        decisionId: 'decision',
        videoId,
        kind: 'archive',
        targetPlaylist: target,
      },
    ],
  };
}
const evidence = (state: MembershipEvidence['state']): MembershipEvidence => ({
  state,
  source: 'native-dialog',
  observedAt: new Date().toISOString(),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function connect(
  name = WRITE_PORT,
  sender: Runtime.MessageSender | null = {
    id: browser.runtime.id,
    url: browser.runtime.getURL('index.html'),
  },
) {
  const onMessage = event<[unknown, Runtime.Port]>();
  const onDisconnect = event<[Runtime.Port]>();
  const port: Runtime.Port = {
    name,
    sender: sender ?? undefined,
    onMessage,
    onDisconnect,
    postMessage: vi.fn<(message: unknown) => void>(),
    disconnect: vi.fn(),
  };
  for (const [listener] of browser.runtime.onConnect.addListener.mock.calls)
    listener(port);
  return {
    port,
    hasRequestListener: onMessage.hasListeners,
    send: (message: unknown) => onMessage.emit(message, port),
    disconnect: () => onDisconnect.emit(port),
  };
}
let active: AbortController | null;
let adapter: {
  [K in keyof WriteAdapter]: ReturnType<typeof vi.fn<WriteAdapter[K]>>;
};
let env: Parameters<typeof createWriteAdapter>[0];
const setActive = vi.fn<(controller: AbortController | null) => void>();
function install() {
  installWriteChannel(() => active !== null, setActive);
}
function request(
  method: string,
  auth: ExecutionApproval | undefined = approval(),
) {
  return {
    type: 'request',
    method,
    videoId,
    playlistId: target,
    approval: auth,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
  active = null;
  browser.runtime.sendMessage.mockResolvedValue({ authorized: true });
  setActive.mockImplementation((controller) => {
    active = controller;
  });
  adapter = {
    getAvailablePlaylists: vi
      .fn<WriteAdapter['getAvailablePlaylists']>()
      .mockResolvedValue([{ id: target, title: 'Archive', writable: true }]),
    getPlaylistMembership: vi
      .fn<WriteAdapter['getPlaylistMembership']>()
      .mockImplementation(async () => evidence('present')),
    addToPlaylist: vi
      .fn<WriteAdapter['addToPlaylist']>()
      .mockResolvedValue({ changed: true }),
    removeFromWatchLater: vi
      .fn<WriteAdapter['removeFromWatchLater']>()
      .mockResolvedValue({ changed: true }),
  };
  vi.mocked(createWriteAdapter).mockImplementation((environment) => {
    env = environment;
    return adapter;
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('content write boundary without real YouTube DOM', () => {
  it.each([
    [
      'other-port',
      { id: browser.runtime.id, url: browser.runtime.getURL('index.html') },
    ],
    [
      WRITE_PORT,
      { id: 'wrong-extension', url: browser.runtime.getURL('index.html') },
    ],
    [
      WRITE_PORT,
      {
        id: browser.runtime.id,
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
      },
    ],
    [
      WRITE_PORT,
      { id: browser.runtime.id, url: 'moz-extension://other/index.html' },
    ],
    [WRITE_PORT, { id: browser.runtime.id }],
    [WRITE_PORT, {}],
    [WRITE_PORT, null],
  ])(
    'ignores unauthenticated sender %s %j without installing a request listener',
    async (name, sender) => {
      install();
      const channel = connect(name, sender);
      await channel.send(request('remove'));
      expect(channel.hasRequestListener()).toBe(false);
      expect(createWriteAdapter).not.toHaveBeenCalled();
      expect(setActive).not.toHaveBeenCalled();
      expect(channel.port.postMessage).not.toHaveBeenCalled();
    },
  );
  it.each(['add', 'remove'])(
    'rejects NOAUTH %s without acquiring the shared lock or constructing an adapter',
    async (method) => {
      install();
      const channel = connect();
      await channel.send({
        type: 'request',
        method,
        videoId,
        playlistId: target,
      });
      expect(channel.port.postMessage).toHaveBeenCalledExactlyOnceWith({
        ok: false,
        error: expect.stringContaining('Nutzerfreigabe'),
      });
      expect(createWriteAdapter).not.toHaveBeenCalled();
      expect(setActive).not.toHaveBeenCalled();
    },
  );
  it.each(['playlists', 'membership'])(
    'allows read-only %s discovery but does not turn that port into mutation authority',
    async (method) => {
      install();
      const channel = connect();
      await channel.send({
        type: 'request',
        method,
        videoId,
        playlistId: target,
      });
      expect(channel.port.postMessage).toHaveBeenNthCalledWith(1, {
        ok: true,
        result: expect.anything(),
        ...(method === 'playlists'
          ? { diagnostic: emptyDialogDiagnostic('diagnosis-unavailable') }
          : {}),
      });
      await channel.send(request('remove'));
      expect(channel.port.postMessage).toHaveBeenLastCalledWith({
        ok: false,
        error: expect.stringContaining('beschäftigt'),
      });
      expect(adapter.addToPlaylist).not.toHaveBeenCalled();
      expect(adapter.removeFromWatchLater).not.toHaveBeenCalled();
      expect(active).toBeNull();
    },
  );
  it.each([false, true])(
    'transports only sanitized diagnostics on playlist discovery (failure=%s)',
    async (failure) => {
      install();
      adapter.getAvailablePlaylists.mockImplementation(async () => {
        env.onDiagnostic?.({
          ...emptyDialogDiagnostic('unsupported-structure'),
          privateText: 'SECRET-NAME-AND-TOKEN',
        } as unknown as Parameters<NonNullable<typeof env.onDiagnostic>>[0]);
        if (failure) throw new Error('SECRET-NAME-AND-TOKEN');
        return [];
      });
      const channel = connect();
      await channel.send({ type: 'request', method: 'playlists', videoId });
      const response = vi.mocked(channel.port.postMessage).mock.calls[0][0] as {
        ok: boolean;
        diagnostic: unknown;
      };
      expect(response.ok).toBe(!failure);
      expect(response.diagnostic).toEqual(
        emptyDialogDiagnostic('unsupported-structure'),
      );
      expect(JSON.stringify(response.diagnostic)).not.toContain('SECRET');
      expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
      expect(adapter.addToPlaylist).not.toHaveBeenCalled();
      expect(adapter.removeFromWatchLater).not.toHaveBeenCalled();
    },
  );
  it.each(['wrong-video', 'wrong-target', 'expired'])(
    'rejects approval mismatch %s at the content boundary',
    async (mismatch) => {
      install();
      const channel = connect();
      const message = request('add');
      if (mismatch === 'wrong-video') message.videoId = 'lmnopqrstuv';
      if (mismatch === 'wrong-target') message.playlistId = 'PLabcdefghij';
      if (mismatch === 'expired')
        message.approval!.expiresAt = new Date().toISOString();
      await channel.send(message);
      expect(channel.port.postMessage).toHaveBeenCalledWith({
        ok: false,
        error: expect.any(String),
      });
      expect(createWriteAdapter).not.toHaveBeenCalled();
      expect(setActive).not.toHaveBeenCalled();
    },
  );
  it.each([
    null,
    { type: 'scan' },
    { type: 'request', method: 'unknown', videoId },
  ])(
    'rejects malformed content requests without adapter side effects: %j',
    async (message) => {
      install();
      const channel = connect();
      await channel.send(message);
      expect(channel.port.postMessage).toHaveBeenCalledExactlyOnceWith({
        ok: false,
        error: expect.any(String),
      });
      expect(createWriteAdapter).not.toHaveBeenCalled();
      expect(setActive).not.toHaveBeenCalled();
    },
  );
  it('adds only the approved target and returns a transport acknowledgement, not membership verification', async () => {
    install();
    const channel = connect();
    await channel.send(request('add'));
    expect(adapter.addToPlaylist).toHaveBeenCalledExactlyOnceWith(
      videoId,
      target,
    );
    expect(adapter.getPlaylistMembership).not.toHaveBeenCalled();
    expect(adapter.removeFromWatchLater).not.toHaveBeenCalled();
    expect(channel.port.postMessage).toHaveBeenCalledExactlyOnceWith({
      ok: true,
      result: { changed: true },
    });
    expect(env.doc).toBe(document);
    expect(env.url()).toBe(location.href);
    expect(env.signal.aborted).toBe(false);
    expect(active).toBeNull();
  });
  it.each(['add', 'remove'] as const)(
    'forwards changed:false from %s without converting it to null or success-by-change',
    async (method) => {
      install();
      const channel = connect();
      if (method === 'add')
        adapter.addToPlaylist.mockResolvedValueOnce({ changed: false });
      else
        adapter.removeFromWatchLater.mockResolvedValueOnce({ changed: false });
      await channel.send(request(method));
      expect(channel.port.postMessage).toHaveBeenCalledExactlyOnceWith({
        ok: true,
        result: { changed: false },
      });
    },
  );
  it.each(['add', 'remove'] as const)(
    'awaits background durable authorization before any actual %s adapter mutation',
    async (method) => {
      install();
      const channel = connect();
      const message = request(method);
      const permit = deferred<unknown>();
      browser.runtime.sendMessage.mockReturnValueOnce(permit.promise);
      const running = channel.send(message);
      await vi.advanceTimersByTimeAsync(0);
      expect(browser.runtime.sendMessage).toHaveBeenCalledExactlyOnceWith({
        type: AUTHORIZE_MUTATION,
        request: message,
      });
      expect(adapter.addToPlaylist).not.toHaveBeenCalled();
      expect(adapter.removeFromWatchLater).not.toHaveBeenCalled();
      expect(channel.port.postMessage).not.toHaveBeenCalled();
      expect(active).not.toBeNull();
      if (method === 'remove') {
        expect(adapter.getPlaylistMembership).toHaveBeenCalledExactlyOnceWith(
          videoId,
          target,
        );
        expect(
          adapter.getPlaylistMembership.mock.invocationCallOrder[0],
        ).toBeLessThan(browser.runtime.sendMessage.mock.invocationCallOrder[0]);
      }
      permit.resolve({ authorized: true });
      await running;
      const mutation =
        method === 'add' ? adapter.addToPlaylist : adapter.removeFromWatchLater;
      expect(mutation).toHaveBeenCalledOnce();
      expect(
        browser.runtime.sendMessage.mock.invocationCallOrder[0],
      ).toBeLessThan(mutation.mock.invocationCallOrder[0]);
      expect(channel.port.postMessage).toHaveBeenCalledExactlyOnceWith({
        ok: true,
        result: { changed: true },
      });
      expect(active).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it.each(['add', 'remove'] as const)(
    'requires authorized:true for %s and fails closed on missing or negative background responses',
    async (method) => {
      install();
      for (const response of [
        undefined,
        null,
        false,
        {},
        { authorized: false },
        { authorized: 'true' },
        { authorized: 1 },
        { authorized: false, error: 'WAL attempt already consumed' },
      ]) {
        const channel = connect();
        browser.runtime.sendMessage.mockResolvedValueOnce(response);
        await channel.send(request(method));
        expect(channel.port.postMessage).toHaveBeenCalledExactlyOnceWith({
          ok: false,
          error: expect.any(String),
        });
        expect(adapter.addToPlaylist).not.toHaveBeenCalled();
        expect(adapter.removeFromWatchLater).not.toHaveBeenCalled();
        expect(active).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
      }
    },
  );
  it.each(['add', 'remove'] as const)(
    'does not mutate or retry %s if background authorization rejects or times out',
    async (method) => {
      install();
      const channel = connect();
      browser.runtime.sendMessage.mockRejectedValueOnce(
        new Error('authorization timeout'),
      );
      await channel.send(request(method));
      expect(channel.port.postMessage).toHaveBeenCalledExactlyOnceWith({
        ok: false,
        error: 'authorization timeout',
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(adapter.addToPlaylist).not.toHaveBeenCalled();
      expect(adapter.removeFromWatchLater).not.toHaveBeenCalled();
      expect(browser.runtime.sendMessage).toHaveBeenCalledOnce();
      expect(active).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it.each([
    'yt-navigate-start',
    'popstate',
    'pagehide',
    'disconnect',
    'deadline',
    'expiry',
  ])(
    'rejects late authorization after %s without a click and releases the shared lock',
    async (trigger) => {
      install();
      for (const method of ['add', 'remove'] as const) {
        const channel = connect();
        const auth = approval();
        if (trigger === 'expiry')
          auth.expiresAt = new Date(Date.now() + 5000).toISOString();
        const permit = deferred<unknown>();
        browser.runtime.sendMessage.mockReturnValueOnce(permit.promise);
        const running = channel.send(request(method, auth));
        await vi.advanceTimersByTimeAsync(0);
        expect(active).not.toBeNull();
        expect(adapter.addToPlaylist).not.toHaveBeenCalled();
        expect(adapter.removeFromWatchLater).not.toHaveBeenCalled();
        if (trigger === 'disconnect') await channel.disconnect();
        else if (trigger === 'deadline')
          await vi.advanceTimersByTimeAsync(35_000);
        else if (trigger === 'expiry') vi.setSystemTime(auth.expiresAt);
        else window.dispatchEvent(new Event(trigger));
        if (trigger !== 'expiry') expect(env.signal.aborted).toBe(true);
        permit.resolve({ authorized: true });
        await running;
        expect(channel.port.postMessage).toHaveBeenCalledExactlyOnceWith({
          ok: false,
          error: expect.any(String),
        });
        expect(adapter.addToPlaylist).not.toHaveBeenCalled();
        expect(adapter.removeFromWatchLater).not.toHaveBeenCalled();
        expect(active).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
      }
      await connect().send(request('playlists'));
      expect(active).toBeNull();
    },
  );
  it.each(['playlists', 'membership'])(
    'does not ask for mutation authority during read-only %s discovery',
    async (method) => {
      install();
      await connect().send({
        type: 'request',
        method,
        videoId,
        playlistId: target,
      });
      expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
      expect(adapter.addToPlaylist).not.toHaveBeenCalled();
      expect(adapter.removeFromWatchLater).not.toHaveBeenCalled();
    },
  );
  it('requires a fresh present archive target after approval and awaits it before removing WL', async () => {
    install();
    const channel = connect();
    const pending = deferred<MembershipEvidence>();
    adapter.getPlaylistMembership.mockReturnValueOnce(pending.promise);
    const running = channel.send(request('remove'));
    expect(adapter.getPlaylistMembership).toHaveBeenCalledExactlyOnceWith(
      videoId,
      target,
    );
    expect(adapter.removeFromWatchLater).not.toHaveBeenCalled();
    expect(channel.port.postMessage).not.toHaveBeenCalled();
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
    pending.resolve(evidence('present'));
    await running;
    expect(adapter.removeFromWatchLater).toHaveBeenCalledExactlyOnceWith(
      videoId,
    );
    expect(
      adapter.getPlaylistMembership.mock.invocationCallOrder[0],
    ).toBeLessThan(adapter.removeFromWatchLater.mock.invocationCallOrder[0]);
    expect(channel.port.postMessage).toHaveBeenCalledWith({
      ok: true,
      result: { changed: true },
    });
  });
  it.each(['absent', 'unknown', 'error'])(
    'never removes WL when the fresh archive observation is %s',
    async (state) => {
      install();
      const channel = connect();
      if (state === 'error')
        adapter.getPlaylistMembership.mockRejectedValueOnce(
          new Error('read unavailable'),
        );
      else
        adapter.getPlaylistMembership.mockResolvedValueOnce(
          evidence(state === 'absent' ? 'absent' : 'unknown'),
        );
      await channel.send(request('remove'));
      expect(adapter.removeFromWatchLater).not.toHaveBeenCalled();
      expect(channel.port.postMessage).toHaveBeenCalledWith({
        ok: false,
        error: expect.any(String),
      });
      expect(active).toBeNull();
    },
  );
  it('rechecks expiry after a slow archive read before removing WL', async () => {
    install();
    const channel = connect();
    const pending = deferred<MembershipEvidence>();
    adapter.getPlaylistMembership.mockReturnValueOnce(pending.promise);
    const running = channel.send(request('remove'));
    await vi.advanceTimersByTimeAsync(60_000);
    pending.resolve(evidence('present'));
    await running;
    expect(adapter.removeFromWatchLater).not.toHaveBeenCalled();
    expect(channel.port.postMessage).toHaveBeenCalledWith({
      ok: false,
      error: expect.stringContaining('Nutzerfreigabe'),
    });
  });
  it('allows approved remove-only actions without inventing an archive target', async () => {
    install();
    const channel = connect();
    const auth = approval();
    auth.actions[0] = {
      ...auth.actions[0],
      kind: 'remove',
      targetPlaylist: null,
    };
    await channel.send(request('remove', auth));
    expect(adapter.getPlaylistMembership).not.toHaveBeenCalled();
    expect(adapter.removeFromWatchLater).toHaveBeenCalledExactlyOnceWith(
      videoId,
    );
  });
  it.each(['yt-navigate-start', 'popstate', 'pagehide', 'disconnect'])(
    'aborts the adapter on %s, prevents late removal, then releases the shared lock',
    async (trigger) => {
      install();
      const channel = connect();
      adapter.getPlaylistMembership.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            env.signal.addEventListener(
              'abort',
              () => reject(new Error('adapter aborted')),
              { once: true },
            );
          }),
      );
      const running = channel.send(request('remove'));
      const signal = env.signal;
      if (trigger === 'disconnect') await channel.disconnect();
      else window.dispatchEvent(new Event(trigger));
      await running;
      expect(signal.aborted).toBe(true);
      expect(adapter.removeFromWatchLater).not.toHaveBeenCalled();
      expect(channel.port.postMessage).toHaveBeenCalledWith({
        ok: false,
        error: 'adapter aborted',
      });
      expect(active).toBeNull();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(createWriteAdapter).toHaveBeenCalledOnce();
      expect(adapter.getPlaylistMembership).toHaveBeenCalledOnce();
    },
  );
  it('rejects a port disconnected before its first request', async () => {
    install();
    const channel = connect();
    await channel.disconnect();
    await channel.send(request('add'));
    expect(createWriteAdapter).not.toHaveBeenCalled();
    expect(channel.port.postMessage).toHaveBeenCalledWith({
      ok: false,
      error: expect.stringContaining('beendet'),
    });
  });
  it.each([5000, 60_000, undefined])(
    'aborts pending content work at min(35s, remaining grant), lifetime=%s',
    async (lifetime) => {
      install();
      const channel = connect();
      const auth = lifetime === undefined ? undefined : approval();
      if (auth && lifetime !== undefined)
        auth.expiresAt = new Date(Date.now() + lifetime).toISOString();
      adapter.getPlaylistMembership.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            env.signal.addEventListener(
              'abort',
              () => reject(new Error('deadline aborted')),
              { once: true },
            );
          }),
      );
      const running = channel.send({
        type: 'request',
        method: 'membership',
        videoId,
        playlistId: target,
        approval: auth,
      });
      const deadline = Math.min(35_000, lifetime ?? 35_000);
      await vi.advanceTimersByTimeAsync(deadline - 1);
      expect(env.signal.aborted).toBe(false);
      expect(channel.port.postMessage).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await running;
      expect(env.signal.aborted).toBe(true);
      expect(channel.port.postMessage).toHaveBeenCalledExactlyOnceWith({
        ok: false,
        error: 'deadline aborted',
      });
      expect(active).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      expect(adapter.removeFromWatchLater).not.toHaveBeenCalled();
      expect(adapter.getPlaylistMembership).toHaveBeenCalledOnce();
    },
  );
  it('cleans navigation listeners and the deadline on completion and does not abort a completed adapter later', async () => {
    install();
    const channel = connect();
    await channel.send(request('playlists'));
    const signal = env.signal;
    for (const name of ['yt-navigate-start', 'popstate', 'pagehide'])
      window.dispatchEvent(new Event(name));
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(signal.aborted).toBe(false);
  });
  it('rejects concurrent requests on the same or another port without releasing the current owner lock', async () => {
    install();
    const first = connect();
    const second = connect();
    const pending =
      deferred<Awaited<ReturnType<WriteAdapter['addToPlaylist']>>>();
    adapter.addToPlaylist.mockReturnValueOnce(pending.promise);
    const running = first.send(request('add'));
    const owner = active;
    await first.send(request('remove'));
    await second.send(request('remove'));
    expect(active).toBe(owner);
    expect(owner).not.toBeNull();
    expect(createWriteAdapter).toHaveBeenCalledOnce();
    expect(setActive).toHaveBeenCalledOnce();
    expect(adapter.removeFromWatchLater).not.toHaveBeenCalled();
    pending.resolve({ changed: true });
    await running;
    expect(active).toBeNull();
    await connect().send(request('playlists'));
    expect(createWriteAdapter).toHaveBeenCalledTimes(2);
  });
  it.each([new Error('uncertain click'), 'unknown failure'])(
    'returns adapter errors without success, retries, or lock leakage: %s',
    async (error) => {
      install();
      const channel = connect();
      adapter.addToPlaylist.mockRejectedValueOnce(error);
      await channel.send(request('add'));
      expect(channel.port.postMessage).toHaveBeenCalledExactlyOnceWith({
        ok: false,
        error: error instanceof Error ? error.message : error,
      });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(adapter.addToPlaylist).toHaveBeenCalledOnce();
      expect(active).toBeNull();
    },
  );
  it('contains reply-posting errors after disconnect and still releases the lock', async () => {
    install();
    const channel = connect();
    vi.mocked(channel.port.postMessage).mockImplementation(() => {
      throw new Error('closed port');
    });
    await expect(channel.send(request('add'))).resolves.toBeUndefined();
    expect(active).toBeNull();
    expect(adapter.addToPlaylist).toHaveBeenCalledOnce();
  });
});

describe('real content.ts shared scanner/write lock integration', () => {
  async function integration() {
    vi.resetModules();
    const scan = deferred<void>();
    const scanWatchLater = vi.fn().mockReturnValue(scan.promise);
    vi.mocked(createYouTubeAdapter).mockReturnValue({
      capabilities: {
        scan: true,
        write: false,
        membership: false,
        playbackCheck: false,
      },
      scanWatchLater,
    });
    vi.mocked(createPlaylistScroller).mockReturnValue({
      advance: vi.fn(),
      info: vi.fn(),
      reset: vi.fn(),
    });
    const add = vi.spyOn(window, 'addEventListener');
    await import('../src/content');
    const navigationListeners = add.mock.calls.filter(([name]) =>
      ['yt-navigate-start', 'popstate', 'pagehide'].includes(name),
    );
    add.mockRestore();
    return {
      scan,
      scanWatchLater,
      cleanup: () => {
        for (const [name, listener, options] of navigationListeners)
          window.removeEventListener(name, listener, options);
      },
    };
  }
  it('blocks writes while the actual scanner owns active, then permits a new write after scan completion', async () => {
    const fixture = await integration();
    try {
      const scanner = connect('latersift-readonly-v1');
      const scanning = scanner.send({ type: 'scan' });
      expect(fixture.scanWatchLater).toHaveBeenCalledOnce();
      const writer = connect();
      await writer.send(request('add'));
      expect(writer.port.postMessage).toHaveBeenCalledWith({
        ok: false,
        error: expect.stringContaining('beschäftigt'),
      });
      expect(createWriteAdapter).not.toHaveBeenCalled();
      fixture.scan.resolve();
      await scanning;
      await connect().send(request('add'));
      expect(adapter.addToPlaylist).toHaveBeenCalledOnce();
    } finally {
      fixture.scan.resolve();
      fixture.cleanup();
    }
  });
  it('blocks the actual scanner while a write owns active, then permits a new scan after write completion', async () => {
    const fixture = await integration();
    const pending =
      deferred<Awaited<ReturnType<WriteAdapter['addToPlaylist']>>>();
    try {
      adapter.addToPlaylist.mockReturnValueOnce(pending.promise);
      const running = connect().send(request('add'));
      const scanner = connect('latersift-readonly-v1');
      await scanner.send({ type: 'scan' });
      expect(scanner.port.postMessage).toHaveBeenCalledWith({
        type: 'error',
        message: expect.stringContaining('bereits'),
      });
      expect(fixture.scanWatchLater).not.toHaveBeenCalled();
      pending.resolve({ changed: true });
      await running;
      const scanning = connect('latersift-readonly-v1').send({ type: 'scan' });
      expect(fixture.scanWatchLater).toHaveBeenCalledOnce();
      fixture.scan.resolve();
      await scanning;
    } finally {
      pending.resolve({ changed: true });
      fixture.scan.resolve();
      fixture.cleanup();
    }
  });
});
