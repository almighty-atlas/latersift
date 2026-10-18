import { afterEach, describe, expect, it, vi } from 'vitest';
import { scanWatchLater, type ScanEnvironment } from '../src/adapter/scanner';
import { createPlaylistScroller } from '../src/adapter/scroll';
import type { Scan, ScrollTraceEntry } from '../src/model';

const epoch = Date.UTC(2026, 0, 1);
const options = { background: 'experimental' } as const;
const id = (position: number) => String(position).padStart(11, '0');
const frames: HTMLIFrameElement[] = [];

afterEach(() => {
  frames.splice(0).forEach((frame) => frame.remove());
  vi.restoreAllMocks();
});

function rect(top: number, height: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    bottom: top + height,
    left: 0,
    right: 600,
    width: 600,
    height,
    toJSON: () => ({}),
  };
}

function fixture(total: number | null = 2, initial = 1) {
  // DOMParser documents have no defaultView, so CSS rejection needs a window.
  const frame = document.createElement('iframe');
  document.body.append(frame);
  frames.push(frame);
  const doc = frame.contentDocument!;
  doc.body.innerHTML = `<ytd-playlist-header-renderer><div id="stats">${total === null ? '' : `${total} videos`}</div></ytd-playlist-header-renderer><section style="overflow-y: auto"><ytd-playlist-video-list-renderer><div id="contents"></div></ytd-playlist-video-list-renderer></section>`;
  let container = doc.querySelector('section')!;
  const contents = doc.querySelector<HTMLElement>('#contents')!;
  let time = epoch;
  let hidden = true;
  let top = 0;
  let height = 1000;
  let viewport = 500;
  let noOp = false;
  let onWait: () => void = () => {};
  let onScroll: () => void = () => {};
  let waitElapsed: number | undefined;
  const requests: { at: number; top: number }[] = [];
  Object.defineProperties(doc, {
    hidden: { configurable: true, get: () => hidden },
    visibilityState: {
      configurable: true,
      get: () => (hidden ? 'hidden' : 'visible'),
    },
    scrollingElement: { configurable: true, get: () => doc.documentElement },
  });
  const installGeometry = (node: HTMLElement) => {
    Object.defineProperties(node, {
      scrollTop: {
        configurable: true,
        get: () => top,
        set: (value: number) => {
          top = value;
        },
      },
      scrollHeight: { configurable: true, get: () => height },
      clientHeight: { configurable: true, get: () => viewport },
      clientTop: { configurable: true, value: 0 },
    });
    node.getBoundingClientRect = () => rect(100, viewport);
    node.scrollTo = vi.fn((input: ScrollToOptions | number = {}) => {
      if (typeof input === 'number')
        throw new Error('Expected ScrollToOptions');
      requests.push({ at: time - epoch, top: input.top ?? 0 });
      if (!noOp) top = Math.max(0, Math.min(height - viewport, input.top ?? 0));
      onScroll();
    });
  };
  installGeometry(container);
  // A real fallback target makes a rejected CSS candidate observable.
  Object.defineProperties(doc.documentElement, {
    scrollHeight: { configurable: true, value: 3000 },
    clientHeight: { configurable: true, value: 600 },
  });
  doc.documentElement.scrollTo = vi.fn(
    (input: ScrollToOptions | number = {}) => {
      if (typeof input === 'object')
        doc.documentElement.scrollTop = input.top ?? 0;
    },
  );
  const render = (start: number, count: number, continuation = true) => {
    contents.innerHTML =
      Array.from({ length: count }, (_, i) => {
        const position = start + i;
        return `<ytd-playlist-video-renderer><div id="index">${position}</div><a id="video-title" href="/watch?v=${id(position)}&list=WL" title="Video ${position}">Video ${position}</a></ytd-playlist-video-renderer>`;
      }).join('') +
      (continuation
        ? '<ytd-continuation-item-renderer></ytd-continuation-item-renderer>'
        : '');
    const loading = contents.querySelector('ytd-continuation-item-renderer');
    if (loading)
      loading.getBoundingClientRect = () => rect(100 + height - top - 30, 30);
  };
  render(1, initial);
  const scroller = createPlaylistScroller(doc);
  const env: ScanEnvironment = {
    doc,
    documentId: 'scroll-trace-document',
    url: () => 'https://www.youtube.com/playlist?list=WL',
    now: () => time,
    scrollInfo: scroller.observedInfo,
    advance: vi.fn(scroller.observedAdvance),
    resetScroll: vi.fn(scroller.observedReset),
    loadingArea: scroller.observedLoadingArea,
    wait: vi.fn(async (ms, signal) => {
      if (signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');
      time += waitElapsed ?? ms;
      onWait();
    }),
  };
  const snapshots: Scan[] = [];
  const run = (signal = new AbortController().signal, resume?: Scan) =>
    scanWatchLater(
      env,
      signal,
      async (scan) => {
        snapshots.push(scan);
      },
      options,
      resume,
    );
  return {
    doc,
    env,
    scroller,
    render,
    run,
    snapshots,
    requests,
    elapsed: () => time - epoch,
    get container() {
      return container;
    },
    get top() {
      return top;
    },
    set top(value: number) {
      top = value;
    },
    set height(value: number) {
      height = value;
    },
    set viewport(value: number) {
      viewport = value;
    },
    set noOp(value: boolean) {
      noOp = value;
    },
    set waitElapsed(value: number) {
      waitElapsed = value;
    },
    set onWait(value: () => void) {
      onWait = value;
    },
    set onScroll(value: () => void) {
      onScroll = value;
    },
    visibility(value: boolean) {
      hidden = value;
      doc.dispatchEvent(new Event('visibilitychange'));
    },
    replaceContainer(tag: string, nextTop: number) {
      const next = doc.createElement(tag);
      next.style.overflowY = 'auto';
      next.append(...container.childNodes);
      container.replaceWith(next);
      container = next;
      top = nextTop;
      installGeometry(next);
    },
  };
}

function trace(scan: Scan) {
  expect(scan.diagnostics?.scrollTrace).toBeDefined();
  return scan.diagnostics!.scrollTrace!;
}

function assertActionLinks(history: ScrollTraceEntry[]) {
  for (const [index, entry] of history.entries()) {
    expect(entry.laterAttribution).toBe('unknown');
    if (entry.action) {
      expect(entry.action.sequence).toBeGreaterThan(0);
      expect(entry.action.attribution).toBe('during-call-only');
    }
    const previous = history[index - 1];
    if (!previous?.action) continue;
    expect(entry.afterAction).toBe(previous.action.sequence);
    if (entry.action)
      expect(entry.action.sequence).toBe(previous.action.sequence! + 1);
  }
}

describe('real Watch Later scroller + scanner scroll trace', () => {
  it('automatically collects 100 → 200 → 300 IDs only after reaching each geometry end', async () => {
    const f = fixture(300, 100);
    f.height = 2500;
    let loaded = 100;
    const boundaries: {
      top: number;
      end: number;
      loadingInViewport: boolean | null;
    }[] = [];
    f.onWait = () => {
      const position = f.scroller.observedInfo()!;
      if (loaded === 300 || position.top < position.height - position.viewport)
        return;
      boundaries.push({
        top: position.top,
        end: position.height - position.viewport,
        loadingInViewport: f.scroller.observedLoadingArea().inViewport,
      });
      loaded += 100;
      f.render(loaded - 99, 100, loaded < 300);
      f.height = (loaded / 100) * 2500;
    };
    expect(f.doc.defaultView).not.toBeNull();
    expect(f.scroller.observedLoadingArea()).toEqual({
      visibleElements: 1,
      inViewport: false,
      distanceToViewport: 1970,
    });
    const result = await f.run();
    expect(result.status).toBe('complete');
    expect(result.confirmedVideoIds).toEqual(
      Array.from({ length: 300 }, (_, i) => id(i + 1)),
    );
    expect(result.videos).toHaveLength(300);
    expect(boundaries).toHaveLength(2);
    expect(
      boundaries.every((b) => b.top === b.end && b.loadingInViewport),
    ).toBe(true);
    expect(f.snapshots.map((s) => s.diagnostics?.confirmedCount)).toEqual(
      expect.arrayContaining([100, 200, 300]),
    );
    expect(f.snapshots[0].diagnostics?.scrollTrace?.lastAction).toMatchObject({
      kind: 'reset',
      sequence: 1,
      outcome: 'target-observed',
      requestedTop: 0,
    });
    expect(trace(result).totalRecoveryAttempts).toBe(0);
    expect(trace(result).progressEvents?.map((e) => e.confirmedCount)).toEqual([
      100, 200, 300,
    ]);
    expect(
      trace(result).history.some(
        (e) =>
          e.action?.outcome === 'target-observed' &&
          e.action.after!.top > e.action.before!.top,
      ),
    ).toBe(true);
    assertActionLinks(trace(result).history);
  });

  it('bounds hidden loading with visible continuation to three recoveries and 90 seconds, keeping only 24 entries', async () => {
    const f = fixture();
    // Keep the overflow ancestor selectable while already within the 2px end tolerance.
    f.height = 501;
    const result = await f.run();
    expect(f.elapsed()).toBe(90000);
    expect(result).toMatchObject({
      status: 'incomplete',
      diagnostics: {
        reason: 'background_loading_stalled',
        recoveryAttempts: 3,
        confirmedCount: 1,
        visibility: 'hidden',
        activeMs: 90000,
      },
    });
    const t = trace(result);
    expect(t.totalRecoveryAttempts).toBe(3);
    expect(
      t.recoveryHistory?.map((r) => ({
        at: r.elapsedMs,
        result: r.result,
        outcome: r.action?.outcome,
      })),
    ).toEqual([
      { at: 20000, result: 'no-new-ids-observed', outcome: 'target-observed' },
      { at: 40000, result: 'no-new-ids-observed', outcome: 'target-observed' },
      { at: 60000, result: 'no-new-ids-observed', outcome: 'target-observed' },
    ]);
    expect(
      vi.mocked(f.env.advance).mock.calls.filter(([recovery]) => recovery),
    ).toHaveLength(3);
    const recoveryTimes = f.snapshots
      .flatMap((s) => trace(s).history)
      .filter((e) => e.action?.kind === 'recovery')
      .map((e) => e.elapsedMs);
    expect([...new Set(recoveryTimes)]).toEqual([20000, 40000, 60000]);
    expect(t.history).toHaveLength(24);
    expect(t.history[0].round).toBe(67);
    expect(t.history.at(-1)?.round).toBe(90);
    expect(t.actionCount).toBe(91);
    expect(t.lastAction?.sequence).toBe(t.actionCount);
    expect(
      t.history.every(
        (e) => e.atGeometryEnd && e.continuation && e.visibility === 'hidden',
      ),
    ).toBe(true);
    expect(t.history.at(-1)?.loadingArea).toEqual({
      visibleElements: 1,
      inViewport: true,
      distanceToViewport: 0,
    });
    assertActionLinks(t.history);
  });

  it('records delayed fake waits without catch-up scrolling or premature success', async () => {
    const f = fixture();
    f.height = 501;
    f.waitElapsed = 60000;
    const result = await f.run();
    expect(result).toMatchObject({
      status: 'incomplete',
      diagnostics: {
        reason: 'background_loading_stalled',
        recoveryAttempts: 3,
        activeMs: 180000,
        timerThrottling: {
          requestedMs: 1000,
          lastElapsedMs: 60000,
          maxElapsedMs: 60000,
          delayedWaits: 3,
        },
      },
    });
    expect(trace(result).recoveryHistory?.map((r) => r.result)).toEqual([
      'no-new-ids-observed',
      'no-new-ids-observed',
      'unresolved',
    ]);
    expect(f.env.wait).toHaveBeenCalledTimes(3);
    expect(f.env.advance).toHaveBeenCalledTimes(4);
    expect(f.requests.map((request) => request.at)).toEqual([
      0, 0, 60000, 120000, 180000,
    ]);
    expect(
      trace(result)
        .history.filter((e) => e.action?.kind === 'recovery')
        .map((e) => e.elapsedMs),
    ).toEqual([60000, 120000, 180000]);
    assertActionLinks(trace(result).history);
  });

  it('reports immediate no-movement for scrollTo no-op and never treats requests as forward travel', async () => {
    const f = fixture();
    f.height = 10000;
    f.noOp = true;
    const result = await f.run();
    expect(f.elapsed()).toBe(90000);
    expect(result).toMatchObject({
      status: 'incomplete',
      diagnostics: { reason: 'scroll_unreachable', confirmedCount: 1 },
    });
    const actions = trace(result).history.flatMap((e) =>
      e.action ? [e.action] : [],
    );
    expect(actions.length).toBeGreaterThan(0);
    expect(
      actions.every(
        (a) =>
          a.outcome === 'no-movement' &&
          a.before!.top === 0 &&
          a.after!.top === 0 &&
          a.requestedTop === 425,
      ),
    ).toBe(true);
    expect(
      trace(result).history.every(
        (e) => e.laterDelta === 0 && !e.atGeometryEnd,
      ),
    ).toBe(true);
    assertActionLinks(trace(result).history);
  });

  it.each([
    'viewport-zero',
    'display-none',
    'visibility-hidden',
    'hidden-attribute',
  ])('rejects an invalid CSS overflow ancestor: %s', async (kind) => {
    const f = fixture();
    if (kind === 'viewport-zero') f.viewport = 0;
    if (kind === 'display-none') f.container.style.display = 'none';
    if (kind === 'visibility-hidden') f.container.style.visibility = 'hidden';
    if (kind === 'hidden-attribute') f.container.hidden = true;
    const rejectedScroll = f.container.scrollTo;
    expect(f.doc.defaultView!.getComputedStyle(f.container).overflowY).toBe(
      'auto',
    );
    expect(f.scroller.observedInfo()).toMatchObject({
      container: 'document',
      viewport: 600,
    });
    const result = await f.run();
    expect(result.status).toBe('incomplete');
    expect(rejectedScroll).not.toHaveBeenCalled();
    expect(f.doc.documentElement.scrollTo).toHaveBeenCalled();
    expect(
      trace(result).history.every((e) => e.scroll?.container === 'document'),
    ).toBe(true);
    if (kind !== 'viewport-zero') {
      expect(trace(result).history.every((e) => e.visibleRows === 0)).toBe(
        true,
      );
      expect(trace(result).history.at(-1)?.loadingArea?.visibleElements).toBe(
        0,
      );
    }
  });

  it.each(['different-tag', 'same-tag'])(
    'does not count a switched container as forward travel (%s)',
    async (kind) => {
      const f = fixture();
      f.height = 200000;
      f.noOp = true;
      const initial = f.scroller.observedInfo()!;
      f.onWait = () =>
        f.replaceContainer(
          kind === 'same-tag'
            ? 'section'
            : f.container.localName === 'section'
              ? 'article'
              : 'section',
          f.top + 1000,
        );
      const result = await f.run();
      expect(f.elapsed()).toBe(90000);
      expect(result).toMatchObject({
        status: 'incomplete',
        diagnostics: { reason: 'scroll_unreachable' },
      });
      const t = trace(result);
      expect(t.containerChanges).toBe(90);
      expect(
        t.history.every(
          (e) =>
            e.containerChanged && e.laterDelta === null && !e.atGeometryEnd,
        ),
      ).toBe(true);
      expect(new Set(t.history.map((e) => e.scroll?.epoch)).size).toBe(24);
      expect(t.history[0].scroll?.epoch).not.toBe(initial.epoch);
      if (kind === 'same-tag')
        expect(
          t.history.every((e) => e.scroll?.container === initial.container),
        ).toBe(true);
      assertActionLinks(t.history);
    },
  );

  it('preserves the persisted checkpoint and confirmed IDs across pause/resume without resetting the same document', async () => {
    const f = fixture(3);
    const control = new AbortController();
    f.onWait = () => control.abort();
    const paused = await f.run(control.signal);
    expect(paused.status).toBe('interrupted');
    expect(paused.confirmedVideoIds).toEqual([id(1)]);
    expect(f.snapshots.at(-1)).toEqual(paused);
    const checkpoint = structuredClone(paused);
    const resets = vi.mocked(f.env.resetScroll!).mock.calls.length;
    f.render(2, 2, false);
    f.onWait = () => {};
    const result = await f.run(new AbortController().signal, paused);
    expect(result.status).toBe('complete');
    expect(result.id).toBe(paused.id);
    expect(result.startedAt).toBe(paused.startedAt);
    expect(result.confirmedVideoIds).toEqual([id(1), id(2), id(3)]);
    expect(vi.mocked(f.env.resetScroll!).mock.calls).toHaveLength(resets);
    expect(paused).toEqual(checkpoint);
    expect(trace(result).history.some((e) => e.action?.kind === 'reset')).toBe(
      false,
    );
    assertActionLinks(trace(result).history);
  });

  it.each(['unknown-count', 'missing-position', 'position-gap'])(
    'never completes with insufficient count/position evidence: %s',
    async (kind) => {
      const f = fixture(kind === 'unknown-count' ? null : 2, 2);
      f.height = 501;
      f.render(1, 2, false);
      const positions = f.doc.querySelectorAll('[id="index"]');
      if (kind === 'missing-position') positions[1].remove();
      if (kind === 'position-gap') positions[1].textContent = '3';
      const result = await f.run();
      expect(result.status).toBe('incomplete');
      expect(f.snapshots.every((s) => s.status !== 'complete')).toBe(true);
      expect(result.diagnostics?.confirmedCount).toBe(2);
      expect(result.diagnostics?.continuation).toBe(false);
      if (kind === 'unknown-count') expect(result.expectedCount).toBeNull();
      else expect(result.diagnostics?.missingPositions).toContain(2);
    },
  );

  it('attributes simulated manual movement after a no-op call to unknown, not automatic success', async () => {
    const f = fixture();
    f.height = 10000;
    f.noOp = true;
    const control = new AbortController();
    let waits = 0;
    f.onWait = () => {
      waits++;
      if (waits === 1) f.top = 300;
      if (waits === 2) control.abort();
    };
    const result = await f.run(control.signal);
    const history = trace(result).history;
    expect(result.status).toBe('interrupted');
    expect(history).toHaveLength(2);
    expect(history[0].action).toMatchObject({
      sequence: 2,
      outcome: 'no-movement',
      before: { top: 0 },
      after: { top: 0 },
    });
    expect(history[1]).toMatchObject({
      afterAction: 2,
      laterDelta: 300,
      laterAttribution: 'unknown',
      containerChanged: false,
      scroll: { top: 300 },
    });
    expect(history[1].action).toMatchObject({
      sequence: 3,
      outcome: 'no-movement',
      before: { top: 300 },
      after: { top: 300 },
    });
    assertActionLinks(history);
  });
});
