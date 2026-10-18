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
export async function activateYouTubeTab(tabId: number): Promise<void> {
  const { default: browser } = await import('webextension-polyfill');
  const tab = await browser.tabs.update(tabId, { active: true });
  if (tab.windowId === undefined)
    throw new Error('YouTube-Fenster nicht gefunden.');
  await browser.windows.update(tab.windowId, { focused: true });
}
export function connectScan(
  tabId: number,
  onCheckpoint: (scan: Scan) => Promise<void>,
  onFinish: (error?: string) => void,
  resume?: Scan,
  experimentalBackground = false,
): Promise<Runtime.Port> {
  return connectRead(tabId, onCheckpoint, onFinish, {
    type: 'scan',
    ...(resume ? { resume } : {}),
    ...(experimentalBackground ? { background: 'experimental' } : {}),
  });
}

export async function connectRead<T>(
  tabId: number,
  onCheckpoint: (value: T) => Promise<void>,
  onFinish: (error?: string) => void,
  request: {
    type: 'scan' | 'playlists';
    resume?: Scan;
    background?: 'experimental';
  },
): Promise<Runtime.Port> {
  const { default: browser } = await import('webextension-polyfill');
  const port = browser.tabs.connect(tabId, { name: 'latersift-readonly-v1' });
  let finished = false;
  let closing = false;
  let disconnected = false;
  let tasks = Promise.resolve();
  // This watchdog runs in the extension page, independently of content/scanner
  // timers. The ~60s bound only holds while the extension page itself can run;
  // already queued storage commits must still settle before the terminal callback.
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const resetWatchdog = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      closing = true;
      void tasks.then(() => {
        if (finished) return;
        finished = true;
        port.disconnect();
        onFinish(
          'Seit 60 Sekunden kein Checkpoint empfangen. Der YouTube-Tab ist möglicherweise inaktiv, suspendiert oder gedrosselt. Gesicherte Teilbestände bleiben erhalten; der Lesevorgang ist nicht abgeschlossen.',
        );
      });
    }, 60_000);
  };
  resetWatchdog();
  port.onMessage.addListener((message: unknown) => {
    if (
      closing ||
      finished ||
      !message ||
      typeof message !== 'object' ||
      !('type' in message)
    )
      return;
    if (message.type === 'checkpoint' && 'scan' in message && 'id' in message) {
      resetWatchdog();
      // Serialized, even if a future adapter emits faster than storage can commit.
      tasks = tasks
        .then(async () => {
          if (finished) return;
          await onCheckpoint(message.scan as T);
          if (!disconnected) port.postMessage({ ack: message.id });
        })
        .catch((error) => {
          if (finished) return;
          finished = true;
          clearTimeout(watchdog);
          port.disconnect();
          onFinish(`Speicherung fehlgeschlagen: ${String(error)}`);
        });
    }
    if (message.type === 'done' || message.type === 'error') {
      closing = true;
      clearTimeout(watchdog);
      void tasks.then(() => {
        if (!finished) {
          finished = true;
          port.disconnect();
          onFinish('message' in message ? String(message.message) : undefined);
        }
      });
    }
  });
  port.onDisconnect.addListener(() => {
    disconnected = true;
    clearTimeout(watchdog);
    if (!finished && !closing) {
      closing = true;
      void tasks.then(() => {
        if (finished) return;
        finished = true;
        onFinish(
          'Verbindung getrennt. Letzter bestätigter Teilbestand ist gesichert.',
        );
      });
    }
  });
  try {
    port.postMessage(request);
  } catch (error) {
    finished = true;
    clearTimeout(watchdog);
    port.disconnect();
    throw error;
  }
  return port;
}
