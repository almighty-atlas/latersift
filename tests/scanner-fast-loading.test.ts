import { describe, expect, it, vi } from 'vitest';
import { scanWatchLater } from '../src/adapter/scanner';
import type { Scan } from '../src/model';
import { growing } from './fixtures/scanner';

describe('fast import loading budgets with real scroll geometry', () => {
  const options = { background: 'experimental', mode: 'fast-jump' } as const;

  it.each([4000, 12000, 29000])(
    'waits for first rows at %i ms, then stabilizes and jumps immediately after ACK',
    async (readyAt) => {
      const f = growing();
      f.render(1, 0, true);
      const wait = f.env.wait;
      const jump = f.env.jumpToEnd!;
      let firstJumpAt: number | undefined;
      let saved: Scan | undefined;
      f.env.jumpToEnd = vi.fn(() => {
        firstJumpAt ??= f.elapsed();
        expect(saved?.diagnostics?.performance?.initializationState).toBe(
          'ready',
        );
        expect(saved?.confirmedVideoIds).toHaveLength(
          f.env.doc.querySelectorAll('ytd-playlist-video-renderer').length,
        );
        const action = jump();
        expect(action).toMatchObject({ outcome: 'target-observed' });
        return action;
      });
      f.env.wait = async (ms, signal) => {
        if (f.elapsed() < readyAt) {
          f.tick(ms);
          expect(f.env.advance).not.toHaveBeenCalled();
          expect(f.env.jumpToEnd).not.toHaveBeenCalled();
          if (f.elapsed() >= readyAt) f.render(1, 100, true);
        } else await wait(ms, signal);
      };
      const result = await scanWatchLater(
        f.env,
        new AbortController().signal,
        async (s) => {
          saved = s;
        },
        options,
      );
      expect(result.status).toBe('complete');
      expect(firstJumpAt).toBe(readyAt + 1000);
      expect(result.diagnostics?.performance).toMatchObject({
        initializationState: 'ready',
        initializationElapsedMs: readyAt + 1000,
        endJumps: 3,
        fallbackCount: 0,
      });
      expect(f.boundaries).toEqual([100, 200]);
      expect(f.env.advance).not.toHaveBeenCalled();
    },
  );

  it('grants stabilization its own budget after a late first identifiable row', async () => {
    const f = growing(10, 10);
    f.render(1, 0, true);
    f.env.wait = async (ms) => {
      f.tick(ms);
      if (f.elapsed() === 29000) {
        f.render(1, 10, false);
        f.env.doc.querySelectorAll('[id="index"]').forEach((n) => {
          n.textContent = '';
        });
      }
      if (f.elapsed() === 33000) f.render(1, 10, false);
    };
    const result = await scanWatchLater(
      f.env,
      new AbortController().signal,
      async () => {},
      options,
    );
    expect(result.status).toBe('complete');
    expect(result.diagnostics?.performance).toMatchObject({
      initializationState: 'ready',
      initializationElapsedMs: 34000,
      fallbackCount: 0,
    });
  });

  it.each([15000, 20000, 29000])(
    'accepts new IDs %i ms after each jump without recovery or catch-up scrolling',
    async (loadMs) => {
      const f = growing();
      const wait = f.env.wait;
      const jump = f.env.jumpToEnd!;
      let jumpedAt = Infinity;
      f.env.jumpToEnd = vi.fn(() => {
        jumpedAt = f.elapsed();
        return jump();
      });
      f.env.wait = async (ms, signal) => {
        if (f.elapsed() + ms - jumpedAt < loadMs) f.tick(ms);
        else await wait(ms, signal);
      };
      const result = await scanWatchLater(
        f.env,
        new AbortController().signal,
        async () => {},
        options,
      );
      expect(result.status).toBe('complete');
      expect(f.boundaries).toEqual([100, 200]);
      expect(f.env.advance).not.toHaveBeenCalled();
      expect(result.diagnostics?.performance).toMatchObject({
        mode: 'fast-jump',
        endJumps: 3,
        loadEvents: 2,
        fallbackCount: 0,
        jumpToNewIdsMs: 2 * loadMs,
        jumpToNewIdsSamples: 2,
      });
    },
  );

  it.each(['empty', 'unidentifiable'])(
    'bounds persistently %s initial DOM at 30 s',
    async (kind) => {
      const f = growing(10, 10);
      f.render(1, 0, true);
      if (kind === 'unidentifiable')
        f.env.doc
          .querySelector('#contents')!
          .insertAdjacentHTML(
            'afterbegin',
            '<ytd-playlist-video-renderer></ytd-playlist-video-renderer>',
          );
      const result = await scanWatchLater(
        f.env,
        new AbortController().signal,
        async () => {},
        options,
      );
      expect(result.status).toBe(kind === 'empty' ? 'failed' : 'incomplete');
      expect(result.diagnostics?.performance).toMatchObject({
        initializationState: 'fallback',
        endJumps: 0,
        fallbackSnapshots: [
          {
            elapsedMs: 30000,
            phase: 'initializing',
            reason: kind === 'empty' ? 'no-rows' : 'unidentifiable-rows',
          },
        ],
      });
    },
  );

  it.each([1000, 17000])(
    'bounds missing loads with %i ms timer ticks and no early recovery',
    async (tickMs) => {
      const f = growing(30, 10);
      f.stopLoading();
      const wait = f.env.wait;
      const jump = f.env.jumpToEnd!;
      let jumpedAt = 0;
      f.env.jumpToEnd = vi.fn(() => {
        jumpedAt = f.elapsed();
        return jump();
      });
      f.env.wait = (ms, signal) => wait(Math.max(ms, tickMs), signal);
      const saved: Scan[] = [];
      const result = await scanWatchLater(
        f.env,
        new AbortController().signal,
        async (s) => {
          saved.push(s);
          if (s.diagnostics?.performance?.mode === 'fast-jump') {
            expect(f.env.advance).not.toHaveBeenCalled();
            expect(s.diagnostics.scrollTrace?.totalRecoveryAttempts).toBe(0);
          }
        },
        options,
      );
      expect(result.status).toBe('incomplete');
      expect(f.env.jumpToEnd).toHaveBeenCalledOnce();
      const snapshot = result.diagnostics!.performance!.fallbackSnapshots![0];
      expect(snapshot.reason).toBe('bounded-stall');
      expect(snapshot.elapsedMs - jumpedAt).toBe(
        Math.ceil(30000 / tickMs) * tickMs,
      );
      expect(saved.some((s) => s.status === 'complete')).toBe(false);
      expect(f.elapsed()).toBeLessThan(200000);
      if (tickMs > 1000)
        expect(
          result.diagnostics?.timerThrottling?.delayedWaits,
        ).toBeGreaterThan(0);
    },
  );

  it('pauses while waiting for first rows and resumes with fresh evidence and ACK', async () => {
    const f = growing(10, 10);
    f.render(1, 0, true);
    const control = new AbortController();
    f.env.wait = async (ms) => {
      f.tick(ms);
      if (f.elapsed() === 10000) control.abort();
    };
    const paused = await scanWatchLater(
      f.env,
      control.signal,
      async () => {},
      options,
    );
    expect(paused.status).toBe('interrupted');
    expect(paused.diagnostics?.performance?.fallbackCount).toBe(0);
    expect(f.env.jumpToEnd).not.toHaveBeenCalled();
    f.render(1, 10, false);
    const result = await scanWatchLater(
      f.env,
      new AbortController().signal,
      async () => {},
      options,
      paused,
    );
    expect(result.status).toBe('complete');
    expect(result.id).toBe(paused.id);
    expect(result.diagnostics?.performance).toMatchObject({
      initializationState: 'ready',
      initializationElapsedMs: 1000,
      endJumps: 1,
    });
  });
});
