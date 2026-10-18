import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWriteAdapter } from '../src/adapter/write';

const VIDEO = 'abcdefghijk';
const PLAYLIST = 'PLarchive_123';

// Handwritten synthetic renderer contracts, NOT captured live DOM or live YouTube proof.
function option(title: string, id: string | null, checked = false) {
  return `<ytd-playlist-add-to-option-renderer><div role="checkbox" aria-label="${title}" aria-checked="${checked}" tabindex="0"></div>${id ? `<a href="/playlist?list=${id}">${title}</a>` : ''}</ytd-playlist-add-to-option-renderer>`;
}
function fixture() {
  document.body.innerHTML = `<main><ytd-watch-flexy video-id="${VIDEO}"><button aria-label="Save">Icon</button></ytd-watch-flexy></main>`;
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const save = document.querySelector('button')!;
  const persisted = new Map([
    [PLAYLIST, false],
    ['WL', true],
  ]);
  let markup: (() => string) | undefined;
  let effect: ((box: HTMLElement) => void) | undefined;
  let onWait: (() => void) | undefined;
  let url = `https://www.youtube.com/watch?v=${VIDEO}`;
  const controller = new AbortController();
  const clicks = vi.fn();
  const opens = vi.fn();
  save.addEventListener('click', () => {
    opens();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.innerHTML = `<ytd-add-to-playlist-renderer>${markup ? markup() : option('Archive', PLAYLIST, persisted.get(PLAYLIST)) + option('Watch later', 'WL', persisted.get('WL'))}<button aria-label="Close">×</button></ytd-add-to-playlist-renderer>`;
    dialog
      .querySelector('button')!
      .addEventListener('click', () => dialog.remove());
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') dialog.remove();
    });
    for (const box of dialog.querySelectorAll<HTMLElement>(
      '[role="checkbox"], input[type="checkbox"]',
    )) {
      box.addEventListener('click', () => {
        clicks(box);
        if (effect) {
          effect(box);
          return;
        }
        const checked = box.getAttribute('aria-checked') !== 'true';
        box.setAttribute('aria-checked', String(checked));
        const link = box
          .closest('ytd-playlist-add-to-option-renderer')!
          .querySelector('a');
        if (link) {
          const id = new URL(link.href).searchParams.get('list')!;
          persisted.set(id, checked);
        }
      });
    }
    document.body.append(dialog);
  });
  const wait = vi.fn(async (_ms: number, signal: AbortSignal) => {
    signal.throwIfAborted();
    onWait?.();
  });
  const adapter = createWriteAdapter({
    doc: document,
    url: () => url,
    wait,
    signal: controller.signal,
  });
  return {
    adapter,
    save,
    persisted,
    clicks,
    opens,
    wait,
    controller,
    markup: (value: () => string) => {
      markup = value;
    },
    effect: (value: (box: HTMLElement) => void) => {
      effect = value;
    },
    onWait: (value: () => void) => {
      onWait = value;
    },
    url: (value: string) => {
      url = value;
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('native Save write adapter — synthetic contracts, not live proof', () => {
  it('lists only explicit PL identities and reports fresh persisted membership after reopening', async () => {
    const f = fixture();
    expect(await f.adapter.getAvailablePlaylists(VIDEO)).toEqual([
      {
        id: PLAYLIST,
        title: 'Archive',
        writable: true,
        checked: false,
        identity: 'explicit-link',
        variant: 'legacy',
      },
      {
        id: 'WL',
        title: 'Watch later',
        writable: true,
        checked: true,
        identity: 'explicit-link',
        variant: 'legacy',
      },
    ]);
    expect((await f.adapter.getPlaylistMembership(VIDEO, PLAYLIST)).state).toBe(
      'absent',
    );
    expect(await f.adapter.addToPlaylist(VIDEO, PLAYLIST)).toEqual({
      changed: true,
    });
    expect(f.clicks).toHaveBeenCalledTimes(1);
    expect((await f.adapter.getPlaylistMembership(VIDEO, PLAYLIST)).state).toBe(
      'present',
    );
    expect(f.opens).toHaveBeenCalledTimes(4);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(await f.adapter.addToPlaylist(VIDEO, PLAYLIST)).toEqual({
      changed: false,
    });
    expect(f.clicks).toHaveBeenCalledTimes(1);
  });

  it('never treats optimistic mutation feedback as persisted membership', async () => {
    const f = fixture();
    f.effect((box) => box.setAttribute('aria-checked', 'true'));
    await f.adapter.addToPlaylist(VIDEO, PLAYLIST);
    expect((await f.adapter.getPlaylistMembership(VIDEO, PLAYLIST)).state).toBe(
      'absent',
    );
    expect(f.opens).toHaveBeenCalledTimes(2);
  });

  it('removes only the checked WL checkbox and is idempotent when explicitly unchecked', async () => {
    const f = fixture();
    expect(await f.adapter.removeFromWatchLater(VIDEO)).toEqual({
      changed: true,
    });
    expect(f.clicks).toHaveBeenCalledTimes(1);
    expect(f.clicks.mock.calls[0][0].getAttribute('aria-label')).toBe(
      'Watch later',
    );
    expect((await f.adapter.getPlaylistMembership(VIDEO, 'WL')).state).toBe(
      'absent',
    );
    expect(await f.adapter.removeFromWatchLater(VIDEO)).toEqual({
      changed: false,
    });
    expect(f.clicks).toHaveBeenCalledTimes(1);
  });

  it.each(['Watch later', 'Später ansehen'])(
    'requires an explicit WL link for the semantic name %s',
    async (title) => {
      const f = fixture();
      f.markup(() => option(title, 'WL', true));
      expect(await f.adapter.removeFromWatchLater(VIDEO)).toEqual({
        changed: true,
      });
      expect(f.clicks).toHaveBeenCalledTimes(1);
    },
  );

  it('treats a PL playlist named Watch later as custom, never as native WL', async () => {
    const f = fixture();
    f.markup(() => option('Watch later', PLAYLIST, true));
    expect((await f.adapter.getPlaylistMembership(VIDEO, 'WL')).state).toBe(
      'unknown',
    );
    await expect(f.adapter.removeFromWatchLater(VIDEO)).rejects.toThrow(
      /unavailable/,
    );
    expect(f.clicks).not.toHaveBeenCalled();
  });

  it('recognizes WL by explicit link, not arbitrary title heuristics', async () => {
    const f = fixture();
    f.markup(() => option('My list', 'WL', true));
    expect((await f.adapter.getPlaylistMembership(VIDEO, 'WL')).state).toBe(
      'present',
    );
  });

  it.each([
    'Watch later',
    'Später ansehen',
    'Watch later videos',
    'Später ansehen Archiv',
    'WL',
  ])(
    'does not infer WL from a single custom checkbox title %s',
    async (title) => {
      const f = fixture();
      f.markup(() => option(title, null, true));
      expect((await f.adapter.getPlaylistMembership(VIDEO, 'WL')).state).toBe(
        'unknown',
      );
      await expect(f.adapter.removeFromWatchLater(VIDEO)).rejects.toThrow(
        /unavailable/,
      );
      expect(f.clicks).not.toHaveBeenCalled();
    },
  );

  it('reports missing WL as unknown, even on the exact watch URL; never infers absence', async () => {
    const f = fixture();
    f.markup(() => option('Archive', PLAYLIST));
    expect((await f.adapter.getPlaylistMembership(VIDEO, 'WL')).state).toBe(
      'unknown',
    );
    await expect(f.adapter.removeFromWatchLater(VIDEO)).rejects.toThrow(
      /unavailable/,
    );
    expect(f.clicks).not.toHaveBeenCalled();
  });

  it('does not map a checkbox title or manual playlist ID to an unidentified row', async () => {
    const f = fixture();
    f.markup(() => option(PLAYLIST, null));
    expect(await f.adapter.getAvailablePlaylists(VIDEO)).toEqual([
      expect.objectContaining({
        id: null,
        title: PLAYLIST,
        writable: false,
        identity: 'unverified',
      }),
    ]);
    expect((await f.adapter.getPlaylistMembership(VIDEO, PLAYLIST)).state).toBe(
      'unknown',
    );
    await expect(f.adapter.addToPlaylist(VIDEO, PLAYLIST)).rejects.toThrow(
      /unidentified/,
    );
    expect(f.clicks).not.toHaveBeenCalled();
  });

  it('returns mixed identity diagnostics without relaxing the old complete-ID archive preflight', async () => {
    const f = fixture();
    f.markup(() => option('Archive', PLAYLIST) + option('Other', null));
    const choices = await f.adapter.getAvailablePlaylists(VIDEO);
    expect(choices).toHaveLength(2);
    expect(choices[0]).toMatchObject({
      id: PLAYLIST,
      identity: 'explicit-link',
      writable: false,
    });
    expect(choices[1]).toMatchObject({
      id: null,
      identity: 'unverified',
      writable: false,
    });
    expect(f.clicks).not.toHaveBeenCalled();
  });

  it.each([
    () => option('A', PLAYLIST) + option('B', PLAYLIST),
    () => option('Watch later', 'WL', true) + option('Other', 'WL', true),
    () =>
      option('A', PLAYLIST).replace(
        '</ytd-playlist-add-to-option-renderer>',
        '<a href="/playlist?list=PLdifferent">Other</a></ytd-playlist-add-to-option-renderer>',
      ),
  ])(
    'rejects duplicate or conflicting identities before any mutation',
    async (markup) => {
      const f = fixture();
      f.markup(markup);
      await expect(f.adapter.addToPlaylist(VIDEO, PLAYLIST)).rejects.toThrow(
        /ambiguous|conflicting/,
      );
      expect(f.clicks).not.toHaveBeenCalled();
    },
  );

  it.each(['mixed', 'unknown', 'TRUE', ''])(
    'refuses unknown aria-checked=%s',
    async (state) => {
      const f = fixture();
      f.markup(() =>
        option('Archive', PLAYLIST).replace(
          'aria-checked="false"',
          `aria-checked="${state}"`,
        ),
      );
      expect(
        (await f.adapter.getPlaylistMembership(VIDEO, PLAYLIST)).state,
      ).toBe('unknown');
      await expect(f.adapter.addToPlaylist(VIDEO, PLAYLIST)).rejects.toThrow(
        /unknown/,
      );
      expect(f.clicks).not.toHaveBeenCalled();
    },
  );

  it('reports disabled entries as not writable and refuses a disabled WL', async () => {
    const f = fixture();
    f.markup(() =>
      (
        option('Archive', PLAYLIST) + option('Watch later', 'WL', true)
      ).replaceAll('role="checkbox"', 'role="checkbox" aria-disabled="true"'),
    );
    expect(await f.adapter.getAvailablePlaylists(VIDEO)).toEqual([
      {
        id: PLAYLIST,
        title: 'Archive',
        writable: false,
        checked: false,
        identity: 'explicit-link',
        variant: 'legacy',
      },
      {
        id: 'WL',
        title: 'Watch later',
        writable: false,
        checked: true,
        identity: 'explicit-link',
        variant: 'legacy',
      },
    ]);
    await expect(f.adapter.removeFromWatchLater(VIDEO)).rejects.toThrow(
      /disabled/,
    );
    expect(f.clicks).not.toHaveBeenCalled();
  });

  it('mutates only the actual input checkbox and verifies its property on reopening', async () => {
    const f = fixture();
    f.markup(
      () =>
        `<ytd-playlist-add-to-option-renderer><label><input type="checkbox" ${f.persisted.get(PLAYLIST) ? 'checked' : ''}>Archive</label><a href="/playlist?list=${PLAYLIST}">Archive</a></ytd-playlist-add-to-option-renderer>`,
    );
    f.effect((box) => {
      expect(box.localName).toBe('input');
      f.persisted.set(PLAYLIST, (box as HTMLInputElement).checked);
    });
    await f.adapter.addToPlaylist(VIDEO, PLAYLIST);
    expect(f.clicks).toHaveBeenCalledTimes(1);
    expect((await f.adapter.getPlaylistMembership(VIDEO, PLAYLIST)).state).toBe(
      'present',
    );
  });

  it.each(['indeterminate', 'conflicting aria', 'missing aria'])(
    'fails closed for %s checkbox state',
    async (kind) => {
      const f = fixture();
      f.markup(() =>
        kind === 'missing aria'
          ? option('Archive', PLAYLIST).replace('aria-checked="false"', '')
          : `<ytd-playlist-add-to-option-renderer><input type="checkbox" aria-label="Archive" ${kind === 'conflicting aria' ? 'checked aria-checked="false"' : ''}><a href="/playlist?list=${PLAYLIST}">Archive</a></ytd-playlist-add-to-option-renderer>`,
      );
      if (kind === 'indeterminate')
        f.save.addEventListener('click', () => {
          document.querySelector<HTMLInputElement>('input')!.indeterminate =
            true;
        });
      expect(
        (await f.adapter.getPlaylistMembership(VIDEO, PLAYLIST)).state,
      ).toBe('unknown');
      await expect(f.adapter.addToPlaylist(VIDEO, PLAYLIST)).rejects.toThrow(
        /unknown/,
      );
      expect(f.clicks).not.toHaveBeenCalled();
    },
  );

  it('supports actual labeled input checkboxes and checked properties', async () => {
    const f = fixture();
    f.markup(
      () =>
        `<ytd-playlist-add-to-option-renderer><label><input type="checkbox" checked>Archive</label><a href="/playlist?list=${PLAYLIST}">Archive link</a></ytd-playlist-add-to-option-renderer>`,
    );
    expect((await f.adapter.getPlaylistMembership(VIDEO, PLAYLIST)).state).toBe(
      'present',
    );
    await f.adapter.addToPlaylist(VIDEO, PLAYLIST);
    expect(f.clicks).not.toHaveBeenCalled();
  });

  it.each([
    'https://www.youtube.com/watch?v=zzzzzzzzzzz',
    'https://www.youtube.com/watch?v=abcdefghij',
    'https://www.youtube.com/watch?v=abcdefghijk&v=abcdefghijk',
    'https://www.youtube.com/playlist?list=WL',
    'https://evil.example/watch?v=abcdefghijk',
  ])('rejects incorrect watch context %s without opening', async (url) => {
    const f = fixture();
    f.url(url);
    await expect(f.adapter.addToPlaylist(VIDEO, PLAYLIST)).rejects.toThrow(
      /watch URL/,
    );
    expect(f.opens).not.toHaveBeenCalled();
    expect(f.clicks).not.toHaveBeenCalled();
  });

  it.each([
    'missing renderer',
    'missing attribute',
    'wrong ID',
    'hidden renderer',
    'duplicate renderer',
  ])(
    'blocks all operations before any click for native identity: %s',
    async (kind) => {
      const f = fixture();
      const watch = document.querySelector('ytd-watch-flexy')!;
      if (kind === 'missing renderer') watch.replaceWith(f.save);
      if (kind === 'missing attribute') watch.removeAttribute('video-id');
      if (kind === 'wrong ID') watch.setAttribute('video-id', 'zzzzzzzzzzz');
      if (kind === 'hidden renderer') watch.setAttribute('hidden', '');
      if (kind === 'duplicate renderer')
        document.body.append(watch.cloneNode(true));
      // URL and generic metadata cannot substitute for the native renderer identity.
      document.head.insertAdjacentHTML(
        'beforeend',
        `<link rel="canonical" href="https://www.youtube.com/watch?v=${VIDEO}">`,
      );
      try {
        await expect(f.adapter.getAvailablePlaylists(VIDEO)).rejects.toThrow(
          /native video identity/,
        );
        await expect(
          f.adapter.getPlaylistMembership(VIDEO, 'WL'),
        ).rejects.toThrow(/native video identity/);
        await expect(f.adapter.addToPlaylist(VIDEO, PLAYLIST)).rejects.toThrow(
          /native video identity/,
        );
        await expect(f.adapter.removeFromWatchLater(VIDEO)).rejects.toThrow(
          /native video identity/,
        );
        expect(f.opens).not.toHaveBeenCalled();
        expect(f.clicks).not.toHaveBeenCalled();
      } finally {
        document.head.querySelector('[rel="canonical"]')!.remove();
      }
    },
  );

  it('never clicks a global Save outside the identified watch renderer', async () => {
    const f = fixture();
    document.body.append(f.save);
    await expect(f.adapter.addToPlaylist(VIDEO, PLAYLIST)).rejects.toThrow(
      /Save.*missing/,
    );
    expect(f.opens).not.toHaveBeenCalled();
    expect(f.clicks).not.toHaveBeenCalled();
  });

  it('ignores unrelated global Save buttons when the native watch has its own unique Save', async () => {
    const f = fixture();
    const unrelated = f.save.cloneNode(true);
    const clicked = vi.fn();
    unrelated.addEventListener('click', clicked);
    document.body.append(unrelated);
    expect(await f.adapter.addToPlaylist(VIDEO, PLAYLIST)).toEqual({
      changed: true,
    });
    expect(clicked).not.toHaveBeenCalled();
    expect(f.opens).toHaveBeenCalledTimes(1);
  });

  it('rechecks native video identity after opening, before any checkbox mutation', async () => {
    const f = fixture();
    f.save.addEventListener('click', () => {
      document
        .querySelector('ytd-watch-flexy')!
        .setAttribute('video-id', 'zzzzzzzzzzz');
    });
    await expect(f.adapter.addToPlaylist(VIDEO, PLAYLIST)).rejects.toThrow(
      /native video identity/,
    );
    expect(f.opens).toHaveBeenCalledTimes(1);
    expect(f.clicks).not.toHaveBeenCalled();
  });

  it.each(['hidden', 'unfocused'])(
    'requires the manually active foreground tab: %s',
    async (mode) => {
      const f = fixture();
      if (mode === 'hidden')
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          value: 'hidden',
        });
      else vi.mocked(document.hasFocus).mockReturnValue(false);
      await expect(f.adapter.addToPlaylist(VIDEO, PLAYLIST)).rejects.toThrow(
        /visible and active/,
      );
      expect(f.opens).not.toHaveBeenCalled();
    },
  );

  it.each(['Save', 'Speichern', 'Save to playlist', 'In Playlist speichern'])(
    'accepts exact accessible Save name %s',
    async (label) => {
      const f = fixture();
      f.save.setAttribute('aria-label', label);
      await f.adapter.getAvailablePlaylists(VIDEO);
      expect(f.opens).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    'Save video and delete',
    'Save to Watch later',
    'Remove',
    'More actions',
  ])('never opens a loosely named control: %s', async (label) => {
    const f = fixture();
    f.save.setAttribute('aria-label', label);
    await expect(f.adapter.addToPlaylist(VIDEO, PLAYLIST)).rejects.toThrow(
      /button/,
    );
    expect(f.opens).not.toHaveBeenCalled();
  });

  it('does not open while an alertdialog exists or YouTube reports an error', async () => {
    const f = fixture();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<section role="alertdialog">Confirm</section>',
    );
    await expect(f.adapter.addToPlaylist(VIDEO, PLAYLIST)).rejects.toThrow(
      /already open/,
    );
    document.querySelector('[role="alertdialog"]')!.remove();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div role="status">Playlist is full</div>',
    );
    await expect(f.adapter.addToPlaylist(VIDEO, PLAYLIST)).rejects.toThrow(
      /YouTube error\/limit/,
    );
    expect(f.opens).not.toHaveBeenCalled();
    expect(f.clicks).not.toHaveBeenCalled();
  });

  it('refuses ambiguous Save controls or a preexisting dialog', async () => {
    const f = fixture();
    const duplicate = f.save.cloneNode(true);
    f.save.parentElement!.append(duplicate);
    await expect(f.adapter.addToPlaylist(VIDEO, PLAYLIST)).rejects.toThrow(
      /ambiguous/,
    );
    duplicate.parentNode!.removeChild(duplicate);
    document.body.insertAdjacentHTML(
      'beforeend',
      '<section role="dialog">Unrelated</section>',
    );
    await expect(f.adapter.addToPlaylist(VIDEO, PLAYLIST)).rejects.toThrow(
      /already open/,
    );
    expect(f.opens).not.toHaveBeenCalled();
  });

  it.each(['hidden', 'outside', 'foreign'])(
    'ignores %s identity links',
    async (kind) => {
      const f = fixture();
      f.markup(() => {
        const row = option('Archive', PLAYLIST);
        if (kind === 'hidden') return row.replace('<a ', '<a hidden ');
        if (kind === 'foreign')
          return row.replace('/playlist?', 'https://evil.example/playlist?');
        return (
          option('Archive', null) +
          `<a href="/playlist?list=${PLAYLIST}">Outside row</a>`
        );
      });
      await expect(f.adapter.addToPlaylist(VIDEO, PLAYLIST)).rejects.toThrow(
        /unidentified/,
      );
      expect(f.clicks).not.toHaveBeenCalled();
    },
  );

  it.each([
    'limit',
    'error',
    'closed',
    'replaced',
    'navigation',
    'native video change',
    'abort',
    'timeout',
  ])('reports mutation uncertainty on %s', async (kind) => {
    const f = fixture();
    if (kind === 'timeout') f.effect(() => {});
    else
      f.onWait(() => {
        if (kind === 'limit' || kind === 'error')
          document.body.insertAdjacentHTML(
            'beforeend',
            `<div role="alert">${kind === 'limit' ? 'Playlist limit reached' : 'Ein Fehler ist aufgetreten'}</div>`,
          );
        if (kind === 'closed')
          document.querySelector('[role="dialog"]')?.remove();
        if (kind === 'replaced') {
          const box = document.querySelector('[role="checkbox"]')!;
          box.replaceWith(box.cloneNode(true));
        }
        if (kind === 'navigation')
          f.url('https://www.youtube.com/watch?v=zzzzzzzzzzz');
        if (kind === 'native video change')
          document
            .querySelector('ytd-watch-flexy')!
            .setAttribute('video-id', 'zzzzzzzzzzz');
        if (kind === 'abort') f.controller.abort();
      });
    await expect(f.adapter.addToPlaylist(VIDEO, PLAYLIST)).rejects.toThrow(
      /Mutation uncertainty.*unknown/,
    );
    expect(f.clicks).toHaveBeenCalledTimes(1);
    if (kind === 'timeout')
      expect(
        f.wait.mock.calls.reduce((total, [ms]) => total + ms, 0),
      ).toBeGreaterThanOrEqual(10_000);
  });

  it('waits for asynchronous checkbox feedback without another click', async () => {
    const f = fixture();
    let box: HTMLElement;
    f.effect((clicked) => {
      box = clicked;
    });
    f.onWait(() => {
      if (f.wait.mock.calls.length === 3)
        box.setAttribute('aria-checked', 'true');
    });
    await f.adapter.addToPlaylist(VIDEO, PLAYLIST);
    expect(f.clicks).toHaveBeenCalledTimes(1);
    expect(f.wait).toHaveBeenCalledTimes(3);
  });

  it('uses Escape only when an exact close button is unavailable and verifies closure', async () => {
    const f = fixture();
    f.save.addEventListener('click', () =>
      document.querySelector('[aria-label="Close"]')!.remove(),
    );
    await f.adapter.getAvailablePlaylists(VIDEO);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(f.clicks).not.toHaveBeenCalled();
  });

  it('does not claim success when native closing fails', async () => {
    const f = fixture();
    f.save.addEventListener('click', () => {
      const button = document.querySelector('[aria-label="Close"]')!;
      button.replaceWith(button.cloneNode(true));
    });
    await expect(f.adapter.addToPlaylist(VIDEO, PLAYLIST)).rejects.toThrow(
      /Mutation uncertainty.*timeout/,
    );
  });

  it('fails with a bounded unsupported-structure diagnostic rather than guessing arbitrary checkboxes', async () => {
    const f = fixture();
    f.markup(
      () =>
        '<div role="checkbox" aria-label="Archive" aria-checked="false"></div>',
    );
    await expect(f.adapter.addToPlaylist(VIDEO, PLAYLIST)).rejects.toThrow(
      /timeout.*unsupported structure/,
    );
    expect(f.wait.mock.calls.reduce((total, [ms]) => total + ms, 0)).toBe(
      10_000,
    );
    expect(f.clicks).not.toHaveBeenCalled();
  });

  it('refuses nested or duplicate checkbox controls instead of clicking text or menus', async () => {
    const f = fixture();
    f.markup(() =>
      option('Archive', PLAYLIST).replace(
        '</ytd-playlist-add-to-option-renderer>',
        '<button role="checkbox" aria-checked="false">Other</button><button>Delete video</button></ytd-playlist-add-to-option-renderer>',
      ),
    );
    await expect(f.adapter.addToPlaylist(VIDEO, PLAYLIST)).rejects.toThrow(
      /exactly one checkbox/,
    );
    expect(f.clicks).not.toHaveBeenCalled();
    expect(Object.keys(f.adapter).sort()).toEqual([
      'addToPlaylist',
      'getAvailablePlaylists',
      'getPlaylistMembership',
      'removeFromWatchLater',
    ]);
  });
});
