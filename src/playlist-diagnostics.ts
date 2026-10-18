import type {
  PlaylistDiagnosticTag,
  PlaylistLinkType,
  PlaylistRejectionReason,
} from './adapter/playlists';

const parserTags = [
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
] as const satisfies readonly PlaylistDiagnosticTag[];

const scrollTags = [
  ...parserTags,
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
] as const;

// Legacy reason keys include naming warnings on accepted playlist identities.
const rejectionReasons = [
  'no_playlist_link',
  'conflicting_playlist_ids',
  'missing_title_node',
  'conflicting_titles',
  'ambiguous_title_link',
  'hidden_card',
  'incomplete_rendering',
] as const satisfies readonly PlaylistRejectionReason[];

const linkTypes = [
  'playlist',
  'watch',
  'channel',
  'external',
  'other',
  'invalid',
  'missing',
] as const satisfies readonly PlaylistLinkType[];

const scanReasons = [
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
] as const;

function own(value: unknown, key: string): unknown {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Object.prototype.hasOwnProperty.call(value, key)
  )
    return undefined;
  return (value as Record<string, unknown>)[key];
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1e9, Math.max(0, Math.round(value)))
    : 0;
}

function allowed(
  value: unknown,
  choices: readonly string[],
  fallback: string,
): string {
  return choices.find((choice) => choice === value) ?? fallback;
}

/** Only public structural tags may cross the scroll/display boundary. */
export function safePlaylistTag(value: unknown): string {
  return allowed(value, scrollTags, 'other');
}

function counts(value: unknown, keys: readonly string[]) {
  return Object.fromEntries(keys.map((key) => [key, number(own(value, key))]));
}

function tagCounts(value: unknown) {
  return Object.fromEntries(
    parserTags
      .filter((tag) => own(value, tag) !== undefined)
      .map((tag) => [tag, number(own(value, tag))]),
  );
}

function bounded(value: unknown): unknown[] {
  return Array.isArray(value) ? value.slice(0, 12) : [];
}

function geometry(value: unknown) {
  return counts(value, ['top', 'height', 'viewport']);
}

/** Rebuild persisted diagnostics; never serialize unknown objects or text. */
export function formatPlaylistDiagnostic(value: unknown): string {
  const scroll = own(value, 'scroll');
  const parser = own(value, 'parser');
  const cardCount = own(value, 'cardCount');
  const scrollContainers = own(value, 'scrollContainers');
  const loadingEvidence = own(value, 'loadingEvidence');
  const pagination = own(value, 'pagination');
  const report = {
    reason: allowed(own(value, 'reason'), scanReasons, 'unknown'),
    rounds: number(own(value, 'rounds')),
    scrollAttempts: number(own(value, 'scrollAttempts')),
    observedScrolls: number(own(value, 'observedScrolls')),
    scroll:
      scroll !== null && typeof scroll === 'object' && !Array.isArray(scroll)
        ? {
            ...(own(scroll, 'container') !== undefined
              ? { container: safePlaylistTag(own(scroll, 'container')) }
              : {}),
            ...geometry(scroll),
          }
        : null,
    continuation: own(value, 'continuation') === true,
    continuationSeen: own(value, 'continuationSeen') === true,
    unsupportedCards: number(own(value, 'unsupportedCards')),
    expectedCount: null,
    completenessVerified: own(value, 'completenessVerified') === true,
    checkpointError:
      typeof own(value, 'checkpointError') === 'string'
        ? 'checkpoint_failed'
        : undefined,
    parser:
      parser === undefined
        ? undefined
        : {
            // Per-card latest-round counts and maxima, not rejection-only totals.
            latest: counts(own(parser, 'latest'), rejectionReasons),
            peaks: counts(own(parser, 'peaks'), rejectionReasons),
            // Card-local unnamed identities before name retention, not catalog totals.
            ...(own(parser, 'identifiedUnnamed') !== undefined
              ? {
                  identifiedUnnamed: counts(own(parser, 'identifiedUnnamed'), [
                    'latest',
                    'peak',
                  ]),
                }
              : {}),
            sources: tagCounts(own(parser, 'sources')),
            samplesTruncated: own(parser, 'samplesTruncated') === true,
            samples: bounded(own(parser, 'samples')).map((sample) => ({
              index: number(own(sample, 'index')),
              tag: allowed(own(sample, 'tag'), parserTags, 'other'),
              reasons: bounded(own(sample, 'reasons')).map((reason) =>
                allowed(reason, rejectionReasons, 'unknown'),
              ),
              titleNodes: counts(own(sample, 'titleNodes'), [
                'playlistTitle',
                'videoTitle',
                'lockupTitle',
              ]),
              childTags: tagCounts(own(sample, 'childTags')),
              links: counts(own(sample, 'links'), linkTypes),
              distinctValidIds: number(own(sample, 'distinctValidIds')),
              ...(own(sample, 'titleStructure') !== undefined
                ? {
                    titleStructure: counts(own(sample, 'titleStructure'), [
                      'canonicalLinkCount',
                      'linkHeadings',
                      'metadataHeadings',
                      'ariaLabelledbyLinks',
                      'localHeadingReferences',
                      'missingOrAmbiguousReferences',
                      'watchLinkedHeadings',
                      'canonicalLinkHasAriaLabel',
                      'watchLinksMatchingPlaylist',
                      'watchLinksMissingPlaylist',
                      'watchLinksConflictingPlaylist',
                      'watchLinksUnresolvedPlaylist',
                      'headingsWithMatchingWatchPlaylist',
                      'ambiguousHeadings',
                      'watchHeadingContainsLink',
                      'watchLinkContainsHeading',
                      'watchHeadingsInLockupMetadata',
                      'watchHeadingsWithCanonicalLinkInMetadata',
                      'watchHeadingsWithCanonicalLinkOutsideMetadata',
                    ]),
                  }
                : {}),
            })),
          },
    cardCount:
      cardCount === undefined
        ? undefined
        : {
            ...counts(cardCount, ['initial', 'latest', 'max']),
            changes: bounded(own(cardCount, 'changes')).map((change) =>
              counts(change, [
                'round',
                'total',
                'accepted',
                'rejected',
                'hidden',
              ]),
            ),
          },
    scrollAvailability:
      own(value, 'scrollAvailability') === undefined
        ? undefined
        : allowed(
            own(value, 'scrollAvailability'),
            ['unavailable', 'not_scrollable', 'scrollable'],
            'unknown',
          ),
    loadingEvidence:
      loadingEvidence === undefined
        ? undefined
        : counts(loadingEvidence, [
            'cardGrowths',
            'heightGrowths',
            'continuationRounds',
            'continuationAppearances',
          ]),
    pagination:
      pagination === undefined
        ? undefined
        : counts(pagination, ['nextAnchors', 'nextButtons']),
    scrollContainers:
      scrollContainers === undefined
        ? undefined
        : {
            inspectedElements: number(
              own(scrollContainers, 'inspectedElements'),
            ),
            truncated: own(scrollContainers, 'truncated') === true,
            containers: bounded(own(scrollContainers, 'containers')).map(
              (container) => ({
                tag: safePlaylistTag(own(container, 'tag')),
                ...geometry(container),
                selected: own(container, 'selected') === true,
                scrollable: own(container, 'scrollable') === true,
              }),
            ),
          },
  };
  return JSON.stringify(report, null, 2);
}
