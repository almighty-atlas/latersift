import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWriteAdapter } from '../src/adapter/write';
import { saveSheet, sheetRow } from './fixtures/save-sheet';

const VIDEO = 'abcdefghijk';
const ID = 'PLarchive_123';
function fixture(markup = saveSheet(), afterOpen?: (popup: Element) => void) {
  document.body.innerHTML = `<ytd-watch-flexy video-id="${VIDEO}"><button aria-label="Save">Save</button></ytd-watch-flexy>`;
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const mutations = vi.fn();
  const controller = new AbortController();
  document.querySelector('button')!.addEventListener('click', () => {
    document.body.insertAdjacentHTML('beforeend', markup);
    const popup = document.querySelector('ytd-popup-container')!;
    popup.addEventListener('click', mutations);
    popup.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape') popup.remove();
    });
    afterOpen?.(popup);
  });
  const adapter = createWriteAdapter({
    doc: document,
    url: () => `https://www.youtube.com/watch?v=${VIDEO}`,
    signal: controller.signal,
    wait: async () => {},
  });
  return { adapter, mutations, controller };
}
beforeEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('new Save sheet — synthetic, discovery only, no live compatibility claim', () => {
  it('reads 16 names and true/false UI states, excludes New playlist, mutates nothing', async () => {
    const f = fixture();
    const choices = await f.adapter.getAvailablePlaylists(VIDEO);
    expect(choices).toHaveLength(16);
    const sheet = document.querySelector('yt-sheet-view-model')!;
    expect(sheet.querySelectorAll('button')).toHaveLength(17);
    expect(sheet.querySelectorAll('button[role="menuitem"]')).toHaveLength(16);
    expect(
      sheet.querySelectorAll('yt-collection-thumbnail-view-model'),
    ).toHaveLength(16);
    expect(choices[0]).toMatchObject({
      id: null,
      title: 'Watch later',
      checked: true,
      identity: 'unverified',
      variant: 'sheet',
      writable: false,
    });
    expect(choices[1]).toMatchObject({ title: 'Archive', checked: false });
    expect(choices.every((p) => p.id === null && !p.writable)).toBe(true);
    expect(choices.some((p) => p.title === 'New playlist')).toBe(false);
    expect(f.mutations).not.toHaveBeenCalled();
    expect(document.querySelector('yt-sheet-view-model')).not.toBeNull();
  });
  it('never clicks a playlist named Close or New playlist to dismiss a sheet', async () => {
    const f = fixture(saveSheet(sheetRow('Close') + sheetRow('New playlist')));
    expect(await f.adapter.getAvailablePlaylists(VIDEO)).toHaveLength(2);
    expect(f.mutations).not.toHaveBeenCalled();
  });
  it.each([
    'Save to…',
    'Save to...',
    'Save to',
    'Speichern in…',
    'Speichern unter...',
    'In Playlist speichern',
    'Speichern',
  ])('recognizes English/German heading %s', async (heading) => {
    expect(
      await fixture(
        saveSheet(undefined, heading),
      ).adapter.getAvailablePlaylists(VIDEO),
    ).toHaveLength(16);
  });
  it('reads accessible names via row-local aria-labelledby and plain text', async () => {
    const rows =
      sheetRow('Archive')
        .replace('aria-label="Archive"', 'aria-labelledby="row-name"')
        .replace('<span>', '<span id="row-name">') +
      sheetRow('Other').replace('aria-label="Other"', '');
    const choices = await fixture(
      saveSheet(rows),
    ).adapter.getAvailablePlaylists(VIDEO);
    expect(choices.map((p) => p.title)).toEqual(['Archive', 'Other']);
  });
  it.each(['aria-label', 'aria-labelledby', 'plain text'])(
    'prefers a structured title over accessibility extras in %s',
    async (source) => {
      const row = sheetRow('Archive')
        .replace(
          'aria-label="Archive"',
          source === 'aria-label'
            ? 'aria-label="Archive, Private, Not selected"'
            : source === 'aria-labelledby'
              ? 'aria-labelledby="playlist-title privacy selection"'
              : '',
        )
        .replace(
          '<span>Archive</span>',
          '<span id="playlist-title" class="yt-list-item-view-model__title">Archive</span><span id="privacy">Private</span><span id="selection">Not selected</span>',
        );
      const f = fixture(saveSheet(row));
      expect((await f.adapter.getAvailablePlaylists(VIDEO))[0]).toMatchObject({
        title: 'Archive',
        id: null,
        identity: 'unverified',
        writable: false,
        checked: false,
      });
      expect(f.mutations).not.toHaveBeenCalled();
    },
  );
  it.each(['Private', 'Not selected', 'My Private Archive, Not selected'])(
    'preserves the actual structured playlist name %s verbatim',
    async (title) => {
      const row = sheetRow(title)
        .replace(
          `aria-label="${title}"`,
          `aria-label="${title}, Private, Not selected"`,
        )
        .replace('<span>', '<span class="yt-list-item-view-model__title">');
      expect(
        (await fixture(saveSheet(row)).adapter.getAvailablePlaylists(VIDEO))[0]
          .title,
      ).toBe(title);
    },
  );
  it.each(['no title', 'duplicate titles', 'hidden title', 'empty title'])(
    'does not strip words from the accessible name with %s',
    async (kind) => {
      const title = 'Private, Not selected';
      let row = sheetRow(title);
      if (kind === 'duplicate titles')
        row = row.replace(
          `<span>${title}</span>`,
          '<span class="yt-list-item-view-model__title">A</span><span class="yt-list-item-view-model__title">B</span>',
        );
      if (kind === 'hidden title')
        row = row.replace(
          '<span>',
          '<span hidden class="yt-list-item-view-model__title">',
        );
      if (kind === 'empty title')
        row = row.replace(
          `<span>${title}</span>`,
          '<span class="yt-list-item-view-model__title"> </span>',
        );
      expect(
        (await fixture(saveSheet(row)).adapter.getAvailablePlaylists(VIDEO))[0]
          .title,
      ).toBe(title);
    },
  );
  it.each(['external', 'duplicate'])(
    'does not bypass %s aria-labelledby references with a structured title',
    async (kind) => {
      const row = sheetRow('Archive')
        .replace('aria-label="Archive"', 'aria-labelledby="row-name"')
        .replace(
          '<span>',
          `<span ${kind === 'duplicate' ? 'id="row-name" ' : ''}class="yt-list-item-view-model__title">`,
        );
      const f = fixture(saveSheet(row), (popup) =>
        popup.insertAdjacentHTML(
          'beforeend',
          '<span id="row-name">Wrong playlist</span>',
        ),
      );
      expect((await f.adapter.getAvailablePlaylists(VIDEO))[0].title).toBe('');
      expect(f.mutations).not.toHaveBeenCalled();
    },
  );
  it('does not use an external or duplicated accessible name as a playlist name', async () => {
    const rows = sheetRow('Archive').replace(
      'aria-label="Archive"',
      'aria-labelledby="outside"',
    );
    const f = fixture(saveSheet(rows), (popup) =>
      popup.insertAdjacentHTML(
        'beforeend',
        '<span id="outside">Wrong playlist</span>',
      ),
    );
    expect((await f.adapter.getAvailablePlaylists(VIDEO))[0].title).toBe('');
  });
  it('never infers IDs from duplicate names, page links, data attributes or manual IDs', async () => {
    const rows = (
      sheetRow('Archive') +
      sheetRow('Archive') +
      sheetRow('Später ansehen', true)
    ).replaceAll(
      '<toggleable-list-item-view-model>',
      `<toggleable-list-item-view-model playlist-id="${ID}" data-playlist-id="${ID}">`,
    );
    const f = fixture(saveSheet(rows));
    document.body.insertAdjacentHTML(
      'beforeend',
      `<a href="/playlist?list=${ID}">Archive</a><a href="/playlist?list=WL">Später ansehen</a>`,
    );
    expect(
      (await f.adapter.getAvailablePlaylists(VIDEO)).map((p) => p.id),
    ).toEqual([null, null, null]);
    document.querySelector('ytd-popup-container')?.remove();
    expect((await f.adapter.getPlaylistMembership(VIDEO, ID)).state).toBe(
      'unknown',
    );
    expect((await f.adapter.getPlaylistMembership(VIDEO, 'WL')).state).toBe(
      'unknown',
    );
    await expect(f.adapter.addToPlaylist(VIDEO, ID)).rejects.toThrow(
      /nur lesbar/,
    );
    document.querySelector('ytd-popup-container')!.remove();
    await expect(f.adapter.removeFromWatchLater(VIDEO)).rejects.toThrow(
      /nur lesbar/,
    );
    expect(f.mutations).not.toHaveBeenCalled();
  });
  it('reports row-local explicit links, but keeps even linked sheets read-only and membership unknown', async () => {
    const f = fixture(
      saveSheet(
        sheetRow('Same name', false, ID) + sheetRow('Same name', true, 'WL'),
      ),
    );
    const choices = await f.adapter.getAvailablePlaylists(VIDEO);
    expect(choices.map((p) => [p.id, p.identity, p.writable])).toEqual([
      [ID, 'explicit-link', false],
      ['WL', 'explicit-link', false],
    ]);
    document.querySelector('ytd-popup-container')?.remove();
    expect((await f.adapter.getPlaylistMembership(VIDEO, ID)).state).toBe(
      'unknown',
    );
    await expect(f.adapter.addToPlaylist(VIDEO, ID)).rejects.toThrow(
      /nur lesbar/,
    );
    expect(f.mutations).not.toHaveBeenCalled();
  });
  it.each(['duplicate IDs', 'conflicting links'])(
    'rejects ambiguous explicit identities: %s',
    async (kind) => {
      const rows =
        kind === 'duplicate IDs'
          ? sheetRow('A', false, ID) + sheetRow('B', true, ID)
          : sheetRow('A', false, ID).replace(
              '</yt-list-item-view-model>',
              '<a href="/playlist?list=WL">Other</a></yt-list-item-view-model>',
            );
      const f = fixture(saveSheet(rows));
      await expect(f.adapter.getAvailablePlaylists(VIDEO)).rejects.toThrow(
        /ambiguous/,
      );
      expect(f.mutations).not.toHaveBeenCalled();
    },
  );
  it.each(['hidden', 'foreign', 'outside row'])(
    'does not associate a %s link with a row',
    async (kind) => {
      let row = sheetRow('Archive', false, ID);
      if (kind === 'hidden') row = row.replace('<a ', '<a hidden ');
      if (kind === 'foreign')
        row = row.replace('/playlist?', 'https://evil.example/playlist?');
      if (kind === 'outside row')
        row =
          sheetRow('Archive') + `<a href="/playlist?list=${ID}">Archive</a>`;
      expect(
        (await fixture(saveSheet(row)).adapter.getAvailablePlaylists(VIDEO))[0]
          .id,
      ).toBeNull();
    },
  );
  it.each([
    'missing',
    'mixed',
    'TRUE',
    '',
    'contradictory button',
    'contradictory row',
    'contradictory child',
  ])('reports unknown UI state for %s', async (kind) => {
    let row = sheetRow('Archive');
    if (kind === 'missing') row = row.replace('aria-pressed="false"', '');
    else if (kind === 'contradictory button')
      row = row.replace(
        'aria-pressed="false"',
        'aria-pressed="false" aria-checked="true"',
      );
    else if (kind === 'contradictory row')
      row = row.replace(
        '<toggleable-list-item-view-model>',
        '<toggleable-list-item-view-model aria-pressed="true">',
      );
    else if (kind === 'contradictory child')
      row = row.replace('<span>', '<span aria-pressed="true">');
    else row = row.replace('aria-pressed="false"', `aria-pressed="${kind}"`);
    const f = fixture(saveSheet(row));
    expect((await f.adapter.getAvailablePlaylists(VIDEO))[0]).toMatchObject({
      checked: null,
      writable: false,
    });
    expect(f.mutations).not.toHaveBeenCalled();
  });
  it.each(['hidden', 'aria-hidden', 'display', 'visibility', 'opacity'])(
    'ignores a second %s sheet and its entries',
    async (kind) => {
      const f = fixture(saveSheet(), (popup) => {
        const clone = popup.cloneNode(true) as Element;
        const sheet = clone.querySelector('yt-sheet-view-model')!;
        if (kind === 'hidden') sheet.setAttribute('hidden', '');
        if (kind === 'aria-hidden') sheet.setAttribute('aria-hidden', 'true');
        if (kind === 'display') sheet.setAttribute('style', 'display:none');
        if (kind === 'visibility')
          sheet.setAttribute('style', 'visibility:hidden');
        if (kind === 'opacity') sheet.setAttribute('style', 'opacity:0');
        document.body.append(clone);
      });
      expect(await f.adapter.getAvailablePlaylists(VIDEO)).toHaveLength(16);
      expect(f.mutations).not.toHaveBeenCalled();
    },
  );
  it.each(['separate', 'same wrapper', 'legacy mixed'])(
    'rejects multiple visible dialogs: %s',
    async (kind) => {
      const f = fixture(saveSheet(), (popup) => {
        if (kind === 'separate') document.body.append(popup.cloneNode(true));
        if (kind === 'same wrapper') popup.setAttribute('role', 'dialog');
        if (kind === 'same wrapper')
          popup
            .querySelector('tp-yt-iron-dropdown')!
            .append(
              popup.querySelector('yt-sheet-view-model')!.cloneNode(true),
            );
        if (kind === 'legacy mixed')
          popup
            .querySelector('yt-contextual-sheet-layout')!
            .insertAdjacentHTML(
              'beforeend',
              '<ytd-add-to-playlist-renderer></ytd-add-to-playlist-renderer>',
            );
      });
      await expect(f.adapter.getAvailablePlaylists(VIDEO)).rejects.toThrow(
        /ambiguous|nicht eindeutig/,
      );
      expect(f.mutations).not.toHaveBeenCalled();
    },
  );
  it.each([
    'wrong title',
    'missing title',
    'duplicate title',
    'missing layout',
    'outside popup',
    'duplicate buttons',
    'missing item',
  ])('rejects unsupported structure: %s', async (kind) => {
    const f = fixture(saveSheet(), (popup) => {
      if (kind === 'wrong title')
        popup.querySelector('h2')!.textContent = 'Share';
      if (kind === 'missing title') popup.querySelector('h2')!.remove();
      if (kind === 'duplicate title')
        popup
          .querySelector('yt-panel-header-view-model')!
          .append(document.createElement('h2'));
      if (kind === 'missing layout')
        popup
          .querySelector('yt-contextual-sheet-layout')!
          .replaceWith(
            ...popup.querySelector('yt-contextual-sheet-layout')!.childNodes,
          );
      if (kind === 'outside popup')
        document.body.append(popup.querySelector('yt-sheet-view-model')!);
      if (kind === 'duplicate buttons')
        popup
          .querySelector('yt-list-item-view-model')!
          .insertAdjacentHTML(
            'beforeend',
            '<button role="menuitem" aria-pressed="true">Other</button>',
          );
      if (kind === 'missing item')
        popup.querySelector('yt-list-item-view-model')!.remove();
    });
    await expect(f.adapter.getAvailablePlaylists(VIDEO)).rejects.toThrow(
      /nicht|fehlen/,
    );
    expect(f.mutations).not.toHaveBeenCalled();
  });
  it.each(['focus', 'closed', 'video changed', 'aborted'])(
    'stops a read after %s, without touching playlist controls',
    async (kind) => {
      const f = fixture(saveSheet(), (popup) => {
        if (kind === 'focus')
          vi.mocked(document.hasFocus).mockReturnValue(false);
        if (kind === 'closed') popup.remove();
        if (kind === 'video changed')
          document
            .querySelector('ytd-watch-flexy')!
            .setAttribute('video-id', 'zzzzzzzzzzz');
        if (kind === 'aborted') f.controller.abort();
      });
      await expect(f.adapter.getAvailablePlaylists(VIDEO)).rejects.toThrow();
      expect(f.mutations).not.toHaveBeenCalled();
    },
  );
});
