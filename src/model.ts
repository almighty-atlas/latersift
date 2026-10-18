import type { DecisionJournal, OperationState } from './operations';

export type Availability =
  'available' | 'private' | 'removed' | 'restricted' | 'unknown';
export interface Video {
  id: string;
  url: string;
  title: string | null;
  channel: string | null;
  thumbnail: string | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  position: number | null;
  availability: Availability;
  evidence: string | null;
  scannedAt: string;
  originalPlaylist: 'WL';
}
export interface ScrollPosition {
  container: string;
  top: number;
  height: number;
  viewport: number;
  /** Scan-local element identity; never a DOM id or attribute value. */
  epoch?: number;
}
export interface ScrollActionObservation {
  kind: 'advance' | 'recovery' | 'reset' | 'end-jump';
  sequence?: number;
  before: ScrollPosition | null;
  requestedTop: number | null;
  after: ScrollPosition | null;
  outcome:
    | 'target-observed'
    | 'no-movement'
    | 'partial-or-divergent'
    | 'unavailable'
    | 'error';
  /** Synchronous geometry observation, not proof that browser input was absent. */
  attribution: 'during-call-only';
}
export interface LoadingAreaObservation {
  visibleElements: number;
  inViewport: boolean | null;
  distanceToViewport: number | null;
}
export interface ScrollTraceEntry {
  round: number;
  elapsedMs: number;
  visibility: 'hidden' | 'visible' | 'unknown';
  scroll: ScrollPosition | null;
  distanceToEnd: number | null;
  renderedRows: number;
  visibleRows: number;
  confirmedCount: number;
  newConfirmed: number;
  progressAgeMs: number;
  continuation: boolean;
  loadingArea?: LoadingAreaObservation;
  /** A regular DOM end is not proof of the website's actual loading trigger. */
  atGeometryEnd: boolean;
  action?: ScrollActionObservation;
  /** Difference after the previous call returned: manual input/layout/async scrolling unknown. */
  afterAction?: number;
  laterDelta: number | null;
  laterAttribution: 'unknown';
  containerChanged: boolean;
}
export interface ScrollRecoveryObservation {
  elapsedMs: number;
  action?: ScrollActionObservation;
  confirmedBefore: number;
  confirmedAfter: number;
  result:
    'pending' | 'new-ids-later-observed' | 'no-new-ids-observed' | 'unresolved';
}
export interface ScanScrollTrace {
  history: ScrollTraceEntry[];
  actionCount: number;
  containerChanges: number;
  totalRecoveryAttempts: number;
  endObservations: number;
  lastAction?: ScrollActionObservation;
  recoveryHistory?: ScrollRecoveryObservation[];
  progressEvents?: {
    elapsedMs: number;
    confirmedCount: number;
    newConfirmed: number;
  }[];
}
export type FastFallbackReason =
  | 'virtualization-or-removed-rows'
  | 'position-gap-or-conflict' // Legacy diagnostics only.
  | 'no-rows'
  | 'unidentifiable-rows'
  | 'invalid-positions'
  | 'duplicate-ids'
  | 'duplicate-positions'
  | 'changed-positions'
  | 'rendered-position-gaps'
  | 'confirmed-position-gaps'
  | 'initialization-unstable'
  | 'container-changed'
  | 'geometry-unavailable'
  | 'jump-failed'
  | 'bounded-stall';
export interface FastFallbackSnapshot {
  reason: FastFallbackReason;
  phase: 'initializing' | 'scanning';
  elapsedMs: number;
  renderedRows: number;
  uniqueRenderedIds: number;
  unidentifiableRows: number;
  validPositions: number;
  invalidPositions: number;
  minPosition: number | null;
  maxPosition: number | null;
  missingWithinRenderedRange: number;
  missingWithinConfirmedRange: number;
  duplicateIds: boolean;
  duplicatePositions: boolean;
  changedPositions: boolean;
}
export interface ImportPerformance {
  mode: 'stepwise' | 'fast-jump';
  endJumps: number;
  loadEvents: number;
  progressIntervals: number;
  progressIntervalTotalMs: number;
  averageProgressIntervalMs: number | null;
  scrollApproachMs: number;
  endWithoutNewIdsMs: number;
  jumpToNewIdsMs: number;
  jumpToNewIdsSamples: number;
  fallbackCount: number;
  fallbackReasons: FastFallbackReason[];
  fallbackSnapshots?: FastFallbackSnapshot[];
  initializationState?: 'waiting' | 'ready' | 'fallback';
  initializationElapsedMs?: number;
  initializationObservations?: number;
  renderedRows: number;
  minRenderedPosition: number | null;
  maxRenderedPosition: number | null;
  minVisiblePosition: number | null;
  maxVisiblePosition: number | null;
  renderedRowsDelta: number;
  scrollHeightDelta: number | null;
  missingWithinConfirmedRange: number;
  uniqueRenderedIds: number;
  positionConflicts: boolean;
  domBehavior: 'unknown' | 'growing' | 'virtualization-suspected';
  milestones: { confirmedCount: number; elapsedMs: number }[];
}
export interface ScanDiagnostics {
  lastProgressAt: string;
  visibility: string;
  reason: string;
  highestPosition: number;
  missingPositions: number[];
  recoveryAttempts: number;
  scroll: ScrollPosition | null;
  scrollTrace?: ScanScrollTrace;
  continuation: boolean;
  confirmedCount: number;
  documentId?: string;
  positionConflict?: boolean;
  activeMs?: number;
  attentionMs?: number;
  totalAttentionMs?: number;
  recoveryResults?: string[];
  performance?: ImportPerformance;
  rewindRequired?: boolean;
  backgroundMode?: 'paused' | 'experimental';
  // Delayed waits suggest throttling, but do not establish its cause.
  timerThrottling?: {
    requestedMs: number;
    lastElapsedMs: number;
    maxElapsedMs: number;
    delayedWaits: number;
  };
}
export interface Scan {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status:
    | 'running'
    | 'waiting'
    | 'needs_attention'
    | 'complete'
    | 'interrupted'
    | 'incomplete'
    | 'failed';
  diagnostics?: ScanDiagnostics;
  // IDs whose positions were actually observed in diagnostics.documentId.
  confirmedVideoIds?: string[];
  expectedCount: number | null;
  videos: Video[];
  unidentifiableRows: number;
  message: string;
}
export type DecisionKind = 'remove' | 'archive' | 'defer';
export type OperationStatus =
  'pending' | 'running' | 'verified' | 'failed' | 'unknown';
export interface Decision {
  id: string;
  videoId: string;
  sessionId: string;
  kind: DecisionKind;
  targetPlaylist: string | null;
  createdAt: string;
  status: OperationStatus;
  journal?: DecisionJournal;
  source?: 'swipe' | 'cleanup';
}
export interface Session {
  id: string;
  size: number;
  videoIds: string[];
  paused: boolean;
  createdAt: string;
}
export interface Library {
  schemaVersion: 1 | 2 | 3;
  operations?: OperationState;
  scans: Scan[];
  decisions: Decision[];
  session: Session | null;
  archivePlaylist: string;
}
export const emptyLibrary = (): Library => ({
  schemaVersion: 3,
  operations: { limit: 1, attestations: [] },
  scans: [],
  decisions: [],
  session: null,
  archivePlaylist: '',
});
export const latestScan = (lib: Library) => lib.scans.at(-1);
export const safeCandidate = (v: Video) =>
  v.availability === 'private' || v.availability === 'removed';
export interface VideoRecommendationProvider {
  recommend(
    video: Video,
  ): Promise<{ action: 'keep' | 'remove'; reason: string } | null>;
}
