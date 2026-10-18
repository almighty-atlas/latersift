import { describe, expect, it } from 'vitest';
import type { PlaylistEntry } from '../src/adapter/playlists';
import {
  mergePlaylistHistory,
  playlistDisplayName,
  playlistNameLabel,
} from '../src/playlist-catalog';
const entry = (overrides: Partial<PlaylistEntry> = {}): PlaylistEntry => ({
  id: 'PL_fixture',
  name: null,
  url: 'https://www.youtube.com/playlist?list=PL_fixture',
  visibility: 'unknown',
  ownership: 'unknown',
  nameStatus: 'unknown',
  writability: 'unknown',
  ...overrides,
});

describe('playlist catalog presentation and non-destructive history', () => {
  it('shows a neutral label without making up a name from an ID', () => {
    const unknown = entry();
    expect(playlistDisplayName(unknown)).toBe(
      'Playlist ohne bestätigten Namen',
    );
    expect(playlistNameLabel(unknown)).toBe('Name: unbekannt');
    expect(
      playlistDisplayName(entry({ name: 'Unverified', nameStatus: 'unknown' })),
    ).toBe('Playlist ohne bestätigten Namen');
  });
  it('separates fresh confirmation from names stored by old versions', () => {
    expect(
      playlistNameLabel(entry({ name: 'Confirmed', nameStatus: 'confirmed' })),
    ).toBe('Name: bestätigt');
    const legacy = entry({ name: 'Legacy', nameStatus: undefined });
    expect(playlistDisplayName(legacy)).toBe('Legacy');
    expect(playlistNameLabel(legacy)).toBe(
      'Name: gespeichert (älterer Katalog)',
    );
  });
  it('preserves historical names and IDs without assigning them to an unnamed fresh result', () => {
    const legacy = entry({ name: 'Legacy', nameStatus: undefined });
    const fresh = entry();
    const result = mergePlaylistHistory(
      [legacy],
      [fresh, entry({ id: 'PL_other' })],
    );
    expect(result).toEqual([legacy, entry({ id: 'PL_other' })]);
    expect(fresh.name).toBeNull();
    expect(fresh.nameStatus).toBe('unknown');
    expect(
      mergePlaylistHistory(result, [entry({ nameSource: 'conflicting' })]),
    ).toEqual(result);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
  it('updates historical names only with a new named observation and never merges by title', () => {
    const older = entry({ name: 'Same', nameStatus: 'confirmed' });
    const newer = entry({ name: 'New', nameStatus: 'confirmed' });
    const other = entry({
      id: 'PL_other',
      name: 'New',
      nameStatus: 'confirmed',
    });
    expect(mergePlaylistHistory([older], [newer, other])).toEqual([
      newer,
      other,
    ]);
    expect(older.name).toBe('Same');
  });
});
