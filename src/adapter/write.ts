import type {
  MembershipEvidence,
  PlaylistChoice,
  WriteAdapter,
} from '../operations';

type Environment = {
  doc: Document;
  url(): string;
  wait(ms: number, signal: AbortSignal): Promise<void>;
  signal: AbortSignal;
};

// Deliberately isolated contracts, not a claim about every current YouTube UI.
const RENDERER = 'ytd-add-to-playlist-renderer';
const OPTION = 'ytd-playlist-add-to-option-renderer';
const DIALOG =
  '[role="dialog"], [role="alertdialog"], dialog[open], tp-yt-paper-dialog';
const BUTTON = 'button, [role="button"]';
const CHECKBOX = 'input[type="checkbox"], [role="checkbox"]';
const SAVE = /^(Save|Save to playlist|Speichern|In Playlist speichern)$/i;
const CLOSE = /^(Close|Schließen)$/i;

const TIMEOUT = 10_000;
const INTERVAL = 100;
const normalize = (text: string | null) =>
  (text || '').replace(/\s+/g, ' ').trim();

export function createWriteAdapter(env: Environment): WriteAdapter {
  const { doc, signal } = env;
  let busy = false;
  function fail(message: string): never {
    throw new Error(`Native Save dialog: ${message}`);
  }
  function visible(el: Element): boolean {
    if (!el.isConnected || el.ownerDocument !== doc) return false;
    for (let node: Element | null = el; node; node = node.parentElement) {
      if (node.matches('[hidden], [inert], [aria-hidden="true"]')) return false;
      const style = doc.defaultView?.getComputedStyle(node);
      if (
        style?.display === 'none' ||
        style?.visibility === 'hidden' ||
        style?.visibility === 'collapse' ||
        style?.opacity === '0'
      )
        return false;
    }
    return true;
  }
  function enabled(el: Element): boolean {
    return !el.closest('[disabled], [aria-disabled="true"], fieldset:disabled');
  }
  function name(el: Element): string {
    if (el.hasAttribute('aria-label'))
      return normalize(el.getAttribute('aria-label'));
    const refs = el.getAttribute('aria-labelledby');
    if (refs)
      return normalize(
        refs
          .split(/\s+/)
          .map((id) => doc.getElementById(id)?.textContent || '')
          .join(' '),
      );
    if (el.localName === 'input') {
      return normalize(
        Array.from((el as HTMLInputElement).labels || [])
          .map((label) => label.textContent)
          .join(' '),
      );
    }
    return normalize(el.textContent);
  }
  function context(videoId: string) {
    if (signal.aborted) fail('aborted');
    if (doc.visibilityState !== 'visible' || !doc.hasFocus())
      fail(
        'manual video tab must be visible and active; no automatic focusing',
      );
    let url: URL;
    try {
      url = new URL(env.url());
    } catch {
      return fail('invalid watch URL');
    }
    // Same validation as dom.ts parseRow; there is no exported ID validator there.
    if (
      !/^[\w-]{11}$/.test(videoId) ||
      url.origin !== 'https://www.youtube.com' ||
      url.pathname !== '/watch' ||
      url.searchParams.getAll('v').length !== 1 ||
      url.searchParams.get('v') !== videoId
    )
      fail(
        'watch URL must identify exactly the requested 11-character video ID',
      );
    const watches = [...doc.querySelectorAll('ytd-watch-flexy')].filter(
      visible,
    );
    if (watches.length !== 1 || watches[0].getAttribute('video-id') !== videoId)
      fail(
        'unsupported native video identity: expected one visible ytd-watch-flexy with matching video-id',
      );
    return watches[0];
  }
  function dialogs(): Element[] {
    const candidates = [
      ...doc.querySelectorAll(`${DIALOG}, ${RENDERER}`),
    ].filter(visible);
    return candidates.filter(
      (el) => !candidates.some((other) => other !== el && other.contains(el)),
    );
  }
  function errors() {
    for (const el of doc.querySelectorAll(
      '[role="alert"], [role="status"], ytd-notification-action-renderer, tp-yt-paper-toast, ytd-alert-with-button-renderer, yt-alert-renderer',
    )) {
      const text = normalize(el.textContent);
      if (
        visible(el) &&
        text &&
        (el.getAttribute('role') === 'alert' ||
          /error|failed|unable|could not|limit|maximum|too many|full|fehler|fehlgeschlagen|nicht möglich|konnte nicht|zu viele|voll|versuche es erneut|try again/i.test(
            text,
          ))
      )
        fail(`YouTube error/limit: ${text}`);
    }
  }
  function current(videoId: string, dialog: Element): Element {
    context(videoId);
    errors();
    const open = dialogs();
    if (!visible(dialog) || open.length !== 1 || open[0] !== dialog)
      fail('dialog unexpectedly closed or replaced');
    const renderers = [...dialog.querySelectorAll(RENDERER)];
    if (dialog.matches(RENDERER)) renderers.unshift(dialog);
    if (renderers.length !== 1 || !visible(renderers[0]))
      fail('unsupported structure: expected one ytd-add-to-playlist-renderer');
    return renderers[0];
  }
  function click(el: Element) {
    if (
      !visible(el) ||
      !enabled(el) ||
      typeof (el as HTMLElement).click !== 'function'
    )
      fail('stale, hidden or disabled control');
    (el as HTMLElement).click();
  }
  async function poll<T>(
    videoId: string,
    read: () => T | undefined,
    diagnostic: string,
  ): Promise<T> {
    for (let elapsed = 0; elapsed <= TIMEOUT; elapsed += INTERVAL) {
      context(videoId);
      errors();
      const result = read();
      if (result !== undefined) return result;
      if (elapsed < TIMEOUT) await env.wait(INTERVAL, signal);
    }
    return fail(`timeout (10s): ${diagnostic}`);
  }
  async function open(videoId: string): Promise<Element> {
    const watch = context(videoId);
    errors();
    if (dialogs().length) fail('another dialog is already open');
    const buttons = [...watch.querySelectorAll(BUTTON)].filter(
      (el) => visible(el) && SAVE.test(name(el)),
    );
    if (buttons.length !== 1 || !enabled(buttons[0]))
      fail('Save/Speichern button is missing, disabled or ambiguous');
    click(buttons[0]);
    const dialog = await poll(
      videoId,
      () => {
        const open = dialogs();
        if (open.length > 1) fail('ambiguous dialogs');
        return open[0];
      },
      'native Save dialog did not open',
    );
    await poll(
      videoId,
      () => {
        const root = current(videoId, dialog);
        return [...root.querySelectorAll(OPTION)].some(visible)
          ? true
          : undefined;
      },
      'unsupported structure: no supported checkbox options',
    );
    return dialog;
  }
  async function close(videoId: string, dialog: Element) {
    current(videoId, dialog);
    const buttons = [...dialog.querySelectorAll(BUTTON)].filter(
      (el) => visible(el) && CLOSE.test(name(el)),
    );
    if (buttons.length > 1) fail('ambiguous Close/Schließen buttons');
    if (buttons.length === 1) click(buttons[0]);
    else {
      const Keyboard = doc.defaultView?.KeyboardEvent;
      if (!Keyboard) fail('cannot dispatch native Escape');
      const target =
        doc.activeElement && dialog.contains(doc.activeElement)
          ? doc.activeElement
          : dialog;
      target.dispatchEvent(
        new Keyboard('keydown', {
          key: 'Escape',
          code: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
      target.dispatchEvent(
        new Keyboard('keyup', { key: 'Escape', code: 'Escape', bubbles: true }),
      );
    }
    await poll(
      videoId,
      () => (dialogs().length === 0 ? true : undefined),
      'native dialog did not close',
    );
  }
  type Row = {
    option: Element;
    checkbox: Element;
    id: string | null;
    title: string;
    checked: boolean | null;
    writable: boolean;
  };
  function rows(videoId: string, dialog: Element): Row[] {
    const root = current(videoId, dialog);
    const result: Row[] = [];
    for (const option of root.querySelectorAll(OPTION)) {
      if (!visible(option)) continue;
      const boxes = [...option.querySelectorAll(CHECKBOX)].filter(
        (el) => visible(el) && el.closest(OPTION) === option,
      );
      if (boxes.length !== 1)
        fail(
          'unsupported structure: checkbox option must contain exactly one checkbox',
        );
      const checkbox = boxes[0];
      const ids = new Set<string>();
      for (const anchor of option.querySelectorAll('a[href]')) {
        if (anchor.closest(OPTION) !== option || !visible(anchor)) continue;
        let url: URL;
        try {
          url = new URL(
            anchor.getAttribute('href')!,
            'https://www.youtube.com',
          );
        } catch {
          continue;
        }
        if (
          url.origin !== 'https://www.youtube.com' ||
          url.pathname !== '/playlist' ||
          url.searchParams.getAll('list').length !== 1
        )
          continue;
        const id = url.searchParams.get('list')!;
        if (id === 'WL' || /^PL[\w-]+$/.test(id)) ids.add(id);
      }
      if (ids.size > 1)
        fail('ambiguous explicit playlist IDs within one option');
      const title = name(checkbox);
      const id = [...ids][0] || null;
      const aria = checkbox.getAttribute('aria-checked');
      const input = checkbox.matches('input[type="checkbox"]')
        ? (checkbox as HTMLInputElement)
        : null;
      let checked: boolean | null =
        aria === 'true' ? true : aria === 'false' ? false : null;
      if (input) {
        checked =
          input.indeterminate ||
          (aria !== null && (checked === null || checked !== input.checked))
            ? null
            : input.checked;
      }
      result.push({
        option,
        checkbox,
        id,
        title,
        checked,
        writable:
          enabled(option) && enabled(checkbox) && checked !== null && !!title,
      });
    }
    const ids = result.map((row) => row.id).filter((id) => id !== null);
    if (new Set(ids).size !== ids.length)
      fail('duplicate/ambiguous playlist ID');
    return result;
  }
  function target(
    videoId: string,
    dialog: Element,
    id: string,
  ): Row | undefined {
    return rows(videoId, dialog).find((row) => row.id === id);
  }
  function playlistId(id: string) {
    if (id !== 'WL' && !/^PL[\w-]+$/.test(id))
      fail('unsupported playlist ID; explicit PL link required');
  }
  async function session<T>(
    videoId: string,
    run: (dialog: Element) => Promise<T>,
  ): Promise<T> {
    if (busy) fail('another adapter operation is in progress');
    busy = true;
    try {
      const dialog = await open(videoId);
      const result = await run(dialog);
      await close(videoId, dialog);
      return result;
    } finally {
      // On failure leave the UI untouched for manual inspection; never guess a cleanup target.
      busy = false;
    }
  }
  async function mutate(videoId: string, id: string, desired: boolean) {
    playlistId(id);
    let clicked = false;
    try {
      await session(videoId, async (dialog) => {
        const row = target(videoId, dialog, id);
        if (!row || !row.writable || row.checked === null)
          fail(
            'target checkbox unavailable, unidentified, disabled or unknown',
          );
        if (row.checked === desired) return;
        // No await between identity validation and the single checkbox click.
        clicked = true;
        click(row.checkbox);
        // A changed checkbox is feedback only, never persisted membership evidence.
        await env.wait(INTERVAL, signal);
        await poll(
          videoId,
          () => {
            const fresh = target(videoId, dialog, id);
            if (
              !fresh ||
              fresh.option !== row.option ||
              fresh.checkbox !== row.checkbox ||
              !visible(row.checkbox)
            )
              fail(
                'target checkbox disappeared or was replaced after mutation',
              );
            if (!fresh.writable || fresh.checked === null)
              fail('target checkbox became disabled or unknown');
            return fresh.checked === desired ? true : undefined;
          },
          'no checkbox mutation feedback',
        );
      });
      return { changed: clicked };
    } catch (error) {
      if (clicked)
        throw new Error(
          `Mutation uncertainty; executor must treat outcome as unknown: ${error instanceof Error ? error.message : String(error)}`,
        );
      throw error;
    }
  }
  return {
    getAvailablePlaylists: (videoId) =>
      session(videoId, async (dialog): Promise<PlaylistChoice[]> => {
        const options = rows(videoId, dialog);
        if (options.some((row) => row.id === null))
          fail(
            'unsupported structure: missing explicit playlist link; checkbox titles are not playlist IDs',
          );
        return options
          .filter((row) => row.id !== 'WL')
          .map((row) => ({
            id: row.id!,
            title: row.title,
            writable: row.writable,
          }));
      }),
    getPlaylistMembership: async (videoId, id) => {
      playlistId(id);
      return session(videoId, async (dialog): Promise<MembershipEvidence> => {
        const row = target(videoId, dialog, id);
        const known = row && row.writable && row.checked !== null;
        return {
          state: known ? (row.checked ? 'present' : 'absent') : 'unknown',
          observedAt: new Date().toISOString(),
          source: 'native-dialog',
          ...(!known
            ? {
                message:
                  'Target checkbox missing, unidentified, disabled or unknown; absence is not established.',
              }
            : {}),
        };
      });
    },
    addToPlaylist: (videoId, id) => {
      if (id === 'WL')
        return Promise.reject(
          new Error('Archive target requires an explicit PL playlist link'),
        );
      return mutate(videoId, id, true);
    },
    removeFromWatchLater: (videoId) => mutate(videoId, 'WL', false),
  };
}
