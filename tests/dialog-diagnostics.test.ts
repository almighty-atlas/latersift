import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWriteAdapter } from '../src/adapter/write';
import {
  emptyDialogDiagnostic,
  formatDialogDiagnostic,
  sanitizeDialogDiagnostic,
  type DialogDiagnostic,
} from '../src/dialog-diagnostics';
import { saveSheet, sheetRow } from './fixtures/save-sheet';

const VIDEO = 'abcdefghijk';
const ID = 'PLprivate_target_123';
function fixture(markup = saveSheet(), update?: (popup: Element) => void) {
  document.body.innerHTML = `<ytd-watch-flexy video-id="${VIDEO}"><button aria-label="Save">Save</button></ytd-watch-flexy>`;
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible',
  });
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  const onDiagnostic = vi.fn<(report: DialogDiagnostic) => void>();
  const clicked = vi.fn();
  document.querySelector('button')!.addEventListener('click', () => {
    document.body.insertAdjacentHTML('beforeend', markup);
    const popup = document.body.lastElementChild!;
    popup.addEventListener('click', clicked);
    popup.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Escape') popup.remove();
    });
    update?.(popup);
  });
  const adapter = createWriteAdapter({
    doc: document,
    url: () => `https://www.youtube.com/watch?v=${VIDEO}`,
    signal: new AbortController().signal,
    wait: async () => {},
    onDiagnostic,
  });
  return {
    adapter,
    onDiagnostic,
    clicked,
    report: () => onDiagnostic.mock.lastCall![0],
  };
}
beforeEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('copyable dialog diagnostics — synthetic read-only contracts', () => {
  it('counts valid, missing and conflicting UI states independently of proven IDs', async () => {
    const f = fixture(saveSheet(), (popup) => {
      const buttons = popup.querySelectorAll('button[role="menuitem"]');
      buttons[0].removeAttribute('aria-pressed');
      buttons[1].setAttribute('aria-checked', 'true');
    });
    await f.adapter.getAvailablePlaylists(VIDEO);
    expect(f.report()).toMatchObject({
      variant: 'sheet',
      playlistRows: 16,
      selectionStates: { valid: 14, unknown: 1, contradictory: 1 },
      provenPlaylistIds: 0,
      unidentifiedRows: 16,
      failureReason: null,
    });
    expect(f.report().rows[0].unsupportedReasons).toContain(
      'unknown-selection',
    );
    expect(f.report().rows[1].unsupportedReasons).toContain(
      'conflicting-selection',
    );
    expect(f.clicked).not.toHaveBeenCalled();
  });
  it('reports public attribute names, never names, values, URLs or IDs', async () => {
    const f = fixture(
      saveSheet(sheetRow('PRIVATE_PLAYLIST_NAME', true, ID)),
      (popup) => {
        const row = popup.querySelector('toggleable-list-item-view-model')!;
        row.setAttribute('data-playlist-id', ID);
        row.setAttribute('data-token', 'PRIVATE_TOKEN');
        row.setAttribute('data-private-name', 'PRIVATE_VALUE');
        popup
          .querySelector('a')!
          .setAttribute(
            'href',
            `/playlist?list=${ID}&private_param=PRIVATE_PARAM`,
          );
      },
    );
    await f.adapter.getAvailablePlaylists(VIDEO);
    expect(f.report()).toMatchObject({
      provenPlaylistIds: 1,
      unidentifiedRows: 0,
    });
    expect(f.report().rows[0].unsupportedReasons).toEqual(['sheet-readonly']);
    expect(f.report().publicAttributeNames).toContain('data-playlist-id');
    const copy = formatDialogDiagnostic(f.report());
    for (const secret of [
      'PRIVATE_',
      ID,
      VIDEO,
      '/playlist?',
      'data-token',
      'data-private-name',
    ])
      expect(copy).not.toContain(secret);
    expect(JSON.parse(copy).uiStateIsNotPersistedMembership).toBe(true);
  });
  it('retains a legacy observation after closing and explains the complete-ID gate', async () => {
    const row = (id: string | null) =>
      `<ytd-playlist-add-to-option-renderer><div role="checkbox" aria-label="PRIVATE_NAME" aria-checked="true"></div>${id ? `<a href="/playlist?list=${id}">PRIVATE_NAME</a>` : ''}</ytd-playlist-add-to-option-renderer>`;
    const f = fixture(
      `<div role="dialog"><ytd-add-to-playlist-renderer>${row(ID) + row(null)}</ytd-add-to-playlist-renderer></div>`,
    );
    await f.adapter.getAvailablePlaylists(VIDEO);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(f.report()).toMatchObject({
      variant: 'legacy',
      playlistRows: 2,
      provenPlaylistIds: 1,
      unidentifiedRows: 1,
    });
    expect(f.report().rows[0].unsupportedReasons).toContain(
      'incomplete-id-map',
    );
  });
  it.each([
    'wrong header',
    'missing control',
    'ambiguous IDs',
    'duplicate IDs',
    'multiple sheets',
    'focus lost',
    'closed dialog',
    'youtube error',
  ])('preserves a sanitized report after %s', async (kind) => {
    const rows = sheetRow('PRIVATE_NAME', false, ID);
    const f = fixture(saveSheet(rows), (popup) => {
      if (kind === 'wrong header')
        popup.querySelector('h2')!.textContent = 'PRIVATE_NAME';
      if (kind === 'missing control')
        popup.querySelector('button[role="menuitem"]')!.remove();
      if (kind === 'ambiguous IDs')
        popup
          .querySelector('toggleable-list-item-view-model')!
          .insertAdjacentHTML(
            'beforeend',
            '<a href="/playlist?list=WL">PRIVATE_NAME</a>',
          );
      if (kind === 'duplicate IDs')
        popup
          .querySelector('yt-contextual-sheet-layout')!
          .insertAdjacentHTML('beforeend', rows);
      if (kind === 'multiple sheets')
        document.body.append(popup.cloneNode(true));
      if (kind === 'focus lost')
        vi.mocked(document.hasFocus).mockReturnValue(false);
      if (kind === 'closed dialog') queueMicrotask(() => popup.remove());
      if (kind === 'youtube error')
        document.body.insertAdjacentHTML(
          'beforeend',
          '<div role="alert">PRIVATE_ERROR_TOKEN</div>',
        );
    });
    await expect(f.adapter.getAvailablePlaylists(VIDEO)).rejects.toThrow();
    expect(f.onDiagnostic).toHaveBeenCalled();
    expect(f.report().failureReason).not.toBeNull();
    if (kind === 'wrong header')
      expect(f.report()).toMatchObject({
        variant: 'unsupported',
        playlistRows: 1,
        provenPlaylistIds: 0,
      });
    if (kind === 'ambiguous IDs' || kind === 'duplicate IDs')
      expect(f.report().rows.every((row) => row.identity === 'ambiguous')).toBe(
        true,
      );
    if (kind === 'focus lost')
      expect(f.report().failureReason).toBe('focus-lost');
    if (kind === 'youtube error')
      expect(f.report().failureReason).toBe('youtube-error');
    const copy = formatDialogDiagnostic(f.report());
    for (const secret of ['PRIVATE_', ID, VIDEO])
      expect(copy).not.toContain(secret);
    expect(f.clicked).not.toHaveBeenCalled();
  });
  it('counts candidate rows and public attributes inside an unsupported generic dialog', async () => {
    const f = fixture(
      `<div role="dialog">${sheetRow('PRIVATE_NAME', true, ID)}</div>`,
    );
    await expect(f.adapter.getAvailablePlaylists(VIDEO)).rejects.toThrow();
    expect(f.report()).toMatchObject({
      variant: 'unsupported',
      playlistRows: 1,
      provenPlaylistIds: 0,
      unidentifiedRows: 1,
      failureReason: 'unsupported-structure',
    });
    expect(f.report().publicAttributeNames).toContain('href');
    expect(formatDialogDiagnostic(f.report())).not.toContain(ID);
  });
  it('distinguishes recognized empty dialog rows from a dialog that never opens', async () => {
    const f = fixture(saveSheet(''));
    await expect(f.adapter.getAvailablePlaylists(VIDEO)).rejects.toThrow(
      /timeout/,
    );
    expect(f.report()).toMatchObject({
      variant: 'sheet',
      playlistRows: 0,
      failureReason: 'no-playlist-rows',
    });
  });
  it('reports a bounded timeout when no dialog opens', async () => {
    const f = fixture('');
    // Simulate a Save control that never opens a popup.
    const button = document.querySelector('button')!;
    button.replaceWith(button.cloneNode(true));
    await expect(f.adapter.getAvailablePlaylists(VIDEO)).rejects.toThrow(
      /timeout/,
    );
    expect(f.report()).toMatchObject({
      variant: 'unsupported',
      playlistRows: 0,
      failureReason: 'timeout',
    });
  });
  it('reconstructs untrusted reports from a closed vocabulary before copying', () => {
    const wire = {
      ...emptyDialogDiagnostic('timeout'),
      playlistNames: ['PRIVATE_NAME'],
      videoId: VIDEO,
      cookie: 'PRIVATE_COOKIE',
      publicAttributeNames: ['data-playlist-id', 'data-private-name'],
      failureReason: 'PRIVATE_ERROR',
      rows: [
        {
          index: ID,
          uiState: 'PRIVATE_STATE',
          identity: 'PRIVATE_IDENTITY',
          unsupportedReasons: ['sheet-readonly', 'PRIVATE_REASON'],
          text: 'PRIVATE_TEXT',
        },
      ],
    };
    const safe = sanitizeDialogDiagnostic(wire);
    expect(safe.publicAttributeNames).toEqual(['data-playlist-id']);
    expect(safe.rows[0]).toEqual({
      index: 1,
      uiState: 'unknown',
      identity: 'unverified',
      unsupportedReasons: ['sheet-readonly'],
    });
    const copy = formatDialogDiagnostic(safe);
    for (const secret of ['PRIVATE_', ID, VIDEO])
      expect(copy).not.toContain(secret);
  });
});
