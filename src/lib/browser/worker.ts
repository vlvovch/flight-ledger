/// <reference lib="webworker" />
/*
 * The browser build's engine process (design: mode 1).
 *
 * SQLite-WASM runs HERE, in a dedicated worker, because OPFS sync access
 * handles exist only in workers — and the opfs-sahpool VFS is chosen over
 * the plain OPFS VFS deliberately: it needs no COOP/COEP headers, so the app
 * can be served from hosts that can't set headers (GitHub Pages), which the
 * verifiable-deploy story depends on.
 *
 * Two protocols share the worker. "dispatch" is the real app: boot the OPFS
 * ledger, hand its driver to the browser db shell, then route synthetic
 * Requests through the SAME route modules the server mounts — repo and the
 * audit log running synchronously down here, exactly as they do in node.
 * "smoke" is the labs harness, kept on its own pool and its own file so it
 * can never touch a ledger.
 */
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { wasmDriver, type WasmDb } from "../wasm-driver";
import { wasmUrl } from "./wasm-url";
import { prepareLedger } from "../schema";
import type { SqlDriver } from "../sql-driver";
import { activeAccount } from "./accounts";
import { setBrowserDriver } from "./db";

type SmokeResult = {
  sqliteVersion: string;
  vfs: string;
  tables: string[];
  runs: number;
};

type DispatchReq = {
  id: number;
  op: "dispatch";
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
};
type SmokeReq = { id: number; op: "smoke" };

type Rpc =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

/* The package types the init module as zero-arg and omits the SAH pool
   installer; both exist at runtime. Cast once, here, at the boundary. */
type InitOpts = { locateFile?: (f: string) => string };
type Sqlite3 = {
  version: { libVersion: string };
  installOpfsSAHPoolVfs(opts: { name: string }): Promise<{
    OpfsSAHPoolDb: new (filename: string) => WasmDb;
  }>;
};

let sqlite3Promise: Promise<Sqlite3> | null = null;
function boot(): Promise<Sqlite3> {
  sqlite3Promise ??= (
    sqlite3InitModule as unknown as (o?: InitOpts) => Promise<unknown>
    /* not beside the worker (it lives in the bundler's chunks folder) and
       not hard-rooted (a copy under /flight-ledger/ would 404): the app root
       is the worker's URL with /_next/... cut off — see wasm-url.ts */
  )({ locateFile: (f: string) => wasmUrl(self.location.href, f) }) as Promise<Sqlite3>;
  return sqlite3Promise;
}

/* ------------------------------ the ledger ------------------------------ */

let ledgerPromise: Promise<void> | null = null;
function ledgerReady(): Promise<void> {
  ledgerPromise ??= (async () => {
    const sqlite3 = await boot();
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "flight-ledger" });
    const driver = wasmDriver(new pool.OpfsSAHPoolDb(activeAccount().file));
    prepareLedger(driver);
    setBrowserDriver(driver);
  })().catch((e) => {
    /* Cleared so the NEXT request retries: the usual cause is another tab
       holding the OPFS pool, and "close the other tab, press again" should
       actually work without a reload. The raw failure is a DOMException
       that stringifies to noise; say what it means instead. */
    ledgerPromise = null;
    throw new Error(
      "The ledger could not be opened. It is probably open in another tab; " +
        "close that tab and try again. " +
        `(${e instanceof Error ? e.message : String(e)})`
    );
  });
  return ledgerPromise;
}

async function handleDispatch(msg: DispatchReq): Promise<unknown> {
  await ledgerReady();
  // loaded after the engine is up — dispatch pulls repo, whose db shell
  // resolves to browser/db in this compilation and needs the driver set
  const { dispatch } = await import("../dispatch");
  const res = await dispatch(msg.url, {
    method: msg.method,
    headers: msg.headers,
    body: msg.body ?? undefined,
  });
  return {
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: await res.text(),
  };
}

/* ------------------------------- the smoke ------------------------------ */

let smokePromise: Promise<{ driver: SqlDriver; version: string }> | null = null;
function smokeEngine() {
  smokePromise ??= (async () => {
    const sqlite3 = await boot();
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "flight-ledger-labs" });
    const driver = wasmDriver(new pool.OpfsSAHPoolDb("labs-smoke.db"));
    prepareLedger(driver);
    driver.exec("CREATE TABLE IF NOT EXISTS labs_smoke (runs INTEGER NOT NULL)");
    return { driver, version: sqlite3.version.libVersion };
  })();
  return smokePromise;
}

async function handleSmoke(): Promise<SmokeResult> {
  const { driver, version } = await smokeEngine();
  const has = driver.prepare("SELECT runs FROM labs_smoke").get() as
    | { runs: number }
    | undefined;
  if (has == null) driver.prepare("INSERT INTO labs_smoke (runs) VALUES (1)").run();
  else driver.prepare("UPDATE labs_smoke SET runs = runs + 1").run();
  const { runs } = driver.prepare("SELECT runs FROM labs_smoke").get() as {
    runs: number;
  };
  const tables = (
    driver
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
  ).map((t) => t.name);
  return { sqliteVersion: version, vfs: "opfs-sahpool", tables, runs };
}

self.onmessage = async (ev: MessageEvent<DispatchReq | SmokeReq>) => {
  const { id } = ev.data;
  try {
    const result =
      ev.data.op === "dispatch"
        ? await handleDispatch(ev.data)
        : await handleSmoke();
    self.postMessage({ id, ok: true, result } satisfies Rpc);
  } catch (e) {
    self.postMessage({
      id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    } satisfies Rpc);
  }
};
