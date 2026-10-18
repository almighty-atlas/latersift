import type { Scan } from './model';

const REASONS = [
  'scanning',
  'navigation',
  'count_and_positions_verified',
  'background_tab_stalled',
  'background_scan_stalled',
  'background_loading_stalled',
  'loading_stalled',
  'waiting_for_youtube',
  'attention_timeout',
  'unsupported_dom',
  'scroll_unreachable',
  'recovery_exhausted',
  'active_time_budget',
  'round_safety_limit',
  'user_or_browser_interrupted',
  'scanner_error',
] as const;
const CONTAINERS = [
  'document',
  'html',
  'body',
  'section',
  'div',
  'main',
  'article',
  'ytd-app',
  'ytd-page-manager',
  'ytd-browse',
  'ytd-playlist-video-list-renderer',
  'ytd-section-list-renderer',
  'ytd-item-section-renderer',
] as const;

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function choice(
  value: unknown,
  allowed: readonly string[],
  fallback = 'unknown',
): string {
  return allowed.find((entry) => entry === value) ?? fallback;
}

// Bounds apply even to imported backups, not just current scanner output.
function number(value: unknown, signed = false): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(signed ? -1_000_000_000 : 0, Math.min(1_000_000_000, value))
    : null;
}
function optionalNumber(value: unknown) {
  return value === undefined ? undefined : number(value);
}
function boolean(value: unknown): boolean {
  return value === true;
}
function timestamp(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  )
    return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const canonical = new Date(time).toISOString();
  return canonical === value || canonical.replace('.000Z', 'Z') === value
    ? value
    : null;
}
function position(value: unknown) {
  if (value == null) return null;
  const p = object(value);
  return {
    container: choice(p.container, CONTAINERS, 'other'),
    top: number(p.top, true),
    height: number(p.height),
    viewport: number(p.viewport),
    epoch: optionalNumber(p.epoch),
  };
}
function action(value: unknown) {
  const a = object(value);
  const before = position(a.before);
  const after = position(a.after);
  const requestedTop = number(a.requestedTop, true);
  // Unknown tags or absent/invalid epochs cannot establish element identity.
  const sameContainer =
    before !== null &&
    after !== null &&
    before.container !== 'other' &&
    before.container === after.container &&
    typeof before.epoch === 'number' &&
    before.epoch === after.epoch;
  return {
    kind: choice(a.kind, ['advance', 'recovery', 'reset', 'end-jump']),
    sequence: optionalNumber(a.sequence),
    before,
    requestedTop,
    after,
    requestedDelta:
      sameContainer && before.top !== null && requestedTop !== null
        ? requestedTop - before.top
        : null,
    observedDelta:
      sameContainer && before.top !== null && after.top !== null
        ? after.top - before.top
        : null,
    outcome: choice(a.outcome, [
      'target-observed',
      'no-movement',
      'partial-or-divergent',
      'unavailable',
      'error',
    ]),
    attribution: choice(a.attribution, ['during-call-only']),
  };
}
function loadingArea(value: unknown) {
  const area = object(value);
  return {
    visibleElements: number(area.visibleElements),
    inViewport: typeof area.inViewport === 'boolean' ? area.inViewport : null,
    distanceToViewport: number(area.distanceToViewport),
  };
}
function trace(value: unknown) {
  const t = object(value);
  return {
    history: (Array.isArray(t.history) ? t.history.slice(-24) : []).map(
      (value: unknown) => {
        const e = object(value);
        return {
          round: number(e.round),
          elapsedMs: number(e.elapsedMs),
          visibility: choice(e.visibility, ['hidden', 'visible', 'unknown']),
          scroll: position(e.scroll),
          distanceToEnd: number(e.distanceToEnd, true),
          renderedRows: number(e.renderedRows),
          visibleRows: number(e.visibleRows),
          confirmedCount: number(e.confirmedCount),
          newConfirmed: number(e.newConfirmed),
          progressAgeMs: number(e.progressAgeMs),
          continuation: boolean(e.continuation),
          loadingArea:
            e.loadingArea === undefined
              ? undefined
              : loadingArea(e.loadingArea),
          atGeometryEnd: boolean(e.atGeometryEnd),
          action: e.action === undefined ? undefined : action(e.action),
          afterAction: optionalNumber(e.afterAction),
          laterDelta: number(e.laterDelta, true),
          laterAttribution: choice(e.laterAttribution, ['unknown']),
          containerChanged: boolean(e.containerChanged),
        };
      },
    ),
    actionCount: number(t.actionCount),
    containerChanges: number(t.containerChanges),
    totalRecoveryAttempts: number(t.totalRecoveryAttempts),
    endObservations: number(t.endObservations),
    lastAction: t.lastAction === undefined ? undefined : action(t.lastAction),
    recoveryHistory:
      t.recoveryHistory === undefined
        ? undefined
        : (Array.isArray(t.recoveryHistory)
            ? t.recoveryHistory.slice(-3)
            : []
          ).map((value: unknown) => {
            const r = object(value);
            return {
              elapsedMs: number(r.elapsedMs),
              action: r.action === undefined ? undefined : action(r.action),
              confirmedBefore: number(r.confirmedBefore),
              confirmedAfter: number(r.confirmedAfter),
              result: choice(r.result, [
                'pending',
                'new-ids-later-observed',
                'no-new-ids-observed',
                'unresolved',
              ]),
            };
          }),
    progressEvents:
      t.progressEvents === undefined
        ? undefined
        : (Array.isArray(t.progressEvents)
            ? t.progressEvents.slice(-8)
            : []
          ).map((value: unknown) => {
            const p = object(value);
            return {
              elapsedMs: number(p.elapsedMs),
              confirmedCount: number(p.confirmedCount),
              newConfirmed: number(p.newConfirmed),
            };
          }),
  };
}
function performance(value: unknown) {
  const p = object(value);
  return {
    mode: choice(p.mode, ['stepwise', 'fast-jump']),
    ...Object.fromEntries(
      [
        'endJumps',
        'loadEvents',
        'progressIntervals',
        'progressIntervalTotalMs',
        'averageProgressIntervalMs',
        'scrollApproachMs',
        'endWithoutNewIdsMs',
        'jumpToNewIdsMs',
        'jumpToNewIdsSamples',
        'fallbackCount',
        'renderedRows',
        'minRenderedPosition',
        'maxRenderedPosition',
        'minVisiblePosition',
        'maxVisiblePosition',
        'missingWithinConfirmedRange',
        'uniqueRenderedIds',
      ].map((key) => [key, number(p[key])]),
    ),
    renderedRowsDelta: number(p.renderedRowsDelta, true),
    scrollHeightDelta: number(p.scrollHeightDelta, true),
    positionConflicts: boolean(p.positionConflicts),
    domBehavior: choice(p.domBehavior, [
      'unknown',
      'growing',
      'virtualization-suspected',
    ]),
    fallbackReasons: (Array.isArray(p.fallbackReasons)
      ? p.fallbackReasons.slice(-10)
      : []
    ).map((reason: unknown) =>
      choice(reason, [
        'virtualization-or-removed-rows',
        'position-gap-or-conflict',
        'container-changed',
        'geometry-unavailable',
        'jump-failed',
        'bounded-stall',
      ]),
    ),
    milestones: (Array.isArray(p.milestones)
      ? p.milestones.slice(0, 4)
      : []
    ).map((value: unknown) => {
      const m = object(value);
      return {
        confirmedCount: number(m.confirmedCount),
        elapsedMs: number(m.elapsedMs),
      };
    }),
  };
}
function recoveryResult(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  if (value === 'scroll_retry_no_progress') return value;
  const attempt =
    /^Recovery ([1-9]\d{0,5}): Scroll-Container erneut annähern$/.exec(value);
  if (attempt)
    return `Recovery ${Number(attempt[1])}: Scroll-Container erneut annähern`;
  const progress = /^Fortschritt nach Recovery ([1-9]\d{0,5})$/.exec(value);
  return progress
    ? `Fortschritt nach Recovery ${Number(progress[1])}`
    : 'unknown';
}

/** Reconstruct at the copy boundary: persisted scans are not trusted diagnostics. */
export function formatImportDiagnostic(scan: Scan): string {
  const s = object(scan);
  const d = object(s.diagnostics);
  const timer = object(d.timerThrottling);
  return JSON.stringify(
    {
      count: Array.isArray(s.videos) ? number(s.videos.length) : 0,
      expectedCount: number(s.expectedCount),
      status: choice(s.status, [
        'running',
        'waiting',
        'needs_attention',
        'complete',
        'interrupted',
        'incomplete',
        'failed',
      ]),
      diagnostics:
        s.diagnostics == null
          ? null
          : {
              lastProgressAt: timestamp(d.lastProgressAt),
              visibility: choice(d.visibility, [
                'hidden',
                'visible',
                'unknown',
              ]),
              reason: choice(d.reason, REASONS),
              highestPosition: number(d.highestPosition),
              missingPositions: (Array.isArray(d.missingPositions)
                ? d.missingPositions.slice(0, 100)
                : []
              ).map((value: unknown) => number(value)),
              recoveryAttempts: number(d.recoveryAttempts),
              recoveryResults:
                d.recoveryResults === undefined
                  ? undefined
                  : (Array.isArray(d.recoveryResults)
                      ? d.recoveryResults.slice(-10)
                      : []
                    ).map(recoveryResult),
              positionConflict:
                d.positionConflict === undefined
                  ? undefined
                  : boolean(d.positionConflict),
              activeMs: optionalNumber(d.activeMs),
              attentionMs: optionalNumber(d.attentionMs),
              totalAttentionMs: optionalNumber(d.totalAttentionMs),
              scroll: position(d.scroll),
              scrollTrace:
                d.scrollTrace === undefined ? undefined : trace(d.scrollTrace),
              continuation: boolean(d.continuation),
              confirmedCount: number(d.confirmedCount),
              rewindRequired:
                d.rewindRequired === undefined
                  ? undefined
                  : boolean(d.rewindRequired),
              performance:
                d.performance === undefined
                  ? undefined
                  : performance(d.performance),
              backgroundMode:
                d.backgroundMode === undefined
                  ? undefined
                  : choice(d.backgroundMode, ['paused', 'experimental']),
              timerThrottling:
                d.timerThrottling === undefined
                  ? undefined
                  : {
                      requestedMs: number(timer.requestedMs),
                      lastElapsedMs: number(timer.lastElapsedMs),
                      maxElapsedMs: number(timer.maxElapsedMs),
                      delayedWaits: number(timer.delayedWaits),
                    },
            },
    },
    null,
    2,
  );
}
