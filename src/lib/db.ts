import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { accountPath, activeAccount } from "./accounts";
import { prepareLedger } from "./schema";
import type { SqlDriver } from "./sql-driver";

declare global {
  /* Keyed by database PATH, not by account id: the path is what actually
     decides which rows a query sees, so caching on it makes it impossible for
     a renamed or re-pointed account to hand back a handle on someone else's
     ledger. */
  // eslint-disable-next-line no-var
  var __trackerDbs: Map<string, SqlDriver> | undefined;
}


/**
 * The open ledger.
 *
 * Which file that is comes from the account registry on every call. Resolving
 * it per call rather than once at startup is what makes switching accounts
 * take effect — and because the cache is keyed by the resolved path, a stale
 * handle can only ever be a handle on the same file it was opened for.
 */
export function getDb(): SqlDriver {
  const path = accountPath(activeAccount());
  const cache = (globalThis.__trackerDbs ??= new Map());
  const open = cache.get(path);
  if (open) return open;
  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  const db = new DatabaseSync(path);
  prepareLedger(db);
  cache.set(path, db);
  return db;
}

/** Where the ledger currently in use lives, for display. */
export function activeDbPath(): string {
  return `data/${activeAccount().file}`;
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

export { bindable, newId, nowIso } from "./sql-driver";
