import type { Runtime, Tabs } from 'webextension-polyfill';
import type { Scan } from './model';
export async function youtubeTabs(): Promise<Tabs.Tab[]> {
  const { default: browser } = await import('webextension-polyfill');
  return browser.tabs.query({
    url: 'https://www.youtube.com/playlist?list=WL*',
  });
}
export async function openWatchLater() {
  const { default: browser } = await import('webextension-polyfill');
  await browser.tabs.create({
    url: 'https://www.youtube.com/playlist?list=WL',
  });
}
export async function connectScan(
  tabId: number,
  onCheckpoint: (scan: Scan) => Promise<void>,
  onFinish: (error?: string) => void,
): Promise<Runtime.Port> {
  const { default: browser } = await import('webextension-polyfill');
  const port = browser.tabs.connect(tabId, { name: 'latersift-readonly-v1' });
  let finished = false;
  let tasks = Promise.resolve();
  port.onMessage.addListener((message: unknown) => {
    if (!message || typeof message !== 'object' || !('type' in message)) return;
    if (message.type === 'checkpoint' && 'scan' in message && 'id' in message) {
      // Serialized, even if a future adapter emits faster than storage can commit.
      tasks = tasks
        .then(async () => {
          await onCheckpoint(message.scan as Scan);
          port.postMessage({ ack: message.id });
        })
        .catch((error) => {
          finished = true;
          port.disconnect();
          onFinish(`Speicherung fehlgeschlagen: ${String(error)}`);
        });
    }
    if (message.type === 'done' || message.type === 'error') {
      tasks.then(() => {
        if (!finished) {
          finished = true;
          port.disconnect();
          onFinish('message' in message ? String(message.message) : undefined);
        }
      });
    }
  });
  port.onDisconnect.addListener(() => {
    if (!finished) {
      finished = true;
      void tasks.then(() =>
        onFinish(
          'Verbindung getrennt. Letzter bestätigter Teilbestand ist gesichert.',
        ),
      );
    }
  });
  port.postMessage({ type: 'scan' });
  return port;
}
