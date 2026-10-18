import { describe, expect, it } from 'vitest';
import { formatImportDiagnostic } from '../src/import-diagnostics';
import type {
  Scan,
  ScrollActionObservation,
  ScrollTraceEntry,
} from '../src/model';

function fixture(): Scan {
  return {
    id: 'PRIVATE_SCAN_ID',
    startedAt: 'PRIVATE_START',
    finishedAt: null,
    status: 'waiting',
    expectedCount: 12,
    videos: [],
    confirmedVideoIds: ['PRIVATE_VIDEO_ID'],
    unidentifiableRows: 0,
    message: 'PRIVATE_MESSAGE',
    diagnostics: {
      lastProgressAt: '2026-10-18T12:34:56.000Z',
      visibility: 'visible',
      reason: 'waiting_for_youtube',
      highestPosition: 10,
      missingPositions: [11, 12],
      recoveryAttempts: 1,
      scroll: { container: 'document', top: 900, height: 1500, viewport: 600 },
      continuation: true,
      confirmedCount: 10,
      documentId: 'PRIVATE_DOCUMENT_ID',
    },
  };
}
const observation: ScrollActionObservation = {
  kind: 'recovery',
  sequence: 42,
  before: {
    container: 'section',
    top: 900,
    height: 1500,
    viewport: 600,
    epoch: 2,
  },
  requestedTop: 390,
  after: {
    container: 'section',
    top: 390,
    height: 1500,
    viewport: 600,
    epoch: 2,
  },
  outcome: 'target-observed',
  attribution: 'during-call-only',
};
const entry: ScrollTraceEntry = {
  round: 42,
  elapsedMs: 1200,
  visibility: 'hidden',
  scroll: observation.after,
  distanceToEnd: 510,
  renderedRows: 20,
  visibleRows: 8,
  confirmedCount: 10,
  newConfirmed: 2,
  progressAgeMs: 5000,
  continuation: true,
  atGeometryEnd: false,
  action: observation,
  afterAction: 41,
  laterDelta: -25,
  laterAttribution: 'unknown',
  containerChanged: true,
};
const parse = (value: unknown) =>
  JSON.parse(formatImportDiagnostic(value as Scan));

describe('copyable import diagnostics', () => {
  it('retains every legacy field without IDs or inventing optional observations', () => {
    const scan = fixture();
    const before = structuredClone(scan);
    expect(parse(scan)).toEqual({
      count: 0,
      expectedCount: 12,
      status: 'waiting',
      diagnostics: {
        lastProgressAt: '2026-10-18T12:34:56.000Z',
        visibility: 'visible',
        reason: 'waiting_for_youtube',
        highestPosition: 10,
        missingPositions: [11, 12],
        recoveryAttempts: 1,
        scroll: {
          container: 'document',
          top: 900,
          height: 1500,
          viewport: 600,
        },
        continuation: true,
        confirmedCount: 10,
      },
    });
    expect(scan).toEqual(before);
    delete scan.diagnostics;
    expect(parse(scan).diagnostics).toBeNull();
  });

  it('preserves valid trace, action attribution and all optional legacy diagnostics', () => {
    const scan = fixture();
    Object.assign(scan.diagnostics!, {
      recoveryResults: [
        'Recovery 1: Scroll-Container erneut annähern',
        'Fortschritt nach Recovery 1',
      ],
      positionConflict: false,
      activeMs: 12000,
      attentionMs: 1000,
      totalAttentionMs: 2000,
      backgroundMode: 'experimental',
      timerThrottling: {
        requestedMs: 1000,
        lastElapsedMs: 1500,
        maxElapsedMs: 4000,
        delayedWaits: 2,
      },
      scrollTrace: {
        history: [entry],
        actionCount: 42,
        containerChanges: 1,
        totalRecoveryAttempts: 3,
        endObservations: 4,
        lastAction: observation,
      },
    });
    const expected = structuredClone(scan.diagnostics!);
    delete expected.documentId;
    const exportedAction = {
      ...observation,
      requestedDelta: -510,
      observedDelta: -510,
    };
    expect(parse(scan).diagnostics).toEqual({
      ...expected,
      scrollTrace: {
        ...expected.scrollTrace,
        history: [{ ...entry, action: exportedAction }],
        lastAction: exportedAction,
      },
    });
  });

  it('keeps action sequence, previous-action reference and later movement separate', () => {
    const scan = fixture();
    scan.diagnostics!.scrollTrace = {
      history: [
        entry,
        { ...entry, action: undefined, afterAction: 42, laterDelta: 15 },
      ],
      actionCount: 42,
      containerChanges: 0,
      totalRecoveryAttempts: 1,
      endObservations: 0,
      lastAction: observation,
    };
    const t = parse(scan).diagnostics.scrollTrace;
    expect(t.history[0]).toMatchObject({
      afterAction: 41,
      action: { sequence: 42, requestedDelta: -510, observedDelta: -510 },
      laterDelta: -25,
      laterAttribution: 'unknown',
    });
    expect(t.history[1]).toMatchObject({
      afterAction: 42,
      laterDelta: 15,
      laterAttribution: 'unknown',
    });
    expect(t.history[1]).not.toHaveProperty('action');
    expect(t.lastAction).toEqual(t.history[0].action);
  });

  it.each([
    { before: null, requestedDelta: null, observedDelta: null },
    { after: null, requestedDelta: null, observedDelta: null },
    {
      before: { ...observation.before, top: NaN },
      requestedDelta: null,
      observedDelta: null,
    },
    { requestedTop: Infinity, requestedDelta: null, observedDelta: -510 },
    { requestedTop: '390', requestedDelta: null, observedDelta: -510 },
    {
      after: { ...observation.after, top: NaN },
      requestedDelta: -510,
      observedDelta: null,
    },
    {
      after: { ...observation.after, container: 'div' },
      requestedDelta: null,
      observedDelta: null,
    },
    {
      after: { ...observation.after, epoch: 3 },
      requestedDelta: null,
      observedDelta: null,
    },
    {
      after: { ...observation.after, epoch: NaN },
      requestedDelta: null,
      observedDelta: null,
    },
    {
      before: { ...observation.before, epoch: undefined },
      after: { ...observation.after, epoch: undefined },
      requestedDelta: null,
      observedDelta: null,
    },
    {
      before: { ...observation.before, container: 'PRIVATE_A' },
      after: { ...observation.after, container: 'PRIVATE_B' },
      requestedDelta: null,
      observedDelta: null,
    },
    {
      before: { ...observation.before, top: 1e100 },
      requestedTop: -1e100,
      after: { ...observation.after, top: -1e100 },
      requestedDelta: -2_000_000_000,
      observedDelta: -2_000_000_000,
    },
    {
      requestedTop: 1200,
      after: { ...observation.after, top: 950 },
      requestedDelta: 300,
      observedDelta: 50,
    },
  ])(
    'derives deltas only from sanitized numbers and matching element identity: %j',
    ({ requestedDelta, observedDelta, ...overrides }) => {
      const scan = fixture();
      Object.assign(scan.diagnostics!, {
        scrollTrace: {
          lastAction: {
            ...observation,
            ...overrides,
            requestedDelta: 'PRIVATE_INJECTED',
            observedDelta: 123456,
          },
        },
      });
      const a = parse(scan).diagnostics.scrollTrace.lastAction;
      expect(a.requestedDelta).toBe(requestedDelta);
      expect(a.observedDelta).toBe(observedDelta);
    },
  );

  it.each([undefined, NaN, Infinity, 'PRIVATE_REFERENCE', null, 1e100])(
    'sanitizes optional sequence references %s',
    (reference) => {
      const scan = fixture();
      Object.assign(scan.diagnostics!, {
        scrollTrace: {
          history: [
            {
              ...entry,
              afterAction: reference,
              action: { ...observation, sequence: reference },
            },
          ],
        },
      });
      const e = parse(scan).diagnostics.scrollTrace.history[0];
      if (reference === undefined) {
        expect(e).not.toHaveProperty('afterAction');
        expect(e.action).not.toHaveProperty('sequence');
      } else {
        const expected = reference === 1e100 ? 1_000_000_000 : null;
        expect(e.afterAction).toBe(expected);
        expect(e.action.sequence).toBe(expected);
      }
    },
  );

  it.each([
    { visibleElements: 2, inViewport: true, distanceToViewport: 0 },
    { visibleElements: 1, inViewport: false, distanceToViewport: 450 },
    { visibleElements: 0, inViewport: null, distanceToViewport: null },
  ])('preserves loading area observation %j', (loadingArea) => {
    const scan = fixture();
    scan.diagnostics!.scrollTrace = {
      history: [{ ...entry, loadingArea }, entry],
      actionCount: 1,
      containerChanges: 0,
      totalRecoveryAttempts: 0,
      endObservations: 0,
    };
    const history = parse(scan).diagnostics.scrollTrace.history;
    expect(history[0].loadingArea).toEqual(loadingArea);
    expect(history[1]).not.toHaveProperty('loadingArea');
  });

  it('whitelists loading area fields and rejects malformed observations without coercion', () => {
    const secret =
      'PRIVATE_TITLE https://private.invalid/PRIVATE_ID <div>PRIVATE_DOM</div>';
    const observations = [
      {
        visibleElements: secret,
        inViewport: secret,
        distanceToViewport: secret,
        text: secret,
        id: secret,
      },
      {
        visibleElements: NaN,
        inViewport: 'true',
        distanceToViewport: Infinity,
      },
      { visibleElements: Infinity, inViewport: 1, distanceToViewport: NaN },
      { visibleElements: 1e100, inViewport: false, distanceToViewport: 1e100 },
      { visibleElements: -3, inViewport: null, distanceToViewport: -10 },
      {
        visibleElements: { toJSON: () => secret },
        inViewport: {},
        distanceToViewport: '123',
        toJSON: () => secret,
      },
      null,
      secret,
      [],
    ];
    const scan = fixture();
    Object.assign(scan.diagnostics!, {
      scrollTrace: {
        history: observations.map((loadingArea) => ({ ...entry, loadingArea })),
        actionCount: 0,
        containerChanges: 0,
        totalRecoveryAttempts: 0,
        endObservations: 0,
      },
    });
    const copy = formatImportDiagnostic(scan);
    for (const forbidden of ['PRIVATE_', 'https:', '<div>', 'toJSON'])
      expect(copy).not.toContain(forbidden);
    const unknown = {
      visibleElements: null,
      inViewport: null,
      distanceToViewport: null,
    };
    expect(
      JSON.parse(copy).diagnostics.scrollTrace.history.map(
        (e: { loadingArea: unknown }) => e.loadingArea,
      ),
    ).toEqual([
      unknown,
      unknown,
      unknown,
      {
        visibleElements: 1_000_000_000,
        inViewport: false,
        distanceToViewport: 1_000_000_000,
      },
      { visibleElements: 0, inViewport: null, distanceToViewport: 0 },
      unknown,
      unknown,
      unknown,
      unknown,
    ]);
  });

  it('reconstructs malicious stored values at every nesting level', () => {
    const secret =
      'PRIVATE_TITLE https://private.invalid/watch?id=PRIVATE_ID <div>PRIVATE_DOM</div>';
    const maliciousPosition = {
      container: `ytd-${secret}`,
      top: secret,
      height: { toJSON: () => secret },
      viewport: secret,
      epoch: secret,
      id: secret,
      text: secret,
    };
    const maliciousAction = {
      kind: secret,
      before: maliciousPosition,
      requestedTop: secret,
      after: maliciousPosition,
      outcome: secret,
      attribution: secret,
      error: secret,
    };
    const scan = {
      ...fixture(),
      status: secret,
      expectedCount: secret,
      videos: [{ title: secret, url: secret, id: secret }],
      diagnostics: {
        lastProgressAt: secret,
        visibility: secret,
        reason: secret,
        highestPosition: secret,
        missingPositions: [secret, { toJSON: () => secret }],
        recoveryAttempts: secret,
        recoveryResults: [secret, `Fortschritt nach Recovery 1 ${secret}`],
        positionConflict: secret,
        activeMs: secret,
        attentionMs: secret,
        totalAttentionMs: secret,
        scroll: maliciousPosition,
        continuation: secret,
        confirmedCount: secret,
        backgroundMode: secret,
        timerThrottling: {
          requestedMs: secret,
          lastElapsedMs: secret,
          maxElapsedMs: secret,
          delayedWaits: secret,
          text: secret,
        },
        documentId: secret,
        scrollTrace: {
          history: [
            {
              ...Object.fromEntries(
                Object.keys(entry).map((key) => [key, secret]),
              ),
              scroll: maliciousPosition,
              action: maliciousAction,
            },
          ],
          actionCount: secret,
          containerChanges: secret,
          totalRecoveryAttempts: secret,
          endObservations: secret,
          lastAction: maliciousAction,
          content: secret,
        },
      },
    };
    const copy = formatImportDiagnostic(scan as unknown as Scan);
    for (const forbidden of [
      'PRIVATE_',
      'https:',
      '<div>',
      'documentId',
      'toJSON',
    ])
      expect(copy).not.toContain(forbidden);
    const safe = JSON.parse(copy);
    expect(safe.count).toBe(1);
    expect(safe.status).toBe('unknown');
    expect(safe.expectedCount).toBeNull();
    expect(safe.diagnostics).toMatchObject({
      lastProgressAt: null,
      visibility: 'unknown',
      reason: 'unknown',
      missingPositions: [null, null],
      recoveryResults: ['unknown', 'unknown'],
      scroll: { container: 'other', top: null, height: null, epoch: null },
      continuation: false,
      positionConflict: false,
      backgroundMode: 'unknown',
      scrollTrace: {
        lastAction: {
          kind: 'unknown',
          outcome: 'unknown',
          attribution: 'unknown',
        },
        history: [
          {
            visibility: 'unknown',
            laterAttribution: 'unknown',
            laterDelta: null,
          },
        ],
      },
    });
  });

  it('bounds lists to the latest 24/10 entries and first 100 missing positions', () => {
    const scan = fixture();
    Object.assign(scan.diagnostics!, {
      missingPositions: Array.from({ length: 500 }, (_, i) => i + 1),
      recoveryResults: Array.from(
        { length: 100 },
        (_, i) => `Fortschritt nach Recovery ${i + 1}`,
      ),
      scrollTrace: {
        history: Array.from({ length: 100 }, (_, i) => ({
          ...entry,
          round: i,
        })),
        actionCount: 100,
        containerChanges: 0,
        totalRecoveryAttempts: 100,
        endObservations: 0,
      },
    });
    const d = parse(scan).diagnostics;
    expect(d.missingPositions).toEqual(
      Array.from({ length: 100 }, (_, i) => i + 1),
    );
    expect(d.recoveryResults).toHaveLength(10);
    expect(d.recoveryResults[0]).toBe('Fortschritt nach Recovery 91');
    expect(d.scrollTrace.history).toHaveLength(24);
    expect(d.scrollTrace.history[0].round).toBe(76);
    expect(d.scrollTrace.history.at(-1).round).toBe(99);
    expect(d.scrollTrace).not.toHaveProperty('lastAction');
  });

  it('rejects NaN, infinities and coercion; clamps finite numbers and preserves signed deltas', () => {
    const scan = fixture();
    Object.assign(scan.diagnostics!, {
      activeMs: NaN,
      attentionMs: Infinity,
      totalAttentionMs: -Infinity,
      missingPositions: [NaN, Infinity, -4, 1e100, '123'],
      scroll: {
        container: 'div',
        top: -3,
        height: 1e100,
        viewport: -12,
        epoch: NaN,
      },
      scrollTrace: {
        history: [{ ...entry, laterDelta: -1e100, elapsedMs: NaN }],
        actionCount: Infinity,
        containerChanges: -1,
        totalRecoveryAttempts: 1e100,
        endObservations: '12',
      },
    });
    const d = parse(scan).diagnostics;
    expect(d.activeMs).toBeNull();
    expect(d.attentionMs).toBeNull();
    expect(d.totalAttentionMs).toBeNull();
    expect(d.missingPositions).toEqual([null, null, 0, 1_000_000_000, null]);
    expect(d.scroll).toEqual({
      container: 'div',
      top: -3,
      height: 1_000_000_000,
      viewport: 0,
      epoch: null,
    });
    expect(d.scrollTrace).toMatchObject({
      history: [{ laterDelta: -1_000_000_000, elapsedMs: null }],
      actionCount: null,
      containerChanges: 0,
      totalRecoveryAttempts: 1_000_000_000,
      endObservations: null,
    });
  });

  it.each([
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
  ])('preserves scanner reason %s verbatim', (reason) => {
    const scan = fixture();
    scan.diagnostics!.reason = reason;
    expect(parse(scan).diagnostics.reason).toBe(reason);
  });

  it('retains recoveries at 20/40/60 seconds independently of the rolling history at 90 seconds', () => {
    const scan = fixture();
    const recoveries = [20_000, 40_000, 60_000].map((elapsedMs) => ({
      elapsedMs,
      action: observation,
      confirmedBefore: 10,
      confirmedAfter: 10,
      result: 'no-new-ids-observed',
    }));
    const progress = { elapsedMs: 1000, confirmedCount: 10, newConfirmed: 10 };
    Object.assign(scan.diagnostics!, {
      scrollTrace: {
        history: Array.from({ length: 91 }, (_, i) => ({
          ...entry,
          elapsedMs: i * 1000,
        })),
        recoveryHistory: recoveries,
        progressEvents: [progress],
      },
    });
    const t = parse(scan).diagnostics.scrollTrace;
    expect(t.history).toHaveLength(24);
    expect(t.history[0].elapsedMs).toBe(67_000);
    expect(t.recoveryHistory).toEqual(
      recoveries.map((r) => ({
        ...r,
        action: { ...observation, requestedDelta: -510, observedDelta: -510 },
      })),
    );
    expect(t.progressEvents).toEqual([progress]);
  });

  it.each([
    'pending',
    'new-ids-later-observed',
    'no-new-ids-observed',
    'unresolved',
  ])(
    'preserves recovery result %s without inventing an optional action',
    (result) => {
      const scan = fixture();
      const recovery = {
        elapsedMs: 20_000,
        confirmedBefore: 10,
        confirmedAfter: 12,
        result,
      };
      Object.assign(scan.diagnostics!, {
        scrollTrace: { recoveryHistory: [recovery] },
      });
      const r = parse(scan).diagnostics.scrollTrace.recoveryHistory[0];
      expect(r).toEqual(recovery);
      expect(r).not.toHaveProperty('action');
    },
  );

  it('keeps only the latest three recoveries and eight progress events', () => {
    const scan = fixture();
    const recoveries = Array.from({ length: 100 }, (_, i) => ({
      elapsedMs: i * 1000,
      confirmedBefore: i,
      confirmedAfter: i + 1,
      result: 'new-ids-later-observed',
    }));
    const progress = Array.from({ length: 100 }, (_, i) => ({
      elapsedMs: i * 1000,
      confirmedCount: i + 1,
      newConfirmed: 1,
    }));
    Object.assign(scan.diagnostics!, {
      scrollTrace: { recoveryHistory: recoveries, progressEvents: progress },
    });
    const t = parse(scan).diagnostics.scrollTrace;
    expect(t.recoveryHistory).toEqual(recoveries.slice(-3));
    expect(t.progressEvents).toEqual(progress.slice(-8));
  });

  it('reconstructs recovery and progress observations without trusting strings, extra fields or numbers', () => {
    const secret =
      'PRIVATE_TITLE https://private.invalid/PRIVATE_ID <div>PRIVATE_DOM</div>';
    const scan = fixture();
    Object.assign(scan.diagnostics!, {
      scrollTrace: {
        recoveryHistory: [
          {
            elapsedMs: secret,
            confirmedBefore: NaN,
            confirmedAfter: Infinity,
            result: secret,
            action: {
              ...observation,
              sequence: secret,
              before: { ...observation.before, container: secret },
              requestedDelta: secret,
              observedDelta: secret,
              text: secret,
            },
            text: secret,
            url: secret,
            toJSON: () => secret,
          },
          {
            elapsedMs: 1e100,
            confirmedBefore: -1,
            confirmedAfter: '12',
            result: 'pending',
          },
          null,
        ],
        progressEvents: [
          {
            elapsedMs: secret,
            confirmedCount: NaN,
            newConfirmed: Infinity,
            id: secret,
            text: secret,
            toJSON: () => secret,
          },
          { elapsedMs: -1, confirmedCount: 1e100, newConfirmed: '12' },
          null,
        ],
      },
    });
    const copy = formatImportDiagnostic(scan);
    for (const forbidden of ['PRIVATE_', 'https:', '<div>', 'toJSON'])
      expect(copy).not.toContain(forbidden);
    const t = JSON.parse(copy).diagnostics.scrollTrace;
    expect(t.recoveryHistory[0]).toEqual({
      elapsedMs: null,
      confirmedBefore: null,
      confirmedAfter: null,
      result: 'unknown',
      action: {
        ...observation,
        sequence: null,
        before: { ...observation.before, container: 'other' },
        requestedDelta: null,
        observedDelta: null,
      },
    });
    expect(t.recoveryHistory[1]).toEqual({
      elapsedMs: 1_000_000_000,
      confirmedBefore: 0,
      confirmedAfter: null,
      result: 'pending',
    });
    expect(t.recoveryHistory[2]).toEqual({
      elapsedMs: null,
      confirmedBefore: null,
      confirmedAfter: null,
      result: 'unknown',
    });
    expect(t.progressEvents).toEqual([
      { elapsedMs: null, confirmedCount: null, newConfirmed: null },
      { elapsedMs: 0, confirmedCount: 1_000_000_000, newConfirmed: null },
      { elapsedMs: null, confirmedCount: null, newConfirmed: null },
    ]);
  });

  it.each([undefined, null, {}, 'PRIVATE_CONTENT'])(
    'handles absent or malformed summary lists %s',
    (value) => {
      const scan = fixture();
      Object.assign(scan.diagnostics!, {
        scrollTrace: { recoveryHistory: value, progressEvents: value },
      });
      const t = parse(scan).diagnostics.scrollTrace;
      if (value === undefined) {
        expect(t).not.toHaveProperty('recoveryHistory');
        expect(t).not.toHaveProperty('progressEvents');
      } else {
        expect(t.recoveryHistory).toEqual([]);
        expect(t.progressEvents).toEqual([]);
      }
    },
  );

  it('preserves legacy ISO timestamps without milliseconds while rejecting appended private content', () => {
    const scan = fixture();
    scan.diagnostics!.lastProgressAt = '2026-10-18T12:34:56Z';
    expect(parse(scan).diagnostics.lastProgressAt).toBe('2026-10-18T12:34:56Z');
    scan.diagnostics!.lastProgressAt += ' PRIVATE_TITLE';
    expect(parse(scan).diagnostics.lastProgressAt).toBeNull();
  });

  it('preserves the fixed legacy recovery enum but rejects variants carrying private content', () => {
    const scan = fixture();
    scan.diagnostics!.recoveryResults = [
      'scroll_retry_no_progress',
      'scroll_retry_no_progress PRIVATE_TITLE',
    ];
    expect(parse(scan).diagnostics.recoveryResults).toEqual([
      'scroll_retry_no_progress',
      'unknown',
    ]);
  });

  it('handles malformed legacy collections and invalid timestamps without throwing', () => {
    const scan = fixture();
    Object.assign(scan.diagnostics!, {
      lastProgressAt: '2026-02-30T12:34:56.000Z',
      missingPositions: {},
      recoveryResults: 'PRIVATE_TEXT',
      scrollTrace: { history: 'PRIVATE_DOM' },
    });
    const d = parse(scan).diagnostics;
    expect(d.lastProgressAt).toBeNull();
    expect(d.missingPositions).toEqual([]);
    expect(d.recoveryResults).toEqual([]);
    expect(d.scrollTrace.history).toEqual([]);
    expect(parse({ ...scan, diagnostics: null }).diagnostics).toBeNull();
  });
});
