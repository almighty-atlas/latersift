import { openDB, type DBSchema } from 'idb';
import {
  emptyLibrary,
  latestScan,
  safeCandidate,
  type Library,
  type Scan,
} from './model';
import {
  operationState,
  validateExecutionApproval,
  type ExecutionApproval,
} from './operations';
import { validateWriteRequest, type WriteRequest } from './write-protocol';

interface ExecutionLedger {
  kind: 'execution-ledger';
  consumedApprovalIds: string[];
  activeApproval?: ExecutionApproval;
  activeSnapshotContent?: string;
  activeExportContent?: string;
  issuedMutationKeys?: string[];
}
interface Schema extends DBSchema {
  state: { key: string; value: Library | ExecutionLedger };
  snapshots: { key: string; value: Scan };
}
// Library schema v3 adds operation journals, not stores. Keep IndexedDB
// version 1 so existing tabs cannot block a structural upgrade. Migrate the
// stored document on load instead, preserving decisions and full snapshots.
const db = () =>
  openDB<Schema>('latersift', 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
      if (!db.objectStoreNames.contains('snapshots'))
        db.createObjectStore('snapshots', { keyPath: 'id' });
    },
    blocking(_currentVersion, _blockedVersion, event) {
      (event.target as IDBDatabase).close();
    },
  });
export async function loadLibrary(): Promise<Library> {
  const conn = await db();
  try {
    const tx = conn.transaction('state', 'readwrite');
    const stored = await tx.store.get('library');
    if (stored && !('schemaVersion' in stored))
      throw new Error('Ungültiger Bibliotheksdatensatz.');
    const library = stored ?? emptyLibrary();
    let changed = !stored || library.schemaVersion !== 3 || !library.operations;
    library.schemaVersion = 3;
    library.operations = operationState(library);
    if (library.operations.lastRun?.status === 'running') {
      library.operations.lastRun.status = 'unknown';
      changed = true;
    }
    for (const decision of library.decisions) {
      // 0.1.1 recorded cleanup provenance only in the session ID.
      if (
        decision.source === undefined &&
        decision.sessionId.startsWith('cleanup-')
      ) {
        decision.source = 'cleanup';
        changed = true;
      }
      for (const step of Object.values(decision.journal ?? {})) {
        if (step.status === 'running') {
          step.status = 'unknown';
          decision.status = 'unknown';
          changed = true;
        }
      }
      if (decision.status === 'running') {
        decision.status = 'unknown';
        changed = true;
      }
    }
    for (const scan of library.scans) {
      if (['running', 'waiting', 'needs_attention'].includes(scan.status)) {
        scan.status = 'interrupted';
        changed = true;
      }
    }
    // Retain progress and evidence; never rewrite the last complete snapshot.
    await Promise.all([
      tx.done,
      ...(changed ? [tx.store.put(library, 'library')] : []),
    ]);
    return library;
  } finally {
    conn.close();
  }
}
export async function saveLibrary(library: Library) {
  const stored = structuredClone({
    ...library,
    schemaVersion: 3 as const,
    operations: operationState(library),
  });
  const conn = await db();
  try {
    const tx = conn.transaction('state', 'readwrite');
    await Promise.all([tx.done, tx.store.put(stored, 'library')]);
    library.schemaVersion = 3;
    library.operations = stored.operations;
  } finally {
    conn.close();
  }
}
export async function saveCheckpoint(library: Library, scan: Scan) {
  // Stage all changes before opening the transaction: failed writes must not
  // make in-memory progress look durable. Preserve existing scan references.
  const staged = structuredClone({
    ...library,
    schemaVersion: 3 as const,
    operations: operationState(library),
  });
  const checkpoint = structuredClone(scan);
  const stagedPrior = staged.scans.find((s) => s.id === checkpoint.id);
  if (stagedPrior) Object.assign(stagedPrior, checkpoint);
  else staged.scans.push(checkpoint);
  const conn = await db();
  try {
    const tx = conn.transaction(['state', 'snapshots'], 'readwrite');
    const writes: Promise<unknown>[] = [tx.done];
    try {
      writes.push(tx.objectStore('state').put(staged, 'library'));
      // Incomplete checkpoints must never replace a complete snapshot.
      if (checkpoint.status === 'complete')
        writes.push(tx.objectStore('snapshots').put(checkpoint));
      await Promise.all(writes);
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // A failed/finished transaction may already have been aborted.
      }
      // A synchronous put failure can leave earlier requests pending. Drain
      // those rejections as well as tx.done after aborting the transaction.
      await Promise.allSettled(writes);
      throw error;
    }
    library.schemaVersion = 3;
    library.operations = staged.operations;
    const prior = library.scans.find((s) => s.id === checkpoint.id);
    if (prior) Object.assign(prior, checkpoint);
    else library.scans.push(checkpoint);
  } finally {
    conn.close();
  }
}
// Canonical JSON content comparison: property order and absent optional values
// are irrelevant, but array ordering and all durable library data are not.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(
        Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return item;
  });
}

/** Atomically reserve a one-use approval against the actual durable state. */
export async function claimExecution(
  library: Library,
  approval: ExecutionApproval,
): Promise<void> {
  const caller = structuredClone(library);
  const approved = structuredClone(approval);
  const conn = await db();
  try {
    const tx = conn.transaction(['state', 'snapshots'], 'readwrite');
    const pending: Promise<unknown>[] = [tx.done];
    try {
      const state = tx.objectStore('state');
      const durable = await state.get('library');
      const existingLedger = await state.get('execution-ledger');
      if (
        existingLedger &&
        (!('kind' in existingLedger) ||
          existingLedger.kind !== 'execution-ledger')
      )
        throw new Error('Ungültiges Execution-Ledger.');
      const ledger: ExecutionLedger = existingLedger ?? {
        kind: 'execution-ledger',
        consumedApprovalIds: [],
      };
      if (ledger.consumedApprovalIds.includes(approved.id))
        throw new Error('Diese Freigabe wurde bereits verwendet.');
      if (
        !durable ||
        !('schemaVersion' in durable) ||
        canonical(durable) !== canonical(caller)
      )
        throw new Error(
          'Veralteter Bibliotheksstand: vor einer neuen Freigabe neu laden.',
        );
      const actions = validateExecutionApproval(durable, approved);
      const latest = latestScan(durable)!;
      const snapshot = await tx
        .objectStore('snapshots')
        .get(approved.snapshotId);
      if (
        !snapshot ||
        snapshot.status !== 'complete' ||
        snapshot.id !== latest.id ||
        canonical(snapshot) !== canonical(latest)
      )
        throw new Error(
          'Der tatsächliche vollständige Snapshot fehlt oder stimmt nicht mit dem aktuellen Bestand überein.',
        );
      if (durable.operations?.exportConfirmation?.snapshotId !== snapshot.id)
        throw new Error('Zuerst den Export dieses Snapshots bestätigen.');
      const operations = operationState(durable);
      if (
        operations.consumedApprovalIds?.includes(approved.id) ||
        operations.lastRun?.id === approved.id
      )
        throw new Error('Diese Freigabe wurde bereits verwendet.');
      ledger.consumedApprovalIds = [
        ...new Set([
          ...ledger.consumedApprovalIds,
          ...(operations.consumedApprovalIds ?? []),
          approved.id,
        ]),
      ];
      ledger.activeApproval = structuredClone(approved);
      ledger.activeSnapshotContent = canonical(snapshot);
      ledger.activeExportContent = canonical(operations.exportConfirmation);
      ledger.issuedMutationKeys ??= [];
      operations.consumedApprovalIds = [...ledger.consumedApprovalIds];
      // Reserve the library in this transaction too: otherwise two different
      // approvals could both claim the same caller state before the first WAL.
      operations.lastRun = {
        id: approved.id,
        decisionIds: actions.map((a) => a.decisionId),
        status: 'running',
        startedAt: new Date().toISOString(),
      };
      durable.operations = operations;
      durable.schemaVersion = 3;
      pending.push(state.put(ledger, 'execution-ledger'));
      pending.push(state.put(durable, 'library'));
      await Promise.all(pending);
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* The transaction may already be aborted. */
      }
      await Promise.allSettled(pending);
      throw error;
    }
  } finally {
    conn.close();
  }
}

/** Privileged boundary: grant a native mutation only once per durable running WAL attempt. */
export async function authorizeMutation(request: WriteRequest): Promise<void> {
  const mutation = validateWriteRequest(structuredClone(request));
  if (mutation.method !== 'add' && mutation.method !== 'remove')
    throw new Error('Nur konkrete Mutationen dürfen autorisiert werden.');
  const approval = mutation.approval!;
  const conn = await db();
  try {
    const tx = conn.transaction(['state', 'snapshots'], 'readwrite');
    const pending: Promise<unknown>[] = [tx.done];
    try {
      const state = tx.objectStore('state');
      const ledger = await state.get('execution-ledger');
      const library = await state.get('library');
      if (
        !ledger ||
        !('kind' in ledger) ||
        ledger.kind !== 'execution-ledger' ||
        !ledger.activeApproval ||
        canonical(ledger.activeApproval) !== canonical(approval) ||
        !ledger.consumedApprovalIds.includes(approval.id)
      )
        throw new Error('Keine aktive dauerhaft beanspruchte Freigabe.');
      if (!library || !('schemaVersion' in library))
        throw new Error('Bibliothek fehlt.');
      const run = library.operations?.lastRun;
      if (
        run?.id !== approval.id ||
        run.status !== 'running' ||
        canonical(run.decisionIds) !==
          canonical(approval.actions.map((a) => a.decisionId))
      )
        throw new Error(
          'Die aktive Ausführung stimmt nicht mit der Freigabe überein.',
        );
      const latest = latestScan(library);
      const snapshot = await tx
        .objectStore('snapshots')
        .get(approval.snapshotId);
      if (
        !latest ||
        latest.id !== approval.snapshotId ||
        latest.status !== 'complete' ||
        !snapshot ||
        snapshot.status !== 'complete' ||
        canonical(snapshot) !== canonical(latest) ||
        ledger.activeSnapshotContent !== canonical(snapshot) ||
        library.scans.filter((s) => s.id === approval.snapshotId).length !==
          1 ||
        library.operations?.exportConfirmation?.snapshotId !==
          approval.snapshotId ||
        ledger.activeExportContent !==
          canonical(library.operations?.exportConfirmation)
      )
        throw new Error(
          'Snapshot oder Exportbestätigung stimmen nicht mehr mit der Freigabe überein.',
        );
      for (const action of approval.actions) {
        const decisions = library.decisions.filter(
          (d) => d.id === action.decisionId,
        );
        const decision = decisions[0];
        const videos = snapshot.videos.filter((v) => v.id === action.videoId);
        if (
          decisions.length !== 1 ||
          !decision ||
          decision.videoId !== action.videoId ||
          decision.kind !== action.kind ||
          decision.targetPlaylist !== action.targetPlaylist ||
          videos.length !== 1 ||
          library.decisions.filter(
            (d) => d.videoId === action.videoId && d.kind !== 'defer',
          ).length !== 1
        )
          throw new Error(
            'Die dauerhafte Entscheidung stimmt nicht mit der Freigabe überein.',
          );
        if (
          (decision.source === 'cleanup' ||
            decision.sessionId.startsWith('cleanup-')) &&
          (decision.kind !== 'remove' || !safeCandidate(videos[0]))
        )
          throw new Error(
            'Cleanup benötigt weiterhin eindeutig private oder gelöschte Videos.',
          );
      }
      const action = approval.actions.find(
        (a) => a.videoId === mutation.videoId,
      )!;
      const decision = library.decisions.find(
        (d) => d.id === action.decisionId,
      )!;
      const step =
        mutation.method === 'add'
          ? decision.journal?.add
          : decision.journal?.remove;
      if (
        decision.status !== 'running' ||
        step?.status !== 'running' ||
        typeof step.id !== 'string' ||
        !step.id ||
        !Number.isSafeInteger(step.attempts) ||
        step.attempts < 1
      )
        throw new Error(
          'Kein dauerhaft laufender WAL-Schritt für diese Mutation.',
        );
      if (mutation.method === 'remove' && decision.kind === 'archive') {
        const add = decision.journal?.add;
        if (
          add?.status !== 'verified' ||
          add.evidence?.state !== 'present' ||
          add.evidence.source !== 'native-dialog' ||
          !Number.isFinite(Date.parse(add.evidence.observedAt))
        )
          throw new Error(
            'Archivierung muss vor dem Entfernen dauerhaft verifiziert sein.',
          );
      }
      const key = `${approval.id}:${step.id}:${step.attempts}:${mutation.method}`;
      if (ledger.issuedMutationKeys?.includes(key))
        throw new Error('Dieser Mutationsversuch wurde bereits autorisiert.');
      // The transaction may have waited behind another tab past the TTL.
      validateWriteRequest(mutation);
      ledger.issuedMutationKeys = [...(ledger.issuedMutationKeys ?? []), key];
      pending.push(state.put(ledger, 'execution-ledger'));
      await Promise.all(pending);
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* The transaction may already be aborted. */
      }
      await Promise.allSettled(pending);
      throw error;
    }
  } finally {
    conn.close();
  }
}

export async function loadSnapshot(id: string): Promise<Scan | undefined> {
  const conn = await db();
  try {
    const snapshot = await conn.get('snapshots', id);
    return snapshot ? structuredClone(snapshot) : undefined;
  } finally {
    conn.close();
  }
}

export function exportBackup(library: Library) {
  return JSON.stringify(
    {
      format: 'LaterSift backup',
      exportedAt: new Date().toISOString(),
      notice:
        'Lokale Bestandsaufnahme, keine garantierte automatische Wiederherstellung. Teilimporte sind ausdrücklich gekennzeichnet.',
      ...library,
    },
    null,
    2,
  );
}
