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
        status: 'complete',
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

  describe.each(['playlists', 'watch-later'] as const)(
    'create snapshot for %s',
    (source) => {
      it.each([
        'markerless',
        'different-marker',
        'foreign-loading',
        'foreign-complete',
        'pending-markerless',
        'pending-foreign',
        'blank-pending',
        'missing-pending',
      ])(
        'permanently forfeits cleanup after %s, even when the first lookup is restored',
        async (deviation) => {
          browser.tabs.create.mockImplementation(
            async (options: Tabs.CreateCreatePropertiesType) => {
              const restored = {
                id: nextId++,
                url: options.url!,
                status: 'complete',
              };
              tabs.set(restored.id, restored);
              const snapshot: Partial<Tabs.Tab> = { ...restored };
              if (deviation === 'markerless')
                snapshot.url = restored.url.split('#')[0];
              if (deviation === 'different-marker')
                snapshot.url = restored.url.split('#')[0] + '#private-marker';
              if (deviation.startsWith('foreign-')) {
                snapshot.url =
                  'https://example.com/private-person' +
                  new URL(restored.url).hash;
                snapshot.status =
                  deviation === 'foreign-loading' ? 'loading' : 'complete';
              }
              if (deviation.includes('pending')) {
                snapshot.pendingUrl =
                  deviation === 'pending-foreign'
                    ? 'https://example.com/private-person'
                    : restored.url.split('#')[0];
              }
              if (deviation === 'blank-pending') snapshot.url = 'about:blank';
              if (deviation === 'missing-pending') delete snapshot.url;
              return snapshot;
            },
          );
          const work = await api.createWorkTab(source);
          expect(journal()).toEqual([]);
          expect(browser.tabs.get).not.toHaveBeenCalled();
          await expect(api.createWorkTab(source)).rejects.toThrow(
            'already active',
          );
          const reports = vi.fn();
          await api.waitForWorkTab(work.tabId, reports);
          const reason = deviation.startsWith('foreign-')
            ? 'unverified_intermediate_destination'
            : deviation.includes('pending')
              ? 'pending_navigation'
              : 'marker_lost';
          expect(reports.mock.calls[0]?.[0]).toMatchObject({
            source,
            reason,
            phase: 'initial',
          });
          expect(JSON.stringify(reports.mock.calls)).not.toMatch(
            /private-person|private-marker|latersift-work|https:/,
          );
          await work.close();
          expect(browser.tabs.remove).not.toHaveBeenCalled();
          expect(tabs.has(work.tabId)).toBe(true);
          expect(held.size).toBe(0);

          const orphan = await api.createWorkTab(source);
          expect(journal()).toEqual([]);
          const fresh = await restart();
          await fresh.cleanupOrphanWorkTabs();
          expect(browser.tabs.remove).not.toHaveBeenCalled();
          expect(tabs.has(orphan.tabId)).toBe(true);
        },
      );

      it.each(['about:blank', undefined])(
        'allows cleanup after a normal initial %s snapshot',
        async (url) => {
          browser.tabs.create.mockImplementationOnce(
            async (options: Tabs.CreateCreatePropertiesType) => {
              const restored = {
                id: nextId++,
                url: options.url,
                status: 'complete',
              };
              tabs.set(restored.id, restored);
              return {
                ...restored,
                url,
                status: 'loading',
                pendingUrl: options.url,
              };
            },
          );
          const work = await api.createWorkTab(source);
          expect(journal()).toHaveLength(1);
          await api.waitForWorkTab(work.tabId);
          await work.close();
          expect(browser.tabs.remove).toHaveBeenCalledExactlyOnceWith(
            work.tabId,
          );
          expect(held.size).toBe(0);
        },
      );
    },
  );

  it('never closes a create-snapshot-disowned tab when journal persistence fails', async () => {
    browser.tabs.create.mockImplementationOnce(
      async (options: Tabs.CreateCreatePropertiesType) => {
        const restored = { id: nextId++, url: options.url, status: 'complete' };
        tabs.set(restored.id, restored);
        return {
          ...restored,
          url: 'https://example.com/private-person',
          status: 'loading',
        };
      },
    );
    const set = vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
      throw new Error('storage full');
    });
    try {
      await expect(api.createWorkTab('playlists')).rejects.toThrow(
        'storage full',
      );
      expect(browser.tabs.remove).not.toHaveBeenCalled();
      expect(journal()).toEqual([]);
      expect(held.size).toBe(0);
    } finally {
      set.mockRestore();
    }
  });

  it('polls until complete without releasing the source lock', async () => {
    vi.useFakeTimers();
    const work = await api.createWorkTab('playlists');
    tabs.get(work.tabId)!.status = 'loading';
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
    'https://www.youtube.com/feed/library',
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
      tabs.get(work.tabId)!.status = 'loading';
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

  it.each([
    ['about:blank', 'complete'],
    ['about:blank', 'loading'],
    [undefined, 'complete'],
    [undefined, 'loading'],
    ['https://example.com/private/person', 'loading'],
    ['https://www.youtube.com/feed/library', 'loading'],
  ] as const)(
    'waits for delayed initial adoption: %s, %s',
    async (url, status) => {
      vi.useFakeTimers();
      const work = await api.createWorkTab('playlists');
      const tab = tabs.get(work.tabId)!;
      const original = tab.url;
      Object.assign(tab, { url, status });
      const reports = vi.fn();
      const waiting = api.waitForWorkTab(work.tabId, reports);
      await vi.advanceTimersByTimeAsync(500);
      expect(reports).toHaveBeenLastCalledWith(
        expect.objectContaining({ phase: 'initial', reason: 'waiting' }),
      );
      const unverifiedIntermediate = !!url && url !== 'about:blank';
      expect(journal()).toHaveLength(unverifiedIntermediate ? 0 : 1);
      if (unverifiedIntermediate) {
        expect(reports).toHaveBeenCalledWith(
          expect.objectContaining({
            reason: 'unverified_intermediate_destination',
            phase: 'initial',
          }),
        );
        expect(reports).not.toHaveBeenCalledWith(
          expect.objectContaining({ reason: 'marker_lost' }),
        );
      }
      await expect(api.createWorkTab('playlists')).rejects.toThrow(
        'already active',
      );
      Object.assign(tab, { url: original, status: 'loading' });
      await vi.advanceTimersByTimeAsync(250);
      expect(reports).toHaveBeenLastCalledWith(
        expect.objectContaining({ phase: 'target-loading' }),
      );
      tab.status = 'complete';
      await vi.advanceTimersByTimeAsync(250);
      await waiting;
      expect(reports).toHaveBeenLastCalledWith(
        expect.objectContaining({ phase: 'target-ready', reason: 'ready' }),
      );
      expect(journal()).toHaveLength(unverifiedIntermediate ? 0 : 1);
      await work.close();
      if (unverifiedIntermediate) {
        expect(browser.tabs.remove).not.toHaveBeenCalled();
        expect(tabs.has(work.tabId)).toBe(true);
      } else {
        expect(browser.tabs.remove).toHaveBeenCalledExactlyOnceWith(work.tabId);
      }
      expect(held.size).toBe(0);
    },
  );

  it.each(['playlists', 'watch-later'] as const)(
    'reads %s without a matching marker, but permanently forfeits cleanup',
    async (source) => {
      const work = await api.createWorkTab(source);
      const tab = tabs.get(work.tabId)!;
      const original = tab.url!;
      tab.url = original.split('#')[0];
      const reports = vi.fn();
      await api.waitForWorkTab(work.tabId, reports);
      expect(reports).toHaveBeenCalledWith(
        expect.objectContaining({ marker: 'absent', reason: 'marker_lost' }),
      );
      expect(journal()).toEqual([]);
      await expect(api.createWorkTab(source)).rejects.toThrow('already active');
      await api.cleanupOrphanWorkTabs();
      tab.url = original;
      await api.waitForWorkTab(work.tabId);
      await work.close();
      expect(browser.tabs.remove).not.toHaveBeenCalled();
      expect(tabs.has(work.tabId)).toBe(true);
      const next = await api.createWorkTab(source);
      await next.close();
    },
  );

  it.each(['playlists', 'watch-later'] as const)(
    'reads markerless %s with an identical markerless pending URL',
    async (source) => {
      const work = await api.createWorkTab(source);
      const tab = tabs.get(work.tabId)!;
      const original = tab.url!;
      tab.url = original.split('#')[0];
      tab.pendingUrl = tab.url;
      await api.waitForWorkTab(work.tabId);
      expect(journal()).toEqual([]);
      await expect(api.createWorkTab(source)).rejects.toThrow('already active');
      Object.assign(tab, { url: original, pendingUrl: original });
      await work.close();
      expect(browser.tabs.remove).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['playlists', 'https://www.youtube.com/feed/playlists?other=1'],
    ['watch-later', 'https://www.youtube.com/playlist?list=WL&list=WL'],
    ['watch-later', 'https://www.youtube.com/playlist?list=WL&other=1'],
  ] as const)(
    'still blocks a pending query mismatch for %s',
    async (source, pendingUrl) => {
      const work = await api.createWorkTab(source);
      tabs.get(work.tabId)!.pendingUrl = pendingUrl;
      await expect(api.waitForWorkTab(work.tabId)).rejects.toThrow('navigated');
      await work.close();
      expect(browser.tabs.remove).not.toHaveBeenCalled();
    },
  );

  it('allows a readable pending target for read but not strict close ownership', async () => {
    const work = await api.createWorkTab('playlists');
    const tab = tabs.get(work.tabId)!;
    tab.pendingUrl = tab.url!.split('#')[0];
    const reports = vi.fn();
    await api.waitForWorkTab(work.tabId, reports);
    expect(journal()).toEqual([]);
    expect(reports).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'pending_navigation',
        marker: 'matching',
      }),
    );
    await expect(api.createWorkTab('playlists')).rejects.toThrow(
      'already active',
    );
    delete tab.pendingUrl;
    await api.waitForWorkTab(work.tabId);
    await work.close();
    expect(browser.tabs.remove).not.toHaveBeenCalled();
  });

  it.each([
    ['playlists', false],
    ['playlists', true],
    ['watch-later', false],
    ['watch-later', true],
  ] as const)(
    'permanently forfeits cleanup on a readable pending mismatch while loading: %s, initial blank %s',
    async (source, initialBlank) => {
      vi.useFakeTimers();
      const work = await api.createWorkTab(source);
      const tab = tabs.get(work.tabId)!;
      const original = tab.url!;
      Object.assign(tab, {
        url: initialBlank ? 'about:blank' : original,
        status: 'loading',
        pendingUrl: original.split('#')[0] + '#different-marker',
      });
      const reports = vi.fn();
      const waiting = api.waitForWorkTab(work.tabId, reports);
      await vi.advanceTimersByTimeAsync(500);
      expect(journal()).toEqual([]);
      expect(reports).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'pending_navigation' }),
      );
      await expect(api.createWorkTab(source)).rejects.toThrow('already active');
      await api.cleanupOrphanWorkTabs();
      expect(browser.tabs.remove).not.toHaveBeenCalled();
      Object.assign(tab, {
        url: original,
        status: 'complete',
        pendingUrl: undefined,
      });
      await vi.advanceTimersByTimeAsync(250);
      await waiting;
      await work.close();
      expect(browser.tabs.remove).not.toHaveBeenCalled();
      expect(tabs.has(work.tabId)).toBe(true);
      expect(held.size).toBe(0);
    },
  );

  it.each([
    ['https://consent.youtube.com/m', 'consent', '/m', 'consent_required'],
    [
      'https://accounts.google.com/ServiceLogin',
      'sign-in',
      '[other]',
      'sign_in_required',
    ],
  ] as const)(
    'diagnoses visible final %s without adopting its matching marker',
    async (destination, origin, actualPath, reason) => {
      vi.useFakeTimers();
      const work = await api.createWorkTab('playlists');
      const tab = tabs.get(work.tabId)!;
      const original = tab.url!;
      const reports = vi.fn();
      Object.assign(tab, { url: undefined, status: 'complete' });
      const result = api
        .waitForWorkTab(work.tabId, reports)
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(500);
      expect(reports).toHaveBeenCalledTimes(3);
      expect(reports).toHaveBeenLastCalledWith(
        expect.objectContaining({
          phase: 'initial',
          reason: 'waiting',
          origin: 'unknown',
        }),
      );
      tab.url = `${destination}?continue=private-person${new URL(original).hash}`;
      await vi.advanceTimersByTimeAsync(250);
      const error = await result;
      expect(error).toBeInstanceOf(api.WorkTabError);
      if (!(error instanceof api.WorkTabError))
        throw new Error('Expected WorkTabError');
      expect(error.diagnostic).toMatchObject({
        origin,
        actualPath,
        reason,
        marker: 'matching',
        phase: 'foreign-navigation',
      });
      expect(JSON.stringify(reports.mock.calls)).not.toMatch(
        /private-person|https:|latersift-work/,
      );
      expect(journal()).toEqual([]);
      tab.url = original;
      await work.close();
      expect(browser.tabs.remove).not.toHaveBeenCalled();
      const next = await api.createWorkTab('playlists');
      await next.close();
    },
  );

  it.each([
    'https://consent.youtube.com/m',
    'https://accounts.google.com/ServiceLogin',
  ])('does not infer origin from pending URL alone: %s', async (pendingUrl) => {
    const work = await api.createWorkTab('playlists');
    Object.assign(tabs.get(work.tabId)!, {
      url: undefined,
      pendingUrl,
      status: 'complete',
    });
    const reports = vi.fn();
    await expect(
      api.waitForWorkTab(work.tabId, reports),
    ).rejects.toBeInstanceOf(api.WorkTabError);
    expect(reports).toHaveBeenLastCalledWith(
      expect.objectContaining({
        origin: 'unknown',
        actualPath: 'unknown',
        reason: 'pending_navigation',
      }),
    );
    await work.close();
    expect(browser.tabs.remove).not.toHaveBeenCalled();
  });

  it.each([
    'http://consent.youtube.com/m',
    'https://consent.youtube.com.evil.example/m',
    'http://accounts.google.com/ServiceLogin',
    'https://accounts.google.com.evil.example/ServiceLogin',
  ])('does not classify lookalike auth origins: %s', async (url) => {
    const work = await api.createWorkTab('playlists');
    tabs.get(work.tabId)!.url = url;
    const reports = vi.fn();
    await expect(
      api.waitForWorkTab(work.tabId, reports),
    ).rejects.toBeInstanceOf(api.WorkTabError);
    expect(reports).toHaveBeenLastCalledWith(
      expect.objectContaining({
        origin: 'other',
        reason: 'foreign_destination',
      }),
    );
    await work.close();
    expect(browser.tabs.remove).not.toHaveBeenCalled();
  });

  it('reads a foreign marker without treating it as ownership', async () => {
    const work = await api.createWorkTab('playlists');
    const tab = tabs.get(work.tabId)!;
    const original = tab.url!;
    tab.url = original.split('#')[0] + '#latersift-work=not-ours';
    const reports = vi.fn();
    await api.waitForWorkTab(work.tabId, reports);
    expect(reports).toHaveBeenCalledWith(
      expect.objectContaining({ marker: 'different', reason: 'marker_lost' }),
    );
    expect(journal()).toEqual([]);
    tab.url = original;
    await work.close();
    expect(browser.tabs.remove).not.toHaveBeenCalled();
  });

  it('accepts the adapter trailing slash only for reading', async () => {
    const work = await api.createWorkTab('playlists');
    const tab = tabs.get(work.tabId)!;
    tab.url = tab.url!.replace('/playlists#', '/playlists/#');
    await api.waitForWorkTab(work.tabId);
    await work.close();
    expect(browser.tabs.remove).not.toHaveBeenCalled();
  });

  it.each(['about:blank', undefined])(
    'does not treat %s after target observation as initial loading',
    async (url) => {
      vi.useFakeTimers();
      const work = await api.createWorkTab('playlists');
      const tab = tabs.get(work.tabId)!;
      const original = tab.url;
      tab.status = 'loading';
      const waiting = expect(api.waitForWorkTab(work.tabId)).rejects.toThrow(
        'navigated',
      );
      await vi.advanceTimersByTimeAsync(250);
      tab.url = url;
      await vi.advanceTimersByTimeAsync(250);
      await waiting;
      expect(journal()).toEqual([]);
      Object.assign(tab, { url: original, status: 'complete' });
      await work.close();
      expect(browser.tabs.remove).not.toHaveBeenCalled();
      expect(held.size).toBe(0);
    },
  );

  it.each([
    ['playlists', 'https://www.youtube.com/feed/library'],
    ['playlists', 'https://www.youtube.com/feed/playlists?list=private'],
    ['playlists', 'https://other.example/feed/playlists'],
    ['watch-later', 'https://www.youtube.com/playlist?list=WL&list=WL'],
    ['watch-later', 'https://www.youtube.com/playlist?list=WL&other=1'],
    ['watch-later', 'https://www.youtube.com/playlist/?list=WL'],
    ['watch-later', 'https://www.youtube.com/playlist?list=private'],
  ] as const)(
    'rejects complete foreign target for %s: %s',
    async (source, url) => {
      const work = await api.createWorkTab(source);
      tabs.get(work.tabId)!.url = url;
      const reports = vi.fn();
      await expect(
        api.waitForWorkTab(work.tabId, reports),
      ).rejects.toBeInstanceOf(api.WorkTabError);
      expect(reports).toHaveBeenLastCalledWith(
        expect.objectContaining({ phase: 'foreign-navigation' }),
      );
      if (url.includes('/feed/library'))
        expect(reports).toHaveBeenLastCalledWith(
          expect.objectContaining({
            reason: 'unexpected_youtube_destination',
            actualPath: '/feed/library',
          }),
        );
      await work.close();
      expect(browser.tabs.remove).not.toHaveBeenCalled();
    },
  );

  it('waits on an initial nonmatching loading URL, but rejects it when complete', async () => {
    vi.useFakeTimers();
    const work = await api.createWorkTab('playlists');
    const tab = tabs.get(work.tabId)!;
    Object.assign(tab, {
      url: 'https://www.youtube.com/feed/library',
      status: 'loading',
    });
    const waiting = expect(api.waitForWorkTab(work.tabId)).rejects.toThrow(
      'navigated',
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(journal()).toEqual([]);
    await expect(api.createWorkTab('playlists')).rejects.toThrow(
      'already active',
    );
    tab.status = 'complete';
    await vi.advanceTimersByTimeAsync(250);
    await waiting;
    await work.close();
    expect(browser.tabs.remove).not.toHaveBeenCalled();
  });

  it('does not require pendingUrl for readiness or ownership', async () => {
    const work = await api.createWorkTab('playlists');
    delete tabs.get(work.tabId)!.pendingUrl;
    await api.waitForWorkTab(work.tabId);
    await work.close();
    expect(browser.tabs.remove).toHaveBeenCalledExactlyOnceWith(work.tabId);
  });

  it('blocks cleanup on a different pending URL without a prior wait', async () => {
    const work = await api.createWorkTab('playlists');
    tabs.get(work.tabId)!.pendingUrl = 'https://example.com/private';
    await work.close();
    expect(browser.tabs.remove).not.toHaveBeenCalled();
    expect(journal()).toEqual([]);
  });

  it('remembers target-ready across waits and rejects subsequent blank loading', async () => {
    const work = await api.createWorkTab('playlists');
    await api.waitForWorkTab(work.tabId);
    Object.assign(tabs.get(work.tabId)!, {
      url: 'about:blank',
      status: 'loading',
    });
    await expect(api.waitForWorkTab(work.tabId)).rejects.toThrow('navigated');
    await work.close();
    expect(browser.tabs.remove).not.toHaveBeenCalled();
  });

  it('cannot reacquire stripped-marker ownership after restart', async () => {
    const work = await api.createWorkTab('playlists');
    const tab = tabs.get(work.tabId)!;
    const original = tab.url!;
    tab.url = original.split('#')[0];
    await api.waitForWorkTab(work.tabId);
    tab.url = original;
    const fresh = await restart();
    await fresh.cleanupOrphanWorkTabs();
    expect(browser.tabs.remove).not.toHaveBeenCalled();
    expect(journal()).toEqual([]);
  });

  it('never uses pendingUrl as positive evidence for cleanup', async () => {
    const work = await api.createWorkTab('playlists');
    const tab = tabs.get(work.tabId)!;
    tab.pendingUrl = tab.url;
    tab.url = 'about:blank';
    await work.close();
    expect(browser.tabs.remove).not.toHaveBeenCalled();
  });

  it('blocks pending navigation even after marker ownership was lost', async () => {
    const work = await api.createWorkTab('playlists');
    const tab = tabs.get(work.tabId)!;
    const original = tab.url!;
    tab.url = original.split('#')[0];
    await api.waitForWorkTab(work.tabId);
    tab.pendingUrl = 'https://www.youtube.com/feed/playlists?other=1';
    await expect(api.waitForWorkTab(work.tabId)).rejects.toThrow('navigated');
    Object.assign(tab, { url: original, pendingUrl: undefined });
    await work.close();
    expect(browser.tabs.remove).not.toHaveBeenCalled();
    expect(held.size).toBe(0);
  });

  it('preserves loading tabs both on close and orphan cleanup', async () => {
    const work = await api.createWorkTab('playlists');
    tabs.get(work.tabId)!.status = 'loading';
    await work.close();
    expect(browser.tabs.remove).not.toHaveBeenCalled();
    const orphan = await api.createWorkTab('watch-later');
    tabs.get(orphan.tabId)!.status = 'loading';
    const fresh = await restart();
    await fresh.cleanupOrphanWorkTabs();
    expect(browser.tabs.remove).not.toHaveBeenCalled();
    expect(journal()).toEqual([]);
  });

  it.each([
    'about:blank',
    undefined,
    'https://www.youtube.com/private/person-123?secret=token#uuid',
  ])(
    'bounds initial waits and sanitizes timeout diagnostics: %s',
    async (url) => {
      vi.useFakeTimers();
      const work = await api.createWorkTab('playlists');
      Object.assign(tabs.get(work.tabId)!, {
        url,
        status: url?.includes('private') ? 'loading' : 'complete',
      });
      const reports = vi.fn();
      const result = api
        .waitForWorkTab(work.tabId, reports)
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(30_000);
      const error = await result;
      expect(error).toBeInstanceOf(api.WorkTabError);
      if (!(error instanceof api.WorkTabError))
        throw new Error('Expected WorkTabError');
      expect(error.diagnostic).toMatchObject({
        reason: 'timeout',
        phase: 'initial',
        actualPath: url ? '[other]' : 'unknown',
      });
      const serialized = JSON.stringify({
        error: error.message,
        diagnostic: error.diagnostic,
        reports: reports.mock.calls,
      });
      for (const secret of [
        'person-123',
        'secret',
        'token',
        'uuid',
        'https://',
        String(work.tabId),
      ])
        expect(serialized).not.toContain(secret);
      await work.close();
    },
  );

  it('does not expose lookup exceptions in loss diagnostics', async () => {
    const work = await api.createWorkTab('playlists');
    browser.tabs.get.mockRejectedValueOnce(
      new Error('private-person https://secret.example/#uuid'),
    );
    const reports = vi.fn();
    const error = await api
      .waitForWorkTab(work.tabId, reports)
      .catch((error: unknown) => error);
    expect(error).toBeInstanceOf(api.WorkTabError);
    expect(JSON.stringify(reports.mock.calls)).not.toMatch(
      /private-person|secret|uuid/,
    );
    expect(reports).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'tab_lost', origin: 'unknown' }),
    );
    await work.close();
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
