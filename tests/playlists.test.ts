import { describe, expect, it, vi } from 'vitest';
import {
  scanPlaylists,
  type PlaylistCatalog,
  type PlaylistEnvironment,
} from '../src/adapter/playlists';

// Synthetic candidate DOM only. These fixtures are not captured/live YouTube evidence.
const epoch = Date.UTC(2026, 0, 1);
function card(id = 'PL_one', name = 'Synthetic playlist', extra = '') {
  return `<ytd-playlist-renderer><a href="/playlist?list=${id}&amp;feature=share"><span id="playlist-title">${name}</span></a>${extra}</ytd-playlist-renderer>`;
}
function fixture(html = card()) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  let time = epoch;
  const env: PlaylistEnvironment = {
    doc,
    url: () => 'https://www.youtube.com/feed/playlists',
    now: () => time,
    advance: vi.fn(),
    wait: vi.fn(async (ms, signal) => {
      if (signal.aborted)
        throw new DOMException('Synthetic abort', 'AbortError');
      time += ms;
    }),
  };
  return { env, doc };
}
function run(env: PlaylistEnvironment) {
  return scanPlaylists(env, new AbortController().signal, async () => {});
}

describe('playlist catalog — synthetic DOM, not live-site validation', () => {
  const lockup = (content: string) =>
    `<ytd-rich-item-renderer><yt-lockup-view-model>${content}</yt-lockup-view-model></ytd-rich-item-renderer>`;
  const unnamed = (id: string) =>
    lockup(
      `<a href="/playlist?list=${id}" aria-label="Thumbnail accessibility suffix"><img alt="Not a title"></a><a href="/watch?v=one&list=${id}">Video one</a><a href="/watch?v=two&list=${id}">Video two</a>`,
    );

  it.each([
    ['matching', '&list=PL_one', 1, 0, 0, 0],
    ['missing', '', 0, 1, 0, 1],
    ['different', '&list=PL_other', 0, 0, 1, 1],
    ['case-sensitive', '&list=PL_One', 0, 0, 1, 1],
    ['prefix', '&list=PL_one_more', 0, 0, 1, 1],
    ['empty', '&list=', 0, 0, 1, 1],
    ['duplicate identical', '&list=PL_one&list=PL_one', 0, 0, 1, 1],
    ['duplicate conflicting', '&list=PL_one&list=PL_other', 0, 0, 1, 1],
  ])(
    'diagnoses %s watch list parameters without confirming video text',
    async (_, query, matching, missing, conflicting, ambiguous) => {
      const { env } = fixture(
        lockup(
          `<a href="/playlist?list=PL_one"><img alt="Thumbnail"></a>
       <yt-lockup-metadata-view-model><h3><a href="/watch?v=video${query}">Single video title</a></h3></yt-lockup-metadata-view-model>`,
        ),
      );
      const result = await run(env);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toMatchObject({
        id: 'PL_one',
        name: null,
        nameStatus: 'unknown',
        nameSource: 'unknown',
        ownership: 'unknown',
        writability: 'unknown',
      });
      expect(
        result.diagnostics.parser?.samples[0]?.titleStructure,
      ).toMatchObject({
        watchLinksMatchingPlaylist: matching,
        watchLinksMissingPlaylist: missing,
        watchLinksConflictingPlaylist: conflicting,
        watchLinksUnresolvedPlaylist: 0,
        headingsWithMatchingWatchPlaylist: matching,
        ambiguousHeadings: ambiguous,
        watchHeadingContainsLink: 1,
        watchLinkContainsHeading: 0,
        watchHeadingsInLockupMetadata: 1,
        watchHeadingsWithCanonicalLinkInMetadata: 0,
        watchHeadingsWithCanonicalLinkOutsideMetadata: 1,
      });
    },
  );

  it('describes a watch link enclosing a heading and a shared metadata boundary, not a confirmed name', async () => {
    const { env } = fixture(
      lockup(`<yt-lockup-metadata-view-model>
      <a href="/watch?v=video&list=PL_one"><h3>Video title</h3></a>
      <a href="/playlist?list=PL_one">View playlist</a>
      </yt-lockup-metadata-view-model>`),
    );
    const result = await run(env);
    expect(result.entries[0]?.name).toBeNull();
    expect(result.diagnostics.parser?.samples[0]?.titleStructure).toMatchObject(
      {
        watchLinksMatchingPlaylist: 1,
        watchHeadingContainsLink: 0,
        watchLinkContainsHeading: 1,
        watchHeadingsInLockupMetadata: 1,
        watchHeadingsWithCanonicalLinkInMetadata: 1,
        watchHeadingsWithCanonicalLinkOutsideMetadata: 0,
      },
    );
  });

  it.each([
    '<a href="/watch?v=a&list=PL_one">One</a><a href="/watch?v=b&list=PL_one">Two</a>',
    '<a href="/watch?v=a&list=PL_one">One</a><a href="/watch?v=b&list=PL_other">Two</a>',
    '<a href="/watch?v=a&list=PL_one">One</a><a href="/playlist?list=PL_one">Playlist</a>',
  ])('counts a heading with multiple links as ambiguous: %s', async (links) => {
    const { env } = fixture(
      lockup(`<a href="/playlist?list=PL_one"></a><h3>${links}</h3>`),
    );
    const result = await run(env);
    expect(result.entries[0]?.name).toBeNull();
    expect(result.diagnostics.parser?.samples[0]?.titleStructure).toMatchObject(
      {
        headingsWithMatchingWatchPlaylist: 1,
        ambiguousHeadings: 1,
      },
    );
  });

  it('counts multiple same-text watch headings as ambiguous, not one unique name', async () => {
    const { env } = fixture(
      lockup(`<a href="/playlist?list=PL_one"></a>
      <h3><a href="/watch?v=a&list=PL_one">Same text</a></h3>
      <h3><a href="/watch?v=b&list=PL_one">Same text</a></h3>`),
    );
    const result = await run(env);
    expect(result.entries[0]?.name).toBeNull();
    expect(result.diagnostics.parser?.samples[0]?.titleStructure).toMatchObject(
      {
        headingsWithMatchingWatchPlaylist: 2,
        ambiguousHeadings: 2,
      },
    );
  });

  it.each([
    'hidden',
    'aria-hidden="true"',
    'style="display:none"',
    'style="visibility:hidden"',
  ])('excludes %s watch headings and links', async (attribute) => {
    const { env, doc } = fixture(
      lockup(`<a href="/playlist?list=PL_one"></a>
      <yt-lockup-metadata-view-model ${attribute}><h3><a href="/watch?v=a&list=PL_one">Hidden</a></h3></yt-lockup-metadata-view-model>`),
    );
    Object.defineProperty(doc, 'defaultView', { value: window });
    const result = await run(env);
    expect(result.entries[0]?.name).toBeNull();
    expect(result.diagnostics.parser?.samples[0]?.titleStructure).toMatchObject(
      {
        watchLinksMatchingPlaylist: 0,
        watchLinkedHeadings: 0,
        headingsWithMatchingWatchPlaylist: 0,
        ambiguousHeadings: 0,
        watchHeadingsInLockupMetadata: 0,
      },
    );
  });

  it('excludes nested-card watch headings even when the playlist ID matches', async () => {
    const { env } = fixture(
      lockup(`<a href="/playlist?list=PL_one"></a>
      <ytd-playlist-renderer><a href="/playlist?list=PL_one"></a>
      <yt-lockup-metadata-view-model><h3><a href="/watch?v=a&list=PL_one">Nested video</a></h3></yt-lockup-metadata-view-model>
      </ytd-playlist-renderer>`),
    );
    const result = await run(env);
    expect(result.entries[0]?.name).toBeNull();
    const samples = result.diagnostics.parser!.samples;
    expect(samples[0]?.titleStructure).toMatchObject({
      watchLinksMatchingPlaylist: 0,
      watchLinkedHeadings: 0,
    });
    expect(samples[1]?.titleStructure).toMatchObject({
      watchLinksMatchingPlaylist: 1,
      watchLinkedHeadings: 1,
    });
  });

  it('does not compare watch IDs to an arbitrary first canonical playlist in conflicting cards', async () => {
    const { env } = fixture(
      lockup(`<a href="/playlist?list=PL_one"></a><a href="/playlist?list=PL_two"></a>
      <h3><a href="/watch?v=a&list=PL_one">Video</a></h3>`),
    );
    const result = await run(env);
    expect(result.entries).toEqual([]);
    expect(result.diagnostics.parser?.samples[0]?.titleStructure).toMatchObject(
      {
        canonicalLinkCount: 0,
        watchLinksMatchingPlaylist: 0,
        watchLinksUnresolvedPlaylist: 1,
        ambiguousHeadings: 1,
      },
    );
  });

  it('keeps equal watch titles on different playlist identities unnamed and separate', async () => {
    const { env } = fixture(
      ['PL_one', 'PL_two']
        .map((id) =>
          lockup(
            `<a href="/playlist?list=${id}"></a><h3><a href="/watch?v=a&list=${id}">Same text</a></h3>`,
          ),
        )
        .join(''),
    );
    const result = await run(env);
    expect(result.entries.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'PL_one', name: null },
      { id: 'PL_two', name: null },
    ]);
    for (const sample of result.diagnostics.parser!.samples)
      expect(sample.titleStructure?.watchLinksMatchingPlaylist).toBe(1);
  });

  it('identifies 18 unnamed lockups after background growth 0 → 4 → 18 without claiming completeness', async () => {
    const { env, doc } = fixture('');
    let calls = 0;
    env.advance = vi.fn(() => {
      calls++;
      if (calls === 1 || calls === 3)
        doc.body.innerHTML = Array.from(
          { length: calls === 1 ? 4 : 18 },
          (_, i) => unnamed(`PL_${i}`),
        ).join('');
    });
    const click = vi.spyOn(HTMLElement.prototype, 'click');
    const fetch = vi.spyOn(globalThis, 'fetch');
    const result = await run(env);
    expect(result.status).toBe('partial');
    expect(result.entries).toHaveLength(18);
    for (const entry of result.entries)
      expect(entry).toMatchObject({
        name: null,
        nameStatus: 'unknown',
        nameSource: 'unknown',
        identityEvidence: 'playlist-url',
        writability: 'unknown',
        ownership: 'unknown',
      });
    expect(result.diagnostics).toMatchObject({
      unsupportedCards: 0,
      completenessVerified: false,
      cardCount: { initial: 0, latest: 18, max: 18 },
      parser: {
        latest: { missing_title_node: 18 },
        peaks: { missing_title_node: 18 },
        identifiedUnnamed: { latest: 18, peak: 18 },
        samplesTruncated: true,
      },
    });
    expect(
      result.diagnostics.cardCount?.changes.map(
        ({ total, accepted, rejected }) => [total, accepted, rejected],
      ),
    ).toEqual([
      [0, 0, 0],
      [4, 4, 0],
      [18, 18, 0],
    ]);
    expect(result.diagnostics.parser?.samples).toHaveLength(12);
    for (const sample of result.diagnostics.parser!.samples)
      expect(sample).toMatchObject({
        reasons: ['missing_title_node'],
        distinctValidIds: 1,
        links: { playlist: 1, watch: 2 },
        titleStructure: {
          canonicalLinkCount: 1,
          linkHeadings: 0,
          metadataHeadings: 0,
          ariaLabelledbyLinks: 0,
          localHeadingReferences: 0,
          missingOrAmbiguousReferences: 0,
          watchLinkedHeadings: 0,
          canonicalLinkHasAriaLabel: 1,
        },
      });
    expect(click).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    click.mockRestore();
    fetch.mockRestore();
  });

  it.each([
    '<a href="/playlist?list=PL_one"><h2>Semantic name</h2></a>',
    '<h1><a href="/playlist?list=PL_one">Semantic name</a></h1>',
    '<div role="heading"><a href="/playlist?list=PL_one">Semantic name</a></div>',
    '<a role="heading" href="/playlist?list=PL_one">Semantic name</a>',
    '<h6><a href="/playlist?list=PL_one&feature=share">Semantic</a> <a href="/playlist?list=PL_one">name</a></h6>',
    '<a href="/playlist?list=PL_one" aria-labelledby="local-title">Thumbnail</a><h4 id="local-title">Semantic name</h4>',
    '<a href="/playlist?list=PL_one" aria-labelledby="local-title">Thumbnail</a><span id="local-title" class="yt-lockup-metadata-view-model__title">Semantic name</span>',
  ])(
    'confirms a synthetic semantic title relationship: %s',
    async (content) => {
      const { env } = fixture(lockup(content));
      const result = await run(env);
      expect(result.entries[0]).toMatchObject({
        name: 'Semantic name',
        nameStatus: 'confirmed',
        nameSource: content.includes('aria-labelledby')
          ? 'aria-labelledby'
          : 'playlist-heading',
        identityEvidence: 'playlist-url',
        writability: 'unknown',
      });
      expect(result.diagnostics.parser?.identifiedUnnamed?.latest).toBe(0);
    },
  );

  it.each([
    '<h3><a href="/playlist?list=PL_one">Playlist name</a><a hidden href="/watch?v=one"> Watch title</a></h3>',
    '<a href="/playlist?list=PL_one"><h3>Playlist name<span aria-hidden="true"> Watch title</span></h3></a>',
    '<a href="/playlist?list=PL_one"><span id="playlist-title">Playlist name<span style="display:none"> Watch title</span></span></a>',
    '<a href="/playlist?list=PL_one" aria-labelledby="local-title">Thumbnail</a><h3 id="local-title">Playlist name<span hidden> Watch title</span></h3>',
    '<a href="/playlist?list=PL_one" aria-labelledby="local-title">Thumbnail</a><span class="yt-lockup-metadata-view-model__title" id="local-title">Playlist name<a hidden href="/watch?v=one"> Watch title</a></span>',
    '<a role="heading" href="/playlist?list=PL_one">Playlist name<ytd-grid-playlist-renderer><h3> Other card metadata</h3></ytd-grid-playlist-renderer></a>',
    '<a href="/playlist?list=PL_one" aria-labelledby="local-title">Thumbnail</a><div role="heading" id="local-title">Playlist name<ytd-grid-playlist-renderer><span> Other card metadata</span><a href="/watch?v=one"> Watch title</a></ytd-grid-playlist-renderer></div>',
  ])(
    'extracts only visible same-card text from validated titles: %s',
    async (content) => {
      const { env, doc } = fixture(lockup(content));
      // Exercise CSS visibility with a view; detached fixtures otherwise lack one.
      Object.defineProperty(doc, 'defaultView', { value: window });
      const result = await run(env);
      expect(result.entries).toMatchObject([
        {
          id: 'PL_one',
          name: 'Playlist name',
          nameStatus: 'confirmed',
          identityEvidence: 'playlist-url',
        },
      ]);
      expect(result.diagnostics.parser?.latest.conflicting_titles).toBe(0);
    },
  );

  it.each([
    '<a href="/playlist?list=PL_one"><h3><span hidden>Hidden title</span></h3></a>',
    '<a href="/playlist?list=PL_one" aria-labelledby="local-title">Thumbnail</a><h3 id="local-title"><span hidden>Hidden title</span></h3>',
    '<a href="/playlist?list=PL_one"><ytd-grid-playlist-renderer><h3>Other card metadata</h3><span id="playlist-title">Other legacy title</span></ytd-grid-playlist-renderer></a>',
    '<a href="/playlist?list=PL_one" aria-labelledby="nested-title">Thumbnail<ytd-grid-playlist-renderer><h3 id="nested-title">Other card metadata</h3></ytd-grid-playlist-renderer></a>',
    '<a href="/playlist?list=PL_one">Thumbnail</a><div role="heading"><ytd-grid-playlist-renderer><a href="/playlist?list=PL_one"></a>Other card metadata</ytd-grid-playlist-renderer></div>',
  ])(
    'preserves identity without adopting hidden or nested-card names: %s',
    async (content) => {
      const { env } = fixture(lockup(content));
      const result = await run(env);
      expect(result.entries).toMatchObject([
        {
          id: 'PL_one',
          name: null,
          nameStatus: 'unknown',
          identityEvidence: 'playlist-url',
        },
      ]);
      expect(result.diagnostics.cardCount?.changes[0].accepted).toBeGreaterThan(
        0,
      );
    },
  );

  it('does not inherit an outer-card canonical anchor for a nested-card heading', async () => {
    const { env } = fixture(
      lockup(
        '<a href="/playlist?list=PL_one"><ytd-grid-playlist-renderer><h3>Other card metadata</h3></ytd-grid-playlist-renderer></a>',
      ),
    );
    // Construct the nesting through DOM methods: parsing nested anchors would repair it.
    const nested = env.doc.querySelector('ytd-grid-playlist-renderer')!;
    const nestedAnchor = env.doc.createElement('a');
    nestedAnchor.href = '/playlist?list=PL_nested';
    nested.append(nestedAnchor);
    const result = await run(env);
    expect(result.entries).toMatchObject([
      { id: 'PL_nested', name: null, nameStatus: 'unknown' },
    ]);
    expect(result.diagnostics.parser?.latest.conflicting_playlist_ids).toBe(1);
  });

  it.each([
    '<h3 class="yt-lockup-metadata-view-model__title">Unlinked CSS title</h3>',
    '<a class="yt-lockup-metadata-view-model__title" href="/playlist?list=PL_one">CSS alone</a>',
    '<h3><a href="/playlist?list=PL_one">Playlist</a><a href="/watch?v=one">Video</a></h3>',
    '<h3><a href="/watch?v=one">Video</a></h3>',
    '<span id="playlist-title">Unlinked legacy title</span>',
    '<h3 hidden><a href="/playlist?list=PL_one">Hidden</a></h3>',
    '<h2><a href="/playlist?list=PL_one">One</a></h2><h3><a href="/playlist?list=PL_one">Two</a></h3>',
  ])(
    'keeps proven identity with unknown or conflicting title: %s',
    async (content) => {
      const { env } = fixture(
        lockup(
          `<a href="/playlist?list=PL_one" title="Not title" aria-label="Not title">Thumbnail</a>${content}`,
        ),
      );
      const result = await run(env);
      expect(result.entries).toMatchObject([
        { id: 'PL_one', name: null, nameStatus: 'unknown' },
      ]);
      expect(result.diagnostics.unsupportedCards).toBe(0);
      expect(result.diagnostics.parser?.samples).toHaveLength(1);
    },
  );

  it.each([
    ['missing', ''],
    ['outside', '<h3 id="outside">Outside</h3>'],
    ['duplicate', ''],
    ['one two', ''],
    ['shared', ''],
    ['hidden', ''],
    ['cross', lockup('<h3 id="cross">Other card</h3>')],
    ['watch', ''],
  ])(
    'rejects unsafe labelledby reference %s without rejecting identity',
    async (ref, outside) => {
      const { env } = fixture(
        `${outside}${lockup(`<a href="/playlist?list=PL_one" aria-labelledby="${ref}">Thumbnail</a><h3 id="duplicate">One</h3><h3 id="duplicate">Two</h3><h3 id="one">One</h3><h3 id="two">Two</h3><h3 id="shared">Shared</h3><a href="/watch?v=one" aria-labelledby="shared">Watch</a><h3 id="hidden" hidden>Hidden</h3><h3 id="watch"><a href="/watch?v=one">Video</a></h3>`)}`,
      );
      const result = await run(env);
      expect(result.entries[0]).toMatchObject({
        name: null,
        nameStatus: 'unknown',
      });
      expect(
        result.diagnostics.parser?.samples.find(
          (sample) => sample.titleStructure?.ariaLabelledbyLinks === 1,
        )?.titleStructure,
      ).toMatchObject({
        ariaLabelledbyLinks: 1,
        localHeadingReferences: 0,
        missingOrAmbiguousReferences: 1,
      });
    },
  );

  it('ignores hidden playlist links for identity and titles, but rejects visible ambiguous identity', async () => {
    const { env } = fixture(
      card(
        'PL_one',
        'Good',
        '<a hidden href="/playlist?list=PL_other"><h2>Hidden</h2></a>',
      ) +
        lockup(
          '<a hidden href="/playlist?list=PL_hidden">Hidden</a><h3><a href="/watch?v=one&list=PL_hidden">Video</a></h3>',
        ) +
        lockup(
          '<a href="/playlist?list=PL_two">One</a><a href="/playlist?list=PL_three">Two</a>',
        ),
    );
    const result = await run(env);
    expect(result.entries).toMatchObject([{ id: 'PL_one', name: 'Good' }]);
    expect(result.diagnostics.unsupportedCards).toBe(2);
  });

  it.each([false, true])(
    'retains a confirmed name across unnamed duplicates in either order (%s)',
    async (reverse) => {
      const cards = [card('PL_one', 'Confirmed'), unnamed('PL_one')];
      const { env } = fixture((reverse ? cards.reverse() : cards).join(''));
      const result = await run(env);
      expect(result.entries).toMatchObject([
        {
          name: 'Confirmed',
          nameStatus: 'confirmed',
          nameSource: 'legacy-title',
        },
      ]);
      expect(result.diagnostics.parser?.latest.missing_title_node).toBe(1);
    },
  );

  it('preserves a scan-confirmed name when later rounds contain only unnamed duplicates', async () => {
    const { env, doc } = fixture(card('PL_one', 'Confirmed'));
    env.advance = vi.fn(() => {
      doc.body.innerHTML = unnamed('PL_one');
    });
    const result = await run(env);
    expect(result.entries).toMatchObject([
      {
        name: 'Confirmed',
        nameStatus: 'confirmed',
        nameSource: 'legacy-title',
      },
    ]);
    expect(result.diagnostics.parser?.identifiedUnnamed).toEqual({
      latest: 1,
      peak: 1,
    });
    expect(result.diagnostics.parser?.latest.missing_title_node).toBe(1);
  });

  it('retains confirmed evidence across rounds, but never resurrects conflicting names', async () => {
    const { env, doc } = fixture(card('PL_one', 'One'));
    let calls = 0;
    const snapshots: PlaylistCatalog[] = [];
    env.advance = vi.fn(() => {
      calls++;
      if (calls === 1) doc.body.innerHTML = unnamed('PL_one');
      if (calls === 2) doc.body.innerHTML = card('PL_one', 'Two');
      if (calls === 3)
        doc.body.innerHTML = card('PL_one', 'One') + unnamed('PL_one');
    });
    const result = await scanPlaylists(
      env,
      new AbortController().signal,
      (catalog) => {
        snapshots.push(catalog);
      },
    );
    expect(result.entries).toMatchObject([
      { name: null, nameStatus: 'unknown', nameSource: 'conflicting' },
    ]);
    expect(snapshots[0].entries[0].name).toBe('One');
    expect(result.diagnostics.parser?.latest.conflicting_titles).toBe(2);
    expect(result.diagnostics.parser?.identifiedUnnamed?.latest).toBe(2);
    // A new scan must not inherit names from a previous catalog.
    doc.body.innerHTML = unnamed('PL_one');
    expect((await run(env)).entries[0].name).toBeNull();
  });

  it.each([false, true])(
    'merges conflicting same-ID duplicates conservatively in either order (%s)',
    async (reverse) => {
      const cards = [
        card('PL_one', 'One'),
        card('PL_one', 'Two'),
        unnamed('PL_one'),
      ];
      const { env } = fixture((reverse ? cards.reverse() : cards).join(''));
      const result = await run(env);
      expect(result.entries).toMatchObject([
        { id: 'PL_one', name: null, nameSource: 'conflicting' },
      ]);
      expect(result.diagnostics.parser?.latest.conflicting_titles).toBe(3);
      expect(result.diagnostics.cardCount?.changes[0]).toMatchObject({
        accepted: 3,
        rejected: 0,
      });
    },
  );
  it.each([
    card(),
    '<ytd-grid-playlist-renderer><a href="/playlist?list=PL_one" id="video-title">Synthetic playlist</a></ytd-grid-playlist-renderer>',
    '<ytd-rich-item-renderer><yt-lockup-view-model><a href="/playlist?list=PL_one">Thumbnail</a><h3 class="yt-lockup-metadata-view-model__title"><a href="/playlist?list=PL_one">Synthetic playlist</a></h3></yt-lockup-view-model></ytd-rich-item-renderer>',
  ])('reads a candidate card with separate title: %s', async (html) => {
    const { env } = fixture(html);
    const result = await run(env);
    expect(result.entries).toMatchObject([
      {
        id: 'PL_one',
        name: 'Synthetic playlist',
        url: 'https://www.youtube.com/playlist?list=PL_one',
        visibility: 'unknown',
        ownership: 'unknown',
      },
    ]);
    expect(result.status).toBe('partial');
    expect(result.diagnostics.reason).toBe('stable_unverified_end');
    expect(env.advance).toHaveBeenCalled();
    expect(Date.parse(result.updatedAt)).toBeGreaterThan(epoch);
  });

  it('deduplicates canonical URLs, never equal names', async () => {
    const { env } = fixture(
      card('PL_one', 'Same name') +
        card('PL_one', 'Same name').replace(
          '/playlist?list=PL_one&amp;feature=share',
          'https://www.youtube.com/playlist?feature=other&amp;list=PL_one#x',
        ) +
        card('PL_two', 'Same name'),
    );
    const result = await run(env);
    expect(result.entries.map((entry) => entry.id)).toEqual([
      'PL_one',
      'PL_two',
    ]);
  });

  it.each([
    '/watch?v=abcdefghijk&list=PL_one',
    '/playlist',
    '/playlist?list=',
    '/playlist?list=bad%20id',
    '/playlist?list=PL_one&list=PL_two',
    'https://evil.example/playlist?list=PL_one',
    'https://www.youtube.com.evil.example/playlist?list=PL_one',
    'javascript:alert(1)',
  ])('rejects unproven playlist URL %s', async (href) => {
    const { env } = fixture(
      `<ytd-playlist-renderer><a href="${href}" id="playlist-title">Synthetic title</a></ytd-playlist-renderer>`,
    );
    const result = await run(env);
    expect(result.entries).toEqual([]);
    expect(result.status).toBe('failed');
    expect(result.diagnostics.reason).toBe('unsupported_dom');
    expect(result.diagnostics.unsupportedCards).toBe(1);
  });

  it('does not treat aggregate card text, thumbnail attributes or watch titles as playlist names', async () => {
    const { env } = fixture(`
      <ytd-playlist-renderer><a href="/playlist?list=PL_one" title="Thumbnail label" aria-label="Private owned playlist">Thumbnail</a>Playlist 12 videos</ytd-playlist-renderer>
      <ytd-playlist-renderer><a href="/playlist?list=PL_two">Thumbnail</a><a href="/watch?v=abcdefghijk" id="video-title">Video title</a></ytd-playlist-renderer>
      <a href="/playlist?list=PL_three" id="playlist-title">Outside supported cards</a>
      <yt-lockup-view-model><a href="/playlist?list=PL_four" id="playlist-title">Outside rich item</a></yt-lockup-view-model>`);
    expect((await run(env)).entries.map((entry) => entry.name)).toEqual([
      null,
      null,
    ]);
  });

  it('retains conflicting names as unknown but rejects multi-playlist cards', async () => {
    const { env } = fixture(
      card(
        'PL_one',
        'One',
        '<a href="/playlist?list=PL_one" id="video-title">Another title</a>',
      ) +
        card(
          'PL_two',
          'Two',
          '<a href="/playlist?list=PL_three">Other playlist</a>',
        ),
    );
    expect((await run(env)).entries).toMatchObject([
      { id: 'PL_one', name: null, nameSource: 'conflicting' },
    ]);
  });

  it('never infers private visibility or ownership from names, prose or edit controls', async () => {
    const { env } = fixture(
      card(
        'PL_one',
        'Private · Privat · My playlists · Owned',
        '<span>Private playlist, created by you</span><button aria-label="Edit playlist">Edit</button>',
      ),
    );
    expect((await run(env)).entries[0]).toMatchObject({
      visibility: 'unknown',
      ownership: 'unknown',
    });
  });

  it.each(['private', 'public', 'unlisted'] as const)(
    'reads only explicit structured synthetic %s badges',
    async (visibility) => {
      const { env } = fixture(
        card(
          'PL_one',
          'Synthetic',
          `<ytd-badge-supported-renderer badge-style-type="BADGE_STYLE_TYPE_PRIVACY_${visibility.toUpperCase()}"></ytd-badge-supported-renderer>`,
        ),
      );
      expect((await run(env)).entries[0]).toMatchObject({
        visibility,
        ownership: 'unknown',
      });
    },
  );

  it('treats contradictory badges conservatively and ignores unstructured badge prose', async () => {
    const { env } = fixture(
      card(
        'PL_one',
        'One',
        '<ytd-badge-supported-renderer><span class="badge-style-type-privacy-private"></span><span class="badge-style-type-privacy-public"></span></ytd-badge-supported-renderer>',
      ) +
        card(
          'PL_two',
          'Two',
          '<ytd-badge-supported-renderer>Private</ytd-badge-supported-renderer>',
        ),
    );
    expect((await run(env)).entries.map((entry) => entry.visibility)).toEqual([
      'unknown',
      'unknown',
    ]);
  });

  it('ignores hidden structured privacy evidence', async () => {
    const { env } = fixture(
      card(
        'PL_one',
        'Synthetic',
        '<ytd-badge-supported-renderer><span hidden class="badge-style-type-privacy-private"></span></ytd-badge-supported-renderer>',
      ),
    );
    expect((await run(env)).entries[0].visibility).toBe('unknown');
  });

  it('retains identity but ignores a lockup heading linking to a video', async () => {
    const { env } = fixture(
      '<ytd-rich-item-renderer><yt-lockup-view-model><a href="/playlist?list=PL_one">Thumbnail</a><h3 class="yt-lockup-metadata-view-model__title"><a href="/watch?v=abcdefghijk">Video title</a></h3></yt-lockup-view-model></ytd-rich-item-renderer>',
    );
    expect((await run(env)).entries).toMatchObject([
      { id: 'PL_one', name: null },
    ]);
  });

  it('ignores hidden cards and hidden continuation markers', async () => {
    const { env } = fixture(
      `<div hidden>${card()}</div><ytd-continuation-item-renderer hidden></ytd-continuation-item-renderer>`,
    );
    const result = await run(env);
    expect(result.entries).toEqual([]);
    expect(result.diagnostics.continuationSeen).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.diagnostics.reason).toBe('unsupported_dom');
    expect(result.diagnostics.parser?.latest.hidden_card).toBe(1);
  });

  it('waits through delayed continuation loading and retains virtualized entries', async () => {
    const { env, doc } = fixture(
      card() +
        '<ytd-continuation-item-renderer></ytd-continuation-item-renderer>',
    );
    let advances = 0;
    env.advance = vi.fn(() => {
      if (++advances === 9) doc.body.innerHTML = card('PL_two', 'Loaded later');
    });
    const snapshots: PlaylistCatalog[] = [];
    const result = await scanPlaylists(
      env,
      new AbortController().signal,
      (snapshot) => {
        snapshots.push(snapshot);
      },
    );
    expect(result.entries.map((entry) => entry.id)).toEqual([
      'PL_one',
      'PL_two',
    ]);
    expect(result.status).toBe('partial');
    expect(result.diagnostics).toMatchObject({
      continuationSeen: true,
      continuation: false,
    });
    expect(snapshots[0].entries).toHaveLength(1);
    expect(
      snapshots.some(
        (snapshot) =>
          snapshot.status === 'running' && snapshot.entries.length === 2,
      ),
    ).toBe(true);
    expect(snapshots.at(-1)).toEqual(result);
  });

  it('diagnoses a stalled continuation without claiming completeness', async () => {
    const { env } = fixture(
      card() +
        '<ytd-continuation-item-renderer></ytd-continuation-item-renderer>',
    );
    const result = await run(env);
    expect(result).toMatchObject({
      status: 'partial',
      diagnostics: {
        reason: 'continuation_stalled',
        expectedCount: null,
        completenessVerified: false,
      },
    });
    expect(env.advance).toHaveBeenCalledTimes(12);
  });

  it('bounds real scroll calls even with continuous progress and a frozen clock', async () => {
    const { env, doc } = fixture();
    env.now = () => epoch;
    let calls = 0;
    env.advance = vi.fn(() => {
      doc.body.innerHTML = card(`PL_${++calls}`, `Playlist ${calls}`);
    });
    const result = await run(env);
    expect(env.advance).toHaveBeenCalledTimes(60);
    expect(env.wait).toHaveBeenCalledTimes(60);
    expect(result.entries).toHaveLength(61);
    expect(result.diagnostics.reason).toBe('scroll_budget');
  });

  it('records actual geometry changes separately from scroll attempts', async () => {
    const { env } = fixture();
    let top = 0;
    env.scrollInfo = () => ({
      container: 'synthetic',
      top,
      height: 3000,
      viewport: 1000,
    });
    env.advance = vi.fn(() => {
      top = Math.min(2000, top + 500);
    });
    const result = await run(env);
    expect(result.diagnostics.observedScrolls).toBe(4);
    expect(result.diagnostics.scroll).toMatchObject({ top: 2000 });
    expect(result.status).toBe('partial');
    expect(result.diagnostics.scrollAttempts).toBeGreaterThan(4);
  });

  it('retains entries when aborted during a wait and checkpoints the terminal status', async () => {
    const { env } = fixture();
    const controller = new AbortController();
    env.wait = async () => {
      controller.abort();
      throw new DOMException('Synthetic abort', 'AbortError');
    };
    const checkpoint = vi.fn();
    const result = await scanPlaylists(env, controller.signal, checkpoint);
    expect(result.status).toBe('interrupted');
    expect(result.entries).toHaveLength(1);
    expect(checkpoint.mock.calls.at(-1)?.[0]).toEqual(result);
  });

  it('does not scroll after an abort from the first progress checkpoint', async () => {
    const { env } = fixture();
    const controller = new AbortController();
    const result = await scanPlaylists(env, controller.signal, () => {
      controller.abort();
    });
    expect(result.status).toBe('interrupted');
    expect(result.entries).toHaveLength(1);
    expect(env.advance).not.toHaveBeenCalled();
  });

  it('does no work if already aborted', async () => {
    const { env } = fixture();
    const controller = new AbortController();
    controller.abort();
    expect((await scanPlaylists(env, controller.signal, () => {})).status).toBe(
      'interrupted',
    );
    expect(env.advance).not.toHaveBeenCalled();
  });

  it('retains entries after navigation away from the feed', async () => {
    const { env } = fixture();
    env.wait = async () => {
      env.url = () => 'https://www.youtube.com/feed/history';
    };
    const result = await run(env);
    expect(result).toMatchObject({
      status: 'interrupted',
      diagnostics: { reason: 'navigation' },
    });
    expect(result.entries).toHaveLength(1);
    expect(env.advance).toHaveBeenCalledTimes(1);
  });

  it.each([
    'https://evil.example/feed/playlists',
    'https://www.youtube.com/feed/history',
    'not a URL',
  ])('rejects other locations: %s', async (url) => {
    const { env } = fixture();
    env.url = () => url;
    const result = await run(env);
    expect(result.status).toBe('interrupted');
    expect(result.entries).toEqual([]);
    expect(env.advance).not.toHaveBeenCalled();
  });

  it.each(['advance', 'wait', 'scrollInfo'] as const)(
    'retains already parsed entries after a synthetic %s failure',
    async (method) => {
      const { env } = fixture();
      env[method] = () => {
        throw new Error('Synthetic failure');
      };
      const result = await run(env);
      expect(result).toMatchObject({
        status: 'failed',
        diagnostics: { reason: 'scanner_error' },
      });
      expect(result.entries).toHaveLength(1);
    },
  );

  it('returns retained entries and explicit storage diagnostics if checkpoints fail', async () => {
    const { env } = fixture();
    const result = await scanPlaylists(
      env,
      new AbortController().signal,
      () => {
        throw new Error('Synthetic storage failure');
      },
    );
    expect(result).toMatchObject({
      status: 'failed',
      diagnostics: {
        reason: 'checkpoint_error',
        checkpointError: 'checkpoint_failed',
      },
    });
    expect(result.entries).toHaveLength(1);
    expect(env.advance).not.toHaveBeenCalled();
  });

  it.each([
    ['no_playlist_link', '<span id="playlist-title">Title</span>'],
    [
      'conflicting_playlist_ids',
      '<a href="/playlist?list=PL_one" id="playlist-title">Title</a><a href="/playlist?list=PL_two">Other</a>',
    ],
    ['missing_title_node', '<a href="/playlist?list=PL_one">Thumbnail</a>'],
    [
      'conflicting_titles',
      '<a href="/playlist?list=PL_one" id="playlist-title">One</a><a href="/playlist?list=PL_one" id="video-title">Two</a>',
    ],
    [
      'ambiguous_title_link',
      '<a href="/playlist?list=PL_one">Thumbnail</a><a href="/watch?v=video" id="video-title">Title</a>',
    ],
    [
      'incomplete_rendering',
      '<a href="/playlist?list=PL_one" id="playlist-title"></a>',
    ],
    ['hidden_card', '<div hidden><span id="playlist-title">Title</span></div>'],
  ] as const)(
    'reports fixed rejection or naming warning %s without polling inflation',
    async (reason, content) => {
      const { env } = fixture(
        `<ytd-playlist-renderer ${reason === 'hidden_card' ? 'hidden' : ''}>${content}</ytd-playlist-renderer>`,
      );
      const result = await run(env);
      const rejected = [
        'no_playlist_link',
        'conflicting_playlist_ids',
        'hidden_card',
      ].includes(reason);
      expect(result.status).toBe(rejected ? 'failed' : 'partial');
      expect(result.diagnostics.unsupportedCards).toBe(
        rejected && reason !== 'hidden_card' ? 1 : 0,
      );
      expect(result.diagnostics.parser?.latest[reason]).toBe(1);
      expect(result.diagnostics.parser?.peaks[reason]).toBe(1);
      expect(result.diagnostics.parser?.samples[0].reasons).toContain(reason);
      expect(result.diagnostics.rounds).toBeGreaterThan(1);
    },
  );

  it('counts all applicable reasons but does not guess incomplete rendering', async () => {
    const { env } = fixture(
      '<ytd-playlist-renderer></ytd-playlist-renderer><ytd-grid-playlist-renderer><a href="" id="playlist-title"></a></ytd-grid-playlist-renderer>',
    );
    const result = await run(env);
    expect(result.diagnostics.parser?.latest).toEqual({
      no_playlist_link: 2,
      missing_title_node: 1,
      incomplete_rendering: 1,
      conflicting_playlist_ids: 0,
      conflicting_titles: 0,
      ambiguous_title_link: 1,
      hidden_card: 0,
    });
    expect(result.diagnostics.parser?.samples[0].reasons).not.toContain(
      'incomplete_rendering',
    );
  });

  it('separates three unnamed identities from one unsupported card without blaming scrolling', async () => {
    const { env } = fixture(`
      <ytd-playlist-renderer><a href="/watch?v=video" id="playlist-title">Title</a></ytd-playlist-renderer>
      <ytd-playlist-renderer><a href="/playlist?list=PL_one">Thumbnail</a></ytd-playlist-renderer>
      <ytd-grid-playlist-renderer><a href="/playlist?list=PL_two" id="playlist-title"></a></ytd-grid-playlist-renderer>
      <ytd-rich-item-renderer><yt-lockup-view-model><a href="/playlist?list=PL_three">Thumbnail</a><h3 class="yt-lockup-metadata-view-model__title"><a href="/watch?v=video">Video</a></h3></yt-lockup-view-model></ytd-rich-item-renderer>`);
    env.scrollInfo = () => ({ top: 0, height: 1258, viewport: 1258 });
    const result = await run(env);
    expect(result).toMatchObject({
      status: 'partial',
      diagnostics: {
        reason: 'stable_unverified_end',
        rounds: 7,
        unsupportedCards: 1,
        scrollAvailability: 'not_scrollable',
        continuationSeen: false,
        cardCount: { initial: 4, latest: 4, max: 4 },
        parser: {
          sources: {
            'ytd-playlist-renderer': 2,
            'ytd-grid-playlist-renderer': 1,
            'yt-lockup-view-model': 1,
          },
        },
      },
    });
    expect(
      result.diagnostics.parser?.samples.map((sample) => sample.reasons),
    ).toEqual([
      ['no_playlist_link', 'ambiguous_title_link'],
      ['missing_title_node'],
      ['incomplete_rendering'],
      ['ambiguous_title_link'],
    ]);
  });

  it('distinguishes no candidate containers from unsupported or proven empty', async () => {
    const { env } = fixture(
      '<a href="/playlist?list=PL_outside" id="playlist-title">Outside</a>',
    );
    const result = await run(env);
    expect(result).toMatchObject({
      status: 'failed',
      diagnostics: {
        reason: 'no_card_containers',
        cardCount: { initial: 0, latest: 0, max: 0 },
        scrollAvailability: 'unavailable',
        completenessVerified: false,
      },
    });
    expect(result.diagnostics.parser?.samples).toEqual([]);
    expect(env.wait).toHaveBeenCalledTimes(5);
  });

  it('waits for initially rejected cards to render and succeeds without scrollable geometry', async () => {
    const { env, doc } = fixture(
      '<ytd-playlist-renderer><a href="" id="playlist-title"></a></ytd-playlist-renderer>',
    );
    env.scrollInfo = () => ({ top: 0, height: 1258, viewport: 1258 });
    let rounds = 0;
    env.advance = vi.fn(() => {
      if (++rounds === 4) doc.body.innerHTML = card();
    });
    const result = await run(env);
    expect(result.status).toBe('partial');
    expect(result.entries).toHaveLength(1);
    expect(result.diagnostics.parser?.latest.incomplete_rendering).toBe(0);
    expect(result.diagnostics.parser?.peaks.incomplete_rendering).toBe(1);
    expect(result.diagnostics.cardCount?.changes).toEqual([
      { round: 1, total: 1, accepted: 0, rejected: 1, hidden: 0 },
      { round: 5, total: 1, accepted: 1, rejected: 0, hidden: 0 },
    ]);
  });

  it('preserves acceptance with ignored ambiguous or empty title nodes', async () => {
    const { env } = fixture(
      card(
        'PL_one',
        'Good',
        '<span id="video-title"></span><a href="/watch?v=video" id="playlist-title">Video</a>',
      ),
    );
    const result = await run(env);
    expect(result.entries[0].name).toBe('Good');
    expect(Object.values(result.diagnostics.parser!.latest)).toEqual(
      Array(7).fill(0),
    );
  });

  it('tracks card growth, continuation rounds, explicit pagination and optional scroll diagnostics', async () => {
    const { env, doc } = fixture(
      card() +
        '<a rel="next" href="/anything">Private label</a><button rel="next">Secret</button><button>Next</button><a rel="next" hidden>Hidden</a>',
    );
    const click = vi.fn();
    doc.addEventListener('click', click);
    let calls = 0;
    let height = 1000;
    env.scrollInfo = () => ({ top: 0, height, viewport: 2000 });
    env.scrollDiagnostics = () => ({
      containers: [
        {
          tag: 'document',
          top: 0,
          height,
          viewport: 2000,
          selected: true,
          scrollable: false,
        },
      ],
      inspectedElements: 3,
      truncated: false,
    });
    env.advance = vi.fn(() => {
      calls++;
      if (calls === 1) {
        doc.body.insertAdjacentHTML(
          'beforeend',
          card('PL_two') +
            '<ytd-continuation-item-renderer></ytd-continuation-item-renderer>',
        );
        height = 1200;
      }
      if (calls === 3)
        doc.querySelector('ytd-continuation-item-renderer')?.remove();
    });
    const result = await run(env);
    expect(result.diagnostics).toMatchObject({
      cardCount: { initial: 1, latest: 2, max: 2 },
      loadingEvidence: {
        cardGrowths: 1,
        heightGrowths: 1,
        continuationRounds: 2,
        continuationAppearances: 1,
      },
      continuation: false,
      continuationSeen: true,
      pagination: { nextAnchors: 1, nextButtons: 1 },
      scrollContainers: env.scrollDiagnostics(),
    });
    expect(click).not.toHaveBeenCalled();
  });

  it('bounds structural samples and change history and records sources without arbitrary DOM values', async () => {
    const secret = 'PRIVATE_SENTINEL';
    const html = `<ytd-playlist-renderer data-secret="${secret}"><secret-${secret.toLowerCase()} class="${secret}">${secret}</secret-${secret.toLowerCase()}>
      <a href="/playlist?list=PL_${secret}">Thumbnail ${secret}</a>
      <a href="/watch?v=${secret}" id="playlist-title">${secret}</a>
      <a href="/channel/${secret}"></a><a href="https://${secret}.example/path"></a>
      <a href="/other/${secret}"></a><a href="javascript:${secret}"></a><a data-secret="${secret}"></a>
      <h3 class="yt-lockup-metadata-view-model__title">${secret}</h3><span id="video-title">Different title</span>
    </ytd-playlist-renderer>`;
    // Naming warnings on identified cards must also remain inspectable.
    const { env, doc } = fixture(html.repeat(14));
    let calls = 0;
    env.advance = vi.fn(() => {
      if (++calls <= 15) doc.body.insertAdjacentHTML('beforeend', html);
    });
    const result = await run(env);
    const json = JSON.stringify(result.diagnostics);
    expect(json).not.toContain(secret);
    expect(json).not.toContain(secret.toLowerCase());
    expect(json).not.toContain('secret-');
    expect(json).not.toContain('javascript:');
    expect(result.diagnostics.parser?.samples).toHaveLength(12);
    expect(result.diagnostics.parser?.samplesTruncated).toBe(true);
    expect(result.diagnostics.cardCount?.changes).toHaveLength(12);
    expect(result.diagnostics.parser?.samples[0]).toMatchObject({
      tag: 'ytd-playlist-renderer',
      childTags: { other: 1, a: 7, h3: 1, span: 1 },
      titleNodes: { playlistTitle: 1, videoTitle: 1, lockupTitle: 1 },
      links: {
        playlist: 1,
        watch: 1,
        channel: 1,
        external: 1,
        other: 1,
        invalid: 1,
        missing: 1,
      },
      distinctValidIds: 1,
    });
  });

  it('keeps some accepted entries partial despite rejected siblings', async () => {
    const { env } = fixture(
      card() + '<ytd-playlist-renderer></ytd-playlist-renderer>',
    );
    const result = await run(env);
    expect(result.status).toBe('partial');
    expect(result.entries).toHaveLength(1);
    expect(result.diagnostics.cardCount?.changes[0]).toMatchObject({
      total: 2,
      accepted: 1,
      rejected: 1,
    });
  });

  it.each(['abort', 'error'] as const)(
    'does not replace %s with an unsupported DOM failure',
    async (kind) => {
      const { env } = fixture(
        '<ytd-playlist-renderer></ytd-playlist-renderer>',
      );
      const controller = new AbortController();
      env.wait = async () => {
        if (kind === 'abort') controller.abort();
        throw new Error('PRIVATE_SENTINEL');
      };
      const result = await scanPlaylists(env, controller.signal, () => {});
      expect(result.diagnostics.reason).toBe(
        kind === 'abort' ? 'aborted' : 'scanner_error',
      );
      expect(JSON.stringify(result.diagnostics)).not.toContain(
        'PRIVATE_SENTINEL',
      );
    },
  );

  it.each(['abort', 'error'] as const)(
    'preserves the original %s reason if the terminal checkpoint also fails',
    async (kind) => {
      const { env } = fixture(
        '<ytd-playlist-renderer></ytd-playlist-renderer>',
      );
      const controller = new AbortController();
      env.wait = async () => {
        if (kind === 'abort') controller.abort();
        throw new Error('PRIVATE_SCANNER_ERROR');
      };
      const result = await scanPlaylists(env, controller.signal, (snapshot) => {
        if (snapshot.status !== 'running')
          throw new Error('PRIVATE_STORAGE_ERROR');
      });
      expect(result.diagnostics.reason).toBe(
        kind === 'abort' ? 'aborted' : 'scanner_error',
      );
      expect(result.diagnostics.checkpointError).toBe('checkpoint_failed');
      expect(JSON.stringify(result.diagnostics)).not.toContain('PRIVATE_');
    },
  );

  it('observes delayed candidate containers before declaring a failure', async () => {
    const { env, doc } = fixture('');
    let calls = 0;
    env.advance = vi.fn(() => {
      if (++calls === 4) doc.body.innerHTML = card();
    });
    const result = await run(env);
    expect(result.status).toBe('partial');
    expect(result.entries).toHaveLength(1);
    expect(result.diagnostics.cardCount).toMatchObject({
      initial: 0,
      latest: 1,
      max: 1,
    });
    expect(result.diagnostics.loadingEvidence?.cardGrowths).toBe(1);
  });

  it('remembers candidate evidence even when rejected cards disappear', async () => {
    const { env, doc } = fixture(
      '<ytd-playlist-renderer hidden></ytd-playlist-renderer>',
    );
    env.advance = vi.fn(() => {
      doc.body.innerHTML = '';
    });
    const result = await run(env);
    expect(result.diagnostics.reason).toBe('unsupported_dom');
    expect(result.diagnostics.cardCount).toMatchObject({
      initial: 1,
      latest: 0,
      max: 1,
    });
    expect(result.diagnostics.parser?.latest.hidden_card).toBe(0);
    expect(result.diagnostics.parser?.peaks.hidden_card).toBe(1);
  });

  it('never copies checkpoint exception contents into diagnostics', async () => {
    const { env } = fixture();
    const result = await scanPlaylists(
      env,
      new AbortController().signal,
      () => {
        throw new Error('PRIVATE_SENTINEL https://secret.example/secret');
      },
    );
    expect(result.diagnostics.checkpointError).toBe('checkpoint_failed');
    expect(JSON.stringify(result.diagnostics)).not.toContain(
      'PRIVATE_SENTINEL',
    );
    expect(JSON.stringify(result.diagnostics)).not.toContain('secret.example');
  });

  it.each(['hidden', 'aria-hidden="true"'])(
    'excludes %s descendant watch text from a confirmed playlist heading',
    async (attribute) => {
      const { env } = fixture(`<ytd-rich-item-renderer><yt-lockup-view-model>
        <h3><a href="/playlist?list=PL_one">Playlist name</a><a ${attribute} href="/watch?v=one"> HIDDEN_WATCH_TITLE</a></h3>
      </yt-lockup-view-model></ytd-rich-item-renderer>`);
      const result = await run(env);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toMatchObject({
        id: 'PL_one',
        name: 'Playlist name',
        nameStatus: 'confirmed',
      });
    },
  );

  it.each(['hidden', 'aria-hidden="true"'])(
    'excludes %s descendant text from a local accessibility title reference',
    async (attribute) => {
      const { env } = fixture(`<ytd-rich-item-renderer><yt-lockup-view-model>
        <a href="/playlist?list=PL_one" aria-labelledby="local-heading"><img alt="Never a title"></a>
        <h3 id="local-heading">Playlist name<a ${attribute} href="/watch?v=one"> HIDDEN_WATCH_TITLE</a></h3>
      </yt-lockup-view-model></ytd-rich-item-renderer>`);
      const result = await run(env);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]).toMatchObject({
        id: 'PL_one',
        name: 'Playlist name',
        nameStatus: 'confirmed',
        nameSource: 'aria-labelledby',
      });
    },
  );

  it('does not inherit a playlist anchor across a nested-card boundary', async () => {
    const { env } = fixture(`<ytd-playlist-renderer>
      <a href="/playlist?list=PL_one"><ytd-grid-playlist-renderer><h3>OTHER_CARD_TITLE</h3></ytd-grid-playlist-renderer></a>
    </ytd-playlist-renderer>`);
    const result = await run(env);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      id: 'PL_one',
      name: null,
      nameStatus: 'unknown',
    });
  });

  it('excludes nested-card text from an otherwise valid playlist heading', async () => {
    const { env } = fixture(`<ytd-playlist-renderer>
      <h3><a href="/playlist?list=PL_one">Playlist name</a><ytd-grid-playlist-renderer><span> OTHER_CARD_TITLE</span></ytd-grid-playlist-renderer></h3>
    </ytd-playlist-renderer>`);
    const result = await run(env);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      id: 'PL_one',
      name: 'Playlist name',
      nameStatus: 'confirmed',
    });
  });

  it('checkpoints detached snapshots and does not click or mutate the document', async () => {
    const { env, doc } = fixture();
    const html = doc.documentElement.outerHTML;
    const click = vi.fn();
    doc.addEventListener('click', click);
    const snapshots: PlaylistCatalog[] = [];
    const result = await scanPlaylists(
      env,
      new AbortController().signal,
      (snapshot) => {
        snapshots.push(structuredClone(snapshot));
        snapshot.entries.length = 0;
        snapshot.diagnostics.reason = 'Synthetic external mutation';
      },
    );
    expect(snapshots[0].status).toBe('running');
    expect(snapshots.at(-1)?.status).toBe('partial');
    expect(result.entries).toHaveLength(1);
    expect(result.diagnostics.reason).toBe('stable_unverified_end');
    expect(doc.documentElement.outerHTML).toBe(html);
    expect(click).not.toHaveBeenCalled();
  });
});
