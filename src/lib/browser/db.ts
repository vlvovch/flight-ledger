/*
 * The browser build's db shell (design: mode 1) — same exports as ../db, no
 * node anywhere. The client-compilation alias in next.config resolves
 * "@/lib/db" HERE for browser bundles, which closes an old trap for good: a
 * client import that once dragged node:sqlite into the bundle now lands on
 * this file instead, and fails loudly at runtime if the engine isn't up.
 *
 * The engine itself is installed by the worker at boot — sqlite-wasm over
 * the opfs-sahpool VFS, prepareLedger already run — and handed in through
 * setBrowserDriver(). Everything above the seam (repo, routes, dispatch)
 * then works unchanged, synchronously, inside the worker.
 */
import type { SqlDriver } from "../sql-driver";
import { activeAccount } from "./accounts";

export { bindable, newId, nowIso } from "../sql-driver";

let driver: SqlDriver | null = null;

/** Called once by the worker after the OPFS engine is ready. */
export function setBrowserDriver(d: SqlDriver): void {
  driver = d;
}

export function getDb(): SqlDriver {
  if (!driver) {
    throw new Error(
      "Browser engine not initialized — getDb() is only callable inside the engine worker after boot"
    );
  }
  return driver;
}

/** Where the ledger currently in use lives, for display. */
export function activeDbPath(): string {
  return `opfs://flight-ledger/${activeAccount().file}`;
}

/** Run fn inside a transaction; rolls back on throw. */
export function transaction<T>(fn: (db: SqlDriver) => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn(db);
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
