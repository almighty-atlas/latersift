import { openDB, type DBSchema } from 'idb';
import { emptyLibrary, type Library, type Scan } from './model';
interface Schema extends DBSchema {
  state: { key: string; value: Library };
  snapshots: { key: string; value: Scan };
}
// Library schema v2 adds scan states/diagnostics, not stores. Keep IndexedDB
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
    const library = stored ?? { ...emptyLibrary(), schemaVersion: 2 };
    let changed = library.schemaVersion !== 2;
    library.schemaVersion = 2;
    for (const scan of library.scans) {
      if (['running', 'waiting', 'needs_attention'].includes(scan.status)) {
        scan.status = 'interrupted';
        changed = true;
      }
    }
    // Only scan status changes on restart: retain progress, diagnostics and
    // messages, and never rewrite the last complete snapshot.
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
  const stored = structuredClone({ ...library, schemaVersion: 2 as const });
  const conn = await db();
  try {
    const tx = conn.transaction('state', 'readwrite');
    await Promise.all([tx.done, tx.store.put(stored, 'library')]);
  } finally {
    conn.close();
  }
}
export async function saveCheckpoint(library: Library, scan: Scan) {
  // Stage all changes before opening the transaction: failed writes must not
  // make in-memory progress look durable. Preserve existing scan references.
  const staged = structuredClone({ ...library, schemaVersion: 2 as const });
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
    library.schemaVersion = 2;
    const prior = library.scans.find((s) => s.id === checkpoint.id);
    if (prior) Object.assign(prior, checkpoint);
    else library.scans.push(checkpoint);
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
