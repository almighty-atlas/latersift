import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Runtime, Tabs } from 'webextension-polyfill';
import type { ExecutionApproval } from '../src/operations';
import { WRITE_PORT } from '../src/write-protocol';
import { emptyDialogDiagnostic } from '../src/dialog-diagnostics';

const { event } = vi.hoisted(() => ({
  event<Args extends unknown[]>() {
    const listeners = new Set<(...args: Args) => void>();
    return {
      addListener: (listener: (...args: Args) => void) => {
        listeners.add(listener);
      },
      removeListener: (listener: (...args: Args) => void) => {
        listeners.delete(listener);
      },
      hasListener: (listener: (...args: Args) => void) =>
        listeners.has(listener),
      hasListeners: () => listeners.size > 0,
      clear: () => listeners.clear(),
      emit: (...args: Args) => {
        for (const listener of [...listeners]) listener(...args);
      },
    };
  },
}));
function fakePort() {
  const onMessage = event<[unknown, Runtime.Port]>();
  const onDisconnect = event<[Runtime.Port]>();
  const port: Runtime.Port = {
    name: WRITE_PORT,
    onMessage,
    onDisconnect,
    postMessage: vi.fn<(message: unknown) => void>(),
    disconnect: vi.fn(),
  };
  return {
    port,
    reply: (message: unknown) => onMessage.emit(message, port),
    disconnect: () => onDisconnect.emit(port),
  };
}
const browser = vi.hoisted(() => ({
  tabs: {
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    reload: vi.fn(),
    connect: vi.fn(),
    remove: vi.fn(),
    onUpdated: event<[number, Tabs.OnUpdatedChangeInfoType, Tabs.Tab]>(),
    onRemoved: event<[number, Tabs.OnRemovedRemoveInfoType]>(),
  },
  windows: { get: vi.fn(), update: vi.fn() },
}));
vi.mock('webextension-polyfill', () => ({ default: browser }));
import { createWriteBridge, discoverPlaylists } from '../src/write-bridge';

const videoId = 'abcdefghijk';
const target = 'PL1234567890';
const url = `https://www.youtube.com/watch?v=${videoId}`;
function approval(): ExecutionApproval {
  return {
    id: 'approval',
    snapshotId: 'snapshot',
    createdAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
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
let ports: ReturnType<typeof fakePort>[];
let tab: {
  id: number;
  windowId: number;
  active: boolean;
  status: string;
  url: string;
};
let focused: boolean;
let locked: boolean;
const bridges: Awaited<ReturnType<typeof createWriteBridge>>[] = [];
async function open(auth = approval()) {
  const bridge = await createWriteBridge(auth);
  bridges.push(bridge);
  return bridge;
}
async function hydrated() {
  await vi.advanceTimersByTimeAsync(1000);
}
function emitStatus(status: 'loading' | 'complete', tabId = tab.id) {
  if (tabId === tab.id) tab.status = status;
  browser.tabs.onUpdated.emit(
    tabId,
    { status },
    {
      ...tab,
      id: tabId,
      status,
      index: 0,
      highlighted: true,
      pinned: false,
      incognito: false,
    },
  );
}
function expectNavigationListeners(present: boolean) {
  expect(browser.tabs.onUpdated.hasListeners()).toBe(present);
  expect(browser.tabs.onRemoved.hasListeners()).toBe(present);
}
beforeEach(() => {
  vi.resetAllMocks();
  browser.tabs.onUpdated.clear();
  browser.tabs.onRemoved.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
  ports = [];
  locked = false;
  focused = true;
  tab = { id: 123, windowId: 456, active: true, status: 'complete', url };
  browser.tabs.create.mockImplementation(async () => ({ ...tab }));
  browser.tabs.get.mockImplementation(async () => ({ ...tab }));
  browser.tabs.update.mockImplementation(
    async (_id: number, change: { url: string }) => {
      expectNavigationListeners(true);
      tab.url = change.url;
      emitStatus('loading');
      emitStatus('complete');
      return { ...tab };
    },
  );
  browser.tabs.reload.mockImplementation(async () => {
    expectNavigationListeners(true);
    emitStatus('loading');
    emitStatus('complete');
  });
  browser.windows.get.mockImplementation(async () => ({ focused }));
  browser.tabs.connect.mockImplementation(() => {
    const port = fakePort();
    ports.push(port);
    return port.port;
  });
  const request = vi.fn(
    async (
      _name: string,
      _options: LockOptions,
      callback: LockGrantedCallback<unknown>,
    ) => {
      if (locked) return callback(null);
      locked = true;
      try {
        return await callback({
          name: 'latersift-youtube-writer',
          mode: 'exclusive',
        });
      } finally {
        locked = false;
      }
    },
  );
  vi.stubGlobal('navigator', { locks: { request } });
});
afterEach(async () => {
  for (const bridge of bridges.splice(0)) bridge.close();
  await vi.advanceTimersByTimeAsync(0);
  expectNavigationListeners(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('dedicated explicit work tab', () => {
  it('has no startup effects and opens exactly one dedicated foreground tab on explicit creation', async () => {
    await vi.advanceTimersByTimeAsync(60_000);
    expect(browser.tabs.create).not.toHaveBeenCalled();
    const bridge = await open();
    expect(browser.tabs.create).toHaveBeenCalledExactlyOnceWith({
      url,
      active: true,
    });
    expect(browser.tabs.connect).not.toHaveBeenCalled();
    bridge.close();
    bridge.close();
    expect(browser.tabs.remove).not.toHaveBeenCalled();
    expect(browser.tabs.update).not.toHaveBeenCalled();
    expect(browser.windows.update).not.toHaveBeenCalled();
  });
  it('validates before acquiring a lock or creating a tab', async () => {
    const auth = approval();
    auth.actions = [];
    expect(() => createWriteBridge(auth)).toThrow(/Aktion/);
    const expired = approval();
    expired.expiresAt = expired.createdAt;
    expect(() => createWriteBridge(expired)).toThrow(/Nutzerfreigabe/);
    await expect(discoverPlaylists('bad')).rejects.toThrow(/Video-ID/);
    expect(navigator.locks.request).not.toHaveBeenCalled();
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });
  it('holds an exclusive writer lock until close and rejects another writer or discovery without opening a tab', async () => {
    const first = await open();
    expect(navigator.locks.request).toHaveBeenCalledWith(
      'latersift-youtube-writer',
      { ifAvailable: true },
      expect.any(Function),
    );
    await expect(createWriteBridge(approval())).rejects.toThrow(/bereits/);
    await expect(discoverPlaylists(videoId)).rejects.toThrow(/bereits/);
    expect(browser.tabs.create).toHaveBeenCalledOnce();
    first.close();
    await vi.advanceTimersByTimeAsync(0);
    await open();
    expect(browser.tabs.create).toHaveBeenCalledTimes(2);
  });
  it('releases the lock when tab creation returns no tab ID', async () => {
    browser.tabs.create.mockResolvedValueOnce({});
    await expect(createWriteBridge(approval())).rejects.toThrow(
      /nicht geöffnet/,
    );
    await open();
    expect(browser.tabs.create).toHaveBeenCalledTimes(2);
  });
  it('releases the lock when tab creation fails', async () => {
    browser.tabs.create.mockRejectedValueOnce(new Error('tab denied'));
    await expect(createWriteBridge(approval())).rejects.toThrow('tab denied');
    await open();
    expect(browser.tabs.create).toHaveBeenCalledTimes(2);
  });
  it('discovers read-only playlists without transmitting approval and releases its lock', async () => {
    const result = discoverPlaylists(videoId);
    await hydrated();
    expect(ports[0].port.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'request',
      method: 'playlists',
      videoId,
      approval: undefined,
    });
    ports[0].reply({
      ok: true,
      result: [{ id: target, title: 'Archive', writable: true }],
    });
    await expect(result).resolves.toEqual([
      { id: target, title: 'Archive', writable: true },
    ]);
    await vi.advanceTimersByTimeAsync(0);
    await open();
  });
  it('delivers a sanitized diagnostic even when the content reports recognition failure', async () => {
    const diagnostic = vi.fn();
    const result = discoverPlaylists(videoId, diagnostic);
    const rejection = expect(result).rejects.toThrow('private failure');
    await hydrated();
    ports[0].reply({
      ok: false,
      error: 'private failure',
      diagnostic: {
        ...emptyDialogDiagnostic('unsupported-structure'),
        privateText: 'SECRET',
      },
    });
    await rejection;
    expect(diagnostic).toHaveBeenCalledExactlyOnceWith(
      emptyDialogDiagnostic('unsupported-structure'),
    );
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('SECRET');
    expect(ports[0].port.postMessage).toHaveBeenCalledTimes(1);
  });
  it('provides a fixed diagnostic if a work tab cannot be opened, without leaking the exception', async () => {
    browser.tabs.create.mockRejectedValueOnce(new Error('SECRET'));
    const diagnostic = vi.fn();
    await expect(discoverPlaylists(videoId, diagnostic)).rejects.toThrow(
      'SECRET',
    );
    expect(diagnostic).toHaveBeenCalledExactlyOnceWith(
      emptyDialogDiagnostic('connection-unavailable'),
    );
  });
  it('pins a clone of the approved video and target and rechecks expiry before each call', async () => {
    const auth = approval();
    const original = structuredClone(auth);
    const bridge = await open(auth);
    auth.actions[0].targetPlaylist = 'PLabcdefghij';
    await expect(
      bridge.adapter.addToPlaylist(videoId, 'PLabcdefghij'),
    ).rejects.toThrow(/Archivziel/);
    await expect(
      bridge.adapter.removeFromWatchLater('lmnopqrstuv'),
    ).rejects.toThrow(/Video/);
    const result = bridge.adapter.addToPlaylist(videoId, target);
    await hydrated();
    expect(ports[0].port.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'request',
      method: 'add',
      videoId,
      playlistId: target,
      approval: original,
    });
    ports[0].reply({ ok: true, result: { changed: true } });
    await expect(result).resolves.toEqual({ changed: true });
    vi.setSystemTime(original.expiresAt);
    await expect(bridge.adapter.removeFromWatchLater(videoId)).rejects.toThrow(
      /Nutzerfreigabe/,
    );
    expect(browser.tabs.connect).toHaveBeenCalledOnce();
  });
  it('navigates only its dedicated tab to another explicitly approved video without activating other tabs', async () => {
    const auth = approval();
    const other = 'lmnopqrstuv';
    auth.actions.push({
      decisionId: 'second',
      videoId: other,
      kind: 'remove',
      targetPlaylist: null,
    });
    const bridge = await open(auth);
    const result = bridge.adapter.removeFromWatchLater(other);
    await hydrated();
    expect(browser.tabs.update).toHaveBeenCalledExactlyOnceWith(123, {
      url: `https://www.youtube.com/watch?v=${other}`,
    });
    expect(browser.tabs.connect).toHaveBeenCalledExactlyOnceWith(123, {
      name: WRITE_PORT,
    });
    expect(ports[0].port.postMessage).toHaveBeenCalledWith({
      type: 'request',
      method: 'remove',
      videoId: other,
      approval: auth,
    });
    ports[0].reply({ ok: true, result: { changed: true } });
    await expect(result).resolves.toEqual({ changed: true });
    expect(browser.tabs.create).toHaveBeenCalledOnce();
    expect(browser.windows.update).not.toHaveBeenCalled();
  });
  it.each(['add', 'remove'] as const)(
    'preserves changed:false in the %s mutation response',
    async (method) => {
      const bridge = await open();
      const result =
        method === 'add'
          ? bridge.adapter.addToPlaylist(videoId, target)
          : bridge.adapter.removeFromWatchLater(videoId);
      await hydrated();
      ports[0].reply({ ok: true, result: { changed: false } });
      await expect(result).resolves.toEqual({ changed: false });
    },
  );
  it('reloads with bypassCache after the changed video finishes loading and waits for that reload before the first membership RPC', async () => {
    const other = 'lmnopqrstuv';
    const auth = approval();
    auth.actions.push({
      decisionId: 'second',
      videoId: other,
      kind: 'remove',
      targetPlaylist: null,
    });
    const bridge = await open(auth);
    browser.tabs.update.mockImplementationOnce(
      async (_id: number, change: { url: string }) => {
        expectNavigationListeners(true);
        tab.url = change.url;
        emitStatus('loading');
        return { ...tab };
      },
    );
    browser.tabs.reload.mockImplementationOnce(async () => {
      expectNavigationListeners(true);
      expect(tab.status).toBe('complete');
      emitStatus('loading');
    });
    const read = bridge.adapter.getPlaylistMembership(other, 'WL');
    await vi.advanceTimersByTimeAsync(0);
    expect(browser.tabs.update).toHaveBeenCalledExactlyOnceWith(123, {
      url: `https://www.youtube.com/watch?v=${other}`,
    });
    expect(browser.tabs.reload).not.toHaveBeenCalled();
    expect(browser.tabs.connect).not.toHaveBeenCalled();
    emitStatus('complete');
    await vi.advanceTimersByTimeAsync(500);
    expect(browser.tabs.reload).toHaveBeenCalledExactlyOnceWith(123, {
      bypassCache: true,
    });
    expect(browser.tabs.update.mock.invocationCallOrder[0]).toBeLessThan(
      browser.tabs.reload.mock.invocationCallOrder[0],
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(browser.tabs.connect).not.toHaveBeenCalled();
    emitStatus('complete');
    await vi.advanceTimersByTimeAsync(500);
    expect(browser.tabs.connect).not.toHaveBeenCalled();
    await hydrated();
    expect(browser.tabs.connect).toHaveBeenCalledExactlyOnceWith(123, {
      name: WRITE_PORT,
    });
    expect(browser.tabs.reload.mock.invocationCallOrder[0]).toBeLessThan(
      browser.tabs.connect.mock.invocationCallOrder[0],
    );
    expect(ports[0].port.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'request',
      method: 'membership',
      videoId: other,
      playlistId: 'WL',
      approval: auth,
    });
    const evidence = {
      state: 'absent',
      source: 'native-dialog',
      observedAt: new Date().toISOString(),
    };
    ports[0].reply({ ok: true, result: evidence });
    await expect(read).resolves.toEqual(evidence);
  });
  it('hard reloads with bypassCache before EVERY membership read rather than trusting an optimistic cached checkbox', async () => {
    const bridge = await open();
    const add = bridge.adapter.addToPlaylist(videoId, target);
    await hydrated();
    ports[0].reply({ ok: true, result: { changed: true } });
    await expect(add).resolves.toEqual({ changed: true });
    expect(browser.tabs.reload).not.toHaveBeenCalled();
    for (const [index, playlist] of [target, target, 'WL'].entries()) {
      const read = bridge.adapter.getPlaylistMembership(videoId, playlist);
      await hydrated();
      expect(browser.tabs.reload).toHaveBeenNthCalledWith(index + 1, 123, {
        bypassCache: true,
      });
      expect(browser.tabs.reload.mock.invocationCallOrder[index]).toBeLessThan(
        browser.tabs.connect.mock.invocationCallOrder[index + 1],
      );
      expectNavigationListeners(false);
      const evidence = {
        state: 'absent',
        source: 'native-dialog',
        observedAt: new Date().toISOString(),
      };
      ports[index + 1].reply({ ok: true, result: evidence });
      await expect(read).resolves.toEqual(evidence);
    }
    expect(browser.tabs.reload).toHaveBeenCalledTimes(3);
    expect(browser.tabs.connect).toHaveBeenCalledWith(123, {
      name: WRITE_PORT,
    });
  });
  it.each(['inactive', 'unfocused', 'switched-during-load'])(
    'never autoactivates after a user switch: %s',
    async (state) => {
      const bridge = await open();
      if (state === 'inactive') tab.active = false;
      if (state === 'unfocused') focused = false;
      if (state === 'switched-during-load') {
        tab.status = 'loading';
        browser.tabs.get
          .mockResolvedValueOnce({ ...tab })
          .mockResolvedValueOnce({ ...tab, active: false });
      }
      await expect(
        bridge.adapter.removeFromWatchLater(videoId),
      ).rejects.toThrow(/aktiv|gewechselt/);
      expect(browser.tabs.connect).not.toHaveBeenCalled();
      expect(browser.tabs.update).not.toHaveBeenCalled();
      expect(browser.windows.update).not.toHaveBeenCalled();
      expect(browser.tabs.create).toHaveBeenCalledOnce();
    },
  );
  it('rejects concurrent requests before hydration and while a reply is pending', async () => {
    const bridge = await open();
    const first = bridge.adapter.getAvailablePlaylists(videoId);
    await expect(bridge.adapter.removeFromWatchLater(videoId)).rejects.toThrow(
      /beschäftigt/,
    );
    await hydrated();
    await expect(
      bridge.adapter.getPlaylistMembership(videoId, target),
    ).rejects.toThrow(/beschäftigt/);
    expect(browser.tabs.connect).toHaveBeenCalledOnce();
    ports[0].reply({ ok: true, result: [] });
    await first;
  });
  it.each([
    'disconnect',
    'timeout',
    'response-error',
    'invalid-response',
    'post-error',
  ])(
    'stops on %s, never retries or reports mutation success',
    async (failure) => {
      const bridge = await open();
      if (failure === 'post-error')
        browser.tabs.connect.mockImplementationOnce(() => {
          const port = fakePort();
          ports.push(port);
          vi.mocked(port.port.postMessage).mockImplementation(() => {
            throw new Error('send failed');
          });
          return port.port;
        });
      const result = bridge.adapter.removeFromWatchLater(videoId);
      const rejected = expect(result).rejects.toThrow(
        /unterbrochen|unklar|denied|Ungültige|send failed/,
      );
      await hydrated();
      switch (failure) {
        case 'disconnect':
          ports[0].disconnect();
          break;
        case 'timeout':
          ports[0].reply({ unrelated: true });
          await vi.advanceTimersByTimeAsync(34_999);
          expect(ports[0].port.disconnect).not.toHaveBeenCalled();
          await vi.advanceTimersByTimeAsync(1);
          break;
        case 'response-error':
          ports[0].reply({ ok: false, error: 'denied; outcome unknown' });
          break;
        case 'invalid-response':
          ports[0].reply({ ok: true });
          break;
      }
      await rejected;
      ports[0].reply({ ok: true, result: { changed: true } });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(browser.tabs.connect).toHaveBeenCalledOnce();
      expect(browser.tabs.create).toHaveBeenCalledOnce();
      expect(ports[0].port.postMessage).toHaveBeenCalledOnce();
      expect(ports[0].port.disconnect).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it.each([
    'no-events',
    'complete-only',
    'other-tab-transition',
    'loading-only',
  ])(
    'does not accept a resolved reload or stale complete status without a fresh loading -> complete transition: %s',
    async (events) => {
      const bridge = await open();
      browser.tabs.reload.mockImplementationOnce(async () => {
        expectNavigationListeners(true);
        if (events === 'complete-only') emitStatus('complete');
        if (events === 'other-tab-transition') {
          emitStatus('loading', 999);
          emitStatus('complete', 999);
        }
        if (events === 'loading-only') emitStatus('loading');
      });
      const read = bridge.adapter.getPlaylistMembership(videoId, target);
      const rejected = expect(read).rejects.toThrow(
        /neuer Seitenladevorgang.*30 Sekunden/,
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(browser.tabs.reload).toHaveBeenCalledExactlyOnceWith(123, {
        bypassCache: true,
      });
      expectNavigationListeners(true);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(browser.tabs.connect).not.toHaveBeenCalled();
      expectNavigationListeners(true);
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
      expectNavigationListeners(false);
      expect(vi.getTimerCount()).toBe(0);
      emitStatus('loading');
      emitStatus('complete');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(browser.tabs.connect).not.toHaveBeenCalled();
      expect(browser.tabs.reload).toHaveBeenCalledOnce();
    },
  );
  it.each(['update', 'reload'] as const)(
    'tab removal cancels pending %s immediately and cleans navigation listeners',
    async (action) => {
      const bridge = await open();
      if (action === 'update')
        tab.url = 'https://www.youtube.com/watch?v=lmnopqrstuv';
      browser.tabs[action].mockImplementationOnce(async () => {
        expectNavigationListeners(true);
        emitStatus('loading');
      });
      const read = bridge.adapter.getPlaylistMembership(videoId, target);
      const rejected = expect(read).rejects.toThrow(
        /Arbeitstab wurde geschlossen/,
      );
      await vi.advanceTimersByTimeAsync(0);
      browser.tabs.onRemoved.emit(999, {
        windowId: 456,
        isWindowClosing: false,
      });
      expectNavigationListeners(true);
      browser.tabs.onRemoved.emit(123, {
        windowId: 456,
        isWindowClosing: false,
      });
      await rejected;
      expectNavigationListeners(false);
      expect(vi.getTimerCount()).toBe(0);
      emitStatus('complete');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(browser.tabs.connect).not.toHaveBeenCalled();
      expect(browser.tabs[action]).toHaveBeenCalledOnce();
    },
  );
  it.each(['update', 'reload'] as const)(
    'bridge close cancels pending %s immediately, removes listeners and releases the writer lock',
    async (action) => {
      const bridge = await open();
      if (action === 'update')
        tab.url = 'https://www.youtube.com/watch?v=lmnopqrstuv';
      browser.tabs[action].mockImplementationOnce(async () => {
        expectNavigationListeners(true);
        emitStatus('loading');
      });
      const read = bridge.adapter.getPlaylistMembership(videoId, target);
      const rejected = expect(read).rejects.toThrow(
        /Arbeitsverbindung geschlossen/,
      );
      await vi.advanceTimersByTimeAsync(0);
      expectNavigationListeners(true);
      bridge.close();
      await rejected;
      expectNavigationListeners(false);
      expect(vi.getTimerCount()).toBe(0);
      emitStatus('complete');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(browser.tabs.connect).not.toHaveBeenCalled();
      await expect(
        bridge.adapter.getAvailablePlaylists(videoId),
      ).rejects.toThrow(/geschlossen/);
      await open();
      expect(browser.tabs.create).toHaveBeenCalledTimes(2);
    },
  );
  it.each(['update', 'reload'] as const)(
    'cleans navigation listeners and deadline when %s rejects',
    async (action) => {
      const bridge = await open();
      if (action === 'update')
        tab.url = 'https://www.youtube.com/watch?v=lmnopqrstuv';
      browser.tabs[action].mockRejectedValueOnce(
        new Error('navigation denied'),
      );
      await expect(
        bridge.adapter.getPlaylistMembership(videoId, target),
      ).rejects.toThrow('navigation denied');
      expectNavigationListeners(false);
      expect(vi.getTimerCount()).toBe(0);
      expect(browser.tabs.connect).not.toHaveBeenCalled();
    },
  );
  it('aborts a closed bridge during page loading without connecting', async () => {
    const bridge = await open();
    tab.status = 'loading';
    const result = bridge.adapter.getAvailablePlaylists(videoId);
    const rejected = expect(result).rejects.toThrow(/geschlossen/);
    await vi.advanceTimersByTimeAsync(0);
    bridge.close();
    await vi.advanceTimersByTimeAsync(500);
    await rejected;
    await expect(bridge.adapter.getAvailablePlaylists(videoId)).rejects.toThrow(
      /geschlossen/,
    );
    expect(browser.tabs.connect).not.toHaveBeenCalled();
  });
  it('times out a loading page after 30 seconds without connecting or retrying', async () => {
    const bridge = await open();
    tab.status = 'loading';
    const result = bridge.adapter.getAvailablePlaylists(videoId);
    const rejected = expect(result).rejects.toThrow(/30 Sekunden/);
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    expect(browser.tabs.connect).not.toHaveBeenCalled();
    expect(browser.tabs.create).toHaveBeenCalledOnce();
  });
});
