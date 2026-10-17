import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  classify,
  duration,
  expectedCount,
  parseRow,
  ROW,
} from '../src/adapter/dom';
import { scanWatchLater, type ScanEnvironment } from '../src/adapter/scanner';
const fixture = readFileSync('tests/fixtures/playlist.html', 'utf8');
function environment(html = fixture) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const env: ScanEnvironment = {
    doc,
    url: () => 'https://www.youtube.com/playlist?list=WL',
    advance: () => {},
    wait: async () => {},
  };
  return env;
}
const options = { intervalMs: 0, maxRounds: 10, idleRounds: 2 };
const scan = (env: ScanEnvironment, signal = new AbortController().signal) =>
  scanWatchLater(env, signal, async () => {}, options);
describe('Read-only import', () => {
  it('parses synthetic DOM-shaped fixture without invented metadata', async () => {
    const result = await scan(environment());
    expect(result.status).toBe('complete');
    expect(result.videos).toHaveLength(2);
    expect(result.videos[0]).toMatchObject({
      id: 'aaaaaaaaaaa',
      channel: 'Atlas',
      durationSeconds: 754,
      publishedAt: null,
      availability: 'unknown',
    });
  });
  it('recognizes explicit empty list', async () => {
    expect(
      (
        await scan(
          environment(
            '<ytd-message-renderer>This playlist has no videos.</ytd-message-renderer>',
          ),
        )
      ).status,
    ).toBe('complete');
  });
  it('handles a single entry', async () => {
    const env = environment();
    env.doc.querySelectorAll(ROW)[1].remove();
    env.doc.querySelector('#stats')!.textContent = '1 video';
    expect((await scan(env)).status).toBe('complete');
  });
  it('accumulates 5,000 virtualized lazy-loaded entries and deduplicates IDs', async () => {
    const env = environment(
      '<ytd-playlist-header-renderer><div id="stats">5,000 videos</div></ytd-playlist-header-renderer><ytd-playlist-video-list-renderer></ytd-playlist-video-list-renderer>',
    );
    let page = 0;
    const render = () => {
      const start = page * 1000;
      env.doc.querySelector('ytd-playlist-video-list-renderer')!.innerHTML =
        Array.from(
          { length: 1000 },
          (_, i) =>
            `<ytd-playlist-video-renderer><span id="index">${start + i + 1}</span><a id="video-title" href="/watch?v=${String(start + i).padStart(11, '0')}">Video</a></ytd-playlist-video-renderer>`,
        ).join('') +
        (page < 4
          ? '<ytd-continuation-item-renderer></ytd-continuation-item-renderer>'
          : '');
    };
    render();
    env.advance = () => {
      if (page < 4) {
        page++;
        render();
      }
    };
    const result = await scan(env);
    expect(result.status).toBe('complete');
    expect(result.videos).toHaveLength(5000);
  }, 20000);
  it('does not certify truncated or hidden videos', async () => {
    const env = environment();
    env.doc.querySelector('#stats')!.textContent = '3 Videos';
    expect((await scan(env)).status).toBe('incomplete');
  });
  it('does not certify unknown count, missing positions or persistent continuation', async () => {
    const env = environment();
    env.doc.querySelector('#stats')!.remove();
    expect((await scan(env)).status).toBe('incomplete');
    const missing = environment();
    missing.doc.querySelector('#index')!.remove();
    expect((await scan(missing)).status).toBe('incomplete');
    const continuation = environment();
    continuation.doc
      .querySelector('ytd-playlist-video-list-renderer')!
      .insertAdjacentHTML('beforeend', '<ytd-continuation-item-renderer/>');
    expect((await scan(continuation)).status).toBe('incomplete');
  });
  it('does not turn duplicates into completeness', async () => {
    const env = environment();
    env.doc
      .querySelector('ytd-playlist-video-list-renderer')!
      .append(env.doc.querySelector(ROW)!.cloneNode(true));
    expect((await scan(env)).videos).toHaveLength(2);
  });
  it('saves accumulated videos on interruption', async () => {
    const env = environment();
    const control = new AbortController();
    env.advance = () => control.abort();
    const result = await scan(env, control.signal);
    expect(result.status).toBe('interrupted');
    expect(result.videos).toHaveLength(2);
  });
  it('rejects changed DOM and navigation', async () => {
    expect((await scan(environment('<main>New DOM</main>'))).status).toBe(
      'failed',
    );
    const env = environment();
    env.url = () => 'https://www.youtube.com/watch?v=aaaaaaaaaaa';
    expect((await scan(env)).status).toBe('failed');
  });
  it('reports a local checkpoint failure without reporting success', async () => {
    await expect(
      scanWatchLater(
        environment(),
        new AbortController().signal,
        async () => {
          throw new Error('disk full');
        },
        options,
      ),
    ).rejects.toThrow('disk full');
  });
});
describe('metadata and availability', () => {
  it.each([
    ['[Deleted video]', null, false, 'removed'],
    ['[Private video]', null, false, 'private'],
    ['Tutorial (unlisted)', null, true, 'available'],
    ['Tutorial', null, false, 'unknown'],
    ['Tutorial', 'Try again later', false, 'unknown'],
    ['Tutorial', 'Not available in your country', false, 'restricted'],
    ['[Video unavailable]', null, false, 'unknown'],
  ])('%s / %s', (title, detail, playable, status) => {
    expect(
      classify(title as string, detail as string | null, playable as boolean)
        .availability,
    ).toBe(status);
  });
  it('parses only supported duration values and exact video IDs', () => {
    expect(duration('1:02:03')).toBe(3723);
    expect(duration('LIVE')).toBeNull();
    const env = environment();
    env.doc.querySelector('a')!.setAttribute('href', '/watch?v=bad');
    expect(parseRow(env.doc.querySelector(ROW)!)).toBeNull();
  });
  it('rejects malformed or external links and contradictory unavailable titles', () => {
    const env = environment();
    const row = env.doc.querySelector(ROW)!;
    row.querySelector('a')!.setAttribute('href', 'http://[invalid');
    expect(parseRow(row)).toBeNull();
    row
      .querySelector('a')!
      .setAttribute('href', 'https://external.test/watch?v=aaaaaaaaaaa');
    expect(parseRow(row)).toBeNull();
    row.querySelector('a')!.setAttribute('href', '/watch?v=aaaaaaaaaaa');
    row.querySelector('a')!.setAttribute('title', '[Private video]');
    expect(parseRow(row)?.availability).toBe('unknown');
    expect(duration('1:99')).toBeNull();
  });
  it('reads a count in a header with adjacent metadata nodes', () => {
    const env = environment();
    env.doc.querySelector('#stats')!.innerHTML =
      '<yt-formatted-string>2 Videos</yt-formatted-string><yt-formatted-string>Keine Aufrufe</yt-formatted-string>';
    expect(expectedCount(env.doc)).toBe(2);
  });
  it('accepts German and English counts, rejects compact counts', () => {
    const env = environment();
    for (const label of ['5.000 Videos', '5,000 videos', '5\u202f000 Videos']) {
      env.doc.querySelector('#stats')!.textContent = label;
      expect(expectedCount(env.doc)).toBe(5000);
    }
    env.doc.querySelector('#stats')!.textContent = '5K videos';
    expect(expectedCount(env.doc)).toBeNull();
  });
});
