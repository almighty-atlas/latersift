import 'fake-indexeddb/auto';
import { deleteDB, openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Runtime, Tabs } from 'webextension-polyfill';
import { emptyLibrary, type Library, type Scan } from '../src/model';
import {
  approveExecution,
  confirmExport,
  executeApproved,
} from '../src/operations';
import {
  loadLibrary,
  loadSnapshot,
  saveCheckpoint,
  saveLibrary,
} from '../src/storage';
import { authorizeContentMutation } from '../src/write-authority';
import { createWriteBridge } from '../src/write-bridge';
import { installWriteChannel } from '../src/write-content';
import {
  AUTHORIZE_MUTATION,
  WRITE_PORT,
  type WriteRequest,
} from '../src/write-protocol';

const browser = vi.hoisted(() => ({
  runtime: {
    id: 'synthetic@latersift',
    getURL: vi.fn(),
    sendMessage: vi.fn(),
    onConnect: { addListener: vi.fn() },
  },
  tabs: {
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    reload: vi.fn(),
    connect: vi.fn(),
    onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  windows: { get: vi.fn() },
}));
vi.mock('webextension-polyfill', () => ({ default: browser }));

const VIDEO = 'abcdefghijk';
const TARGET = 'PLsynthetic_archive';
const URL_WATCH = `https://www.youtube.com/watch?v=${VIDEO}`;
function event<T extends unknown[]>() {
  const listeners = new Set<(...args: T) => unknown>();
  return {
    addListener: (listener: (...args: T) => unknown) => {
      listeners.add(listener);
    },
    removeListener: (listener: (...args: T) => unknown) => {
      listeners.delete(listener);
    },
    emit: (...args: T) => {
      for (const listener of [...listeners]) void listener(...args);
    },
    size: () => listeners.size,
  };
}

// Read raw state: loadLibrary intentionally recovers running WALs as unknown.
async function durable() {
  const db = await openDB('latersift');
  try {
    const tx = db.transaction('state');
    const library = (await tx.store.get('library')) as Library;
    const ledger = (await tx.store.get('execution-ledger')) as
      | {
          consumedApprovalIds: string[];
          issuedMutationKeys?: string[];
        }
      | undefined;
    await tx.done;
    return { library, ledger };
  } finally {
    db.close();
  }
}

let bridges: Awaited<ReturnType<typeof createWriteBridge>>[];
let active: AbortController | null;
let backend: Map<string, boolean>;
let page: Map<string, boolean>;
let optimisticOnly: boolean;
let disconnectAfterClick: boolean;
let unknownWL: boolean;
let disconnectPort: () => void;
let clicks: string[];
let requests: WriteRequest[];
let trace: string[];
let permits: {
  request: WriteRequest;
  before: Awaited<ReturnType<typeof durable>>;
  after: Awaited<ReturnType<typeof durable>>;
  response: unknown;
}[];
let updated: ReturnType<typeof event<[number, { status: string }, Tabs.Tab]>>;
let removed: ReturnType<typeof event<[number]>>;
let tab: Tabs.Tab;
const originalVisibility = Object.getOwnPropertyDescriptor(
  document,
  'visibilityState',
);

// Handwritten synthetic native contracts only; no captured/live YouTube DOM or network.
function rebuildDocument() {
  page = new Map(backend);
  document.body.innerHTML = `<ytd-watch-flexy video-id="${VIDEO}"><button aria-label="Save">Synthetic Save</button></ytd-watch-flexy>`;
  document.querySelector('button')!.addEventListener('click', () => {
    trace.push('open');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.innerHTML = `<ytd-add-to-playlist-renderer>${[TARGET, 'WL'].map((id) => `<ytd-playlist-add-to-option-renderer><div role="checkbox" aria-label="${id === 'WL' ? 'Watch later' : 'Synthetic archive'}" aria-checked="${id === 'WL' && unknownWL ? 'mixed' : String(page.get(id))}"></div><a href="https://www.youtube.com/playlist?list=${id}">${id}</a></ytd-playlist-add-to-option-renderer>`).join('')}<button aria-label="Close">Close</button></ytd-add-to-playlist-renderer>`;
    dialog
      .querySelector('button')!
      .addEventListener('click', () => dialog.remove());
    for (const box of dialog.querySelectorAll<HTMLElement>(
      '[role="checkbox"]',
    )) {
      box.addEventListener('click', () => {
        const id = new URL(
          box.parentElement!.querySelector('a')!.href,
        ).searchParams.get('list')!;
        const checked = box.getAttribute('aria-checked') !== 'true';
        box.setAttribute('aria-checked', String(checked));
        page.set(id, checked);
        if (!(optimisticOnly && id === TARGET)) backend.set(id, checked);
        clicks.push(id);
        trace.push(`click:${id}`);
        if (disconnectAfterClick) queueMicrotask(() => disconnectPort());
      });
    }
    document.body.append(dialog);
  });
}

function pairedPorts(name: string): Runtime.Port {
  const clientMessages = event<[unknown]>();
  const contentMessages = event<[unknown]>();
  const clientDisconnect = event<[]>();
  const contentDisconnect = event<[]>();
  let closed = false;
  const disconnect = () => {
    if (closed) return;
    closed = true;
    contentDisconnect.emit();
    clientDisconnect.emit();
  };
  const client = {
    name,
    onMessage: clientMessages,
    onDisconnect: clientDisconnect,
    disconnect,
    postMessage(message: WriteRequest) {
      if (closed) throw new Error('Synthetic disconnected port');
      requests.push(structuredClone(message));
      contentMessages.emit(structuredClone(message));
    },
  };
  const content = {
    name,
    sender: {
      id: browser.runtime.id,
      url: browser.runtime.getURL('index.html'),
    },
    onMessage: contentMessages,
    onDisconnect: contentDisconnect,
    disconnect,
    postMessage(message: unknown) {
      if (closed) throw new Error('Synthetic disconnected port');
      clientMessages.emit(structuredClone(message));
    },
  };
  disconnectPort = disconnect;
  browser.runtime.onConnect.addListener.mock.calls[0][0](content);
  return client as unknown as Runtime.Port;
}

async function seed(kind: 'remove' | 'archive') {
  const library = emptyLibrary();
  const now = new Date().toISOString();
  const scan: Scan = {
    id: 'synthetic-snapshot',
    startedAt: now,
    finishedAt: now,
    status: 'complete',
    expectedCount: 1,
    unidentifiableRows: 0,
    message: 'Synthetic fixture, not live evidence',
    videos: [
      {
        id: VIDEO,
        url: URL_WATCH,
        title: 'Synthetic video',
        channel: null,
        thumbnail: null,
        durationSeconds: null,
        publishedAt: null,
        position: 1,
        availability: 'available',
        evidence: null,
        scannedAt: now,
        originalPlaylist: 'WL',
      },
    ],
  };
  await saveCheckpoint(library, scan);
  library.decisions.push({
    id: 'synthetic-decision',
    videoId: VIDEO,
    sessionId: 'synthetic-session',
    kind,
    targetPlaylist: kind === 'archive' ? TARGET : null,
    status: 'pending',
    createdAt: now,
  });
  confirmExport(library, scan.id);
  await saveLibrary(library);
  expect(await loadSnapshot(scan.id)).toEqual(scan);
  expect(await loadLibrary()).toEqual(library);
  return {
    library,
    approval: approveExecution(library, ['synthetic-decision']),
  };
}

// Advance every production delay in bounded 1000ms steps; IDB task scheduling stays real.
async function drive<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  const result = promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  void result.then(() => {
    settled = true;
  });
  for (let step = 0; step < 180 && !settled; step++) {
    await vi.advanceTimersByTimeAsync(1000);
    // fake-indexeddb uses real task turns, not just promise microtasks.
    await new Promise<void>((resolve) => realSetTimeout(resolve, 0));
  }
  expect(
    settled,
    'Synthetic flow must settle within 180 one-second steps',
  ).toBe(true);
  const outcome = await result;
  if ('error' in outcome) throw outcome.error;
  return outcome.value;
}
const realSetTimeout = globalThis.setTimeout;
async function open(approval: Parameters<typeof createWriteBridge>[0]) {
  const bridge = await createWriteBridge(approval);
  bridges.push(bridge);
  return bridge;
}
async function run(kind: 'remove' | 'archive') {
  const { library, approval } = await seed(kind);
  const bridge = await open(approval);
  const result = await drive(
    executeApproved(library, approval, bridge.adapter, saveLibrary),
  );
  expect((await durable()).library).toEqual(result);
  return { result, approval };
}

beforeEach(async () => {
  await deleteDB('latersift');
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
  bridges = [];
  active = null;
  backend = new Map([
    [TARGET, false],
    ['WL', true],
  ]);
  optimisticOnly = false;
  disconnectAfterClick = false;
  unknownWL = false;
  clicks = [];
  requests = [];
  trace = [];
  permits = [];
  updated = event();
  removed = event();
  tab = {
    id: 123,
    windowId: 456,
    active: true,
    status: 'complete',
    url: URL_WATCH,
    index: 0,
    highlighted: true,
    pinned: false,
    incognito: false,
  };
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  // jsdom history cannot navigate cross-origin from its test URL.
  vi.stubGlobal('location', { href: URL_WATCH });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('No network allowed in synthetic write flow');
    }),
  );
  let locked = false;
  vi.stubGlobal('navigator', {
    locks: {
      request: async (
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
    },
  });
  browser.runtime.getURL.mockImplementation(
    (path: string) => `moz-extension://synthetic/${path}`,
  );
  browser.tabs.onUpdated.addListener.mockImplementation(updated.addListener);
  browser.tabs.onUpdated.removeListener.mockImplementation(
    updated.removeListener,
  );
  browser.tabs.onRemoved.addListener.mockImplementation(removed.addListener);
  browser.tabs.onRemoved.removeListener.mockImplementation(
    removed.removeListener,
  );
  browser.tabs.create.mockImplementation(async () => ({ ...tab }));
  browser.tabs.get.mockImplementation(async () => ({ ...tab }));
  browser.windows.get.mockResolvedValue({ focused: true });
  browser.tabs.reload.mockImplementation(async (id, options) => {
    expect(id).toBe(tab.id);
    expect(options).toEqual({ bypassCache: true });
    expect(updated.size()).toBe(1);
    trace.push('reload');
    tab.status = 'loading';
    updated.emit(id, { status: 'loading' }, { ...tab });
    rebuildDocument();
    tab.status = 'complete';
    updated.emit(id, { status: 'complete' }, { ...tab });
    // Both events precede resolution, as permitted by browser navigation APIs.
  });
  browser.tabs.connect.mockImplementation((id, options) => {
    expect(id).toBe(tab.id);
    expect(options.name).toBe(WRITE_PORT);
    return pairedPorts(options.name);
  });
  browser.runtime.sendMessage.mockImplementation(
    async (message: { type: string; request: WriteRequest }) => {
      expect(message.type).toBe(AUTHORIZE_MUTATION);
      const before = await durable();
      const response = await authorizeContentMutation(message, {
        id: browser.runtime.id,
        url: URL_WATCH,
        tab: { ...tab },
        frameId: 0,
      });
      const after = await durable();
      permits.push({ request: message.request, before, after, response });
      trace.push(`permit:${message.request.method}`);
      return response;
    },
  );
  installWriteChannel(
    () => active !== null,
    (controller) => {
      active = controller;
    },
  );
  rebuildDocument();
});
afterEach(async () => {
  for (const bridge of bridges) bridge.close();
  await vi.advanceTimersByTimeAsync(1000);
  expect(active).toBeNull();
  expect(updated.size()).toBe(0);
  expect(removed.size()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
  document.body.replaceChildren();
  if (originalVisibility)
    Object.defineProperty(document, 'visibilityState', originalVisibility);
  else Reflect.deleteProperty(document, 'visibilityState');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await deleteDB('latersift');
});

function expectDurablePermits(approvalId: string) {
  for (const permit of permits) {
    const method = permit.request.method as 'add' | 'remove';
    const decision = permit.before.library.decisions[0];
    const step = decision.journal![method]!;
    expect(permit.before.ledger?.consumedApprovalIds).toContain(approvalId);
    expect(permit.before.library.operations?.lastRun).toMatchObject({
      id: approvalId,
      status: 'running',
    });
    expect(decision.status).toBe('running');
    expect(step).toMatchObject({ status: 'running', attempts: 1 });
    expect(permit.response).toEqual({ authorized: true });
    expect(permit.after.ledger?.issuedMutationKeys).toContain(
      `${approvalId}:${step.id}:1:${method}`,
    );
    expect(trace.indexOf(`permit:${method}`)).toBeLessThan(
      trace.indexOf(`click:${method === 'add' ? TARGET : 'WL'}`),
    );
  }
}

describe('full synthetic write flow — real storage, authority, bridge, content and native adapter; NOT live proof', () => {
  it('verifies one ordinary remove against freshly reloaded backend membership', async () => {
    const { result, approval } = await run('remove');
    expect(clicks).toEqual(['WL']);
    expect(backend.get('WL')).toBe(false);
    expect(result.decisions[0]).toMatchObject({
      status: 'verified',
      journal: {
        remove: {
          status: 'verified',
          attempts: 1,
          outcome: 'changed',
          evidence: { state: 'absent', source: 'native-dialog' },
        },
      },
    });
    expect(result.operations?.lastRun?.status).toBe('complete');
    expect(permits).toHaveLength(1);
    expectDurablePermits(approval.id);
    expect(trace.slice(trace.indexOf('click:WL') + 1)).toContain('reload');
  });
  it('persists and verifies archive add BEFORE authorizing and clicking remove', async () => {
    const { result, approval } = await run('archive');
    expect(clicks).toEqual([TARGET, 'WL']);
    expect(backend).toEqual(
      new Map([
        [TARGET, true],
        ['WL', false],
      ]),
    );
    expect(result.decisions[0].status).toBe('verified');
    expect(result.decisions[0].journal?.add).toMatchObject({
      status: 'verified',
      attempts: 1,
      evidence: { state: 'present' },
    });
    expect(result.decisions[0].journal?.remove).toMatchObject({
      status: 'verified',
      attempts: 1,
      evidence: { state: 'absent' },
    });
    expect(permits.map((p) => p.request.method)).toEqual(['add', 'remove']);
    expect(permits[1].before.library.decisions[0].journal?.add).toMatchObject({
      status: 'verified',
      evidence: { state: 'present', source: 'native-dialog' },
    });
    expect(
      trace.slice(
        trace.indexOf(`click:${TARGET}`) + 1,
        trace.indexOf('permit:remove'),
      ),
    ).toContain('reload');
    expectDurablePermits(approval.id);
  });
  it('fails an optimistic add that does not persist, without a remove attempt', async () => {
    optimisticOnly = true;
    const { result } = await run('archive');
    expect(clicks).toEqual([TARGET]);
    expect(backend).toEqual(
      new Map([
        [TARGET, false],
        ['WL', true],
      ]),
    );
    expect(result.decisions[0]).toMatchObject({
      status: 'failed',
      journal: {
        add: { status: 'failed', attempts: 1, evidence: { state: 'absent' } },
        remove: { status: 'pending', attempts: 0 },
      },
    });
    expect(result.operations?.lastRun?.status).toBe('stopped');
    expect(permits.map((p) => p.request.method)).toEqual(['add']);
    expect(requests.some((r) => r.method === 'remove')).toBe(false);
    expect(trace.slice(trace.indexOf(`click:${TARGET}`) + 1)).toContain(
      'reload',
    );
  });
  it('rejects a raw bridge mutation with valid approval but no durable claim or WAL before ANY click', async () => {
    const { library, approval } = await seed('remove');
    const bridge = await open(approval);
    await expect(
      drive(bridge.adapter.removeFromWatchLater(VIDEO)),
    ).rejects.toThrow('Keine aktive dauerhaft beanspruchte Freigabe');
    expect(clicks).toEqual([]);
    expect(trace).not.toContain('open');
    expect(permits).toHaveLength(1);
    expect(permits[0].response).toMatchObject({ authorized: false });
    expect((await durable()).library).toEqual(library);
    expect((await durable()).ledger).toBeUndefined();
  });
  it('records a disconnected add as unknown despite persisted membership and never proceeds to remove', async () => {
    disconnectAfterClick = true;
    const { result } = await run('archive');
    expect(clicks).toEqual([TARGET]);
    expect(backend).toEqual(
      new Map([
        [TARGET, true],
        ['WL', true],
      ]),
    );
    expect(result.decisions[0]).toMatchObject({
      status: 'unknown',
      journal: {
        add: { status: 'unknown', attempts: 1, evidence: { state: 'present' } },
        remove: { status: 'pending', attempts: 0 },
      },
    });
    expect(result.operations?.lastRun?.status).toBe('stopped');
    expect(requests.some((r) => r.method === 'remove')).toBe(false);
    expect(permits.map((p) => p.request.method)).toEqual(['add']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(clicks).toEqual([TARGET]);
  });
  it('stops on unknown native WL membership without requesting mutation authority', async () => {
    unknownWL = true;
    const { result } = await run('remove');
    expect(result.decisions[0]).toMatchObject({
      status: 'unknown',
      journal: {
        remove: {
          status: 'unknown',
          attempts: 0,
          evidence: { state: 'unknown' },
        },
      },
    });
    expect(clicks).toEqual([]);
    expect(permits).toEqual([]);
    expect(requests.map((r) => r.method)).toEqual(['membership']);
  });
});
