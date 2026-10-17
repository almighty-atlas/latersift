import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Runtime, Tabs } from 'webextension-polyfill';
import type { ExecutionApproval } from '../src/operations';
import { AUTHORIZE_MUTATION, type WriteRequest } from '../src/write-protocol';

const storage = vi.hoisted(() => ({
  authorizeMutation: vi.fn<(request: WriteRequest) => Promise<void>>(),
}));
const browser = vi.hoisted(() => ({
  runtime: {
    id: 'latersift@test',
    getURL: vi.fn<(path: string) => string>(),
    onMessage: {
      addListener:
        vi.fn<
          (
            listener: (
              message: unknown,
              sender: Runtime.MessageSender,
            ) => unknown,
          ) => void
        >(),
    },
  },
  action: {
    onClicked: {
      addListener: vi.fn<(listener: () => Promise<void>) => void>(),
    },
  },
  tabs: {
    query: vi.fn<() => Promise<Tabs.Tab[]>>(),
    update: vi.fn(),
    create: vi.fn(),
    connect: vi.fn(),
    reload: vi.fn(),
  },
}));
vi.mock('webextension-polyfill', () => ({ default: browser }));
vi.mock('../src/storage', () => storage);
import { authorizeContentMutation } from '../src/write-authority';

const videoId = 'abcdefghijk';
const target = 'PL1234567890';
const watchURL = `https://www.youtube.com/watch?v=${videoId}`;
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
function request(method: 'add' | 'remove' = 'add'): WriteRequest {
  return {
    type: 'request',
    method,
    videoId,
    playlistId: target,
    approval: approval(),
  };
}
function tab(): Tabs.Tab {
  return {
    id: 123,
    windowId: 456,
    url: watchURL,
    active: true,
    status: 'complete',
    index: 0,
    highlighted: true,
    pinned: false,
    incognito: false,
  };
}
function sender(): Runtime.MessageSender {
  return { id: browser.runtime.id, url: watchURL, tab: tab(), frameId: 0 };
}
function envelope(mutation: unknown = request()) {
  return { type: AUTHORIZE_MUTATION, request: mutation };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
  storage.authorizeMutation.mockResolvedValue(undefined);
  browser.runtime.getURL.mockImplementation(
    (path) => `moz-extension://latersift/${path}`,
  );
  browser.tabs.query.mockResolvedValue([]);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('event-page mutation authority boundary', () => {
  it.each([
    undefined,
    null,
    false,
    'authorize',
    {},
    { type: 'scan' },
    { type: 'request' },
  ])(
    'ignores unrelated messages %j without accessing storage',
    async (message) => {
      await expect(
        authorizeContentMutation(message, sender()),
      ).resolves.toBeUndefined();
      expect(storage.authorizeMutation).not.toHaveBeenCalled();
    },
  );
  it.each(['add', 'remove'] as const)(
    'authorizes only a validated %s from the own exact-video YouTube content sender',
    async (method) => {
      const mutation = request(method);
      await expect(
        authorizeContentMutation(envelope(mutation), sender()),
      ).resolves.toEqual({ authorized: true });
      expect(storage.authorizeMutation).toHaveBeenCalledExactlyOnceWith(
        mutation,
      );
      expect(browser.tabs.update).not.toHaveBeenCalled();
      expect(browser.tabs.create).not.toHaveBeenCalled();
      expect(browser.tabs.connect).not.toHaveBeenCalled();
      expect(browser.tabs.reload).not.toHaveBeenCalled();
    },
  );
  it.each([
    'missing-id',
    'wrong-id',
    'no-tab',
    'no-tab-id',
    'no-url',
    'extension-page',
  ])(
    'denies invalid sender %s before storage authorization',
    async (defect) => {
      const source = sender();
      switch (defect) {
        case 'missing-id':
          delete source.id;
          break;
        case 'wrong-id':
          source.id = 'another-extension@test';
          break;
        case 'no-tab':
          delete source.tab;
          break;
        case 'no-tab-id':
          source.tab = { ...tab(), id: undefined };
          break;
        case 'no-url':
          delete source.url;
          break;
        case 'extension-page':
          source.url = browser.runtime.getURL('index.html');
          break;
      }
      await expect(
        authorizeContentMutation(envelope(), source),
      ).resolves.toEqual({ authorized: false, error: expect.any(String) });
      expect(storage.authorizeMutation).not.toHaveBeenCalled();
    },
  );
  it.each([
    'http://www.youtube.com/watch?v=abcdefghijk',
    'https://youtube.com/watch?v=abcdefghijk',
    'https://www.youtube.com.evil.test/watch?v=abcdefghijk',
    'https://evil.test/watch?v=abcdefghijk',
    'https://www.youtube.com/playlist?v=abcdefghijk',
    'https://www.youtube.com/watch/extra?v=abcdefghijk',
    'https://www.youtube.com/watch?v=lmnopqrstuv',
    'https://www.youtube.com/watch',
    'https://www.youtube.com/watch?v=abcdefghijk&v=abcdefghijk',
    'https://www.youtube.com/watch?v=lmnopqrstuv&v=abcdefghijk',
    '/watch?v=abcdefghijk',
    'not a URL',
  ])(
    'denies a sender URL not identifying the exact approved watch video: %s',
    async (url) => {
      await expect(
        authorizeContentMutation(envelope(), { ...sender(), url }),
      ).resolves.toEqual({ authorized: false, error: expect.any(String) });
      expect(storage.authorizeMutation).not.toHaveBeenCalled();
    },
  );
  it.each([
    'missing-request',
    'no-auth',
    'expired',
    'wrong-video',
    'wrong-target',
    'malformed',
    'playlists',
    'membership',
  ])('rejects %s before storage can consume an attempt', async (defect) => {
    const mutation = request();
    let message: unknown = envelope(mutation);
    switch (defect) {
      case 'missing-request':
        message = { type: AUTHORIZE_MUTATION };
        break;
      case 'no-auth':
        delete mutation.approval;
        break;
      case 'expired':
        mutation.approval!.expiresAt = new Date().toISOString();
        break;
      case 'wrong-video':
        mutation.videoId = 'lmnopqrstuv';
        break;
      case 'wrong-target':
        mutation.playlistId = 'PLabcdefghij';
        break;
      case 'malformed':
        message = envelope({ type: 'request', method: 'execute', videoId });
        break;
      case 'playlists':
        mutation.method = 'playlists';
        break;
      case 'membership':
        mutation.method = 'membership';
        break;
    }
    await expect(authorizeContentMutation(message, sender())).resolves.toEqual({
      authorized: false,
      error: expect.any(String),
    });
    expect(storage.authorizeMutation).not.toHaveBeenCalled();
  });
  it('does not grant authorization until the durable storage transaction resolves', async () => {
    const commit = deferred<void>();
    storage.authorizeMutation.mockReturnValueOnce(commit.promise);
    let settled = false;
    const result = authorizeContentMutation(envelope(), sender());
    void result.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.authorizeMutation).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    commit.resolve();
    await expect(result).resolves.toEqual({ authorized: true });
  });
  it.each([
    new Error('durable running WAL missing'),
    new Error('attempt already consumed'),
    'storage unavailable',
  ])('denies authority when storage rejects: %s', async (error) => {
    storage.authorizeMutation.mockRejectedValueOnce(error);
    await expect(
      authorizeContentMutation(envelope(), sender()),
    ).resolves.toEqual({
      authorized: false,
      error: error instanceof Error ? error.message : error,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(storage.authorizeMutation).toHaveBeenCalledOnce();
  });
  it('consults the durable attempt ledger again for a replay rather than caching an approval', async () => {
    const message = envelope();
    storage.authorizeMutation
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('attempt already consumed'));
    await expect(authorizeContentMutation(message, sender())).resolves.toEqual({
      authorized: true,
    });
    await expect(authorizeContentMutation(message, sender())).resolves.toEqual({
      authorized: false,
      error: 'attempt already consumed',
    });
    expect(storage.authorizeMutation).toHaveBeenCalledTimes(2);
  });
});

describe('background registration and explicit toolbar action', () => {
  async function background() {
    vi.resetModules();
    await import('../src/background');
  }
  it('registers one authorization handler and one action handler without startup writes or timers', async () => {
    await background();
    expect(browser.runtime.onMessage.addListener).toHaveBeenCalledOnce();
    expect(browser.action.onClicked.addListener).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(storage.authorizeMutation).not.toHaveBeenCalled();
    expect(browser.tabs.query).not.toHaveBeenCalled();
    expect(browser.tabs.create).not.toHaveBeenCalled();
    expect(browser.tabs.update).not.toHaveBeenCalled();
    expect(browser.tabs.connect).not.toHaveBeenCalled();
    expect(browser.tabs.reload).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('returns the real authorization promise from the registered onMessage handler', async () => {
    await background();
    const handler = browser.runtime.onMessage.addListener.mock.calls[0][0];
    const commit = deferred<void>();
    storage.authorizeMutation.mockReturnValueOnce(commit.promise);
    const message = envelope();
    const result = handler(message, sender());
    expect(result).toBeInstanceOf(Promise);
    expect(storage.authorizeMutation).toHaveBeenCalledExactlyOnceWith(
      message.request,
    );
    commit.resolve();
    await expect(result).resolves.toEqual({ authorized: true });
    await expect(
      handler({ type: 'unrelated' }, sender()),
    ).resolves.toBeUndefined();
    expect(storage.authorizeMutation).toHaveBeenCalledOnce();
  });
  it('opens the extension page only on an explicit toolbar click, without requesting mutation authority', async () => {
    await background();
    await browser.action.onClicked.addListener.mock.calls[0][0]();
    expect(browser.tabs.query).toHaveBeenCalledExactlyOnceWith({});
    expect(browser.tabs.create).toHaveBeenCalledExactlyOnceWith({
      url: browser.runtime.getURL('index.html'),
    });
    expect(browser.tabs.update).not.toHaveBeenCalled();
    expect(storage.authorizeMutation).not.toHaveBeenCalled();
  });
  it('keeps the normal action behavior of activating an existing extension page', async () => {
    await background();
    browser.tabs.query.mockResolvedValueOnce([
      { ...tab(), id: 789, url: browser.runtime.getURL('index.html') },
    ]);
    await browser.action.onClicked.addListener.mock.calls[0][0]();
    expect(browser.tabs.update).toHaveBeenCalledExactlyOnceWith(789, {
      active: true,
    });
    expect(browser.tabs.create).not.toHaveBeenCalled();
    expect(storage.authorizeMutation).not.toHaveBeenCalled();
  });
});
