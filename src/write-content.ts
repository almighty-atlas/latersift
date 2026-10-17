import browser from 'webextension-polyfill';
import { createWriteAdapter } from './adapter/write';
import { wait } from './adapter/scanner';
import {
  AUTHORIZE_MUTATION,
  approvedAction,
  validateWriteRequest,
  WRITE_PORT,
} from './write-protocol';

export function installWriteChannel(
  isBusy: () => boolean,
  setActive: (controller: AbortController | null) => void,
) {
  browser.runtime.onConnect.addListener((port) => {
    if (
      port.name !== WRITE_PORT ||
      port.sender?.id !== browser.runtime.id ||
      !port.sender.url?.startsWith(browser.runtime.getURL(''))
    )
      return;
    const controller = new AbortController();
    port.onDisconnect.addListener(() => controller.abort());
    let used = false;
    port.onMessage.addListener(async (message: unknown) => {
      let acquired = false;
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let reply: { ok: boolean; result?: unknown; error?: string };
      const abort = () => controller.abort();
      try {
        if (used || isBusy() || controller.signal.aborted)
          throw new Error(
            'YouTube-Adapter bereits beschäftigt oder Verbindung beendet.',
          );
        used = true;
        const request = validateWriteRequest(message);
        setActive(controller);
        acquired = true;
        const remaining = request.approval
          ? Date.parse(request.approval.expiresAt) - Date.now()
          : 35000;
        deadline = setTimeout(
          () => controller.abort(),
          Math.min(35000, Math.max(0, remaining)),
        );
        window.addEventListener('yt-navigate-start', abort);
        window.addEventListener('popstate', abort);
        window.addEventListener('pagehide', abort);
        const adapter = createWriteAdapter({
          doc: document,
          url: () => location.href,
          wait,
          signal: controller.signal,
        });
        const permit = async () => {
          const response: unknown = await browser.runtime.sendMessage({
            type: AUTHORIZE_MUTATION,
            request,
          });
          if (
            !response ||
            typeof response !== 'object' ||
            !('authorized' in response) ||
            response.authorized !== true
          )
            throw new Error(
              response && typeof response === 'object' && 'error' in response
                ? String(response.error)
                : 'Kein dauerhaft autorisierter laufender Journalversuch.',
            );
          controller.signal.throwIfAborted();
          approvedAction(request.approval!, request.videoId);
        };
        let result: unknown;
        switch (request.method) {
          case 'playlists':
            result = await adapter.getAvailablePlaylists(request.videoId);
            break;
          case 'membership':
            result = await adapter.getPlaylistMembership(
              request.videoId,
              request.playlistId!,
            );
            break;
          case 'add':
            // This check is intentionally repeated at the content boundary.
            approvedAction(request.approval!, request.videoId);
            await permit();
            result = await adapter.addToPlaylist(
              request.videoId,
              request.playlistId!,
            );
            break;
          case 'remove': {
            const action = approvedAction(request.approval!, request.videoId);
            if (action.kind === 'archive') {
              const target = await adapter.getPlaylistMembership(
                request.videoId,
                action.targetPlaylist!,
              );
              if (target.state !== 'present')
                throw new Error(
                  'Archivmitgliedschaft unmittelbar vor Entfernung nicht bestätigt.',
                );
            }
            // Expiry/navigation is checked again after the potentially slow read.
            approvedAction(request.approval!, request.videoId);
            await permit();
            result = await adapter.removeFromWatchLater(request.videoId);
            break;
          }
        }
        reply = { ok: true, result };
      } catch (error) {
        reply = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        clearTimeout(deadline);
        window.removeEventListener('yt-navigate-start', abort);
        window.removeEventListener('popstate', abort);
        window.removeEventListener('pagehide', abort);
        if (acquired) setActive(null);
      }
      try {
        port.postMessage(reply);
      } catch {
        /* The durable running journal becomes unknown on recovery. */
      }
    });
  });
}
