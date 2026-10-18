import { describe, expect, it } from 'vitest';
import type { PlaylistCatalog } from '../src/adapter/playlists';
import {
  formatPlaylistDiagnostic,
  safePlaylistTag,
} from '../src/playlist-diagnostics';

const reasons = {
  no_playlist_link: 1,
  conflicting_playlist_ids: 2,
  missing_title_node: 3,
  conflicting_titles: 4,
  ambiguous_title_link: 5,
  hidden_card: 6,
  incomplete_rendering: 7,
};
const sample = {
  index: 2,
  tag: 'yt-lockup-view-model' as const,
  reasons: ['missing_title_node' as const],
  titleNodes: { playlistTitle: 0, videoTitle: 1, lockupTitle: 2 },
  childTags: { div: 3, other: 1 },
  links: {
    playlist: 1,
    watch: 2,
    channel: 3,
    external: 4,
    other: 5,
    invalid: 6,
    missing: 7,
  },
  distinctValidIds: 1,
};
const titleStructure = {
  canonicalLinkCount: 1,
  linkHeadings: 2,
  metadataHeadings: 3,
  ariaLabelledbyLinks: 4,
  localHeadingReferences: 5,
  missingOrAmbiguousReferences: 6,
  watchLinkedHeadings: 7,
  canonicalLinkHasAriaLabel: 8,
  watchLinksMatchingPlaylist: 9,
  watchLinksMissingPlaylist: 10,
  watchLinksConflictingPlaylist: 11,
  watchLinksUnresolvedPlaylist: 12,
  headingsWithMatchingWatchPlaylist: 13,
  ambiguousHeadings: 14,
  watchHeadingContainsLink: 15,
  watchLinkContainsHeading: 16,
  watchHeadingsInLockupMetadata: 17,
  watchHeadingsWithCanonicalLinkInMetadata: 18,
  watchHeadingsWithCanonicalLinkOutsideMetadata: 19,
};
const legacy: PlaylistCatalog['diagnostics'] = {
  reason: 'scanning',
  rounds: 3,
  scrollAttempts: 2,
  observedScrolls: 1,
  scroll: { container: 'document', top: 100, height: 2000, viewport: 800 },
  continuation: true,
  continuationSeen: true,
  unsupportedCards: 4,
  expectedCount: null,
  completenessVerified: false,
};

function parse(value: unknown) {
  return JSON.parse(formatPlaylistDiagnostic(value));
}

describe('playlist diagnostic copy/display boundary', () => {
  it('preserves legacy counts without introducing optional blocks', () => {
    expect(parse(legacy)).toEqual(legacy);
    expect(parse({ ...legacy, scroll: null }).scroll).toBeNull();
  });

  it('preserves legacy parser fields without introducing new optional counts', () => {
    const diagnostic = {
      ...legacy,
      parser: {
        latest: reasons,
        peaks: reasons,
        samples: [sample],
        samplesTruncated: false,
        sources: {},
      },
    };
    expect(parse(diagnostic)).toEqual(diagnostic);
  });

  it('preserves all current typed diagnostic fields', () => {
    const diagnostic: PlaylistCatalog['diagnostics'] = {
      ...legacy,
      checkpointError: 'checkpoint_failed',
      parser: {
        latest: reasons,
        peaks: reasons,
        identifiedUnnamed: { latest: 2, peak: 5 },
        samples: [{ ...sample, titleStructure }],
        samplesTruncated: true,
        sources: { 'yt-lockup-view-model': 3, other: 2 },
      },
      cardCount: {
        initial: 2,
        latest: 3,
        max: 4,
        changes: [{ round: 1, total: 3, accepted: 1, rejected: 2, hidden: 1 }],
      },
      scrollAvailability: 'scrollable',
      loadingEvidence: {
        cardGrowths: 1,
        heightGrowths: 2,
        continuationRounds: 3,
        continuationAppearances: 4,
      },
      pagination: { nextAnchors: 1, nextButtons: 2 },
      scrollContainers: {
        inspectedElements: 9,
        truncated: true,
        containers: [
          {
            tag: 'ytd-browse',
            top: 10,
            height: 200,
            viewport: 100,
            selected: true,
            scrollable: true,
          },
        ],
      },
    };
    expect(parse(diagnostic)).toEqual(diagnostic);
  });

  it.each([
    'scanning',
    'aborted',
    'navigation',
    'continuation_stalled',
    'stable_unverified_end',
    'scroll_budget',
    'checkpoint_error',
    'scanner_error',
    'unsupported_dom',
    'no_card_containers',
  ])('allows the actual scanner reason %s', (reason) => {
    expect(parse({ reason }).reason).toBe(reason);
  });

  it('drops private keys and values at every nested boundary', () => {
    const secret = 'PRIVATE_NAME_PL123_https://private.example/playlist';
    const extra = {
      [secret]: secret,
      name: secret,
      id: secret,
      url: secret,
      text: secret,
      href: secret,
      'aria-label': secret,
      'aria-labelledby': secret,
      toJSON: () => secret,
    };
    const hostile = {
      ...legacy,
      ...extra,
      reason: secret,
      checkpointError: secret,
      scroll: { ...extra, container: secret, top: secret },
      parser: {
        ...extra,
        latest: { ...extra, no_playlist_link: secret },
        peaks: { ...extra, hidden_card: { ...extra } },
        identifiedUnnamed: { ...extra, latest: secret, peak: { ...extra } },
        sources: { ...extra, div: secret, other: 2 },
        samplesTruncated: secret,
        samples: [
          {
            ...extra,
            index: secret,
            tag: secret,
            reasons: [secret, { ...extra }, 'hidden_card'],
            titleNodes: { ...extra, playlistTitle: secret },
            childTags: { ...extra, a: secret },
            links: { ...extra, playlist: secret },
            distinctValidIds: { ...extra },
            titleStructure: {
              ...extra,
              ...Object.fromEntries(
                Object.keys(titleStructure).map((key) => [key, { ...extra }]),
              ),
              canonicalLinkCount: 2,
              linkHeadings: secret,
            },
          },
        ],
      },
      cardCount: { ...extra, initial: secret, changes: [{ ...extra }] },
      scrollAvailability: secret,
      loadingEvidence: { ...extra, cardGrowths: secret },
      pagination: { ...extra, nextAnchors: secret },
      scrollContainers: {
        ...extra,
        inspectedElements: secret,
        truncated: secret,
        containers: [{ ...extra, tag: secret, selected: secret }],
      },
    };
    const text = formatPlaylistDiagnostic(hostile);
    expect(text).not.toContain(secret);
    const result = JSON.parse(text);
    expect(result.reason).toBe('unknown');
    expect(result.checkpointError).toBe('checkpoint_failed');
    expect(result.scroll.container).toBe('other');
    expect(result.scrollAvailability).toBe('unknown');
    expect(result.parser.samples[0].tag).toBe('other');
    expect(result.parser.samples[0].reasons).toEqual([
      'unknown',
      'unknown',
      'hidden_card',
    ]);
    expect(result.parser.sources).toEqual({ div: 0, other: 2 });
    expect(result.parser.identifiedUnnamed).toEqual({ latest: 0, peak: 0 });
    expect(result.parser.samples[0].titleStructure).toEqual({
      ...Object.fromEntries(Object.keys(titleStructure).map((key) => [key, 0])),
      canonicalLinkCount: 2,
    });
    expect(result.parser.samples[0].childTags).toEqual({ a: 0 });
    expect(result.scrollContainers.containers[0].tag).toBe('other');
    expect(result.scrollContainers.containers[0].selected).toBe(false);
    expect(result.parser.samplesTruncated).toBe(false);
    expect(text).not.toMatch(
      /"(?:name|id|url|text|href|aria-label|aria-labelledby|toJSON)":/,
    );
  });

  it.each(['legacy private error', '', 'unknown_error_code'])(
    'reduces any string checkpoint error to a fixed code: %j',
    (checkpointError) => {
      expect(parse({ checkpointError }).checkpointError).toBe(
        'checkpoint_failed',
      );
    },
  );

  it.each([null, undefined, 1, true, {}, ['private error']])(
    'omits non-string checkpoint errors: %j',
    (checkpointError) => {
      expect(parse({ checkpointError })).not.toHaveProperty('checkpointError');
    },
  );

  it.each([
    [1.6, 2],
    [-4, 0],
    [2e9, 1e9],
    [Infinity, 0],
    [-Infinity, 0],
    [NaN, 0],
    ['12', 0],
    [true, 0],
    [{ valueOf: () => 12 }, 0],
  ])('rounds and clamps numeric input %j', (input, expected) => {
    const result = parse({
      rounds: input,
      scroll: { top: input },
      parser: {
        latest: { hidden_card: input },
        identifiedUnnamed: { latest: input, peak: input },
        samples: [
          {
            index: input,
            titleStructure: Object.fromEntries(
              Object.keys(titleStructure).map((key) => [key, input]),
            ),
          },
        ],
      },
      cardCount: { changes: [{ total: input }] },
      scrollContainers: { containers: [{ height: input }] },
      pagination: { nextButtons: input },
    });
    expect(result.rounds).toBe(expected);
    expect(result.scroll.top).toBe(expected);
    expect(result.parser.latest.hidden_card).toBe(expected);
    expect(result.parser.samples[0].index).toBe(expected);
    expect(result.parser.identifiedUnnamed).toEqual({
      latest: expected,
      peak: expected,
    });
    expect(result.parser.samples[0].titleStructure).toEqual(
      Object.fromEntries(
        Object.keys(titleStructure).map((key) => [key, expected]),
      ),
    );
    expect(result.cardCount.changes[0].total).toBe(expected);
    expect(result.scrollContainers.containers[0].height).toBe(expected);
    expect(result.pagination.nextButtons).toBe(expected);
  });

  it.each([null, 'private', 12, true, [], [{ latest: 99 }]])(
    'reconstructs malformed optional count blocks without coercion: %j',
    (value) => {
      const result = parse({
        parser: {
          identifiedUnnamed: value,
          samples: [{ titleStructure: value }],
        },
      });
      expect(result.parser.identifiedUnnamed).toEqual({ latest: 0, peak: 0 });
      expect(result.parser.samples[0].titleStructure).toEqual(
        Object.fromEntries(Object.keys(titleStructure).map((key) => [key, 0])),
      );
    },
  );

  it('omits undefined or inherited optional blocks and ignores inherited counts', () => {
    for (const parser of [
      {
        identifiedUnnamed: undefined,
        samples: [{ titleStructure: undefined }],
      },
      Object.assign(
        Object.create({ identifiedUnnamed: { latest: 99, peak: 99 } }),
        {
          samples: [Object.create({ titleStructure })],
        },
      ),
    ]) {
      const result = parse({ parser });
      expect(result.parser).not.toHaveProperty('identifiedUnnamed');
      expect(result.parser.samples[0]).not.toHaveProperty('titleStructure');
    }
    const result = parse({
      parser: {
        identifiedUnnamed: Object.create({ latest: 99, peak: 99 }),
        samples: [{ titleStructure: Object.create(titleStructure) }],
      },
    });
    expect(result.parser.identifiedUnnamed).toEqual({ latest: 0, peak: 0 });
    expect(result.parser.samples[0].titleStructure).toEqual(
      Object.fromEntries(Object.keys(titleStructure).map((key) => [key, 0])),
    );
  });

  it.each([true, false, 'true', 1, {}, null])(
    'accepts only literal true for booleans: %j',
    (value) => {
      const result = parse({
        continuation: value,
        continuationSeen: value,
        completenessVerified: value,
        parser: { samplesTruncated: value },
        scrollContainers: {
          truncated: value,
          containers: [{ selected: value, scrollable: value }],
        },
      });
      for (const flag of [
        result.continuation,
        result.continuationSeen,
        result.completenessVerified,
        result.parser.samplesTruncated,
        result.scrollContainers.truncated,
        result.scrollContainers.containers[0].selected,
        result.scrollContainers.containers[0].scrollable,
      ])
        expect(flag).toBe(value === true);
    },
  );

  it('bounds samples, reasons, card changes and scroll containers to 12', () => {
    const items = Array.from({ length: 30 }, (_, index) => ({
      index,
      round: index,
    }));
    const result = parse({
      parser: {
        identifiedUnnamed: { latest: 30, peak: 40 },
        samples: items.map((item) => ({
          ...item,
          reasons: items,
          titleStructure,
        })),
      },
      cardCount: { changes: items },
      scrollContainers: { containers: items },
    });
    expect(result.parser.samples).toHaveLength(12);
    expect(result.parser.samples[11].index).toBe(11);
    expect(result.parser.samples[11].titleStructure).toEqual(titleStructure);
    expect(result.parser.identifiedUnnamed).toEqual({ latest: 30, peak: 40 });
    expect(result.parser.samples[0].reasons).toHaveLength(12);
    expect(result.cardCount.changes).toHaveLength(12);
    expect(result.scrollContainers.containers).toHaveLength(12);
  });

  it('ignores inherited fields and never serializes unknown objects', () => {
    const inherited = Object.create({
      reason: 'scanning',
      rounds: 99,
      parser: {},
    });
    inherited.scroll = Object.create({ container: 'div', top: 99 });
    inherited.parser = {
      sources: Object.create({ div: 99 }),
      samples: [Object.create({ ...sample, titleStructure })],
    };
    const result = parse(inherited);
    expect(result.reason).toBe('unknown');
    expect(result.rounds).toBe(0);
    expect(result.scroll).toEqual({ top: 0, height: 0, viewport: 0 });
    expect(result.parser.sources).toEqual({});
    expect(result.parser.samples[0].tag).toBe('other');
    expect(result.parser.samples[0].index).toBe(0);
    expect(result.parser.samples[0]).not.toHaveProperty('titleStructure');
    const unsafe = {
      toJSON: () => {
        throw new Error('Unknown toJSON must not run');
      },
    };
    expect(() =>
      formatPlaylistDiagnostic({
        parser: {
          ...unsafe,
          identifiedUnnamed: unsafe,
          samples: [{ titleStructure: unsafe }],
        },
        scroll: unsafe,
      }),
    ).not.toThrow();
    expect(
      parse(JSON.parse('{"__proto__":{"rounds":99},"constructor":"private"}'))
        .rounds,
    ).toBe(0);
    expect(parse(Object.create(null)).reason).toBe('unknown');
  });

  it.each([null, undefined, 123, 'private', true, [], () => 'private'])(
    'handles non-record input without copying it: %j',
    (value) => {
      expect(parse(value)).toEqual({
        reason: 'unknown',
        rounds: 0,
        scrollAttempts: 0,
        observedScrolls: 0,
        scroll: null,
        continuation: false,
        continuationSeen: false,
        unsupportedCards: 0,
        expectedCount: null,
        completenessVerified: false,
      });
    },
  );
});

describe('safePlaylistTag', () => {
  it.each([
    'ytd-playlist-renderer',
    'ytd-grid-playlist-renderer',
    'ytd-rich-item-renderer',
    'yt-lockup-view-model',
    'ytd-badge-supported-renderer',
    'a',
    'span',
    'div',
    'h3',
    'img',
    'button',
    'other',
    'document',
    'html',
    'body',
    'main',
    'section',
    'article',
    'ytd-app',
    'ytd-page-manager',
    'ytd-browse',
    'ytd-rich-grid-renderer',
    'ytd-section-list-renderer',
  ])('allows the public structural tag %s', (tag) => {
    expect(safePlaylistTag(tag)).toBe(tag);
  });

  it.each([
    'private-playlist-name',
    'DIV',
    'div#private-id',
    'https://private.example',
    '__proto__',
    'constructor',
    null,
    undefined,
    12,
    {},
    ['div'],
    { toString: () => 'div' },
  ])('replaces unknown tags rather than coercing them: %j', (value) => {
    expect(safePlaylistTag(value)).toBe('other');
  });
});
