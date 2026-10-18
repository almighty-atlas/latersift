import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tabs } from 'webextension-polyfill';

const browser = vi.hoisted(() => ({
  tabs: { create: vi.fn(), get: vi.fn(), remove: vi.fn() },
}));
vi.mock('webextension-polyfill', () => ({ default: browser }));
type API = typeof import('../src/work-tabs');
let api: API;
let tabs: Map<number, Partial<Tabs.Tab>>;
let nextId: number;
let held: Map<string, Promise<void>>;
const JOURNAL = 'latersift.work-tabs.v1';

function mockLocks() {
  held = new Map();
  function request(
    name: string,
    options: LockOptions | LockGrantedCallback<unknown>,
    callback?: LockGrantedCallback<unknown>,
  ): Promise<unknown> {
    const run = typeof options === 'function' ? options : callback!;
    const busy = held.get(name);
    if (busy) {
      if (typeof options !== 'function' && options.ifAvailable)
        return Promise.resolve(run(null));
      return busy.then(() => request(name, options, callback));
    }
    let release!: () => void;
    held.set(
      name,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return Promise.resolve()
      .then(() => run({ name, mode: 'exclusive' }))
      .finally(() => {
        held.delete(name);
        release();
      });
  }
  vi.stubGlobal('navigator', { locks: { request } });
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    clear: () => storage.clear(),
  });
  tabs = new Map();
  nextId = 10;
  mockLocks();
  browser.tabs.create.mockImplementation(
    async (options: Tabs.CreateCreatePropertiesType) => {
      const tab = {
        id: nextId++,
        url: options.url,
        active: options.active,
        status: 'loading',
      };
      tabs.set(tab.id, tab);
      return tab;
    },
  );
  browser.tabs.get.mockImplementation(async (id: number) => {
    const tab = tabs.get(id);
    if (!tab) throw new Error('Invalid tab ID');
    return { ...tab };
  });
  browser.tabs.remove.mockImplementation(async (id: number) => {
    tabs.delete(id);
  });
  api = await import('../src/work-tabs');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function restart(): Promise<API> {
  // Browser restart loses module state and lifetime locks, but keeps the journal.
  mockLocks();
  vi.resetModules();
  return import('../src/work-tabs');
}

function journal(): unknown[] {
  return JSON.parse(localStorage.getItem(JOURNAL) ?? '[]');
}

describe('work tabs', () => {
  it.each(['playlists', 'watch-later'] as const)(
    'creates a fresh inactive %s tab and closes only it',
    async (source) => {
      tabs.set(1, {
        id: 1,
        url: 'https://www.youtube.com/feed/playlists',
        active: true,
      });
      const work = await api.createWorkTab(source);
      const base =
        source === 'playlists' ? '/feed/playlists' : '/playlist?list=WL';
      expect(browser.tabs.create).toHaveBeenCalledWith({
        active: false,
        url: expect.stringMatching(
          new RegExp(
            `^https://www\\.youtube\\.com${base.replace('?', '\\?')}#latersift-work=[\\da-f-]{36}$`,
          ),
        ),
      });
      expect(journal()).toHaveLength(1);
      expect(work.tabId).not.toBe(1);
      await Promise.all([work.close(), work.close()]);
      expect(browser.tabs.remove).toHaveBeenCalledExactlyOnceWith(work.tabId);
      expect(tabs.has(1)).toBe(true);
      expect(journal()).toEqual([]);
      expect(held.size).toBe(0);
    },
  );

  it('polls until complete without releasing the source lock', async () => {
    vi.useFakeTimers();
    const work = await api.createWorkTab('playlists');
    const waiting = api.waitForWorkTab(work.tabId);
    await vi.advanceTimersByTimeAsync(500);
    expect(browser.tabs.get.mock.calls.length).toBeGreaterThanOrEqual(2);
    tabs.get(work.tabId)!.status = 'complete';
    await vi.advanceTimersByTimeAsync(250);
    await waiting;
    await expect(api.createWorkTab('playlists')).rejects.toThrow(
      'already active',
    );
    await work.close();
  });

  it('rejects same-source concurrency across modules, allows different sources', async () => {
    const first = await api.createWorkTab('playlists');
    vi.resetModules();
    const other = await import('../src/work-tabs');
    await expect(other.createWorkTab('playlists')).rejects.toThrow(
      'already active',
    );
    const second = await other.createWorkTab('watch-later');
    expect(journal()).toHaveLength(2);
    await Promise.all([first.close(), second.close()]);
    const third = await other.createWorkTab('playlists');
    await third.close();
  });

  it('never cleans up a live tab, including from another extension page', async () => {
    const work = await api.createWorkTab('playlists');
    vi.resetModules();
    const other = await import('../src/work-tabs');
    await other.cleanupOrphanWorkTabs();
    expect(browser.tabs.remove).not.toHaveBeenCalled();
    expect(journal()).toHaveLength(1);
    await work.close();
  });

  it.each([
    'https://www.youtube.com/watch?v=abc',
    'https://www.youtube.com/feed/playlists/extra',
    'https://www.youtube.com/feed/playlists?other=1',
    'https://www.youtube.com/playlist?list=WL',
    'https://example.com/feed/playlists',
    'https://www.youtube.com/feed/playlists',
  ])('preserves navigated tabs: %s', async (url) => {
    const work = await api.createWorkTab('playlists');
    const original = tabs.get(work.tabId)!.url!;
    const marker = new URL(original).hash;
    tabs.get(work.tabId)!.url =
      url + (url.endsWith('/playlists') ? '' : marker);
    tabs.get(work.tabId)!.status = 'complete';
    await expect(api.waitForWorkTab(work.tabId)).rejects.toThrow('navigated');
    expect(journal()).toEqual([]);
    // Ownership, once abandoned, cannot be resurrected by a stale handle.
    tabs.get(work.tabId)!.url = original;
    await work.close();
    expect(browser.tabs.remove).not.toHaveBeenCalled();
    const next = await api.createWorkTab('playlists');
    await next.close();
  });

  it('close preserves a tab navigated to the other valid source', async () => {
    const work = await api.createWorkTab('watch-later');
    const tab = tabs.get(work.tabId)!;
    tab.url = 'https://www.youtube.com/feed/playlists' + new URL(tab.url!).hash;
    await work.close();
    expect(browser.tabs.remove).not.toHaveBeenCalled();
    expect(journal()).toEqual([]);
  });

  it('rejects pending navigation even while the old document is complete', async () => {
    const work = await api.createWorkTab('playlists');
    Object.assign(tabs.get(work.tabId)!, {
      status: 'complete',
      pendingUrl: 'https://example.com',
    });
    await expect(api.waitForWorkTab(work.tabId)).rejects.toThrow('navigated');
    await work.close();
    expect(browser.tabs.remove).not.toHaveBeenCalled();
  });

  it('rejects tab loss, discards ownership and releases the source', async () => {
    const work = await api.createWorkTab('watch-later');
    tabs.delete(work.tabId);
    await expect(api.waitForWorkTab(work.tabId)).rejects.toThrow('lost');
    await work.close();
    expect(browser.tabs.remove).not.toHaveBeenCalled();
    expect(journal()).toEqual([]);
    const next = await api.createWorkTab('watch-later');
    await next.close();
  });

  it.each([false, true])(
    'times out after 30s (hung tabs.get: %s), and close releases the lock',
    async (hung) => {
      vi.useFakeTimers();
      const work = await api.createWorkTab('playlists');
      if (hung)
        browser.tabs.get.mockImplementationOnce(() => new Promise(() => {}));
      const waiting = expect(api.waitForWorkTab(work.tabId)).rejects.toThrow(
        '30 seconds',
      );
      await vi.advanceTimersByTimeAsync(30_000);
      await waiting;
      await work.close();
      expect(journal()).toEqual([]);
      expect(held.size).toBe(0);
    },
  );

  it('cleans matching orphans after restart, but leaves unrecorded and reused IDs untouched', async () => {
    const first = await api.createWorkTab('playlists');
    const second = await api.createWorkTab('watch-later');
    tabs.set(99, { ...tabs.get(first.tabId)!, id: 99 });
    tabs.set(second.tabId, {
      id: second.tabId,
      url: 'https://www.youtube.com/playlist?list=WL',
    });
    const fresh = await restart();
    await fresh.cleanupOrphanWorkTabs();
    expect(browser.tabs.remove).toHaveBeenCalledExactlyOnceWith(first.tabId);
    expect(tabs.has(99)).toBe(true);
    expect(tabs.has(second.tabId)).toBe(true);
    expect(journal()).toEqual([]);
    expect(browser.tabs.create).toHaveBeenCalledTimes(2);
    await fresh.cleanupOrphanWorkTabs();
    expect(browser.tabs.remove).toHaveBeenCalledTimes(1);
  });

  it('does not accept a different random marker, even at the correct source and ID', async () => {
    const work = await api.createWorkTab('watch-later');
    tabs.get(work.tabId)!.url =
      `https://www.youtube.com/playlist?list=WL#latersift-work=${crypto.randomUUID()}`;
    const fresh = await restart();
    await fresh.cleanupOrphanWorkTabs();
    expect(browser.tabs.remove).not.toHaveBeenCalled();
    expect(journal()).toEqual([]);
  });

  it('newly created reused IDs replace stale journal records rather than inheriting ownership', async () => {
    const old = await api.createWorkTab('playlists');
    const fresh = await restart();
    nextId = old.tabId;
    const work = await fresh.createWorkTab('watch-later');
    tabs.get(work.tabId)!.status = 'complete';
    expect(journal()).toHaveLength(1);
    await fresh.waitForWorkTab(work.tabId);
    await work.close();
    expect(journal()).toEqual([]);
  });

  it('rejects a watch-later tab navigated to a different playlist', async () => {
    const work = await api.createWorkTab('watch-later');
    const tab = tabs.get(work.tabId)!;
    tab.url = tab.url!.replace('list=WL', 'list=PLother');
    await expect(api.waitForWorkTab(work.tabId)).rejects.toThrow('navigated');
    await work.close();
    expect(browser.tabs.remove).not.toHaveBeenCalled();
    expect(journal()).toEqual([]);
  });

  it('forgets missing orphans without removing another tab', async () => {
    const work = await api.createWorkTab('playlists');
    tabs.delete(work.tabId);
    const fresh = await restart();
    await fresh.cleanupOrphanWorkTabs();
    expect(journal()).toEqual([]);
    expect(browser.tabs.remove).not.toHaveBeenCalled();
  });

  it('retains failed removals for retry but releases lifetime locks', async () => {
    const work = await api.createWorkTab('playlists');
    browser.tabs.remove.mockRejectedValueOnce(new Error('remove failed'));
    await expect(work.close()).rejects.toThrow('remove failed');
    expect(held.size).toBe(0);
    expect(journal()).toHaveLength(1);
    await api.cleanupOrphanWorkTabs();
    expect(journal()).toEqual([]);
  });

  it('cleanup continues with other sources after a removal failure', async () => {
    const first = await api.createWorkTab('playlists');
    const second = await api.createWorkTab('watch-later');
    const fresh = await restart();
    browser.tabs.remove.mockRejectedValueOnce(new Error('remove failed'));
    await expect(fresh.cleanupOrphanWorkTabs()).rejects.toThrow(
      'cleanup failed',
    );
    expect(tabs.has(first.tabId)).toBe(true);
    expect(tabs.has(second.tabId)).toBe(false);
    expect(held.size).toBe(0);
    await fresh.cleanupOrphanWorkTabs();
    expect(journal()).toEqual([]);
  });

  it('releases the source when creation fails', async () => {
    browser.tabs.create.mockRejectedValueOnce(new Error('create failed'));
    await expect(api.createWorkTab('playlists')).rejects.toThrow(
      'create failed',
    );
    const work = await api.createWorkTab('playlists');
    await work.close();
  });

  it('fails closed without Web Locks or with an invalid journal', async () => {
    localStorage.setItem(JOURNAL, 'not json');
    await expect(api.cleanupOrphanWorkTabs()).rejects.toThrow('cleanup failed');
    expect(browser.tabs.remove).not.toHaveBeenCalled();
    localStorage.clear();
    vi.stubGlobal('navigator', {});
    await expect(api.createWorkTab('playlists')).rejects.toThrow('Web Locks');
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });

  it('removes only its newly created marked tab if journal persistence fails', async () => {
    const set = vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
      throw new Error('storage full');
    });
    try {
      await expect(api.createWorkTab('playlists')).rejects.toThrow(
        'storage full',
      );
      expect(browser.tabs.remove).toHaveBeenCalledExactlyOnceWith(10);
      expect(held.size).toBe(0);
    } finally {
      set.mockRestore();
    }
  });

  it('does not poll or close arbitrary existing tabs', async () => {
    tabs.set(1, {
      id: 1,
      url: 'https://www.youtube.com/feed/playlists',
      status: 'complete',
    });
    await expect(api.waitForWorkTab(1)).rejects.toThrow('Unknown');
    await api.cleanupOrphanWorkTabs();
    expect(browser.tabs.get).not.toHaveBeenCalled();
    expect(browser.tabs.remove).not.toHaveBeenCalled();
  });
});
