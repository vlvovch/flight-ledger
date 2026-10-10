/**
 * Pre-pull safety snapshots: the outgoing ledger, stashed the moment before
 * a Drive pull replaces it, so "Keep the Drive copy" is a choice that can
 * be unmade. IndexedDB rather than localStorage because a real export runs
 * to a megabyte, and rather than the engine's own database because the
 * snapshot must survive exactly the operation that rewrites that database.
 *
 * Three per account, newest kept. This is a parachute, not an archive — the
 * backup buttons in Settings remain the archive.
 */

export interface SnapshotMeta {
  id: string;
  account: string;
  at: string;
  flights: number;
  tickets: number;
}

interface SnapshotRow extends SnapshotMeta {
  json: string;
}

const DB_NAME = "flight-ledger-snapshots";
const STORE = "snapshots";
const KEEP_PER_ACCOUNT = 3;

function openDb(): Promise<IDBDatabase> {
  return new Promise((ok, err) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("account", "account", { unique: false });
      }
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => err(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((ok, err) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => err(tx.error);
    tx.onabort = () => err(tx.error);
  });
}

function reqResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((ok, err) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => err(req.error);
  });
}

async function rowsFor(db: IDBDatabase, account: string): Promise<SnapshotRow[]> {
  const tx = db.transaction(STORE, "readonly");
  const all = await reqResult(
    tx.objectStore(STORE).index("account").getAll(account) as IDBRequest<SnapshotRow[]>
  );
  return all.sort((a, b) => b.at.localeCompare(a.at));
}

export async function saveSnapshot(
  account: string,
  json: string,
  counts: { flights: number; tickets: number }
): Promise<void> {
  const db = await openDb();
  try {
    const existing = await rowsFor(db, account);
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.put({
      id: crypto.randomUUID(),
      account,
      at: new Date().toISOString(),
      flights: counts.flights,
      tickets: counts.tickets,
      json,
    } satisfies SnapshotRow);
    for (const old of existing.slice(KEEP_PER_ACCOUNT - 1)) store.delete(old.id);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function listSnapshots(account: string): Promise<SnapshotMeta[]> {
  try {
    const db = await openDb();
    try {
      return (await rowsFor(db, account)).map((row) => ({
        id: row.id,
        account: row.account,
        at: row.at,
        flights: row.flights,
        tickets: row.tickets,
      }));
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

export async function loadSnapshot(id: string): Promise<string | null> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readonly");
      const row = await reqResult(
        tx.objectStore(STORE).get(id) as IDBRequest<SnapshotRow | undefined>
      );
      return row?.json ?? null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}
