import type { Tabs } from 'webextension-polyfill';

type Source = 'playlists' | 'watch-later';
type Entry = { tabId: number; source: Source; token: string };
type WorkTab = { tabId: number; close(): Promise<void> };
const JOURNAL = 'latersift.work-tabs.v1';
const SOURCES: Source[] = ['playlists', 'watch-later'];
const URLS: Record<Source, string> = {
  playlists: 'https://www.youtube.com/feed/playlists',
  'watch-later': 'https://www.youtube.com/playlist?list=WL',
};
const live = new Map<number, { token: string; release(): Promise<void> }>();
let journalQueue: Promise<unknown> = Promise.resolve();

function locks(): LockManager {
  if (!navigator.locks) throw new Error('Work tabs require Web Locks.');
  return navigator.locks;
}

async function acquire(source: Source): Promise<(() => Promise<void>) | null> {
  let unlock!: () => void;
  let accept!: (held: boolean) => void;
  let reject!: (error: unknown) => void;
  const held = new Promise<boolean>((resolve, fail) => {
    accept = resolve;
    reject = fail;
  });
  const lifetime = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  const request = locks().request(
    `latersift.work-tabs.source.${source}`,
    { ifAvailable: true },
    async (lock) => {
      accept(lock !== null);
      if (lock) await lifetime;
    },
  );
  void request.catch(reject);
  if (!(await held)) {
    await request;
    return null;
  }
  return async () => {
    unlock();
    await request;
  };
}

function readJournal(): Entry[] {
  const value: unknown = JSON.parse(localStorage.getItem(JOURNAL) ?? '[]');
  if (
    !Array.isArray(value) ||
    !value.every(
      (entry): entry is Entry =>
        entry !== null &&
        typeof entry === 'object' &&
        Number.isSafeInteger(entry.tabId) &&
        entry.tabId >= 0 &&
        SOURCES.includes(entry.source) &&
        typeof entry.token === 'string' &&
        /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
          entry.token,
        ),
    )
  )
    throw new Error('Invalid work tab journal; refusing cleanup.');
  return value;
}

function journal<T>(operation: (entries: Entry[]) => T): Promise<T> {
  // The Web Lock also serializes read/modify/write across extension pages.
  const next = journalQueue.then(() =>
    locks().request('latersift.work-tabs.journal', () =>
      operation(readJournal()),
    ),
  );
  journalQueue = next.catch(() => {});
  return next;
}

function forget(entry: Entry): Promise<void> {
  return journal((entries) => {
    localStorage.setItem(
      JOURNAL,
      JSON.stringify(
        entries.filter(
          (other) => other.tabId !== entry.tabId || other.token !== entry.token,
        ),
      ),
    );
  });
}

function matches(tab: Tabs.Tab, entry: Entry): boolean {
  // Exact URL comparison rejects other origins, paths, queries and lost markers.
  const expected = `${URLS[entry.source]}#latersift-work=${entry.token}`;
  return (
    tab.id === entry.tabId &&
    tab.url === expected &&
    (tab.pendingUrl === undefined || tab.pendingUrl === expected)
  );
}

async function releaseLive(entry: Entry): Promise<void> {
  const owner = live.get(entry.tabId);
  if (owner?.token !== entry.token) return;
  live.delete(entry.tabId);
  await owner.release();
}

async function removeOwned(entry: Entry): Promise<void> {
  const { default: browser } = await import('webextension-polyfill');
  let tab: Tabs.Tab;
  try {
    tab = await browser.tabs.get(entry.tabId);
  } catch {
    // A failed lookup is not authority to close anything.
    await forget(entry);
    return;
  }
  if (matches(tab, entry)) await browser.tabs.remove(entry.tabId);
  // On remove failure retain the journal so a later cleanup can retry safely.
  await forget(entry);
}

export async function createWorkTab(source: Source): Promise<WorkTab> {
  if (!SOURCES.includes(source)) throw new Error('Unknown work tab source.');
  const release = await acquire(source);
  if (!release) throw new Error(`Work tab already active for ${source}.`);
  let entry: Entry | undefined;
  try {
    const { default: browser } = await import('webextension-polyfill');
    const token = crypto.randomUUID();
    // Navigate directly with the marker. A crash before journaling leaks a tab
    // intentionally: an unrecorded tab must never be adopted or closed.
    const tab = await browser.tabs.create({
      active: false,
      url: `${URLS[source]}#latersift-work=${token}`,
    });
    if (tab.id === undefined) throw new Error('Work tab has no tab ID.');
    entry = { tabId: tab.id, source, token };
    const owned = entry;
    await journal((entries) => {
      localStorage.setItem(
        JOURNAL,
        JSON.stringify([
          ...entries.filter((item) => item.tabId !== owned.tabId),
          owned,
        ]),
      );
    });
    live.set(tab.id, { token, release });
    let closing: Promise<void> | undefined;
    return {
      tabId: tab.id,
      close() {
        return (closing ??= (async () => {
          if (live.get(owned.tabId)?.token !== owned.token) return;
          try {
            await removeOwned(owned);
          } finally {
            await releaseLive(owned);
          }
        })());
      },
    };
  } catch (error) {
    try {
      if (entry) {
        // Persistence may have failed, but this freshly created tab is known.
        const { default: browser } = await import('webextension-polyfill');
        const tab = await browser.tabs.get(entry.tabId);
        if (matches(tab, entry)) await browser.tabs.remove(entry.tabId);
      }
    } catch {
      // Fail closed if ownership cannot be verified; preserve the original error.
    } finally {
      await release();
    }
    throw error;
  }
}

/** A timeout leaves ownership intact: callers must close in a finally block. */
export async function waitForWorkTab(tabId: number): Promise<void> {
  const entry = await journal((entries) =>
    entries.find((item) => item.tabId === tabId),
  );
  if (!entry || live.get(tabId)?.token !== entry.token)
    throw new Error('Unknown or inactive work tab.');
  const { default: browser } = await import('webextension-polyfill');
  let ended = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ended = true;
      reject(new Error('Work tab timed out after 30 seconds.'));
    }, 30_000);
  });
  const poll = async () => {
    while (!ended) {
      let tab: Tabs.Tab;
      try {
        tab = await browser.tabs.get(tabId);
      } catch {
        if (ended) return;
        try {
          await forget(entry);
        } finally {
          await releaseLive(entry);
        }
        throw new Error('Work tab was lost.');
      }
      if (ended) return;
      if (!matches(tab, entry)) {
        try {
          await forget(entry);
        } finally {
          await releaseLive(entry);
        }
        throw new Error('Work tab navigated away from its marked source.');
      }
      if (tab.status === 'complete') return;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
  };
  try {
    await Promise.race([poll(), timeout]);
  } finally {
    ended = true;
    clearTimeout(timer);
  }
}

export async function cleanupOrphanWorkTabs(): Promise<void> {
  const errors: unknown[] = [];
  for (const source of SOURCES) {
    const release = await acquire(source);
    if (!release) continue;
    try {
      const entries = await journal((items) =>
        items.filter((entry) => entry.source === source),
      );
      for (const entry of entries) {
        try {
          await removeOwned(entry);
        } catch (error) {
          errors.push(error);
        }
      }
    } catch (error) {
      errors.push(error);
    } finally {
      await release();
    }
  }
  if (errors.length)
    throw new AggregateError(errors, 'Work tab cleanup failed.');
}
