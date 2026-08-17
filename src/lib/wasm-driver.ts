/*
 * SqlDriver over SQLite-WASM's oo1 API — the browser build's engine
 * (design: mode 1), and the second implementation of the seam db.ts's
 * node:sqlite satisfies structurally.
 *
 * Each call goes through oo1's exec with a bind array rather than holding
 * prepared-statement handles: statements here are prepared per call. That is
 * a deliberate trade — the app's hot path is a user clicking, not a tight
 * loop, and handle lifecycle (finalize-on-error, reset-between-uses) is
 * exactly where a hand-rolled adapter grows leaks. Same inputs, same rows,
 * same `changes` semantics as the node driver; the selftest runs the full
 * schema ritual through this adapter to hold the two engines to one
 * behavior.
 */
import type { SqlDriver, SqlValue } from "./sql-driver";

/** The slice of oo1.DB this adapter touches. */
export interface WasmDb {
  exec(
    opts:
      | string
      | {
          sql: string;
          bind?: SqlValue[];
          rowMode?: "object";
          returnValue?: "resultRows";
        }
  ): unknown;
  changes(): number;
}

export function wasmDriver(db: WasmDb): SqlDriver {
  const rows = (sql: string, params: SqlValue[]): unknown[] =>
    db.exec({
      sql,
      bind: params.length ? params : undefined,
      rowMode: "object",
      returnValue: "resultRows",
    }) as unknown[];

  return {
    exec: (sql) => {
      db.exec(sql);
    },
    prepare: (sql) => ({
      all: (...params) => rows(sql, params),
      get: (...params) => rows(sql, params)[0],
      run: (...params) => {
        db.exec({ sql, bind: params.length ? params : undefined });
        return { changes: db.changes() };
      },
    }),
  };
}
