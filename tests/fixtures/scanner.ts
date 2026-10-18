import { vi } from 'vitest';
import {
  scanWatchLater,
  type ScanEnvironment,
} from '../../src/adapter/scanner';
import type { Scan } from '../../src/model';

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
