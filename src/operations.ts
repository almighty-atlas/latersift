import {
  latestScan,
  safeCandidate,
  type Decision,
  type Library,
  type OperationStatus,
} from './model';
import { playlistId } from './session';
import { claimExecution } from './storage';

export interface PlaylistChoice {
  id: string | null;
  title: string;
  writable: boolean;
  // Discovery observations, never persisted membership evidence.
  checked?: boolean | null;
  identity?: 'explicit-link' | 'unverified';
  variant?: 'legacy' | 'sheet';
  diagnostic?: string;
}
export interface MembershipEvidence {
  state: 'present' | 'absent' | 'unknown';
  observedAt: string;
  source: 'native-dialog';
  message?: string;
}
export interface WriteAdapter {
  getAvailablePlaylists(videoId: string): Promise<PlaylistChoice[]>;
  getPlaylistMembership(
    videoId: string,
    playlistId: string,
  ): Promise<MembershipEvidence>;
  addToPlaylist(
    videoId: string,
    playlistId: string,
  ): Promise<{ changed: boolean }>;
  removeFromWatchLater(videoId: string): Promise<{ changed: boolean }>;
}
export interface OperationStep {
  id: string;
  status: OperationStatus;
  attempts: number;
  evidence?: MembershipEvidence;
  message?: string;
  updatedAt?: string;
  outcome?: 'changed' | 'already_present' | 'already_absent';
}
export interface DecisionJournal {
  add?: OperationStep;
  remove: OperationStep;
}
export interface ApprovedAction {
  decisionId: string;
  videoId: string;
  kind: 'remove' | 'archive';
  targetPlaylist: string | null;
}
export interface ExecutionApproval {
  id: string;
  snapshotId: string;
  createdAt: string;
  expiresAt: string;
  actions: ApprovedAction[];
}
export interface OperationState {
  limit: 1 | 5 | 25;
  consumedApprovalIds?: string[];
  exportConfirmation?: { snapshotId: string; confirmedAt: string };
  attestations: { limit: 5 | 25; confirmedAt: string; decisionId: string }[];
  lastRun?: {
    id: string;
    decisionIds: string[];
    status: 'running' | 'stopped' | 'complete' | 'unknown';
    startedAt: string;
    finishedAt?: string;
  };
}
export type CommitOperations = (library: Library) => Promise<void>;
export type ExecutableDecision = Decision & { kind: 'archive' | 'remove' };

const now = () => new Date().toISOString();
const TTL = 15 * 60 * 1000;
let concurrentExecutor = false;
let lastMutationAt: number | undefined;

/** Read defaults without changing the library or starting any work. */
export function operationState(lib: Library): OperationState {
  return structuredClone({ limit: 1, attestations: [], ...lib.operations });
}

function currentSnapshot(lib: Library, snapshotId?: string) {
  const scan = latestScan(lib);
  if (
    !scan ||
    scan.status !== 'complete' ||
    (snapshotId !== undefined && scan.id !== snapshotId)
  )
    throw new Error(
      'Der aktuelle letzte Scan muss ein vollständiger Snapshot sein.',
    );
  if (lib.scans.filter((s) => s.id === scan.id).length !== 1)
    throw new Error('Snapshot-ID ist nicht eindeutig.');
  return scan;
}

export function confirmExport(lib: Library, snapshotId: string): void {
  currentSnapshot(lib, snapshotId);
  const state = operationState(lib);
  state.exportConfirmation = { snapshotId, confirmedAt: now() };
  lib.operations = state;
}

function selectedActions(
  lib: Library,
  decisionIds: string[],
): ApprovedAction[] {
  const scan = currentSnapshot(lib);
  const state = operationState(lib);
  if (
    state.lastRun?.status === 'running' ||
    lib.decisions.some(
      (d) =>
        d.status === 'running' ||
        Object.values(d.journal ?? {}).some((s) => s.status === 'running'),
    )
  )
    throw new Error('Es läuft bereits eine Ausführung.');
  if (state.exportConfirmation?.snapshotId !== scan.id)
    throw new Error('Zuerst den Export dieses Snapshots bestätigen.');
  if (
    ![1, 5, 25].includes(state.limit) ||
    (state.limit >= 5 && !state.attestations.some((a) => a.limit === 5)) ||
    (state.limit === 25 && !state.attestations.some((a) => a.limit === 25))
  )
    throw new Error('Die Stapelgröße wurde nicht ausdrücklich bestätigt.');
  if (
    !decisionIds.length ||
    decisionIds.length > state.limit ||
    new Set(decisionIds).size !== decisionIds.length
  )
    throw new Error(
      'Eine eindeutige Auswahl innerhalb des Freigabelimits ist erforderlich.',
    );
  const videos = new Set<string>();
  return decisionIds.map((id) => {
    const matches = lib.decisions.filter((d) => d.id === id);
    const d = matches[0];
    if (
      matches.length !== 1 ||
      !d ||
      !['archive', 'remove'].includes(d.kind) ||
      d.status === 'verified'
    )
      throw new Error('Ungültige oder bereits abgeschlossene Entscheidung.');
    const entries = scan.videos.filter((v) => v.id === d.videoId);
    if (
      !/^[A-Za-z0-9_-]{11}$/.test(d.videoId) ||
      entries.length !== 1 ||
      videos.has(d.videoId) ||
      lib.decisions.filter(
        (other) => other.videoId === d.videoId && other.kind !== 'defer',
      ).length !== 1
    )
      throw new Error('Video fehlt im Snapshot oder ist nicht eindeutig.');
    if (
      (d.source === 'cleanup' || d.sessionId.startsWith('cleanup-')) &&
      (d.kind !== 'remove' || !safeCandidate(entries[0]))
    )
      throw new Error(
        'Cleanup erlaubt nur eindeutig private oder gelöschte Videos.',
      );
    if (
      (d.kind === 'archive' &&
        (!d.targetPlaylist ||
          playlistId(d.targetPlaylist) !== d.targetPlaylist)) ||
      (d.kind === 'remove' && d.targetPlaylist !== null)
    )
      throw new Error('Ungültiges Archiv-Playlist-Ziel.');
    videos.add(d.videoId);
    return {
      decisionId: d.id,
      videoId: d.videoId,
      kind: d.kind as 'archive' | 'remove',
      targetPlaylist: d.targetPlaylist,
    };
  });
}

export function approveExecution(
  lib: Library,
  decisionIds: string[],
): ExecutionApproval {
  const actions = selectedActions(lib, decisionIds);
  const created = Date.now();
  return {
    id: crypto.randomUUID(),
    snapshotId: currentSnapshot(lib).id,
    createdAt: new Date(created).toISOString(),
    expiresAt: new Date(created + TTL).toISOString(),
    actions,
  };
}

/** Shared by the executor and the durable claim; never accepts actions against stale decisions. */
export function validateExecutionApproval(
  lib: Library,
  approved: ExecutionApproval,
): ApprovedAction[] {
  const actions = selectedActions(
    lib,
    approved.actions.map((a) => a.decisionId),
  );
  currentSnapshot(lib, approved.snapshotId);
  const created = Date.parse(approved.createdAt),
    expires = Date.parse(approved.expiresAt);
  if (
    !approved.id ||
    !Number.isFinite(created) ||
    !Number.isFinite(expires) ||
    created > Date.now() ||
    expires <= Date.now() ||
    expires <= created ||
    expires - created > TTL ||
    actions.some((a, i) => {
      const b = approved.actions[i];
      return (
        a.decisionId !== b.decisionId ||
        a.videoId !== b.videoId ||
        a.kind !== b.kind ||
        a.targetPlaylist !== b.targetPlaylist
      );
    })
  )
    throw new Error('Freigabe ist ungültig, verändert oder abgelaufen.');
  return actions;
}

/** This is an explicit user attestation, never an executor side effect. */
export function acknowledgeLiveStage(
  lib: Library,
  next: 5 | 25,
  decisionId: string,
): void {
  const state = operationState(lib);
  if (
    (next !== 5 && next !== 25) ||
    state.limit !== (next === 5 ? 1 : 5) ||
    (next === 25 && !state.attestations.some((a) => a.limit === 5)) ||
    state.lastRun?.status !== 'complete' ||
    state.lastRun.decisionIds.length !== state.limit ||
    !state.lastRun.decisionIds.every((id) =>
      lib.decisions.some((d) => d.id === id && d.status === 'verified'),
    ) ||
    !state.lastRun.decisionIds.includes(decisionId)
  )
    throw new Error(
      'Zuerst die vorherige Live-Stufe vollständig verifizieren.',
    );
  const d = lib.decisions.find((item) => item.id === decisionId);
  const steps = d?.journal ? Object.values(d.journal) : [];
  if (
    !d ||
    (d.kind !== 'archive' && d.kind !== 'remove') ||
    d.status !== 'verified' ||
    !d.journal?.remove ||
    (d.kind === 'archive' && !d.journal.add) ||
    steps.some((s) => s.status !== 'verified') ||
    !steps.some(
      (s) =>
        s.outcome === 'changed' &&
        s.attempts > 0 &&
        s.evidence?.source === 'native-dialog' &&
        s.evidence.state === (s === d.journal?.add ? 'present' : 'absent'),
    )
  )
    throw new Error('Es fehlt eine verifizierte tatsächliche Live-Änderung.');
  // A pilot from an earlier stage cannot attest the next stage again.
  const previous = state.attestations.at(-1);
  if (
    previous &&
    (previous.decisionId === decisionId ||
      state.lastRun.startedAt < previous.confirmedAt)
  )
    throw new Error(
      'Ein neuer Live-Nachweis der aktuellen Stufe ist erforderlich.',
    );
  state.attestations.push({ limit: next, confirmedAt: now(), decisionId });
  state.limit = next;
  lib.operations = state;
}

export interface ExecutorOptions {
  wait?: (milliseconds: number) => Promise<void>;
  mutationIntervalMs?: number;
}

/** All commits are outside remote-error handlers: storage failure must escape immediately. */
export async function executeApproved(
  library: Library,
  approval: ExecutionApproval,
  adapter: WriteAdapter,
  commit: CommitOperations,
  shouldStop: () => boolean = () => false,
  options: ExecutorOptions = {},
): Promise<Library> {
  if (concurrentExecutor) throw new Error('Ein Executor ist bereits aktiv.');
  concurrentExecutor = true;
  try {
    const lib = structuredClone(library);
    const approved = structuredClone(approval);
    const actions = validateExecutionApproval(lib, approved);
    const expires = Date.parse(approved.expiresAt);
    // Mandatory durable CAS + snapshot check + independent one-use ledger.
    // This must finish before the first WAL commit and before any adapter call.
    await claimExecution(lib, approved);
    lib.schemaVersion = 3;
    const state = operationState(lib);
    if (
      state.lastRun?.id === approved.id ||
      state.consumedApprovalIds?.includes(approved.id)
    )
      throw new Error('Diese Freigabe wurde bereits verwendet.');
    state.consumedApprovalIds = [
      ...(state.consumedApprovalIds ?? []),
      approved.id,
    ];
    const run: NonNullable<OperationState['lastRun']> = {
      id: approved.id,
      decisionIds: actions.map((a) => a.decisionId),
      status: 'running',
      startedAt: now(),
    };
    state.lastRun = run;
    lib.operations = state;
    const step = (): OperationStep => ({
      id: crypto.randomUUID(),
      status: 'pending',
      attempts: 0,
    });
    for (const action of actions) {
      const d = lib.decisions.find((d) => d.id === action.decisionId)!;
      // Retain attempt counts and IDs across explicit retries, but never trust old evidence.
      d.journal ??= { remove: step() };
      if (d.kind === 'archive') d.journal.add ??= step();
    }
    const persist = () => commit(structuredClone(lib));
    await persist();
    const wait =
      options.wait ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const configuredInterval = options.mutationIntervalMs ?? 1000;
    if (!Number.isFinite(configuredInterval))
      throw new Error('Ungültiges Mutationsintervall.');
    const interval = Math.max(1000, configuredInterval);
    async function pace() {
      if (lastMutationAt !== undefined)
        await wait(Math.max(0, interval - (Date.now() - lastMutationAt)));
    }

    async function read(
      videoId: string,
      playlist: string,
    ): Promise<MembershipEvidence> {
      try {
        const evidence = await adapter.getPlaylistMembership(videoId, playlist);
        if (
          !evidence ||
          !['present', 'absent', 'unknown'].includes(evidence.state) ||
          evidence.source !== 'native-dialog' ||
          !Number.isFinite(Date.parse(evidence.observedAt))
        )
          throw new Error('Ungültiger Mitgliedschaftsnachweis.');
        return evidence;
      } catch (error) {
        return {
          state: 'unknown',
          source: 'native-dialog',
          observedAt: now(),
          message: String(error),
        };
      }
    }
    async function record(
      d: Decision,
      s: OperationStep,
      status: OperationStatus,
      evidence?: MembershipEvidence,
      outcome?: OperationStep['outcome'],
    ) {
      s.status = status;
      s.updatedAt = now();
      s.evidence = evidence;
      s.outcome = outcome;
      s.message = evidence?.message;
      if (status === 'unknown' || status === 'failed') d.status = status;
      await persist();
      return status === 'verified';
    }
    async function stopVerified(
      d: Decision,
      step: OperationStep,
      evidence?: MembershipEvidence,
    ): Promise<false> {
      // Keep the verified step as history and as a permanent no-reclick guard.
      // Reconciliation needs a new decision, not another approval for this step.
      d.status = 'unknown';
      step.message = `Verifizierter Schritt widerspricht dem frischen Zustand (${evidence?.state ?? 'ungeklärt'}). Manuell abgleichen und eine neue Entscheidung erstellen.`;
      await persist();
      return false;
    }
    async function mutate(
      d: Decision,
      s: OperationStep,
      click: () => Promise<{ changed: boolean }>,
      playlist: string,
      desired: 'present' | 'absent',
    ) {
      if (s.status === 'verified') return stopVerified(d, s);
      s.attempts++;
      d.status = 'running';
      await record(d, s, 'running');
      let error: unknown;
      let clickFailed = false;
      let result: unknown;
      try {
        lastMutationAt = Date.now();
        result = await click();
      } catch (cause) {
        clickFailed = true;
        error = cause;
      }
      // Even rejected clicks can have taken effect. Reopen/read, but do not claim success on a disconnected click.
      const evidence = await read(d.videoId, playlist);
      if (
        clickFailed ||
        !result ||
        typeof result !== 'object' ||
        !('changed' in result) ||
        typeof result.changed !== 'boolean'
      ) {
        evidence.message = clickFailed
          ? String(error)
          : 'Ungültiges Mutationsergebnis: changed fehlt.';
        return record(d, s, 'unknown', evidence);
      }
      return record(
        d,
        s,
        evidence.state === 'unknown'
          ? 'unknown'
          : evidence.state === desired
            ? 'verified'
            : 'failed',
        evidence,
        evidence.state === desired
          ? result.changed
            ? 'changed'
            : desired === 'present'
              ? 'already_present'
              : 'already_absent'
          : undefined,
      );
    }
    async function perform(d: Decision): Promise<boolean> {
      const journal = d.journal!;
      await pace();
      const wl = await read(d.videoId, 'WL');
      if (journal.remove.status === 'verified' && wl.state !== 'absent')
        return stopVerified(d, journal.remove, wl);
      if (wl.state === 'unknown')
        return record(d, journal.remove, 'unknown', wl);
      if (wl.state === 'absent' && journal.remove.status !== 'verified')
        await record(d, journal.remove, 'verified', wl, 'already_absent');
      let target: MembershipEvidence | undefined;
      if (d.kind === 'archive') {
        let writable = false;
        try {
          writable = (await adapter.getAvailablePlaylists(d.videoId)).some(
            (p) => p.id === d.targetPlaylist && p.writable,
          );
        } catch {
          /* Unknown target is never permission to mutate. */
        }
        target = await read(d.videoId, d.targetPlaylist!);
        if (
          journal.add?.status === 'verified' &&
          (!writable || target.state !== 'present')
        )
          return stopVerified(d, journal.add, target);
        if (!writable || target.state === 'unknown')
          return record(d, journal.add!, 'unknown', target);
      }
      if (wl.state === 'absent') {
        // Do not archive an entry which was already absent from WL.
        if (journal.add) {
          if (target?.state !== 'present')
            return record(d, journal.add, 'unknown', target);
          if (journal.add.status !== 'verified')
            await record(d, journal.add, 'verified', target, 'already_present');
        }
      } else {
        if (journal.add) {
          if (target?.state === 'present') {
            if (journal.add.status !== 'verified')
              await record(
                d,
                journal.add,
                'verified',
                target,
                'already_present',
              );
          } else if (
            !(await mutate(
              d,
              journal.add,
              () => adapter.addToPlaylist(d.videoId, d.targetPlaylist!),
              d.targetPlaylist!,
              'present',
            ))
          )
            return false;
          // Wait before preflight, not after it: a persisted add is no substitute for fresh evidence.
          await pace();
          target = await read(d.videoId, d.targetPlaylist!);
          if (target.state !== 'present')
            return stopVerified(d, journal.add, target);
        }
        const freshWL = await read(d.videoId, 'WL');
        if (freshWL.state === 'unknown')
          return record(d, journal.remove, 'unknown', freshWL);
        if (freshWL.state === 'absent')
          await record(
            d,
            journal.remove,
            'verified',
            freshWL,
            'already_absent',
          );
        else if (
          !(await mutate(
            d,
            journal.remove,
            () => adapter.removeFromWatchLater(d.videoId),
            'WL',
            'absent',
          ))
        )
          return false;
      }
      d.status = 'verified';
      await persist();
      return true;
    }
    let stopped = false;
    for (const action of actions) {
      if (shouldStop() || Date.now() >= expires) {
        stopped = true;
        break;
      }
      const d = lib.decisions.find((d) => d.id === action.decisionId)!;
      if (!(await perform(d))) {
        stopped = true;
        break;
      }
    }
    run.status = stopped ? 'stopped' : 'complete';
    run.finishedAt = now();
    await persist();
    return lib;
  } finally {
    concurrentExecutor = false;
  }
}
