/**
 * The tombstone: a note in localStorage that this browser's ledger held real
 * data, written whenever that is seen to be true. If the engine later comes
 * up empty while the note still stands, the browser's storage ate the
 * database — and the app can say so instead of presenting an innocent empty
 * ledger.
 *
 * Why this is reliable where storage.persist() is only a request: the one
 * DANGEROUS lost-storage state is "database gone, sync marker survived",
 * because only a surviving marker can turn the void into a Drive push. The
 * tombstone lives in the same localStorage as the marker, so it shares the
 * marker's fate: whenever the hazard exists, its detector exists. If
 * localStorage dies too, the marker died with it, and a fresh browser's
 * sync is already safe (no marker → pull, never push).
 */

export interface Tombstone {
  /** null = known non-empty but counts unknown (noted from a page that only
   *  sees the empty/non-empty flag, not the row counts) */
  flights: number | null;
  tickets: number | null;
  at: string;
}

const key = (account: string) => `ledger-tombstone:${account}`;

export function loadTombstone(account: string): Tombstone | null {
  try {
    const raw = localStorage.getItem(key(account));
    if (!raw) return null;
    const t = JSON.parse(raw) as Tombstone;
    /* A tombstone recording emptiness is no tombstone at all. */
    if (t.flights === 0 && t.tickets === 0) return null;
    return t;
  } catch {
    return null;
  }
}

/** Record that the ledger holds data right now. Counts when known. */
export function noteLedgerAlive(
  account: string,
  counts?: { flights: number; tickets: number }
): void {
  try {
    const prev = loadTombstone(account);
    const t: Tombstone = {
      flights: counts?.flights ?? prev?.flights ?? null,
      tickets: counts?.tickets ?? prev?.tickets ?? null,
      at: new Date().toISOString(),
    };
    localStorage.setItem(key(account), JSON.stringify(t));
  } catch {
    /* storage refusing writes is the condition this file exists to survive */
  }
  void requestDurableStorage();
}

/** The ledger is empty on purpose (erased by hand, or a backup restored over
 *  it said so) — stop remembering. */
export function clearTombstone(account: string): void {
  try {
    localStorage.removeItem(key(account));
  } catch {
    /* nothing to do */
  }
}

/* Ask the browser to exempt this origin's storage from eviction. A request,
   not a contract — Chrome decides silently by engagement, Firefox asks the
   user, Safari does as it pleases — so this is harm reduction layered under
   the tombstone, never the defense itself. Asked at most once per browser:
   a repeated permission prompt is nagging, and persisted() already answers
   when the grant exists. */
const ASKED_KEY = "storage-persist-asked";

export async function requestDurableStorage(): Promise<void> {
  try {
    if (!navigator.storage?.persist) return;
    if (await navigator.storage.persisted()) return;
    if (localStorage.getItem(ASKED_KEY)) return;
    localStorage.setItem(ASKED_KEY, new Date().toISOString());
    await navigator.storage.persist();
  } catch {
    /* best effort by definition */
  }
}
