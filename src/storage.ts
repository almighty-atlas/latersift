import { openDB, type DBSchema } from 'idb';
import { emptyLibrary, type Library, type Scan } from './model';
interface Schema extends DBSchema {
  state: { key: string; value: Library };
  snapshots: { key: string; value: Scan };
}
const db = () =>
  openDB<Schema>('latersift', 1, {
    upgrade(db) {
      db.createObjectStore('state');
      db.createObjectStore('snapshots', { keyPath: 'id' });
    },
  });
export async function loadLibrary(): Promise<Library> {
  const conn = await db();
  try {
    return (await conn.get('state', 'library')) ?? emptyLibrary();
  } finally {
    conn.close();
  }
}
export async function saveLibrary(library: Library) {
  const conn = await db();
  try {
    await conn.put('state', structuredClone(library), 'library');
  } finally {
    conn.close();
  }
}
export async function saveCheckpoint(library: Library, scan: Scan) {
  // Preserve the previous complete snapshot. Replace only this scan's checkpoint.
  const prior = library.scans.find((s) => s.id === scan.id);
  if (prior) Object.assign(prior, scan);
  else library.scans.push(scan);
  const conn = await db();
  try {
    const tx = conn.transaction(['state', 'snapshots'], 'readwrite');
    await tx.objectStore('state').put(structuredClone(library), 'library');
    if (scan.status === 'complete')
      await tx.objectStore('snapshots').put(structuredClone(scan));
    await tx.done;
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
