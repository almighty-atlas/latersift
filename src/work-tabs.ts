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
type Phase =
  'initial' | 'target-loading' | 'target-ready' | 'foreign-navigation';
export type WorkTabDiagnostic = {
  source: Source | 'unknown';
  tabStatus: 'loading' | 'complete' | 'unknown';
  phase: Phase;
  targetPath: '/feed/playlists' | '/playlist' | 'unknown';
  actualPath:
    | '/feed/playlists'
    | '/feed/library'
    | '/playlist'
    | '/watch'
    | '/m'
    | '[other]'
    | 'unknown';
  origin: 'youtube' | 'consent' | 'sign-in' | 'other' | 'unknown' | 'about';
  marker: 'absent' | 'matching' | 'different';
  reason:
    | 'waiting'
    | 'ready'
    | 'marker_lost'
    | 'unverified_intermediate_destination'
    | 'unexpected_youtube_destination'
    | 'foreign_destination'
    | 'consent_required'
    | 'sign_in_required'
    | 'pending_navigation'
    | 'timeout'
    | 'tab_lost'
    | 'inactive'
    | 'ownership_persistence_failed';
};

export class WorkTabError extends Error {
  constructor(
    message: string,
    readonly diagnostic: WorkTabDiagnostic,
  ) {
    super(message);
    this.name = 'WorkTabError';
  }
}

type Owner = Entry & {
  cleanupAllowed: boolean;
  phase: Phase;
  initialDiagnostic?: WorkTabDiagnostic;
  release(): Promise<void>;
};
const live = new Map<number, Owner>();
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
    tab.status === 'complete' &&
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
  let cleanupAllowed = true;
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
    const expected = `${URLS[source]}#latersift-work=${token}`;
    const initialBlank = !tab.url || tab.url === 'about:blank';
    cleanupAllowed =
      (initialBlank || tab.url === expected) &&
      (tab.pendingUrl === undefined || tab.pendingUrl === expected);
    const owner: Owner = {
      ...owned,
      cleanupAllowed,
      phase: 'initial',
      release,
    };
    if (!cleanupAllowed) {
      owner.initialDiagnostic = diagnose(
        owner,
        tab,
        !initialBlank && tab.url !== expected
          ? readable(tab.url, source)
            ? 'marker_lost'
            : 'unverified_intermediate_destination'
          : 'pending_navigation',
      );
    }
    await journal((entries) => {
      localStorage.setItem(
        JOURNAL,
        JSON.stringify([
          ...entries.filter((item) => item.tabId !== owned.tabId),
          ...(cleanupAllowed ? [owned] : []),
        ]),
      );
    });
    live.set(tab.id, owner);
    let closing: Promise<void> | undefined;
    return {
      tabId: tab.id,
      close() {
        return (closing ??= (async () => {
          if (live.get(owned.tabId)?.token !== owned.token) return;
          try {
            if (live.get(owned.tabId)?.cleanupAllowed) await removeOwned(owned);
            else await forget(owned);
          } finally {
            await releaseLive(owned);
          }
        })());
      },
    };
  } catch (error) {
    try {
      if (entry && cleanupAllowed) {
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

function readable(url: string | undefined, source: Source): boolean {
  const base = url?.split('#')[0];
  return (
    base === URLS[source] ||
    (source === 'playlists' && base === `${URLS[source]}/`)
  );
}

function diagnose(
  owner: Owner | undefined,
  tab: Tabs.Tab | undefined,
  reason: WorkTabDiagnostic['reason'],
): WorkTabDiagnostic {
  let url: URL | undefined;
  try {
    if (tab?.url) url = new URL(tab.url);
  } catch {
    /* Unknown URL. */
  }
  const knownPaths = [
    '/feed/playlists',
    '/feed/library',
    '/playlist',
    '/watch',
    '/m',
  ] as const;
  const path = url?.pathname.replace(/\/$/, '');
  return {
    source: owner?.source ?? 'unknown',
    tabStatus:
      tab?.status === 'loading' || tab?.status === 'complete'
        ? tab.status
        : 'unknown',
    phase: owner?.phase ?? 'initial',
    targetPath: owner
      ? owner.source === 'playlists'
        ? '/feed/playlists'
        : '/playlist'
      : 'unknown',
    actualPath: !url
      ? 'unknown'
      : (knownPaths.find((known) => known === path) ?? '[other]'),
    origin: !url
      ? 'unknown'
      : url.protocol === 'about:'
        ? 'about'
        : url.origin === 'https://www.youtube.com'
          ? 'youtube'
          : url.origin === 'https://consent.youtube.com'
            ? 'consent'
            : url.origin === 'https://accounts.google.com'
              ? 'sign-in'
              : 'other',
    marker: !url?.hash
      ? 'absent'
      : owner && url.hash === `#latersift-work=${owner.token}`
        ? 'matching'
        : 'different',
    reason,
  };
}

/** Reading needs only the target; cleanup requires uninterrupted strict ownership. */
export async function waitForWorkTab(
  tabId: number,
  onDiagnostic?: (diagnostic: WorkTabDiagnostic) => void,
): Promise<void> {
  const entry = live.get(tabId);
  let lastTab: Tabs.Tab | undefined;
  const report = (
    reason: WorkTabDiagnostic['reason'],
    diagnostic = diagnose(entry, lastTab, reason),
  ) => {
    // UI reporting must not change the ownership lifecycle.
    try {
      onDiagnostic?.(diagnostic);
    } catch {
      /* Reporter is advisory. */
    }
    return diagnostic;
  };
  if (!entry)
    throw new WorkTabError('Unknown or inactive work tab.', report('inactive'));
  if (entry.initialDiagnostic) {
    report(entry.initialDiagnostic.reason, entry.initialDiagnostic);
    delete entry.initialDiagnostic;
  }
  const abandon = async (release: boolean) => {
    entry.cleanupAllowed = false;
    try {
      await forget(entry);
    } catch {
      throw new WorkTabError(
        'Work tab ownership could not be persisted.',
        report('ownership_persistence_failed'),
      );
    } finally {
      if (release) await releaseLive(entry);
    }
  };
  const { default: browser } = await import('webextension-polyfill');
  let ended = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ended = true;
      reject(
        new WorkTabError(
          'Work tab timed out after 30 seconds.',
          report('timeout'),
        ),
      );
    }, 30_000);
  });
  const poll = async () => {
    while (!ended) {
      let tab: Tabs.Tab;
      try {
        tab = await browser.tabs.get(tabId);
      } catch {
        if (ended) return;
        await abandon(true);
        throw new WorkTabError('Work tab was lost.', report('tab_lost'));
      }
      if (ended) return;
      lastTab = tab;
      const target = readable(tab.url, entry.source);
      const expected = `${URLS[entry.source]}#latersift-work=${entry.token}`;
      const pendingForeign =
        tab.pendingUrl !== undefined && !readable(tab.pendingUrl, entry.source);
      const initialBlank = !tab.url || tab.url === 'about:blank';
      const initialWaiting =
        entry.phase === 'initial' &&
        (initialBlank || (!target && tab.status === 'loading'));
      if (
        tab.id !== entry.tabId ||
        pendingForeign ||
        (!target && !initialWaiting)
      ) {
        entry.phase = 'foreign-navigation';
        const origin = diagnose(entry, tab, 'waiting').origin;
        const reason =
          !target && tab.status === 'complete' && origin === 'consent'
            ? 'consent_required'
            : !target && tab.status === 'complete' && origin === 'sign-in'
              ? 'sign_in_required'
              : pendingForeign
                ? 'pending_navigation'
                : origin === 'youtube'
                  ? 'unexpected_youtube_destination'
                  : 'foreign_destination';
        await abandon(true);
        throw new WorkTabError(
          'Work tab navigated away from its source.',
          report(reason),
        );
      }
      const unverifiedIntermediate = initialWaiting && !initialBlank && !target;
      const unverifiedPending =
        tab.pendingUrl !== undefined && tab.pendingUrl !== expected;
      if (
        entry.cleanupAllowed &&
        (unverifiedIntermediate || unverifiedPending)
      ) {
        // Waiting is safe for reading, but observed uncertainty permanently
        // disqualifies this tab from cleanup, even if the original URL returns.
        await abandon(false);
        report(
          unverifiedIntermediate
            ? 'unverified_intermediate_destination'
            : 'pending_navigation',
        );
      }
      if (target) {
        entry.phase =
          tab.status === 'complete' ? 'target-ready' : 'target-loading';
        // Once lost, ownership cannot be recovered even if the marker returns.
        if (tab.url !== expected && entry.cleanupAllowed) {
          await abandon(false);
          report('marker_lost');
        }
        if (tab.status === 'complete') {
          report('ready');
          return;
        }
      }
      report('waiting');
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
