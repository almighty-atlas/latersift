import { vi } from 'vitest';
import {
  scanWatchLater,
  type ScanEnvironment,
} from '../../src/adapter/scanner';
import type { Scan } from '../../src/model';
import { createPlaylistScroller } from '../../src/adapter/scroll';

export const epoch = Date.UTC(2026, 0, 1);
export const id = (position: number) => String(position).padStart(11, '0');
export function row(position: number, videoId = id(position)) {
  return `<ytd-playlist-video-renderer><div id="index">${position}</div><a id="video-title" href="/watch?v=${videoId}&list=WL&index=${position}" title="Video ${position}">Video ${position}</a><ytd-channel-name><a>Test channel</a></ytd-channel-name><ytd-thumbnail-overlay-time-status-renderer><span id="text">12:34</span></ytd-thumbnail-overlay-time-status-renderer></ytd-playlist-video-renderer>`;
}
export function fixture(total: number, initial = Math.min(total, 100)) {
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
export const run = (
  env: ScanEnvironment,
  checkpoint: (scan: Scan) => Promise<void> = async () => {},
) => scanWatchLater(env, new AbortController().signal, checkpoint);

export function growing(total = 300, initial = 100) {
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
