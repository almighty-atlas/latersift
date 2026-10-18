import { describe, expect, it, vi } from 'vitest';
import { scanWatchLater } from '../src/adapter/scanner';
import type { Scan } from '../src/model';
import { createPlaylistScroller } from '../src/adapter/scroll';
import { id, row, fixture, run } from './fixtures/scanner';

describe('opt-in fast end jumps with the real scroll adapter', () => {
  const options = { background: 'experimental', mode: 'fast-jump' } as const;
  function growing(total = 300, initial = 100) {
    const f = fixture(total, initial);
    f.visibility('hidden');
    Object.defineProperty(f.env.doc, 'defaultView', { value: window });
    const container = f.env.doc.createElement('section');
    container.style.overflowY = 'auto';
    f.env.doc.body.append(container);
    container.append(
      f.env.doc.querySelector('ytd-playlist-video-list-renderer')!,
    );
    let end = initial;
    let failed = false;
    let loading = true;
    const boundaries: number[] = [];
    Object.defineProperties(container, {
      scrollHeight: { get: () => end * 100 },
      clientHeight: { value: 600 },
      scrollTo: {
        value: vi.fn((o: ScrollToOptions) => {
          if (!failed) container.scrollTop = o.top ?? 0;
        }),
      },
    });
    const scroller = createPlaylistScroller(f.env.doc);
    f.env.scrollInfo = scroller.observedInfo;
    f.env.jumpToEnd = vi.fn(scroller.observedEndJump);
    f.env.resetScroll = vi.fn(scroller.observedReset);
    f.env.advance = vi.fn(scroller.observedAdvance);
    f.env.wait = async (ms) => {
      f.tick(ms);
      if (loading && container.scrollTop === end * 100 - 600 && end < total) {
        boundaries.push(end);
        end = Math.min(total, end + 100);
        f.render(1, end, end < total);
      }
    };
    return {
      ...f,
      container,
      boundaries,
      fail: () => {
        failed = true;
      },
      stopLoading: () => {
        loading = false;
      },
    };
  }
  it('checkpoints before every jump and loads 100 → 200 → 300 only at the measured end', async () => {
    const f = growing();
    const saved: Scan[] = [];
    const jump = f.env.jumpToEnd!;
    f.env.jumpToEnd = () => {
      const s = saved.at(-1)!;
      expect(s.confirmedVideoIds).toHaveLength(
        f.env.doc.querySelectorAll('ytd-playlist-video-renderer').length,
      );
      expect(s.videos.every((v) => v.position !== null)).toBe(true);
      return jump();
    };
    const result = await scanWatchLater(
      f.env,
      new AbortController().signal,
      async (s) => {
        saved.push(s);
      },
      options,
    );
    expect(result.status).toBe('complete');
    expect(f.boundaries).toEqual([100, 200]);
    expect(f.env.advance).not.toHaveBeenCalled();
    expect(result.diagnostics?.performance).toMatchObject({
      mode: 'fast-jump',
      endJumps: 3,
      loadEvents: 2,
      averageProgressIntervalMs: 1500,
      jumpToNewIdsMs: 2000,
      jumpToNewIdsSamples: 2,
      fallbackCount: 0,
      domBehavior: 'growing',
      minRenderedPosition: 1,
      maxRenderedPosition: 300,
      uniqueRenderedIds: 300,
      milestones: [
        { confirmedCount: 100, elapsedMs: 0 },
        { confirmedCount: 200, elapsedMs: 2000 },
        { confirmedCount: 300, elapsedMs: 3000 },
      ],
    });
  });
  it.each(['positions', 'placeholders', 'empty', 'geometry'])(
    'waits for stable initial evidence (%s), then checkpoints and jumps without approach',
    async (kind) => {
      const f = growing();
      if (kind === 'positions')
        f.env.doc.querySelectorAll('[id="index"]').forEach((n) => {
          n.textContent = '';
        });
      if (kind === 'placeholders')
        f.env.doc
          .querySelector('#contents')!
          .insertAdjacentHTML(
            'beforeend',
            '<ytd-playlist-video-renderer></ytd-playlist-video-renderer>',
          );
      if (kind === 'empty') f.render(1, 0, true);
      const info = f.env.scrollInfo!;
      let hydrated = false;
      if (kind === 'geometry')
        f.env.scrollInfo = () => (hydrated ? info() : null);
      const wait = f.env.wait;
      let waits = 0;
      f.env.wait = async (ms, signal) => {
        if (++waits === 1) {
          f.tick(ms);
          expect(f.env.jumpToEnd).not.toHaveBeenCalled();
          expect(f.env.advance).not.toHaveBeenCalled();
          f.render(1, 100, true);
          hydrated = true;
        } else await wait(ms, signal);
      };
      const jump = f.env.jumpToEnd!;
      const snapshots: Scan[] = [];
      f.env.jumpToEnd = vi.fn(() => {
        const saved = snapshots.at(-1)!;
        expect(saved.confirmedVideoIds!.length).toBe(
          f.env.doc.querySelectorAll('ytd-playlist-video-renderer').length,
        );
        expect(saved.videos.every((v) => v.position !== null)).toBe(true);
        return jump();
      });
      const result = await scanWatchLater(
        f.env,
        new AbortController().signal,
        async (s) => {
          snapshots.push(s);
        },
        options,
      );
      expect(result.status).toBe('complete');
      expect(result.unidentifiableRows).toBe(0);
      expect(result.diagnostics?.performance).toMatchObject({
        mode: 'fast-jump',
        initializationState: 'ready',
        initializationObservations: 3,
        initializationElapsedMs: 2000,
        endJumps: 3,
        fallbackCount: 0,
        positionConflicts: false,
      });
      expect(f.boundaries).toEqual([100, 200]);
      expect(f.env.advance).not.toHaveBeenCalled();
      expect(snapshots.filter((s) => s.status === 'complete')).toHaveLength(1);
    },
  );
  it.each([
    'missing',
    'gap',
    'unknown',
    'duplicate-id',
    'duplicate-id-same-position',
    'duplicate-position',
    'changed',
    'invalid-number',
    'empty',
  ])(
    'bounds initialization and diagnoses persistent %s without jumping or false completion',
    async (kind) => {
      const f = growing();
      const control = new AbortController();
      const rows = f.env.doc.querySelectorAll('ytd-playlist-video-renderer');
      if (kind === 'missing') rows[49].querySelector('[id="index"]')!.remove();
      if (kind === 'invalid-number')
        rows[49].querySelector('[id="index"]')!.textContent = '0';
      if (kind === 'gap') rows[49].remove();
      if (kind === 'unknown') rows[49].querySelector('a')!.remove();
      if (kind === 'duplicate-id' || kind === 'duplicate-id-same-position')
        rows[49].querySelector('a')!.setAttribute('href', `/watch?v=${id(1)}`);
      if (kind === 'duplicate-id-same-position')
        rows[49].querySelector('[id="index"]')!.textContent = '1';
      if (kind === 'duplicate-position')
        rows[49].querySelector('[id="index"]')!.textContent = '1';
      if (kind === 'empty') f.render(1, 0, true);
      f.env.wait = async (ms) => {
        f.tick(ms);
        if (kind === 'changed')
          rows[49].querySelector('[id="index"]')!.textContent = '51';
      };
      const reasons: Record<string, string> = {
        missing: 'invalid-positions',
        gap: 'rendered-position-gaps',
        unknown: 'unidentifiable-rows',
        'duplicate-id': 'changed-positions',
        'duplicate-id-same-position': 'duplicate-ids',
        'duplicate-position': 'duplicate-positions',
        changed: 'changed-positions',
        'invalid-number': 'invalid-positions',
        empty: 'no-rows',
      };
      const result = await scanWatchLater(
        f.env,
        control.signal,
        async (s) => {
          if (s.diagnostics?.rewindRequired) control.abort();
        },
        options,
      );
      expect(result.status).toBe('interrupted');
      expect(result.confirmedVideoIds).toEqual([]);
      expect(f.env.jumpToEnd).not.toHaveBeenCalled();
      expect(result.diagnostics?.performance).toMatchObject({
        mode: 'stepwise',
        initializationState: 'fallback',
        fallbackCount: 1,
        fallbackReasons: [reasons[kind]],
        fallbackSnapshots: [{ reason: reasons[kind], phase: 'initializing' }],
      });
      const snapshot = result.diagnostics!.performance!.fallbackSnapshots![0];
      expect(snapshot.elapsedMs).toBeLessThanOrEqual(8000);
      if (kind === 'missing')
        expect(snapshot).toMatchObject({
          renderedRows: 100,
          validPositions: 99,
          invalidPositions: 1,
          minPosition: 1,
          maxPosition: 100,
          missingWithinRenderedRange: 1,
        });
    },
  );
  it('does not discharge vanished unknown rows with only a partial prefix', async () => {
    const f = growing();
    const control = new AbortController();
    f.env.doc
      .querySelector('#contents')!
      .insertAdjacentHTML(
        'beforeend',
        '<ytd-playlist-video-renderer></ytd-playlist-video-renderer>',
      );
    f.env.wait = async (ms) => {
      f.tick(ms);
      f.render(1, 100, false);
      if (f.elapsed() >= 4000) control.abort();
    };
    const result = await scanWatchLater(
      f.env,
      control.signal,
      async () => {},
      options,
    );
    expect(result.status).toBe('interrupted');
    expect(result.unidentifiableRows).toBe(1);
    expect(result.videos).toHaveLength(100);
  });
  it('discharges hydrated unknown rows only after the entire list is freshly verified in stepwise mode', async () => {
    const f = fixture(2, 2);
    f.env.doc
      .querySelector('#contents')!
      .insertAdjacentHTML(
        'beforeend',
        '<ytd-playlist-video-renderer></ytd-playlist-video-renderer>',
      );
    const wait = f.env.wait;
    f.env.wait = async (ms, signal) => {
      await wait(ms, signal);
      f.render(1, 2, false);
    };
    const result = await run(f.env);
    expect(result.status).toBe('complete');
    expect(result.unidentifiableRows).toBe(0);
  });
  it('pauses before the first jump and requires fresh stable evidence on resume', async () => {
    const f = growing();
    const control = new AbortController();
    const paused = await scanWatchLater(
      f.env,
      control.signal,
      async () => {
        control.abort();
      },
      options,
    );
    expect(paused.status).toBe('interrupted');
    expect(paused.diagnostics?.performance?.initializationState).toBe(
      'waiting',
    );
    expect(f.env.jumpToEnd).not.toHaveBeenCalled();
    const saved: Scan[] = [];
    const result = await scanWatchLater(
      f.env,
      new AbortController().signal,
      async (s) => {
        saved.push(s);
      },
      options,
      paused,
    );
    expect(result.status).toBe('complete');
    expect(saved[0].diagnostics?.performance?.endJumps).toBe(0);
    expect(result.diagnostics?.performance?.endJumps).toBeGreaterThan(0);
  });
  it('rechecks rows changed during checkpoint ACK before the first jump', async () => {
    const f = growing();
    let changed = false;
    const control = new AbortController();
    const result = await scanWatchLater(
      f.env,
      control.signal,
      async (s) => {
        if (s.diagnostics?.rewindRequired) control.abort();
        if (
          !changed &&
          s.diagnostics?.performance?.initializationState === 'ready'
        ) {
          changed = true;
          f.env.doc.querySelector('[id="index"]')!.textContent = '2';
        }
      },
      options,
    );
    expect(changed).toBe(true);
    expect(result.status).toBe('interrupted');
    expect(f.env.jumpToEnd).not.toHaveBeenCalled();
    expect(result.diagnostics?.performance?.fallbackReasons).toEqual([
      'changed-positions',
    ]);
  });
  it('requires the full settlement window after late position hydration', async () => {
    const f = fixture(2, 2);
    f.env.doc.querySelectorAll('[id="index"]').forEach((n) => {
      n.textContent = '';
    });
    const wait = f.env.wait;
    f.env.wait = async (ms, signal) => {
      await wait(ms, signal);
      if (f.elapsed() >= 4000) f.render(1, 2, false);
    };
    const result = await run(f.env);
    expect(result.status).toBe('complete');
    expect(f.elapsed()).toBe(7000);
  });
  it('bounds an initially growing prefix that never stabilizes without scrolling', async () => {
    const f = growing();
    const control = new AbortController();
    let count = 100;
    f.env.wait = async (ms) => {
      f.tick(ms);
      f.render(1, ++count, true);
    };
    const result = await scanWatchLater(
      f.env,
      control.signal,
      async (s) => {
        if (s.diagnostics?.rewindRequired) control.abort();
      },
      options,
    );
    expect(result.status).toBe('interrupted');
    expect(f.env.jumpToEnd).not.toHaveBeenCalled();
    expect(f.env.advance).not.toHaveBeenCalled();
    expect(result.diagnostics?.performance).toMatchObject({
      fallbackReasons: ['initialization-unstable'],
      fallbackSnapshots: [
        { phase: 'initializing', elapsedMs: 8000, invalidPositions: 0 },
      ],
    });
  });
  it('never certifies duplicate rendered IDs with identical positions in stepwise mode', async () => {
    const f = fixture(2, 2);
    f.env.doc
      .querySelector('#contents')!
      .insertAdjacentHTML('beforeend', row(1));
    const result = await run(f.env);
    expect(result.status).toBe('incomplete');
    expect(result.diagnostics?.positionConflict).toBe(false);
  });
  it('measures reduced approach versus unchanged stepwise scanning on the same fixture', async () => {
    const slow = growing(200);
    const stepped = await scanWatchLater(
      slow.env,
      new AbortController().signal,
      async () => {},
      { background: 'experimental' },
    );
    const fast = growing(200);
    const jumped = await scanWatchLater(
      fast.env,
      new AbortController().signal,
      async () => {},
      options,
    );
    expect(stepped.status).toBe('complete');
    expect(jumped.status).toBe('complete');
    expect(slow.env.jumpToEnd).not.toHaveBeenCalled();
    expect(stepped.diagnostics!.performance!.scrollApproachMs).toBeGreaterThan(
      jumped.diagnostics!.performance!.scrollApproachMs,
    );
    expect(fast.elapsed()).toBeLessThan(slow.elapsed());
  });
  it.each([
    'removed',
    'gap',
    'duplicate-id',
    'duplicate-position',
    'missing-position',
  ])(
    'resets proof and revisits the start on %s, never confirms skipped positions',
    async (kind) => {
      const f = growing();
      const control = new AbortController();
      let waits = 0;
      f.env.wait = async (ms) => {
        f.tick(ms);
        if (!vi.mocked(f.env.jumpToEnd!).mock.calls.length) return;
        if (++waits === 1) {
          if (kind === 'removed') f.render(101, 100, true);
          else {
            f.render(1, 200, true);
            const rows = f.env.doc.querySelectorAll(
              'ytd-playlist-video-renderer',
            );
            if (kind === 'gap') rows[149].remove();
            if (kind === 'duplicate-id')
              rows[149]
                .querySelector('a')!
                .setAttribute('href', `/watch?v=${id(1)}`);
            if (kind === 'duplicate-position')
              rows[149].querySelector('[id="index"]')!.textContent = '1';
            if (kind === 'missing-position')
              rows[149].querySelector('[id="index"]')!.remove();
          }
        } else control.abort();
      };
      const saved: Scan[] = [];
      const result = await scanWatchLater(
        f.env,
        control.signal,
        async (s) => {
          saved.push(s);
        },
        options,
      );
      expect(result.status).toBe('interrupted');
      expect(result.confirmedVideoIds).toEqual([]);
      expect(result.videos.length).toBeGreaterThanOrEqual(100);
      expect(f.env.resetScroll).toHaveBeenCalledTimes(2);
      expect(f.container.scrollTop).toBe(0);
      expect(result.diagnostics?.performance).toMatchObject({
        mode: 'stepwise',
        fallbackCount: 1,
        fallbackReasons: [
          kind === 'removed'
            ? 'virtualization-or-removed-rows'
            : kind === 'gap'
              ? 'rendered-position-gaps'
              : kind === 'duplicate-id'
                ? 'changed-positions'
                : kind === 'duplicate-position'
                  ? 'duplicate-positions'
                  : 'invalid-positions',
        ],
      });
      expect(saved.every((s) => s.status !== 'complete')).toBe(true);
    },
  );
  it('bounds unchanged height and continuation without repeated end jumps or false completion', async () => {
    const f = growing(30, 10);
    f.stopLoading();
    const result = await scanWatchLater(
      f.env,
      new AbortController().signal,
      async () => {},
      options,
    );
    expect(result.status).toBe('incomplete');
    expect(f.env.jumpToEnd).toHaveBeenCalledOnce();
    expect(result.diagnostics?.performance).toMatchObject({
      fallbackReasons: ['bounded-stall'],
      loadEvents: 0,
    });
    expect(
      result.diagnostics!.performance!.endWithoutNewIdsMs,
    ).toBeGreaterThanOrEqual(8000);
  });
  it('falls back after an end jump fails and stays incomplete', async () => {
    const f = growing(30, 10);
    f.fail();
    const result = await scanWatchLater(
      f.env,
      new AbortController().signal,
      async () => {},
      options,
    );
    expect(result.status).toBe('incomplete');
    expect(f.env.jumpToEnd).toHaveBeenCalledOnce();
    expect(result.diagnostics?.performance?.fallbackReasons).toEqual([
      'jump-failed',
    ]);
  });
  it('uses observed delayed timers without catch-up jumps', async () => {
    const f = growing();
    const wait = f.env.wait;
    f.env.wait = (ms, signal) => wait(ms + 59000, signal);
    const result = await scanWatchLater(
      f.env,
      new AbortController().signal,
      async () => {},
      options,
    );
    expect(result.status).toBe('complete');
    expect(f.env.jumpToEnd).toHaveBeenCalledTimes(3);
    expect(result.diagnostics?.performance?.averageProgressIntervalMs).toBe(
      90000,
    );
    expect(result.diagnostics?.timerThrottling?.delayedWaits).toBe(4);
  });
  it('pauses with a committed checkpoint and resumes only with fresh opt-in', async () => {
    const f = growing();
    const control = new AbortController();
    const jump = f.env.jumpToEnd!;
    f.env.jumpToEnd = () => {
      const result = jump();
      control.abort();
      return result;
    };
    const paused = await scanWatchLater(
      f.env,
      control.signal,
      async () => {},
      options,
    );
    expect(paused.status).toBe('interrupted');
    expect(paused.confirmedVideoIds).toHaveLength(100);
    f.env.jumpToEnd = vi.fn(jump);
    const resumed = await scanWatchLater(
      f.env,
      new AbortController().signal,
      async () => {},
      options,
      structuredClone(paused),
    );
    expect(resumed.status).toBe('complete');
    expect(resumed.id).toBe(paused.id);
    expect(f.env.jumpToEnd).toHaveBeenCalled();
    f.env.jumpToEnd = vi.fn(jump);
    const defaultResume = await scanWatchLater(
      f.env,
      new AbortController().signal,
      async () => {},
      { background: 'experimental' },
      paused,
    );
    expect(defaultResume.diagnostics?.performance?.mode).toBe('stepwise');
    expect(f.env.jumpToEnd).not.toHaveBeenCalled();
  });
  it('persists a pending rewind when paused at the fallback checkpoint and resumes it in stepwise mode', async () => {
    const f = growing();
    const control = new AbortController();
    f.env.wait = async (ms) => {
      f.tick(ms);
      if (vi.mocked(f.env.jumpToEnd!).mock.calls.length)
        f.render(101, 100, true);
    };
    const paused = await scanWatchLater(
      f.env,
      control.signal,
      async (s) => {
        if (s.diagnostics?.rewindRequired) control.abort();
      },
      options,
    );
    expect(paused.status).toBe('interrupted');
    expect(paused.diagnostics?.rewindRequired).toBe(true);
    expect(paused.confirmedVideoIds).toEqual([]);
    expect(f.env.resetScroll).toHaveBeenCalledOnce();
    const again = new AbortController();
    const reset = f.env.resetScroll!;
    f.env.resetScroll = vi.fn(() => {
      const result = reset();
      again.abort();
      return result;
    });
    const resumed = await scanWatchLater(
      f.env,
      again.signal,
      async () => {},
      { background: 'experimental' },
      paused,
    );
    expect(f.env.resetScroll).toHaveBeenCalledOnce();
    expect(f.container.scrollTop).toBe(0);
    expect(resumed.status).toBe('interrupted');
    expect(resumed.diagnostics?.rewindRequired).toBe(false);
  });
  it('stops incomplete when a fallback cannot return to the beginning', async () => {
    const f = growing();
    const reset = f.env.resetScroll!;
    let calls = 0;
    f.env.resetScroll = () => {
      if (++calls > 1) f.fail();
      return reset();
    };
    f.env.wait = async (ms) => {
      f.tick(ms);
      if (vi.mocked(f.env.jumpToEnd!).mock.calls.length)
        f.render(101, 100, true);
    };
    const result = await scanWatchLater(
      f.env,
      new AbortController().signal,
      async () => {},
      options,
    );
    expect(result).toMatchObject({
      status: 'incomplete',
      confirmedVideoIds: [],
      diagnostics: { reason: 'scroll_unreachable', rewindRequired: true },
    });
  });
  it('does not grant hidden scrolling through fast mode alone', async () => {
    const f = growing();
    const result = await scanWatchLater(
      f.env,
      new AbortController().signal,
      async () => {},
      {
        mode: 'fast-jump',
        waitingMs: 1000,
        attentionLimitMs: 5000,
      },
    );
    expect(result.status).toBe('incomplete');
    expect(result.diagnostics?.backgroundMode).toBe('paused');
    expect(f.env.jumpToEnd).not.toHaveBeenCalled();
    expect(f.env.advance).not.toHaveBeenCalled();
  });
  it.each(['hidden', 'navigation'])(
    'rechecks %s after checkpoint persistence before jumping',
    async (kind) => {
      const f = growing();
      f.visibility('visible');
      const result = await scanWatchLater(
        f.env,
        new AbortController().signal,
        async () => {
          if (kind === 'hidden') f.visibility('hidden');
          else f.env.url = () => 'https://www.youtube.com/';
        },
        { mode: 'fast-jump', waitingMs: 1000, attentionLimitMs: 5000 },
      );
      expect(result.status).toBe(
        kind === 'hidden' ? 'incomplete' : 'interrupted',
      );
      expect(f.env.jumpToEnd).not.toHaveBeenCalled();
    },
  );
  it('never completes fast import without a direct total count', async () => {
    const f = growing(10, 10);
    f.env.doc.querySelector('#stats')!.remove();
    const result = await scanWatchLater(
      f.env,
      new AbortController().signal,
      async () => {},
      options,
    );
    expect(result.status).toBe('incomplete');
    expect(result.expectedCount).toBeNull();
  });
  it('never jumps before a checkpoint ACK or after a storage failure', async () => {
    const f = growing();
    await expect(
      scanWatchLater(
        f.env,
        new AbortController().signal,
        async () => {
          throw new Error('storage');
        },
        options,
      ),
    ).rejects.toThrow('Speicherung fehlgeschlagen');
    expect(f.env.jumpToEnd).not.toHaveBeenCalled();
  });
});
