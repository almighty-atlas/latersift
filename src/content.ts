import browser from 'webextension-polyfill';
import { wait } from './adapter/scanner';
import { createYouTubeAdapter } from './adapter/youtube';
let active: AbortController | null = null;
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
    if (message.type !== 'scan' || active) {
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
      window.scrollTo(0, 0);
      await createYouTubeAdapter({
        doc: document,
        url: () => location.href,
        wait,
        advance: () => {
          const continuation = document.querySelector(
            'ytd-playlist-video-list-renderer ytd-continuation-item-renderer',
          );
          (
            continuation ??
            document.querySelector('ytd-playlist-video-list-renderer')
              ?.lastElementChild
          )?.scrollIntoView({ block: 'end' });
          window.scrollBy(0, Math.max(innerHeight, 600));
        },
      }).scanWatchLater(controller.signal, async (scan) => {
        // Backpressure: do not proceed until the extension page persisted the checkpoint.
        const id = crypto.randomUUID();
        const saved = new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            ack.delete(id);
            reject(
              new Error('Lokale Speicherung nicht bestätigt. Import gestoppt.'),
            );
          }, 15000);
          ack.set(id, () => {
            clearTimeout(timer);
            ack.delete(id);
            resolve();
          });
        });
        port.postMessage({ type: 'checkpoint', scan, id });
        await saved;
      });
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
