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
  advance(): void;
  wait(ms: number, signal: AbortSignal): Promise<void>;
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
export async function scanWatchLater(
  env: ScanEnvironment,
  signal: AbortSignal,
  checkpoint: (scan: Scan) => Promise<void>,
  options = { intervalMs: 1000, maxRounds: 1200, idleRounds: 8 },
): Promise<Scan> {
  const scan: Scan = {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: 'running',
    expectedCount: null,
    videos: [],
    unidentifiableRows: 0,
    message: 'YouTube wird gelesen …',
  };
  const videos = new Map<string, Video>();
  let idle = 0,
    lastCount = -1;
  // Unknown entries are retained as a diagnostic count, never assigned invented IDs.
  let unknownRows = 0;
  try {
    for (let round = 0; round < options.maxRounds; round++) {
      if (signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');
      if (!watchLaterLocation(env.url()))
        throw new Error(
          'Öffne die angemeldete YouTube-Seite /playlist?list=WL. Der verbundene Tab wurde möglicherweise gewechselt.',
        );
      const rows = [...env.doc.querySelectorAll(ROW)];
      unknownRows = Math.max(
        unknownRows,
        rows.filter((row) => !parseRow(row)).length,
      );
      for (const row of rows) {
        const v = parseRow(row);
        if (v) {
          const previous = videos.get(v.id);
          videos.set(
            v.id,
            previous ? { ...v, position: previous.position ?? v.position } : v,
          );
        }
      }
      scan.videos = [...videos.values()];
      scan.unidentifiableRows = unknownRows;
      scan.expectedCount =
        expectedCount(env.doc) ?? (emptyNotice(env.doc) ? 0 : null);
      idle = videos.size === lastCount ? idle + 1 : 0;
      lastCount = videos.size;
      const settled = idle >= options.idleRounds && !hasContinuation(env.doc);
      const recognized = rows.length > 0 || emptyNotice(env.doc);
      if (settled && recognized) {
        const positions = scan.videos.map((v) => v.position);
        const uniquePositions = new Set(positions);
        const coversPositions =
          scan.expectedCount === 0 ||
          (uniquePositions.size === scan.expectedCount &&
            positions.every(
              (p) => p !== null && p >= 1 && p <= scan.expectedCount!,
            ));
        scan.status =
          scan.expectedCount === videos.size &&
          unknownRows === 0 &&
          coversPositions
            ? 'complete'
            : 'incomplete';
        scan.message =
          scan.status === 'complete'
            ? 'Vollständigkeit über YouTube-Anzahl und fortlaufende Positionen geprüft.'
            : 'Teilimport: Anzahl oder Positionen nicht belegbar, ausgeblendete Videos oder unbekannte Einträge. In YouTube ggf. „Nicht verfügbare Videos anzeigen“ aktivieren und erneut scannen.';
        break;
      }
      if (
        idle >= options.idleRounds &&
        !recognized &&
        !hasContinuation(env.doc)
      )
        throw new Error(
          'Keine unterstützte Playlist-Struktur erkannt. Anmeldung, leere Playlist oder geändertes YouTube-DOM prüfen.',
        );
      scan.message = `${videos.size} eindeutige Videos gesichert · ${scan.expectedCount ?? '?'} erwartet`;
      await checkpoint(structuredClone(scan));
      env.advance();
      await env.wait(options.intervalMs, signal);
    }
    if (scan.status === 'running') {
      scan.status = 'incomplete';
      scan.message =
        'Zeitlimit erreicht. Teilbestand gesichert; erneuter Scan beginnt oben und führt IDs ohne Verlust lokaler Entscheidungen zusammen.';
    }
  } catch (error) {
    scan.status = signal.aborted ? 'interrupted' : 'failed';
    scan.message = signal.aborted
      ? 'Import pausiert. Teilbestand gesichert.'
      : error instanceof Error
        ? error.message
        : String(error);
  }
  scan.finishedAt = new Date().toISOString();
  await checkpoint(structuredClone(scan));
  return scan;
}
