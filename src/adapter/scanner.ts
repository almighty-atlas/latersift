import type { Scan, Video } from '../model';
import {
  emptyNotice,
  expectedCount,
  hasContinuation,
  parseRow,
  ROW,
  watchLaterLocation,
} from './dom';
export interface ScanEnvironment {
  doc: Document;
  url(): string;
  advance(recovery?: boolean): void;
  wait(ms: number, signal: AbortSignal): Promise<void>;
  now?(): number;
  documentId?: string;
  scrollInfo?(): NonNullable<Scan['diagnostics']>['scroll'];
  resetScroll?(): void;
}
export const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Abgebrochen', 'AbortError'));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Abgebrochen', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
export const SCAN_DEFAULTS = {
  intervalMs: 1000,
  waitingMs: 8000,
  recoveryEveryMs: 20000,
  maxRecoveries: 3,
  stallMs: 90000,
  attentionLimitMs: 120000,
  totalAttentionLimitMs: 600000,
  settleMs: 3000,
  checkpointMs: 5000,
  checkpointVideos: 100,
  // A bounded budget grows only with observed IDs, not with polling or tab pauses.
  baseActiveMs: 300000,
  perVideoMs: 1000,
  maxActiveMs: 7200000,
  maxRounds: 100000,
};
export type ScanOptions = Partial<typeof SCAN_DEFAULTS> & {
  idleRounds?: number;
};
class CheckpointError extends Error {}
export async function scanWatchLater(
  env: ScanEnvironment,
  signal: AbortSignal,
  checkpoint: (scan: Scan) => Promise<void>,
  options: ScanOptions = {},
  resume?: Scan,
): Promise<Scan> {
  const config = { ...SCAN_DEFAULTS, ...options };
  // Legacy fixture callers can still request a short settlement window.
  if (options.idleRounds !== undefined)
    config.settleMs = options.idleRounds * Math.max(1, config.intervalMs);
  const clock = env.now ?? (() => performance.timeOrigin + performance.now());
  let time = clock(),
    previousTime = time;
  const scan: Scan = {
    id: resume?.id ?? crypto.randomUUID(),
    startedAt: resume?.startedAt ?? new Date(time).toISOString(),
    finishedAt: null,
    status: 'running',
    expectedCount: null,
    videos: resume?.videos.slice() ?? [],
    unidentifiableRows: 0,
    message: 'YouTube wird gelesen …',
  };
  const videos = new Map(scan.videos.map((v) => [v.id, v]));
  const confirmed = new Map<string, Video>();
  const sameDocument =
    !!env.documentId && resume?.diagnostics?.documentId === env.documentId;
  if (sameDocument) {
    const evidence = new Set(resume?.confirmedVideoIds ?? []);
    scan.videos
      .filter((v) => evidence.has(v.id))
      .forEach((v) => confirmed.set(v.id, v));
  }
  // Fresh/reloaded documents must revisit the beginning, including virtualized rows.
  if (!sameDocument) env.resetScroll?.();
  let lastProgress = time,
    stableSince = time,
    activeMs = 0,
    attentionMs = 0,
    stallMs = 0;
  let recoveries = 0,
    lastRecovery = 0,
    lastSaved = -Infinity,
    savedCount = -1;
  let lastState: Scan['status'] | undefined;
  let positionConflict =
    sameDocument && !!resume?.diagnostics?.positionConflict;
  scan.unidentifiableRows = sameDocument
    ? (resume?.unidentifiableRows ?? 0)
    : 0;
  let priorScroll = env.scrollInfo?.() ?? null;
  let totalAttentionMs = 0,
    hiddenQuietMs = 0,
    activatedSinceTick = false;
  const generation = env.documentId;
  let previousHidden = env.doc.visibilityState === 'hidden';
  let visibilityAt = clock(),
    hiddenDuration = 0;
  let trackedHidden = previousHidden;
  const visibilityChanged = () => {
    const at = clock();
    if (trackedHidden) hiddenDuration += Math.max(0, at - visibilityAt);
    visibilityAt = at;
    const hidden = env.doc.visibilityState === 'hidden';
    if (trackedHidden && !hidden) activatedSinceTick = true;
    trackedHidden = hidden;
  };
  env.doc.addEventListener('visibilitychange', visibilityChanged);
  let previousContinuation: boolean | undefined;
  let previousExpected = sameDocument ? resume!.expectedCount : null;
  const results: string[] = [];
  const persist = async () => {
    try {
      await checkpoint(structuredClone(scan));
    } catch (error) {
      throw new CheckpointError(`Speicherung fehlgeschlagen: ${String(error)}`);
    }
    lastSaved = time;
    savedCount = videos.size;
    lastState = scan.status;
  };
  const finish = (status: Scan['status'], reason: string, message: string) => {
    scan.status = status;
    scan.message = message;
    if (scan.diagnostics) scan.diagnostics.reason = reason;
  };
  try {
    for (let round = 0; round < config.maxRounds; round++) {
      // A logical minimum is useful for deterministic zero-delay DOM fixtures.
      time = Math.max(
        clock(),
        previousTime + (round ? Math.max(1, config.intervalMs) : 0),
      );
      const elapsed = time - previousTime;
      previousTime = time;
      if (signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');
      if (!watchLaterLocation(env.url()) || env.documentId !== generation) {
        finish(
          'interrupted',
          'navigation',
          'YouTube-Tab hat Watch Later verlassen. Bestätigter Teilbestand bleibt erhalten.',
        );
        break;
      }
      const hidden = env.doc.visibilityState === 'hidden';
      const wall = clock();
      // Real visibility events account for transitions even during throttled timers.
      // Fixtures without events conservatively attribute a changed interval to hidden.
      let hiddenElapsed =
        hiddenDuration + (trackedHidden ? Math.max(0, wall - visibilityAt) : 0);
      if (trackedHidden !== hidden) hiddenElapsed = elapsed;
      hiddenElapsed = Math.min(elapsed, hiddenElapsed);
      hiddenDuration = 0;
      visibilityAt = wall;
      trackedHidden = hidden;
      activeMs += elapsed - hiddenElapsed;
      stallMs += elapsed - hiddenElapsed;
      const previousQuiet = hiddenQuietMs;
      hiddenQuietMs += hiddenElapsed;
      const waitingTime =
        Math.max(0, hiddenQuietMs - config.waitingMs) -
        Math.max(0, previousQuiet - config.waitingMs);
      attentionMs += waitingTime;
      totalAttentionMs += waitingTime;
      if (!hidden && (previousHidden || activatedSinceTick)) {
        hiddenQuietMs = 0;
        attentionMs = 0;
        stallMs = 0;
        recoveries = 0;
        lastRecovery = 0;
      }
      activatedSinceTick = false;
      previousHidden = hidden;
      const scroll = env.scrollInfo?.() ?? null;
      const approaching =
        !!scroll && scroll.top < scroll.height - scroll.viewport - 2;
      // Travelling through already loaded rows is not a failed load attempt.
      if (approaching && priorScroll && scroll.top > priorScroll.top)
        stallMs = 0;
      priorScroll = scroll;
      const rows = [...env.doc.querySelectorAll(ROW)];
      const count = expectedCount(env.doc) ?? (emptyNotice(env.doc) ? 0 : null);
      if (previousExpected !== null && count !== previousExpected) {
        // A changed playlist invalidates position evidence, but not retained IDs.
        confirmed.clear();
        positionConflict = false;
      }
      previousExpected = count;
      scan.expectedCount = count;
      let progress = false,
        unknown = 0;
      for (const row of rows) {
        const video = parseRow(row, new Date(time).toISOString());
        if (!video) {
          unknown++;
          continue;
        }
        const prior = confirmed.get(video.id);
        if (prior && prior.position !== video.position) positionConflict = true;
        if (!confirmed.has(video.id)) progress = true;
        confirmed.set(video.id, video);
        videos.set(video.id, video);
      }
      scan.unidentifiableRows = Math.max(scan.unidentifiableRows, unknown);
      if (progress) {
        if (recoveries) results.push(`Fortschritt nach Recovery ${recoveries}`);
        lastProgress = time;
        stableSince = time;
        stallMs = 0;
        attentionMs = 0;
        hiddenQuietMs = 0;
        recoveries = 0;
        lastRecovery = 0;
      }
      const continuation = hasContinuation(env.doc);
      if (continuation !== previousContinuation) stableSince = time;
      previousContinuation = continuation;
      const positions = new Set([...confirmed.values()].map((v) => v.position));
      const missing: number[] = [];
      // Keep diagnostics bounded and metadata-free; only the first 100 gaps.
      if (count !== null)
        for (
          let p = 1;
          p <= Math.min(count, 100000) && missing.length < 100;
          p++
        )
          if (!positions.has(p)) missing.push(p);
      const proven =
        count !== null &&
        confirmed.size === count &&
        positions.size === count &&
        [...positions].every((p) => p !== null && p >= 1 && p <= count) &&
        !positionConflict &&
        scan.unidentifiableRows === 0;
      scan.videos = [...videos.values()];
      scan.confirmedVideoIds = [...confirmed.keys()];
      scan.diagnostics = {
        lastProgressAt: new Date(lastProgress).toISOString(),
        visibility: env.doc.visibilityState,
        reason: 'scanning',
        highestPosition: Math.max(
          0,
          ...[...confirmed.values()].map((v) => v.position ?? 0),
        ),
        missingPositions: missing,
        recoveryAttempts: recoveries,
        recoveryResults: results.slice(-10),
        scroll,
        continuation,
        confirmedCount: confirmed.size,
        documentId: env.documentId,
        positionConflict,
        activeMs,
        attentionMs,
        totalAttentionMs,
      };
      if (proven && !continuation && time - stableSince >= config.settleMs) {
        // A complete snapshot contains only evidence from this document, never stale resume IDs.
        scan.videos = [...confirmed.values()];
        finish(
          'complete',
          'count_and_positions_verified',
          'Vollständigkeit über YouTube-Anzahl und fortlaufende Positionen geprüft.',
        );
        break;
      }
      let recoveredThisRound = false;
      if (
        (hidden ? hiddenQuietMs : stallMs) >= config.waitingMs &&
        (!approaching || hidden)
      ) {
        scan.status = hidden ? 'needs_attention' : 'waiting';
        scan.message = hidden
          ? 'YouTube lädt momentan nicht weiter. Aktiviere den YouTube-Tab, um das Nachladen fortzusetzen.'
          : 'YouTube lädt momentan keine weiteren Videos. Begrenzte Scroll-Wiederherstellung läuft; ggf. nicht verfügbare Videos in YouTube anzeigen.';
        scan.diagnostics.reason = hidden
          ? 'background_tab_stalled'
          : 'waiting_for_youtube';
        if (
          !hidden &&
          recoveries < config.maxRecoveries &&
          stallMs - lastRecovery >= config.recoveryEveryMs
        ) {
          recoveries++;
          lastRecovery = stallMs;
          results.push(
            `Recovery ${recoveries}: Scroll-Container erneut annähern`,
          );
          scan.diagnostics.recoveryAttempts = recoveries;
          env.advance(true);
          recoveredThisRound = true;
        }
      } else {
        scan.status = 'running';
        scan.message =
          sameDocument || !resume
            ? 'YouTube wird schrittweise gelesen …'
            : 'Gesicherte IDs bleiben erhalten; Positionen werden nach Reload erneut bestätigt …';
      }
      if (
        attentionMs >= config.attentionLimitMs ||
        totalAttentionMs >= config.totalAttentionLimitMs
      ) {
        finish(
          'incomplete',
          'attention_timeout',
          'Warten auf aktiven YouTube-Tab beendet. Teilbestand gesichert; YouTube aktivieren und fortsetzen.',
        );
        break;
      }
      if (
        !hidden &&
        stallMs >= config.stallMs &&
        (recoveries >= config.maxRecoveries || approaching)
      ) {
        if (!rows.length && !emptyNotice(env.doc) && !videos.size)
          finish(
            'failed',
            'unsupported_dom',
            'Keine unterstützte Playlist-Struktur erkannt. Anmeldung und YouTube-DOM prüfen.',
          );
        else
          finish(
            'incomplete',
            approaching ? 'scroll_unreachable' : 'recovery_exhausted',
            'Teilimport: YouTube liefert nach begrenzten Scroll-Versuchen keine belegbar vollständige Liste. Diagnose prüfen und erneut versuchen.',
          );
        break;
      }
      const budget = Math.min(
        config.maxActiveMs,
        config.baseActiveMs + confirmed.size * config.perVideoMs,
      );
      if (activeMs >= budget) {
        finish(
          'incomplete',
          'active_time_budget',
          'Fortschrittsabhängiges Zeitbudget erreicht. Teilbestand gesichert; Fortsetzen möglich.',
        );
        break;
      }
      if (
        lastState !== scan.status ||
        (videos.size !== savedCount &&
          (videos.size - savedCount >= config.checkpointVideos ||
            time - lastSaved >= config.checkpointMs)) ||
        time - lastSaved >= 15000
      )
        await persist();
      if (!hidden && !recoveredThisRound) env.advance();
      await env.wait(config.intervalMs, signal);
    }
    if (['running', 'waiting', 'needs_attention'].includes(scan.status)) {
      // maxRounds is a final safety fuse, not the normal completion criterion.
      finish(
        scan.videos.length || env.doc.querySelector(ROW)
          ? 'incomplete'
          : 'failed',
        'round_safety_limit',
        'Sicherheitsgrenze erreicht. Teilbestand gesichert; Diagnose prüfen und fortsetzen.',
      );
    }
  } catch (error) {
    if (error instanceof CheckpointError) {
      env.doc.removeEventListener('visibilitychange', visibilityChanged);
      throw error;
    }
    finish(
      signal.aborted ? 'interrupted' : 'failed',
      signal.aborted ? 'user_or_browser_interrupted' : 'scanner_error',
      signal.aborted
        ? 'Import pausiert. Teilbestand gesichert.'
        : String(error),
    );
  }
  env.doc.removeEventListener('visibilitychange', visibilityChanged);
  scan.finishedAt = new Date(time).toISOString();
  await persist();
  return scan;
}
