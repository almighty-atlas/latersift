import { describe, expect, it, vi } from 'vitest';
import {
  scanPlaylists,
  type PlaylistEnvironment,
} from '../src/adapter/playlists';
import {
  playlistDisplayName,
  playlistNameLabel,
} from '../src/playlist-catalog';

// Synthetic rendering of the user-reported structure, not captured private DOM.
const canonical = '<a href="/playlist?list=PL_one">Playlist</a>';
const heading = (text = 'Minecraft', list = 'PL_one') =>
  `<h3><a href="/watch?v=video&list=${list}">${text}</a></h3>`;
const lockup = (content: string) =>
  `<ytd-rich-item-renderer><yt-lockup-view-model>${content}</yt-lockup-view-model></ytd-rich-item-renderer>`;
const metadata = (content: string) =>
  `<yt-lockup-metadata-view-model>${content}</yt-lockup-metadata-view-model>`;
const candidate = (text = 'Minecraft') =>
  lockup(metadata(canonical + heading(text)));

async function scan(snapshots: string[]) {
  const doc = new DOMParser().parseFromString(snapshots[0], 'text/html');
  // DOMParser documents have no CSS view; live content documents do.
  Object.defineProperty(doc, 'defaultView', { value: window });
  const original = doc.body.innerHTML;
  let time = 0;
  let round = 0;
  const click = vi.fn();
  doc.addEventListener('click', click);
  const env: PlaylistEnvironment = {
    doc,
    url: () => 'https://www.youtube.com/feed/playlists',
    now: () => time,
    advance: vi.fn(),
    wait: async (ms) => {
      time += ms;
      round++;
      if (round < snapshots.length) doc.body.innerHTML = snapshots[round];
    },
  };
  const result = await scanPlaylists(
    env,
    new AbortController().signal,
    async () => {},
  );
  expect(click).not.toHaveBeenCalled();
  if (snapshots.length === 1) expect(doc.body.innerHTML).toBe(original);
  return result;
}

describe('structural playlist name hints, never authority', () => {
  it.each(['Minecraft', 'A genuine video title', '  Minecraft\n adventures  '])(
    'shows %s only as an unconfirmed candidate',
    async (text) => {
      const result = await scan([candidate(text)]);
      const entry = result.entries[0];
      expect(entry).toMatchObject({
        candidateName: text.replace(/\s+/g, ' ').trim(),
        candidateSource: 'lockup-watch-heading',
        name: null,
        nameStatus: 'unknown',
        identityEvidence: 'playlist-url',
        ownership: 'unknown',
        writability: 'unknown',
      });
      expect(playlistDisplayName(entry)).toBe(entry.candidateName);
      expect(playlistNameLabel(entry)).toContain(
        'noch nicht unabhängig bestätigt',
      );
      expect(result.status).toBe('partial');
    },
  );

  it.each([
    ['mismatched ID', metadata(canonical + heading('Video', 'PL_other'))],
    ['case mismatch', metadata(canonical + heading('Video', 'pl_one'))],
    [
      'duplicate list parameter',
      metadata(canonical + heading('Video', 'PL_one&list=PL_one')),
    ],
    [
      'no playlist parameter',
      metadata(canonical + '<h3><a href="/watch?v=video">Video</a></h3>'),
    ],
    ['empty heading', metadata(canonical + heading('  '))],
    [
      'CSS-hidden heading',
      metadata(canonical + '<div style="display:none">' + heading() + '</div>'),
    ],
    [
      'ARIA-hidden heading',
      metadata(canonical + '<div aria-hidden="true">' + heading() + '</div>'),
    ],
    [
      'invisible heading',
      metadata(
        canonical + '<div style="visibility:hidden">' + heading() + '</div>',
      ),
    ],
    ['nested metadata', metadata(canonical + metadata(heading()))],
    [
      'multiple matching heading links',
      metadata(
        canonical +
          '<h3><a href="/watch?v=a&list=PL_one">A</a><a href="/watch?v=b&list=PL_one">B</a></h3>',
      ),
    ],
    [
      'same-text duplicate headings',
      metadata(canonical + heading() + heading()),
    ],
    ['different headings', metadata(canonical + heading() + heading('Other'))],
    [
      'multiple metadata regions',
      metadata(canonical + heading()) + metadata('Other'),
    ],
    ['canonical outside metadata', canonical + metadata(heading())],
    ['heading outside metadata', metadata(canonical) + heading()],
    [
      'hidden heading',
      metadata(canonical + '<div hidden>' + heading() + '</div>'),
    ],
    [
      'hidden text inside heading',
      metadata(canonical + heading('Minecraft<span hidden>Other</span>')),
    ],
    [
      'hidden watch link',
      metadata(
        canonical +
          '<h3><a hidden href="/watch?v=v&list=PL_one">Video</a></h3>',
      ),
    ],
    [
      'conflicting watch link',
      metadata(
        canonical + heading() + '<a href="/watch?v=v&list=PL_other">Other</a>',
      ),
    ],
    ['nested card title', metadata(canonical + lockup(heading()))],
    [
      'nested card inside heading',
      metadata(canonical + heading('Minecraft' + lockup('Other'))),
    ],
    [
      'link contains heading rather than proven direction',
      metadata(
        canonical + '<a href="/watch?v=v&list=PL_one"><h3>Video</h3></a>',
      ),
    ],
  ])('does not derive a candidate from %s', async (_label, content) => {
    const result = await scan([lockup(content)]);
    const entry = result.entries.find((entry) => entry.id === 'PL_one')!;
    expect(entry).toBeDefined();
    expect(entry.name).toBeNull();
    expect(entry.candidateName).toBeUndefined();
    expect(playlistDisplayName(entry)).toBe('Playlist ohne bestätigten Namen');
  });

  it.each(['Minecraft', 'Other'])(
    'keeps confirmed evidence separate when a same-ID strict name is %s',
    async (name) => {
      const strict = `<ytd-playlist-renderer><a href="/playlist?list=PL_one"><h3>${name}</h3></a></ytd-playlist-renderer>`;
      const result = await scan([candidate() + strict]);
      if (name === 'Minecraft') {
        expect(result.entries[0]).toMatchObject({
          name: 'Minecraft',
          nameStatus: 'confirmed',
        });
      } else {
        expect(result.entries[0]).toMatchObject({
          name: null,
          nameStatus: 'unknown',
          nameSource: 'conflicting',
        });
        expect(result.entries[0].candidateName).toBeUndefined();
      }
    },
  );

  it('retains 18 candidates through 0 → 4 → 18 virtual loading', async () => {
    const cards = Array.from({ length: 18 }, (_, index) =>
      candidate(`Fixture ${index}`).replaceAll('PL_one', `PL_fixture_${index}`),
    );
    const result = await scan([
      '',
      cards.slice(0, 4).join(''),
      cards.join(''),
      cards.slice(12).join(''),
    ]);
    expect(result.entries).toHaveLength(18);
    result.entries.forEach((entry, index) => {
      expect(entry).toMatchObject({
        candidateName: `Fixture ${index}`,
        name: null,
        nameStatus: 'unknown',
        writability: 'unknown',
        ownership: 'unknown',
      });
    });
    expect(result.diagnostics.completenessVerified).toBe(false);
  });

  it('rejects conflicting canonical identities', async () => {
    const result = await scan([
      lockup(
        metadata(
          canonical + '<a href="/playlist?list=PL_other">Other</a>' + heading(),
        ),
      ),
    ]);
    expect(result.entries).toEqual([]);
  });

  it('retains and deduplicates same candidates across virtual reloads and unnamed observations', async () => {
    const result = await scan([
      candidate() + candidate(),
      lockup(canonical),
      candidate(),
      '',
    ]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      candidateName: 'Minecraft',
      name: null,
      nameStatus: 'unknown',
    });
  });

  it.each([false, true])(
    'makes candidate conflicts sticky across duplicates and reloads (reverse %s)',
    async (reverse) => {
      const pair = [candidate(), candidate('Other')];
      if (reverse) pair.reverse();
      const result = await scan([
        pair.join(''),
        candidate(),
        lockup(canonical),
        candidate(),
      ]);
      expect(result.entries[0]).toMatchObject({
        name: null,
        nameStatus: 'unknown',
        nameSource: 'conflicting',
      });
      expect(result.entries[0].candidateName).toBeUndefined();
    },
  );

  it('detects conflicts that appear only after virtualization', async () => {
    const result = await scan([candidate(), candidate('Other'), candidate()]);
    expect(result.entries[0].candidateName).toBeUndefined();
    expect(result.entries[0].nameSource).toBe('conflicting');
  });

  it('does not promote an equal confirmed name from a different identity', async () => {
    const result = await scan([
      candidate() +
        '<ytd-playlist-renderer><a href="/playlist?list=PL_two"><h3>Minecraft</h3></a></ytd-playlist-renderer>',
    ]);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].nameStatus).toBe('unknown');
    expect(result.entries[1].nameStatus).toBe('confirmed');
  });
});
