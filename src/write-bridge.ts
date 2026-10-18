import {
  emptyDialogDiagnostic,
  sanitizeDialogDiagnostic,
  type DialogDiagnostic,
} from './dialog-diagnostics';
import type { Runtime } from 'webextension-polyfill';
import type {
  ExecutionApproval,
  MembershipEvidence,
  PlaylistChoice,
  WriteAdapter,
} from './operations';
import {
  approvedAction,
  validateWriteRequest,
  WRITE_PORT,
  type WriteRequest,
} from './write-protocol';

type MutationResult = Awaited<ReturnType<WriteAdapter['addToPlaylist']>>;
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
async function writerLock(): Promise<() => void> {
  return new Promise((resolve, reject) => {
    void navigator.locks
      .request(
        'latersift-youtube-writer',
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            reject(new Error('Ein YouTube-Arbeitsvorgang läuft bereits.'));
            return;
          }
          await new Promise<void>((release) => resolve(release));
        },
      )
      .catch(reject);
  });
}
async function workTab(
  videoId: string,
  approval?: ExecutionApproval,
  onDiagnostic?: (report: DialogDiagnostic) => void,
) {
  if (!/^[\w-]{11}$/.test(videoId)) throw new Error('Ungültige Video-ID.');
  if (approval) approvedAction(approval, videoId);
  const { default: browser } = await import('webextension-polyfill');
  const release = await writerLock();
  let closed = false;
  let activePort: Runtime.Port | null = null;
  let inFlight = false;
  let cancelNavigation: (() => void) | undefined;
  let tabId: number;
  try {
    // Opening this dedicated foreground tab is a direct consequence of the
    // user's discovery/execute button, never a startup or retry side effect.
    const tab = await browser.tabs.create({
      url: `https://www.youtube.com/watch?v=${videoId}`,
      active: true,
    });
    if (tab.id === undefined)
      throw new Error('YouTube-Arbeitstab konnte nicht geöffnet werden.');
    tabId = tab.id;
  } catch (error) {
    release();
    throw error;
  }
  async function ready(id: string, refresh: boolean) {
    const tab = await browser.tabs.get(tabId);
    if (
      !tab.active ||
      tab.windowId === undefined ||
      !(await browser.windows.get(tab.windowId)).focused
    )
      throw new Error(
        'YouTube-Arbeitstab muss aktiv bleiben. Keine automatische Reaktivierung.',
      );
    const url = `https://www.youtube.com/watch?v=${id}`;
    const loaded = async () => {
      for (let attempt = 0; attempt < 60; attempt++) {
        if (closed) throw new Error('Arbeitsverbindung geschlossen.');
        const current = await browser.tabs.get(tabId);
        if (!current.active || current.url !== url)
          throw new Error(
            'YouTube-Arbeitstab wurde gewechselt oder verlassen.',
          );
        if (current.status === 'complete') return;
        await pause(500);
      }
      throw new Error('YouTube-Seite lädt nicht innerhalb von 30 Sekunden.');
    };
    const navigate = (action: () => Promise<unknown>) =>
      new Promise<void>((resolve, reject) => {
        let loading = false,
          settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          browser.tabs.onUpdated.removeListener(updated);
          browser.tabs.onRemoved.removeListener(removed);
          cancelNavigation = undefined;
          if (error) reject(error);
          else resolve();
        };
        const updated = (changedId: number, change: { status?: string }) => {
          if (changedId !== tabId) return;
          if (change.status === 'loading') loading = true;
          if (loading && change.status === 'complete') finish();
        };
        const removed = (removedId: number) => {
          if (removedId === tabId)
            finish(new Error('YouTube-Arbeitstab wurde geschlossen.'));
        };
        const timer = setTimeout(
          () =>
            finish(
              new Error(
                'Kein bestätigter neuer Seitenladevorgang innerhalb von 30 Sekunden.',
              ),
            ),
          30000,
        );
        cancelNavigation = () =>
          finish(new Error('Arbeitsverbindung geschlossen.'));
        // Observe the loading -> complete transition before requesting navigation.
        // Polling only status=complete could accidentally accept the old document.
        browser.tabs.onUpdated.addListener(updated);
        browser.tabs.onRemoved.addListener(removed);
        void action().catch((error) => finish(new Error(String(error))));
      });
    if (tab.url !== url) {
      await navigate(() => browser.tabs.update(tabId, { url }));
      await loaded();
    }
    // Navigation to a different video is NOT itself a cache-bypassing reload.
    if (refresh)
      await navigate(() => browser.tabs.reload(tabId, { bypassCache: true }));
    await loaded();
    // The native renderer/video ID is independently checked by the adapter.
    await pause(1000);
  }
  async function call<T>(request: WriteRequest): Promise<T> {
    if (closed || inFlight)
      throw new Error('Verbindung geschlossen oder bereits beschäftigt.');
    validateWriteRequest(request);
    if (approval) approvedAction(approval, request.videoId);
    inFlight = true;
    try {
      // A fresh full page load before EVERY membership observation prevents
      // verifying an optimistic checkbox cached in the same SPA/dialog.
      await ready(request.videoId, request.method === 'membership');
      if (closed) throw new Error('Arbeitsverbindung geschlossen.');
      return await new Promise<T>((resolve, reject) => {
        const port = browser.tabs.connect(tabId, { name: WRITE_PORT });
        activePort = port;
        let settled = false;
        const finish = (error?: Error, result?: T) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          activePort = null;
          port.disconnect();
          if (error) reject(error);
          else resolve(result as T);
        };
        const timer = setTimeout(
          () =>
            finish(
              new Error(
                'YouTube-Antwort nicht bestätigt (35 Sekunden); Ausgang ggf. unklar.',
              ),
            ),
          35000,
        );
        port.onMessage.addListener((message: unknown) => {
          if (!message || typeof message !== 'object' || !('ok' in message))
            return;
          if (request.method === 'playlists' && onDiagnostic)
            onDiagnostic(
              sanitizeDialogDiagnostic(
                'diagnostic' in message ? message.diagnostic : undefined,
              ),
            );
          if (message.ok === true && 'result' in message)
            finish(undefined, message.result as T);
          else
            finish(
              new Error(
                'error' in message
                  ? String(message.error)
                  : 'Ungültige YouTube-Antwort.',
              ),
            );
        });
        port.onDisconnect.addListener(() =>
          finish(
            new Error('YouTube-Verbindung unterbrochen; Ausgang ggf. unklar.'),
          ),
        );
        try {
          port.postMessage(request);
        } catch (error) {
          finish(new Error(String(error)));
        }
      });
    } finally {
      inFlight = false;
    }
  }
  const adapter: WriteAdapter = {
    getAvailablePlaylists: (id) =>
      call<PlaylistChoice[]>({
        type: 'request',
        method: 'playlists',
        videoId: id,
        approval,
      }),
    getPlaylistMembership: (id, playlistId) =>
      call<MembershipEvidence>({
        type: 'request',
        method: 'membership',
        videoId: id,
        playlistId,
        approval,
      }),
    addToPlaylist: (id, playlistId) =>
      call<MutationResult>({
        type: 'request',
        method: 'add',
        videoId: id,
        playlistId,
        approval,
      }),
    removeFromWatchLater: (id) =>
      call<MutationResult>({
        type: 'request',
        method: 'remove',
        videoId: id,
        approval,
      }),
  };
  return {
    tabId,
    adapter,
    close() {
      if (closed) return;
      closed = true;
      cancelNavigation?.();
      activePort?.disconnect();
      release();
      // Keep the YouTube tab for the user's independent verification.
    },
  };
}
export function createWriteBridge(approval: ExecutionApproval) {
  const pinned = structuredClone(approval);
  if (!pinned.actions?.length) throw new Error('Keine ausgewählte Aktion.');
  approvedAction(pinned, pinned.actions[0].videoId);
  return workTab(pinned.actions[0].videoId, pinned);
}
export async function discoverPlaylists(
  videoId: string,
  onDiagnostic?: (report: DialogDiagnostic) => void,
): Promise<PlaylistChoice[]> {
  let reported = false;
  const report = (diagnostic: DialogDiagnostic) => {
    reported = true;
    onDiagnostic?.(diagnostic);
  };
  let bridge: Awaited<ReturnType<typeof workTab>> | undefined;
  try {
    bridge = await workTab(videoId, undefined, report);
    return await bridge.adapter.getAvailablePlaylists(videoId);
  } catch (error) {
    if (!reported) report(emptyDialogDiagnostic('connection-unavailable'));
    throw error;
  } finally {
    bridge?.close();
  }
}
