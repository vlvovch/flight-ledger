/*
 * The seam between the ledger and whatever runs its SQL.
 *
 * Everything above this interface — repo, migrations, backup, the audit log —
 * speaks plain SQLite through these two methods and nothing else, which is
 * what lets the same code run against different engines:
 *
 *   - node:sqlite's DatabaseSync (the local app) satisfies it structurally,
 *     so the server implementation is the class itself, no wrapper;
 *   - the browser build (design: "mode 1") implements it over SQLite-WASM in
 *     a Web Worker, where OPFS sync access lives.
 *
 * The surface is deliberately minimal — exec and prepare with all/get/run —
 * because that is the entire surface the codebase uses (measured, not
 * guessed: no close(), no iterate(), nothing else). Widen it only when a
 * caller actually needs more, so the browser adapter stays honest about what
 * it must support.
 */

/** What the app binds into statements — bindable() has already flattened
 *  booleans and undefined by the time values reach the driver. */
export type SqlValue = string | number | null;

export interface SqlStatement {
  all(...params: SqlValue[]): unknown[];
  get(...params: SqlValue[]): unknown;
  run(...params: SqlValue[]): { changes: number | bigint };
}

export interface SqlDriver {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
}

/* Small shared helpers both db shells re-export: they belong with the driver
   because they are about what SQLite can store, not where it stores it. */

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

/** Convert JS values to SQLite-bindable values (booleans/undefined → numbers/null). */
export function bindable(v: unknown): string | number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string") return v;
  return String(v);
}
