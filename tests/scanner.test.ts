import { describe, expect, it, vi } from 'vitest';
import { scanWatchLater, type ScanEnvironment } from '../src/adapter/scanner';
import type { Scan } from '../src/model';
import { createPlaylistScroller } from '../src/adapter/scroll';
import { createYouTubeAdapter } from '../src/adapter/youtube';

const epoch = Date.UTC(2026, 0, 1);
const id = (position: number) => String(position).padStart(11, '0');
function row(position: number, videoId = id(position)) {
  return `<ytd-playlist-video-renderer><div id="index">${position}</div><a id="video-title" href="/watch?v=${videoId}&list=WL&index=${position}" title="Video ${position}">Video ${position}</a><ytd-channel-name><a>Test channel</a></ytd-channel-name><ytd-thumbnail-overlay-time-status-renderer><span id="text">12:34</span></ytd-thumbnail-overlay-time-status-renderer></ytd-playlist-video-renderer>`;
}
function fixture(total: number, initial = Math.min(total, 100)) {
  const doc = new DOMParser().parseFromString(
    `<ytd-playlist-header-renderer><div id="stats"><yt-formatted-string>${total.toLocaleString('en-US')} videos</yt-formatted-string><yt-formatted-string>No views</yt-formatted-string></div></ytd-playlist-header-renderer><ytd-playlist-video-list-renderer><div id="contents"></div></ytd-playlist-video-list-renderer>`,
    'text/html',
  );
  let time = epoch;
  let visibility = 'visible';
  Object.defineProperty(doc, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  const render = (
    start: number,
    count: number,
    continuation = start + count - 1 < total,
  ) => {
    doc.querySelector('#contents')!.innerHTML =
      Array.from({ length: count }, (_, i) => row(start + i)).join('') +
      (continuation
        ? '<ytd-continuation-item-renderer><div id="trigger"></div></ytd-continuation-item-renderer>'
        : '');
  };
  const env: ScanEnvironment = {
    doc,
    documentId: 'document-1',
    url: () => 'https://www.youtube.com/playlist?list=WL',
    now: () => time,
    advance: vi.fn(),
    wait: vi.fn(async (ms, signal) => {
      if (signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');
      time += ms;
    }),
  };
  render(1, initial);
  return {
    env,
    render,
    elapsed: () => time - epoch,
    tick: (ms: number) => {
      time += ms;
    },
    visibility: (value: string) => {
      visibility = value;
    },
  };
}
const run = (
  env: ScanEnvironment,
  checkpoint: (scan: Scan) => Promise<void> = async () => {},
) => scanWatchLater(env, new AbortController().signal, checkpoint);

async function paused2500() {
  const f = fixture(2501, 500);
  const control = new AbortController();
  let end = 500;
  f.env.advance = () => {
    if (end === 2500) control.abort();
    else {
      f.render(end + 1, 500);
      end += 500;
    }
  };
  const resume = await scanWatchLater(f.env, control.signal, async () => {});
  expect(resume.status).toBe('interrupted');
  expect(resume.videos).toHaveLength(2500);
  return { ...f, resume };
}

describe('scanner timing, progress and checkpoints', () => {
  it('retains 1,000 background IDs, requests attention after 8 seconds and continues when visible', async () => {
    const f = fixture(1001, 1000);
    f.visibility('hidden');
    const snapshots: Scan[] = [];
    const advance = vi.fn(() => f.render(1001, 1, false));
    f.env.advance = advance;
    const wait = f.env.wait;
    f.env.wait = async (ms, signal) => {
      await wait(ms, signal);
      if (f.elapsed() === 30000) f.visibility('visible');
    };
    const result = await run(f.env, async (s) => {
      snapshots.push(s);
      if (s.diagnostics?.visibility === 'hidden')
        expect(advance).not.toHaveBeenCalled();
    });
    const attention = snapshots.find((s) => s.status === 'needs_attention');
    expect(attention).toMatchObject({
      videos: expect.any(Array),
      diagnostics: {
        reason: 'background_tab_stalled',
        confirmedCount: 1000,
        visibility: 'hidden',
      },
    });
    expect(attention!.videos).toHaveLength(1000);
    expect(Date.parse(attention!.diagnostics!.lastProgressAt)).toBe(epoch);
    expect(result.status).toBe('complete');
    expect(result.videos).toHaveLength(1001);
    expect(result.diagnostics?.reason).toBe('count_and_positions_verified');
  }, 20000);

  it('waits over eight idle rounds at 4,686/4,926, then verifies the final 240 IDs', async () => {
    const f = fixture(4926, 500);
    let end = 500;
    let idleRounds = 0;
    const snapshots: Scan[] = [];
    f.env.advance = () => {
      if (end < 4686) {
        const count = Math.min(500, 4686 - end);
        f.render(end + 1, count);
        end += count;
      } else if (end === 4686 && ++idleRounds === 12) {
        f.render(4687, 240, false);
        end = 4926;
      }
    };
    const result = await run(f.env, async (s) => {
      snapshots.push(s);
    });
    expect(idleRounds).toBeGreaterThan(8);
    expect(
      snapshots.some((s) => s.status === 'waiting' && s.videos.length === 4686),
    ).toBe(true);
    expect(result.status).toBe('complete');
    expect(new Set(result.videos.map((v) => v.id)).size).toBe(4926);
    expect(result.diagnostics).toMatchObject({
      confirmedCount: 4926,
      missingPositions: [],
      highestPosition: 4926,
      continuation: false,
    });
  }, 20000);

  it('exhausts exactly three recoveries at 20/40/60 seconds and stops at 90 seconds', async () => {
    const f = fixture(2, 1);
    const recoveries: number[] = [];
    f.env.advance = (recovery) => {
      if (recovery) recoveries.push(f.elapsed());
    };
    const result = await run(f.env);
    expect(recoveries).toEqual([20000, 40000, 60000]);
    expect(f.elapsed()).toBe(90000);
    expect(result).toMatchObject({
      status: 'incomplete',
      diagnostics: {
        reason: 'recovery_exhausted',
        recoveryAttempts: 3,
        missingPositions: [2],
      },
    });
    expect(f.env.wait).toHaveBeenCalledTimes(90);
  });

  it('bounds background attention without recovery or an infinite loop', async () => {
    const f = fixture(2, 1);
    f.visibility('hidden');
    const result = await run(f.env);
    expect(result).toMatchObject({
      status: 'incomplete',
      diagnostics: {
        reason: 'attention_timeout',
        attentionMs: 120000,
        recoveryAttempts: 0,
      },
    });
    expect(f.elapsed()).toBe(128000);
    expect(f.env.advance).not.toHaveBeenCalled();
  });

  it('does not persist unchanged polling rounds every second', async () => {
    const f = fixture(2, 1);
    const saves: { time: number; status: Scan['status'] }[] = [];
    await run(f.env, async (s) => {
      saves.push({ time: f.elapsed(), status: s.status });
    });
    expect(saves.slice(0, 2)).toEqual([
      { time: 0, status: 'running' },
      { time: 8000, status: 'waiting' },
    ]);
    expect(saves.map((s) => s.time)).toEqual([
      0, 8000, 23000, 38000, 53000, 68000, 83000, 90000,
    ]);
  });

  it.each([
    { batch: 10, at: 5000, count: 60 },
    { batch: 100, at: 1000, count: 200 },
  ])(
    'checkpoints progress by time or 100 IDs ($batch IDs per round)',
    async ({ batch, at, count }) => {
      const f = fixture(1000, batch);
      const control = new AbortController();
      let end = batch;
      f.env.advance = () => {
        f.render(end + 1, batch);
        end += batch;
      };
      const saves: { time: number; count: number }[] = [];
      await scanWatchLater(f.env, control.signal, async (s) => {
        saves.push({ time: f.elapsed(), count: s.videos.length });
        if (saves.length === 2) control.abort();
      });
      expect(saves[1]).toEqual({ time: at, count });
    },
  );

  it.each(['initial', 'progress', 'final'])(
    'rejects %s checkpoint storage failures instead of returning success',
    async (phase) => {
      const f = fixture(200, 100);
      f.env.advance = () => f.render(101, 100, false);
      const checkpoint = vi.fn(async (s: Scan) => {
        if (
          phase === 'initial' ||
          (phase === 'progress' && s.videos.length === 200) ||
          (phase === 'final' && s.status === 'complete')
        )
          throw new Error(`disk full: ${phase}`);
      });
      await expect(run(f.env, checkpoint)).rejects.toThrow(
        `Speicherung fehlgeschlagen: Error: disk full: ${phase}`,
      );
      expect(
        checkpoint.mock.calls.filter(([s]) => s.status === 'complete'),
      ).toHaveLength(phase === 'final' ? 1 : 0);
    },
  );
});

describe('scroll travel and visibility accounting regressions', () => {
  it('starts a fresh visible grace period after three recoveries and a hidden-visible transition entirely between polls', async () => {
    const f = fixture(2, 1);
    const recoveries: number[] = [];
    const snapshots: { at: number; scan: Scan }[] = [];
    f.env.advance = (recovery) => {
      if (!recovery) return;
      recoveries.push(f.elapsed());
      if (recoveries.length === 4) f.render(2, 1, false);
    };
    f.env.wait = async (ms) => {
      if (f.elapsed() === 60000) {
        f.visibility('hidden');
        f.env.doc.dispatchEvent(new Event('visibilitychange'));
        f.tick(360000);
        f.visibility('visible');
        f.env.doc.dispatchEvent(new Event('visibilitychange'));
      }
      f.tick(ms);
    };
    const result = await run(f.env, async (scan) => {
      snapshots.push({ at: f.elapsed(), scan });
    });
    expect(recoveries).toEqual([20000, 40000, 60000, 441000]);
    expect(snapshots.find((s) => s.at === 421000)?.scan).toMatchObject({
      status: 'running',
      confirmedVideoIds: [id(1)],
      diagnostics: {
        visibility: 'visible',
        recoveryAttempts: 0,
        attentionMs: 0,
        activeMs: 61000,
      },
    });
    expect(snapshots.find((s) => s.at === 429000)?.scan).toMatchObject({
      status: 'waiting',
      diagnostics: { reason: 'waiting_for_youtube', recoveryAttempts: 0 },
    });
    expect(result.status).toBe('complete');
    expect(result.videos).toHaveLength(2);
    expect(f.elapsed()).toBe(445000);
    expect(result.diagnostics?.activeMs).toBe(85000);
  });

  it.each([{ intervals: [700000] }, { intervals: [350000, 350000] }])(
    'counts hidden attention toward the 600s total limit even when each interval ends visible ($intervals)',
    async ({ intervals }) => {
      const f = fixture(2, 1);
      const advance = vi.fn();
      f.env.advance = advance;
      let interval = 0;
      const snapshots: Scan[] = [];
      f.env.wait = async (ms) => {
        const hiddenMs = intervals[interval++];
        if (hiddenMs !== undefined) {
          f.tick(250);
          f.visibility('hidden');
          f.env.doc.dispatchEvent(new Event('visibilitychange'));
          f.tick(hiddenMs);
          f.visibility('visible');
          f.env.doc.dispatchEvent(new Event('visibilitychange'));
          f.tick(ms - 250);
        } else f.tick(ms);
      };
      const result = await run(f.env, async (s) => {
        snapshots.push(s);
      });
      expect(result).toMatchObject({
        status: 'incomplete',
        confirmedVideoIds: [id(1)],
        diagnostics: {
          reason: 'attention_timeout',
          visibility: 'visible',
          attentionMs: 0,
          activeMs: intervals.length * 1000,
          recoveryAttempts: 0,
          confirmedCount: 1,
        },
      });
      expect(f.elapsed()).toBe(700000 + intervals.length * 1000);
      expect(advance).toHaveBeenCalledTimes(intervals.length);
      expect(snapshots.every((s) => s.status !== 'complete')).toBe(true);
      if (intervals.length === 2)
        expect(snapshots[1]).toMatchObject({
          status: 'running',
          diagnostics: { activeMs: 1000, attentionMs: 0 },
        });
    },
  );
  it.each(['visible', 'hidden'])(
    'travels through a 100,000px loaded list for over 90 seconds before loading the boundary video (%s)',
    async (visibility) => {
      const f = fixture(2, 1);
      f.visibility(visibility);
      Object.defineProperty(f.env.doc, 'defaultView', { value: window });
      const container = f.env.doc.createElement('section');
      container.style.overflowY = 'auto';
      f.env.doc.body.append(container);
      container.append(
        f.env.doc.querySelector('ytd-playlist-video-list-renderer')!,
      );
      Object.defineProperties(container, {
        scrollHeight: { value: 100000 },
        clientHeight: { value: 600 },
        scrollTo: {
          value: vi.fn((options: ScrollToOptions) => {
            container.scrollTop = options.top ?? container.scrollTop;
          }),
        },
      });
      container.scrollTop = 40000;
      const scroller = createPlaylistScroller(f.env.doc);
      f.env.resetScroll = () => scroller.reset();
      f.env.scrollInfo = () => scroller.info();
      let boundaryAt: number | undefined;
      const advance = vi.fn((recovery?: boolean) => {
        scroller.advance(recovery);
        if (container.scrollTop === 99400 && boundaryAt === undefined) {
          boundaryAt = f.elapsed();
          f.render(2, 1, false);
        }
      });
      f.env.advance = advance;
      const snapshots: Scan[] = [];
      const result = await scanWatchLater(
        f.env,
        new AbortController().signal,
        async (s) => {
          snapshots.push(s);
        },
        visibility === 'hidden' ? { background: 'experimental' } : {},
      );
      expect(boundaryAt).toBeGreaterThan(90000);
      expect(boundaryAt).toBeLessThan(200000);
      expect(snapshots[0].diagnostics?.scroll?.top).toBe(0);
      expect(
        snapshots.some(
          (s) =>
            s.diagnostics!.activeMs! > 90000 &&
            s.diagnostics?.confirmedCount === 1,
        ),
      ).toBe(true);
      expect(
        snapshots.every(
          (s) => s.status === 'running' || s.status === 'complete',
        ),
      ).toBe(true);
      expect(advance.mock.calls.every(([recovery]) => !recovery)).toBe(true);
      expect(result).toMatchObject({
        status: 'complete',
        confirmedVideoIds: [id(1), id(2)],
        diagnostics: {
          confirmedCount: 2,
          scroll: { top: 99400 },
          reason: 'count_and_positions_verified',
        },
      });
      expect(
        f.env.doc.querySelectorAll('ytd-playlist-video-renderer'),
      ).toHaveLength(1);
    },
  );

  it('still stops after 90 seconds when geometry is approaching but scrolling makes no forward progress', async () => {
    const f = fixture(2, 1);
    f.env.scrollInfo = () => ({
      container: 'section',
      top: 0,
      height: 100000,
      viewport: 600,
    });
    const result = await run(f.env);
    expect(f.elapsed()).toBe(90000);
    expect(result).toMatchObject({
      status: 'incomplete',
      diagnostics: { reason: 'scroll_unreachable', confirmedCount: 1 },
    });
  });

  it.each(['activation', 'hidden-progress'] as const)(
    'resets near-limit attention on %s and completes beyond the old deadline',
    async (mode) => {
      const f = fixture(3, 1);
      f.visibility('hidden');
      const snapshots: Scan[] = [];
      f.env.wait = async () => {
        f.tick(1000);
        if (f.elapsed() === 127000) {
          if (mode === 'activation') {
            f.visibility('visible');
            f.env.doc.dispatchEvent(new Event('visibilitychange'));
          }
          f.render(2, 1, true);
        }
        if (f.elapsed() === 131000) f.render(3, 1, false);
      };
      const result = await run(f.env, async (s) => {
        snapshots.push(s);
      });
      expect(
        snapshots.some(
          (s) =>
            s.status === 'needs_attention' &&
            s.diagnostics!.attentionMs! >= 100000,
        ),
      ).toBe(true);
      const resumed = snapshots.find((s) => s.videos.length === 2);
      expect(resumed).toMatchObject({
        status: 'running',
        diagnostics: { attentionMs: 0, confirmedCount: 2 },
      });
      expect(result.status).toBe('complete');
      expect(f.elapsed()).toBe(134000);
      expect(result.diagnostics?.attentionMs).toBeLessThan(120000);
    },
  );

  it('excludes a long hidden interval between visibility events from active time even when no poll ran while hidden', async () => {
    const f = fixture(2, 1);
    let firstWait = true;
    f.env.wait = async (ms) => {
      if (firstWait) {
        firstWait = false;
        f.tick(250);
        f.visibility('hidden');
        f.env.doc.dispatchEvent(new Event('visibilitychange'));
        f.tick(360000);
        f.visibility('visible');
        f.env.doc.dispatchEvent(new Event('visibilitychange'));
        f.tick(750);
        f.render(2, 1, false);
      } else f.tick(ms);
    };
    const result = await run(f.env);
    expect(result.status).toBe('complete');
    expect(f.elapsed()).toBe(364000);
    expect(result.diagnostics).toMatchObject({
      activeMs: 4000,
      attentionMs: 0,
      visibility: 'visible',
      confirmedCount: 2,
    });
  });
});

describe('experimental background scanning', () => {
  const options = { background: 'experimental' } as const;
  const experimental = (
    env: ScanEnvironment,
    checkpoint: (scan: Scan) => Promise<void> = async () => {},
  ) => scanWatchLater(env, new AbortController().signal, checkpoint, options);

  it('forwards explicit adapter opt-in and collects virtualized hidden rows', async () => {
    const f = fixture(3, 1);
    f.visibility('hidden');
    let position = 1;
    f.env.advance = vi.fn(() => {
      if (position < 3) f.render(++position, 1);
    });
    const snapshots: Scan[] = [];
    const result = await createYouTubeAdapter(f.env).scanWatchLater(
      new AbortController().signal,
      async (s) => {
        snapshots.push(s);
      },
      undefined,
      options,
    );
    expect(f.env.advance).toHaveBeenCalled();
    expect(snapshots[0].confirmedVideoIds).toEqual([id(1)]);
    expect(result).toMatchObject({
      status: 'complete',
      confirmedVideoIds: [id(1), id(2), id(3)],
      diagnostics: {
        backgroundMode: 'experimental',
        visibility: 'hidden',
        reason: 'count_and_positions_verified',
        activeMs: 5000,
        attentionMs: 0,
        timerThrottling: { delayedWaits: 0 },
      },
    });
    expect(result.videos).toHaveLength(3);
  });

  it('bounds hidden recovery at 20/40/60 seconds and stops at 90 seconds', async () => {
    const f = fixture(2, 1);
    f.visibility('hidden');
    const recoveries: number[] = [];
    f.env.advance = (recovery) => {
      if (recovery) recoveries.push(f.elapsed());
    };
    const snapshots: Scan[] = [];
    const result = await experimental(f.env, async (s) => {
      snapshots.push(s);
    });
    expect(recoveries).toEqual([20000, 40000, 60000]);
    expect(f.elapsed()).toBe(90000);
    expect(
      snapshots.find((s) => s.status === 'waiting')?.diagnostics?.reason,
    ).toBe('background_scan_stalled');
    expect(snapshots.some((s) => s.status === 'needs_attention')).toBe(false);
    expect(result).toMatchObject({
      status: 'incomplete',
      diagnostics: {
        reason: 'recovery_exhausted',
        recoveryAttempts: 3,
        activeMs: 90000,
        attentionMs: 0,
      },
    });
  });

  it('detects delayed waits and bounds a throttled hidden scan without catch-up scrolling', async () => {
    const f = fixture(2, 1);
    f.visibility('hidden');
    f.env.wait = vi.fn(async () => {
      f.tick(60000);
    });
    const result = await experimental(f.env);
    expect(result).toMatchObject({
      status: 'incomplete',
      diagnostics: {
        reason: 'recovery_exhausted',
        activeMs: 180000,
        recoveryAttempts: 3,
        timerThrottling: {
          requestedMs: 1000,
          lastElapsedMs: 60000,
          maxElapsedMs: 60000,
          delayedWaits: 3,
        },
      },
    });
    expect(f.env.advance).toHaveBeenCalledTimes(4);
    expect(f.env.wait).toHaveBeenCalledTimes(3);
  });

  it('recovers hidden loading without bypassing the settlement window', async () => {
    const f = fixture(2, 1);
    f.visibility('hidden');
    const recoveries: number[] = [];
    f.env.advance = (recovery) => {
      if (recovery) {
        recoveries.push(f.elapsed());
        f.render(2, 1, false);
      }
    };
    const result = await experimental(f.env);
    expect(recoveries).toEqual([20000]);
    expect(f.elapsed()).toBe(24000);
    expect(result.status).toBe('complete');
    expect(result.diagnostics?.recoveryResults).toContain(
      'Fortschritt nach Recovery 1',
    );
  });

  it('still diagnoses delayed timers without enabling default hidden scrolling', async () => {
    const f = fixture(2, 1);
    f.visibility('hidden');
    f.env.wait = async () => {
      f.tick(60000);
    };
    const result = await run(f.env);
    expect(f.env.advance).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'incomplete',
      diagnostics: {
        backgroundMode: 'paused',
        reason: 'attention_timeout',
        activeMs: 0,
        timerThrottling: { delayedWaits: 3, maxElapsedMs: 60000 },
      },
    });
  });

  it('stops on checkpoint failure before any hidden scroll', async () => {
    const f = fixture(2, 1);
    f.visibility('hidden');
    await expect(
      experimental(f.env, async () => {
        throw new Error('storage unavailable');
      }),
    ).rejects.toThrow('Speicherung fehlgeschlagen');
    expect(f.env.advance).not.toHaveBeenCalled();
    expect(f.env.wait).not.toHaveBeenCalled();
  });

  it('interrupts hidden scanning on navigation and persists the partial scan', async () => {
    const f = fixture(2, 1);
    f.visibility('hidden');
    f.env.advance = () => {
      f.env.url = () => 'https://www.youtube.com/';
    };
    const snapshots: Scan[] = [];
    const result = await experimental(f.env, async (s) => {
      snapshots.push(s);
    });
    expect(result).toMatchObject({
      status: 'interrupted',
      confirmedVideoIds: [id(1)],
      diagnostics: { reason: 'navigation' },
    });
    expect(snapshots.at(-1)).toEqual(result);
  });

  it('does not diagnose slow checkpoints as delayed timers', async () => {
    const f = fixture(1, 1);
    f.visibility('hidden');
    const result = await experimental(f.env, async () => {
      f.tick(5000);
    });
    expect(result.status).toBe('complete');
    expect(result.diagnostics?.timerThrottling).toMatchObject({
      lastElapsedMs: 1000,
      maxElapsedMs: 1000,
      delayedWaits: 0,
    });
  });

  it('charges hidden work against the active time budget', async () => {
    const f = fixture(2, 1);
    f.visibility('hidden');
    const result = await scanWatchLater(
      f.env,
      new AbortController().signal,
      async () => {},
      { ...options, baseActiveMs: 4000, perVideoMs: 0 },
    );
    expect(f.elapsed()).toBe(4000);
    expect(result).toMatchObject({
      status: 'incomplete',
      diagnostics: { reason: 'active_time_budget' },
    });
  });

  it.each([
    'unknown-count',
    'duplicate-position',
    'missing-position',
    'duplicate-id',
    'changed-position',
    'unknown-row',
    'continuation',
  ])('does not weaken completeness gates: %s', async (kind) => {
    const f = fixture(2, 2);
    f.visibility('hidden');
    const rows = f.env.doc.querySelectorAll('ytd-playlist-video-renderer');
    if (kind === 'unknown-count') f.env.doc.querySelector('#stats')!.remove();
    if (kind === 'duplicate-position')
      rows[1].querySelector('[id="index"]')!.textContent = '1';
    if (kind === 'missing-position')
      rows[1].querySelector('[id="index"]')!.remove();
    if (kind === 'duplicate-id')
      rows[1].querySelector('a')!.setAttribute('href', `/watch?v=${id(1)}`);
    if (kind === 'changed-position')
      f.env.advance = () => {
        rows[0].querySelector('[id="index"]')!.textContent = '2';
        rows[1].querySelector('[id="index"]')!.textContent = '1';
      };
    if (kind === 'unknown-row')
      f.env.doc
        .querySelector('#contents')!
        .insertAdjacentHTML(
          'beforeend',
          '<ytd-playlist-video-renderer></ytd-playlist-video-renderer>',
        );
    if (kind === 'continuation') f.render(1, 2, true);
    const result = await experimental(f.env);
    expect(result.status).toBe('incomplete');
    expect(result.diagnostics?.reason).toBe('recovery_exhausted');
  });

  it.each([false, true])(
    'preserves resume evidence rules (reload=%s)',
    async (reload) => {
      const f = fixture(2, 1);
      f.visibility('hidden');
      const control = new AbortController();
      f.env.advance = () => {
        control.abort();
      };
      const snapshots: Scan[] = [];
      const resume = await scanWatchLater(
        f.env,
        control.signal,
        async (s) => {
          snapshots.push(s);
        },
        options,
      );
      expect(resume.status).toBe('interrupted');
      expect(snapshots[0].confirmedVideoIds).toEqual([id(1)]);
      expect(snapshots.at(-1)).toEqual(resume);
      if (reload) f.env.documentId = 'reloaded-document';
      const reset = vi.fn();
      f.env.resetScroll = reset;
      f.render(2, 1, false);
      f.env.advance = vi.fn();
      const result = await scanWatchLater(
        f.env,
        new AbortController().signal,
        async () => {},
        options,
        resume,
      );
      expect(reset).toHaveBeenCalledTimes(reload ? 1 : 0);
      expect(result.id).toBe(resume.id);
      expect(result.startedAt).toBe(resume.startedAt);
      expect(result.videos).toHaveLength(2);
      expect(result.status).toBe(reload ? 'incomplete' : 'complete');
      expect(result.diagnostics?.confirmedCount).toBe(reload ? 1 : 2);
    },
  );

  it('does not inherit experimental opt-in from a checkpoint', async () => {
    const f = fixture(2, 1);
    f.visibility('hidden');
    const control = new AbortController();
    f.env.advance = () => {
      control.abort();
    };
    const resume = await scanWatchLater(
      f.env,
      control.signal,
      async () => {},
      options,
    );
    f.env.advance = vi.fn();
    const result = await createYouTubeAdapter(f.env).scanWatchLater(
      new AbortController().signal,
      async () => {},
      resume,
    );
    expect(f.env.advance).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'incomplete',
      diagnostics: {
        backgroundMode: 'paused',
        reason: 'attention_timeout',
        activeMs: 0,
      },
    });
  });
});

describe('resume evidence and position integrity', () => {
  it.each(['generation-2', undefined])(
    'interrupts navigation when the document generation changes during scanning (%s)',
    async (nextGeneration) => {
      const f = fixture(2, 1);
      const wait = vi.fn(async (ms: number) => {
        f.tick(ms);
        f.env.documentId = nextGeneration;
        f.render(2, 1, false);
      });
      f.env.wait = wait;
      const snapshots: Scan[] = [];
      const result = await run(f.env, async (s) => {
        snapshots.push(s);
      });
      expect(f.env.url()).toBe('https://www.youtube.com/playlist?list=WL');
      expect(result).toMatchObject({
        status: 'interrupted',
        confirmedVideoIds: [id(1)],
        diagnostics: {
          reason: 'navigation',
          documentId: 'document-1',
          confirmedCount: 1,
        },
      });
      expect(result.videos.map((v) => v.id)).toEqual([id(1)]);
      expect(result.finishedAt).toBe(new Date(epoch + 1000).toISOString());
      expect(wait).toHaveBeenCalledTimes(1);
      expect(snapshots.map((s) => s.status)).toEqual([
        'running',
        'interrupted',
      ]);
    },
  );

  it('revalidates positions when generation changes between resumes even if the Document object and playlist URL are unchanged', async () => {
    const f = fixture(3, 2);
    const control = new AbortController();
    f.env.advance = () => control.abort();
    const original = await scanWatchLater(
      f.env,
      control.signal,
      async () => {},
    );
    expect(original).toMatchObject({
      status: 'interrupted',
      confirmedVideoIds: [id(1), id(2)],
    });
    f.env.documentId = 'generation-2';
    f.render(3, 1, false);
    f.env.advance = vi.fn();
    const reset = vi.fn();
    f.env.resetScroll = reset;
    const snapshots: Scan[] = [];
    const resumed = await scanWatchLater(
      f.env,
      new AbortController().signal,
      async (s) => {
        snapshots.push(s);
      },
      {},
      structuredClone(original),
    );
    expect(reset).toHaveBeenCalledTimes(1);
    expect(resumed).toMatchObject({
      id: original.id,
      status: 'incomplete',
      confirmedVideoIds: [id(3)],
      diagnostics: {
        reason: 'recovery_exhausted',
        documentId: 'generation-2',
        confirmedCount: 1,
        missingPositions: [1, 2],
      },
    });
    expect(resumed.videos).toHaveLength(3);
    expect(
      snapshots.every(
        (s) => s.status !== 'complete' && s.diagnostics?.confirmedCount === 1,
      ),
    ).toBe(true);

    f.render(1, 2, true);
    f.env.advance = () => f.render(3, 1, false);
    const revalidated = await scanWatchLater(
      f.env,
      new AbortController().signal,
      async () => {},
      {},
      resumed,
    );
    expect(reset).toHaveBeenCalledTimes(1);
    expect(revalidated).toMatchObject({
      status: 'complete',
      diagnostics: {
        confirmedCount: 3,
        missingPositions: [],
        documentId: 'generation-2',
      },
    });
    expect(new Set(revalidated.confirmedVideoIds)).toEqual(
      new Set([id(1), id(2), id(3)]),
    );
  });
  it('does not promote retained reload IDs to evidence on either of two same-document resumes', async () => {
    const original = fixture(3, 2);
    const pause = new AbortController();
    original.env.advance = () => pause.abort();
    const beforeReload = await scanWatchLater(
      original.env,
      pause.signal,
      async () => {},
    );
    expect(beforeReload.confirmedVideoIds).toEqual([id(1), id(2)]);

    const reloaded = fixture(3, 0);
    reloaded.env.documentId = 'reloaded';
    reloaded.render(3, 1, false);
    const pauseReload = new AbortController();
    reloaded.env.advance = () => pauseReload.abort();
    let resume = await scanWatchLater(
      reloaded.env,
      pauseReload.signal,
      async () => {},
      {},
      beforeReload,
    );
    expect(resume.videos).toHaveLength(3);
    expect(resume.confirmedVideoIds).toEqual([id(3)]);
    reloaded.env.advance = vi.fn();

    for (let attempt = 0; attempt < 2; attempt++) {
      const snapshots: Scan[] = [];
      resume = await scanWatchLater(
        reloaded.env,
        new AbortController().signal,
        async (s) => {
          snapshots.push(s);
        },
        {},
        structuredClone(resume),
      );
      expect(resume.status).toBe('incomplete');
      expect(resume.diagnostics).toMatchObject({
        reason: 'recovery_exhausted',
        confirmedCount: 1,
        missingPositions: [1, 2],
      });
      expect(resume.videos).toHaveLength(3);
      expect(resume.confirmedVideoIds).toEqual([id(3)]);
      expect(
        snapshots.every(
          (s) => s.status !== 'complete' && s.diagnostics?.confirmedCount === 1,
        ),
      ).toBe(true);
    }
  });

  it.each(['fresh', 'reload', 'same-document'] as const)(
    'resets scrolling before scanning only for fresh/reloaded documents (%s)',
    async (mode) => {
      const original = fixture(2, 1);
      const control = new AbortController();
      original.env.advance = () => control.abort();
      const resume = await scanWatchLater(
        original.env,
        control.signal,
        async () => {},
      );
      const current = mode === 'same-document' ? original : fixture(2, 1);
      if (mode === 'reload') current.env.documentId = 'reloaded';
      current.env.advance = vi.fn();
      const reset = vi.fn();
      current.env.resetScroll = reset;
      const expectedCalls = mode === 'same-document' ? 0 : 1;
      const result = await scanWatchLater(
        current.env,
        new AbortController().signal,
        async () => {
          expect(reset).toHaveBeenCalledTimes(expectedCalls);
        },
        {},
        mode === 'fresh' ? undefined : resume,
      );
      expect(result.status).toBe('incomplete');
      expect(reset).toHaveBeenCalledTimes(expectedCalls);
    },
  );
  it('resumes 2,500 IDs in the same document without rescanning previous virtualized rows', async () => {
    const f = await paused2500();
    f.render(2501, 1, false);
    f.env.advance = vi.fn();
    const result = await scanWatchLater(
      f.env,
      new AbortController().signal,
      async () => {},
      {},
      f.resume,
    );
    expect(result).toMatchObject({
      id: f.resume.id,
      startedAt: f.resume.startedAt,
      status: 'complete',
      diagnostics: {
        confirmedCount: 2501,
        missingPositions: [],
        documentId: 'document-1',
      },
    });
    expect(result.videos).toHaveLength(2501);
    expect(f.resume.videos).toHaveLength(2500);
  }, 20000);

  it.each(['document-2', undefined])(
    'retains 2,500 reload IDs but cannot certify stale positions (documentId=%s)',
    async (documentId) => {
      const { resume } = await paused2500();
      const f = fixture(2501, 0);
      f.env.documentId = documentId;
      f.render(2501, 1, false);
      const result = await scanWatchLater(
        f.env,
        new AbortController().signal,
        async () => {},
        {},
        resume,
      );
      expect(result.status).toBe('incomplete');
      expect(result.videos).toHaveLength(2501);
      expect(result.diagnostics).toMatchObject({
        confirmedCount: 1,
        reason: 'recovery_exhausted',
        highestPosition: 2501,
        missingPositions: Array.from({ length: 100 }, (_, i) => i + 1),
      });
    },
    20000,
  );

  it('revalidates all positions after reload and only then completes', async () => {
    const { resume } = await paused2500();
    const f = fixture(2501, 500);
    f.env.documentId = 'reloaded-document';
    let end = 500;
    f.env.advance = () => {
      if (end < 2501) {
        const count = Math.min(500, 2501 - end);
        f.render(end + 1, count);
        end += count;
      }
    };
    const confirmations: number[] = [];
    const result = await scanWatchLater(
      f.env,
      new AbortController().signal,
      async (s) => {
        confirmations.push(s.diagnostics!.confirmedCount!);
      },
      {},
      resume,
    );
    expect(confirmations[0]).toBe(500);
    expect(result.status).toBe('complete');
    expect(result.diagnostics?.confirmedCount).toBe(2501);
    expect(result.videos).toHaveLength(2501);
  }, 20000);

  it.each([
    'duplicate-position',
    'missing-position',
    'duplicate-id',
    'changed-position',
  ])('never certifies %s despite matching DOM row count', async (kind) => {
    const f = fixture(2, 2);
    const rows = f.env.doc.querySelectorAll('ytd-playlist-video-renderer');
    if (kind === 'duplicate-position')
      rows[1].querySelector('[id="index"]')!.textContent = '1';
    if (kind === 'missing-position')
      rows[1].querySelector('[id="index"]')!.remove();
    if (kind === 'duplicate-id')
      rows[1].querySelector('a')!.setAttribute('href', `/watch?v=${id(1)}`);
    if (kind === 'changed-position')
      f.env.advance = () => {
        rows[0].querySelector('[id="index"]')!.textContent = '2';
        rows[1].querySelector('[id="index"]')!.textContent = '1';
      };
    const result = await run(f.env);
    expect(result.status).toBe('incomplete');
    expect(result.diagnostics?.reason).toBe('recovery_exhausted');
    if (kind === 'changed-position' || kind === 'duplicate-id')
      expect(result.diagnostics?.positionConflict).toBe(true);
    else expect(result.diagnostics?.missingPositions).toContain(2);
  });
});

describe('opt-in fast end jumps with the real scroll adapter', () => {
  const options = { background: 'experimental', mode: 'fast-jump' } as const;
  function growing(total = 300) {
    const f = fixture(total, 100);
    f.visibility('hidden');
    Object.defineProperty(f.env.doc, 'defaultView', { value: window });
    const container = f.env.doc.createElement('section');
    container.style.overflowY = 'auto';
    f.env.doc.body.append(container);
    container.append(
      f.env.doc.querySelector('ytd-playlist-video-list-renderer')!,
    );
    let end = 100;
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
      averageProgressIntervalMs: 1000,
      jumpToNewIdsMs: 2000,
      jumpToNewIdsSamples: 2,
      fallbackCount: 0,
      domBehavior: 'growing',
      minRenderedPosition: 1,
      maxRenderedPosition: 300,
      uniqueRenderedIds: 300,
      milestones: [
        { confirmedCount: 100, elapsedMs: 0 },
        { confirmedCount: 200, elapsedMs: 1000 },
        { confirmedCount: 300, elapsedMs: 2000 },
      ],
    });
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
            : 'position-gap-or-conflict',
        ],
      });
      expect(saved.every((s) => s.status !== 'complete')).toBe(true);
    },
  );
  it('bounds unchanged height and continuation without repeated end jumps or false completion', async () => {
    const f = growing();
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
    const f = growing();
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
      60000,
    );
    expect(result.diagnostics?.timerThrottling?.delayedWaits).toBe(3);
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
    const f = growing(100);
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
