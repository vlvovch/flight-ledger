"use client";

/*
 * Mode-1 engine smoke harness (design: mode 1, phase C).
 *
 * Not a product page: this exists so the WASM engine's browser-only claims —
 * OPFS persistence, the SAH pool VFS, the worker boundary — are verified in
 * an actual browser instead of asserted. The counter is the proof: it lives
 * in an OPFS SQLite file (labs-smoke.db, never the ledger's), so it should
 * survive a full page reload. The selftest cannot check that; this page is
 * where a human (or the Browser pane) does.
 */
import { useRef, useState } from "react";

type SmokeResult = {
  sqliteVersion: string;
  vfs: string;
  tables: string[];
  runs: number;
};

export default function BrowserDbLab() {
  const workerRef = useRef<Worker | null>(null);
  const idRef = useRef(0);
  const [state, setState] = useState<
    | { phase: "idle" }
    | { phase: "running" }
    | { phase: "done"; result: SmokeResult }
    | { phase: "error"; error: string }
  >({ phase: "idle" });

  const run = () => {
    setState({ phase: "running" });
    workerRef.current ??= new Worker(
      new URL("../../../../lib/browser/worker.ts", import.meta.url)
    );
    const worker = workerRef.current;
    const id = ++idRef.current;
    const onMessage = (
      ev: MessageEvent<
        | { id: number; ok: true; result: SmokeResult }
        | { id: number; ok: false; error: string }
      >
    ) => {
      if (ev.data.id !== id) return;
      worker.removeEventListener("message", onMessage);
      setState(
        ev.data.ok
          ? { phase: "done", result: ev.data.result }
          : { phase: "error", error: ev.data.error }
      );
    };
    worker.addEventListener("message", onMessage);
    worker.postMessage({ id, op: "smoke" });
  };

  return (
    <div className="mx-auto max-w-[640px] p-8">
      <div className="t-label mb-1 text-s-miles">Labs</div>
      <h1 className="t-display text-[26px] text-ink">Browser engine smoke</h1>
      <p className="mt-2 text-[13px] text-ink2">
        Boots SQLite-WASM in a worker, installs the OPFS SAH pool, runs the
        full ledger schema ritual on <span className="t-num">labs-smoke.db</span>,
        and bumps a counter. If the counter climbs across a full page reload,
        OPFS persistence is real. Touches its own file only — never a ledger.
      </p>
      <button className="btn btn-ghost mt-4" onClick={run} disabled={state.phase === "running"}>
        {state.phase === "running" ? "Running…" : "Run smoke"}
      </button>

      {state.phase === "done" && (
        <div className="mt-5 space-y-1 text-[13px]" data-smoke="done">
          <p>
            <span className="text-mute">SQLite</span>{" "}
            <span className="t-num text-ink">{state.result.sqliteVersion}</span>
            <span className="text-mute"> via </span>
            <span className="t-num text-ink">{state.result.vfs}</span>
          </p>
          <p>
            <span className="text-mute">Runs recorded in OPFS:</span>{" "}
            <span className="t-num text-[18px] text-good" data-smoke-runs={state.result.runs}>
              {state.result.runs}
            </span>
          </p>
          <p className="text-mute">
            {state.result.tables.length} tables after the schema ritual:{" "}
            <span className="t-num">{state.result.tables.join(", ")}</span>
          </p>
        </div>
      )}
      {state.phase === "error" && (
        <p className="mt-5 text-[13px] text-critical" data-smoke="error">
          {state.error}
        </p>
      )}
    </div>
  );
}
