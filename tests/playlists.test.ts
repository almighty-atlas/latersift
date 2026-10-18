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
  it.each([
    card(),
    '<ytd-grid-playlist-renderer><a href="/playlist?list=PL_one" id="video-title">Synthetic playlist</a></ytd-grid-playlist-renderer>',
    '<ytd-rich-item-renderer><yt-lockup-view-model><a href="/playlist?list=PL_one">Thumbnail</a><h3 class="yt-lockup-metadata-view-model__title"><a href="/playlist?list=PL_one">Synthetic playlist</a></h3></yt-lockup-view-model></ytd-rich-item-renderer>',
  ])('reads a candidate card with separate title: %s', async (html) => {
    const { env } = fixture(html);
    const result = await run(env);
    expect(result.entries).toEqual([
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
    expect((await run(env)).entries).toEqual([]);
  });

  it('rejects conflicting titles and multi-playlist cards', async () => {
    const { env } = fixture(
      card('PL_one', 'One', '<span id="video-title">Another title</span>') +
        card(
          'PL_two',
          'Two',
          '<a href="/playlist?list=PL_three">Other playlist</a>',
        ),
    );
    expect((await run(env)).entries).toEqual([]);
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

  it('rejects a lockup heading linking to a video rather than its playlist', async () => {
    const { env } = fixture(
      '<ytd-rich-item-renderer><yt-lockup-view-model><a href="/playlist?list=PL_one">Thumbnail</a><h3 class="yt-lockup-metadata-view-model__title"><a href="/watch?v=abcdefghijk">Video title</a></h3></yt-lockup-view-model></ytd-rich-item-renderer>',
    );
    expect((await run(env)).entries).toEqual([]);
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
      '<a href="/playlist?list=PL_one" id="playlist-title">One</a><span id="video-title">Two</span>',
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
    'reports fixed rejection %s without polling inflation',
    async (reason, content) => {
      const { env } = fixture(
        `<ytd-playlist-renderer ${reason === 'hidden_card' ? 'hidden' : ''}>${content}</ytd-playlist-renderer>`,
      );
      const result = await run(env);
      expect(result.status).toBe('failed');
      expect(result.diagnostics.reason).toBe('unsupported_dom');
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
      ambiguous_title_link: 0,
      hidden_card: 0,
    });
    expect(result.diagnostics.parser?.samples[0].reasons).not.toContain(
      'incomplete_rendering',
    );
  });

  it('explains four unsupported cards with non-scrollable geometry without blaming scrolling', async () => {
    const { env } = fixture(`
      <ytd-playlist-renderer><a href="/watch?v=video" id="playlist-title">Title</a></ytd-playlist-renderer>
      <ytd-playlist-renderer><a href="/playlist?list=PL_one">Thumbnail</a></ytd-playlist-renderer>
      <ytd-grid-playlist-renderer><a href="/playlist?list=PL_two" id="playlist-title"></a></ytd-grid-playlist-renderer>
      <ytd-rich-item-renderer><yt-lockup-view-model><a href="/playlist?list=PL_three">Thumbnail</a><h3 class="yt-lockup-metadata-view-model__title"><a href="/watch?v=video">Video</a></h3></yt-lockup-view-model></ytd-rich-item-renderer>`);
    env.scrollInfo = () => ({ top: 0, height: 1258, viewport: 1258 });
    const result = await run(env);
    expect(result).toMatchObject({
      status: 'failed',
      diagnostics: {
        reason: 'unsupported_dom',
        rounds: 6,
        unsupportedCards: 4,
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
      ['no_playlist_link'],
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
    // The second, conflicting valid title makes every sample a rejected card.
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
