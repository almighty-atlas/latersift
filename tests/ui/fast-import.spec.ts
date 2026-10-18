import { test, expect } from '@playwright/test';
import { build } from 'esbuild';

// Exercise real browser geometry and native scroll notifications against a
// synthetic list. No YouTube account, API, playback, or write action is involved.
const bundle = await build({
  stdin: {
    contents: `import { scanWatchLater } from './src/adapter/scanner';
      import { createPlaylistScroller } from './src/adapter/scroll';
      window.fastImportFixture = { scanWatchLater, createPlaylistScroller };`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
});
for (const virtualized of [false, true]) {
  for (const hydration of ['stable', 'positions', 'placeholders']) {
    test(`fast import uses real end geometry and safe fallback (virtualized=${virtualized}, hydration=${hydration})`, async ({
      page,
    }) => {
      await page.goto('/');
      await page.setContent(`<style>section { height: 300px; overflow-y: auto; }
      ytd-playlist-video-renderer { display: block; height: 40px; }</style>
      <ytd-playlist-header-renderer><div id="stats">300 videos</div></ytd-playlist-header-renderer>
      <section><ytd-playlist-video-list-renderer><div id="contents"></div></ytd-playlist-video-list-renderer></section>`);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const result = await page.evaluate(
        async ({ virtualized, hydration }) => {
          const { scanWatchLater, createPlaylistScroller } = Reflect.get(
            window,
            'fastImportFixture',
          );
          const container = document.querySelector('section')!;
          let count = 100;
          let hydrating = hydration !== 'stable';
          let advances = 0;
          let removed = false;
          const boundaries: number[] = [];
          const render = (start = 1) => {
            document.querySelector('#contents')!.innerHTML =
              Array.from({ length: count - start + 1 }, (_, i) => {
                const n = start + i;
                return `<ytd-playlist-video-renderer><span id="index">${hydrating && hydration === 'positions' ? '' : n}</span><a id="video-title" href="/watch?v=${String(n).padStart(11, '0')}">Fixture</a></ytd-playlist-video-renderer>`;
              }).join('') +
              (hydrating && hydration === 'placeholders'
                ? '<ytd-playlist-video-renderer></ytd-playlist-video-renderer>'
                : '') +
              (count < 300
                ? '<ytd-continuation-item-renderer></ytd-continuation-item-renderer>'
                : '');
          };
          render();
          container.addEventListener('scroll', () => {
            if (removed && container.scrollTop === 0) {
              removed = false;
              render();
            }
            if (
              count < 300 &&
              container.scrollTop >=
                container.scrollHeight - container.clientHeight - 2
            ) {
              boundaries.push(count);
              count += 100;
              removed = virtualized && count === 200;
              render(removed ? 101 : 1);
            }
          });
          const scroller = createPlaylistScroller(document);
          const snapshots: { confirmedCount: number; status: string }[] = [];
          const scan = await scanWatchLater(
            {
              doc: document,
              documentId: 'browser-fixture',
              url: () => 'https://www.youtube.com/playlist?list=WL',
              advance: (recovery?: boolean) => {
                advances++;
                return scroller.observedAdvance(recovery);
              },
              jumpToEnd: scroller.observedEndJump,
              resetScroll: scroller.observedReset,
              scrollInfo: scroller.observedInfo,
              wait: async (ms: number) => {
                await new Promise((resolve) => setTimeout(resolve, ms));
                if (hydrating) {
                  hydrating = false;
                  render();
                }
              },
            },
            new AbortController().signal,
            async (s: { confirmedVideoIds: string[]; status: string }) => {
              snapshots.push({
                confirmedCount: s.confirmedVideoIds.length,
                status: s.status,
              });
            },
            {
              mode: 'fast-jump',
              background: 'experimental',
              intervalMs: 50,
              settleMs: 150,
              waitingMs: 2000,
            },
          );
          return {
            status: scan.status,
            count: scan.confirmedVideoIds.length,
            performance: scan.diagnostics.performance,
            boundaries,
            snapshots,
            advances,
            unknownRows: scan.unidentifiableRows,
          };
        },
        { virtualized, hydration },
      );
      expect(result.status).toBe('complete');
      expect(result.count).toBe(300);
      expect(result.boundaries).toEqual([100, 200]);
      expect(result.performance.fallbackCount).toBe(virtualized ? 1 : 0);
      if (virtualized) {
        expect(result.performance.fallbackReasons).toEqual([
          'virtualization-or-removed-rows',
        ]);
        expect(
          result.snapshots.some(
            (s) => s.confirmedCount === 0 && s.status !== 'complete',
          ),
        ).toBe(true);
      } else {
        expect(result.advances).toBe(0);
        expect(result.unknownRows).toBe(0);
        expect(result.performance.initializationState).toBe('ready');
        expect(result.performance.initializationObservations).toBe(
          hydration === 'stable' ? 2 : 3,
        );
        expect(result.performance.mode).toBe('fast-jump');
        expect(result.performance.endJumps).toBe(3);
        expect(result.performance.loadEvents).toBe(2);
      }
    });
  }
}
