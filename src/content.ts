import browser from 'webextension-polyfill';
import { wait } from './adapter/scanner';
import { createYouTubeAdapter } from './adapter/youtube';
import { createPlaylistScroller } from './adapter/scroll';
import { scanPlaylists } from './adapter/playlists';
import type { Scan } from './model';
import { installWriteChannel } from './write-content';
let documentId = crypto.randomUUID();
// YouTube uses SPA navigation: the Document object alone is not a resume epoch.
const invalidateEvidence = () => {
  documentId = crypto.randomUUID();
};
window.addEventListener('yt-navigate-start', invalidateEvidence);
window.addEventListener('popstate', invalidateEvidence);
window.addEventListener('pagehide', invalidateEvidence);
let active: AbortController | null = null;
installWriteChannel(
  () => active !== null,
  (controller) => {
    active = controller;
  },
);
browser.runtime.onConnect.addListener((port) => {
  if (
    port.name !== 'latersift-readonly-v1' ||
    port.sender?.id !== browser.runtime.id
  )
    return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  port.onMessage.addListener(async (message: unknown) => {
    if (!message || typeof message !== 'object' || !('type' in message)) return;
    if (message.type === 'cancel') {
      controller.abort();
      return;
    }
    if (!['scan', 'playlists'].includes(String(message.type)) || active) {
      port.postMessage({
        type: 'error',
        message: 'In diesem Tab läuft bereits ein Import.',
      });
      return;
    }
    active = controller;
    const ack = new Map<string, () => void>();
    port.onMessage.addListener((msg: unknown) => {
      if (
        msg &&
        typeof msg === 'object' &&
        'ack' in msg &&
        typeof msg.ack === 'string'
      )
        ack.get(msg.ack)?.();
    });
    try {
      const scroller = createPlaylistScroller(document);
      const persist = async (scan: unknown) => {
        const id = crypto.randomUUID();
        const saved = new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timer);
            ack.delete(id);
            port.onDisconnect.removeListener(abort);
          };
          const abort = () => {
            cleanup();
            reject(
              new Error(
                'Speicherung unterbrochen; letzter bestätigter Checkpoint bleibt erhalten.',
              ),
            );
          };
          const timer = setTimeout(() => {
            cleanup();
            reject(
              new Error('Lokale Speicherung nicht bestätigt. Import gestoppt.'),
            );
          }, 15000);
          ack.set(id, () => {
            cleanup();
            resolve();
          });
          port.onDisconnect.addListener(abort);
        });
        port.postMessage({ type: 'checkpoint', scan, id });
        await saved;
      };
      if (message.type === 'playlists') {
        const feedScroller = createPlaylistScroller(
          document,
          'ytd-rich-grid-renderer, ytd-section-list-renderer',
        );
        await scanPlaylists(
          {
            doc: document,
            url: () => location.href,
            wait,
            advance: feedScroller.advance,
            scrollInfo: feedScroller.info,
          },
          controller.signal,
          persist,
        );
      } else
        await createYouTubeAdapter({
          doc: document,
          url: () => location.href,
          wait,
          get documentId() {
            return documentId;
          },
          advance: scroller.advance,
          scrollInfo: scroller.info,
          resetScroll: scroller.reset,
        }).scanWatchLater(
          controller.signal,
          persist,
          'resume' in message ? (message.resume as Scan) : undefined,
          'background' in message && message.background === 'experimental'
            ? { background: 'experimental' }
            : {},
        );
      port.postMessage({ type: 'done' });
    } catch (error) {
      try {
        port.postMessage({ type: 'error', message: String(error) });
      } catch {
        /* Disconnected: last acknowledged checkpoint remains. */
      }
    } finally {
      active = null;
    }
  });
});
