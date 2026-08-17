/*
 * Main-thread side of the engine RPC (design: mode 1): an ApiTransport that
 * sends api()'s requests to the worker instead of a server. One worker,
 * spawned lazily on the first call; responses are rebuilt as standard
 * Response objects so api()'s error handling works identically on both
 * transports. Everything the app sends is JSON text — measured, not hoped:
 * files are read client-side and posted as strings — so the protocol carries
 * strings and nothing else.
 */

import { engineOwnership } from "./ownership";

type Rpc =
  | { id: number; ok: true; result: { status: number; headers: Record<string, string>; body: string } }
  | { id: number; ok: false; error: string };

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, (r: Rpc) => void>();

function engineWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./worker.ts", import.meta.url));
    worker.addEventListener("message", (ev: MessageEvent<Rpc>) => {
      const resolve = pending.get(ev.data.id);
      if (resolve) {
        pending.delete(ev.data.id);
        resolve(ev.data);
      }
    });
  }
  return worker;
}

/* The owner's side of a handover: wait briefly for in-flight RPCs to land,
   answer any stragglers with the same sentence the overlay shows, and park
   the worker — terminating it is what releases the OPFS handles. */
let hooked = false;
async function parkForHandover(): Promise<void> {
  const deadline = Date.now() + 1500;
  while (pending.size > 0 && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 25));
  for (const [id, resolve] of pending)
    resolve({ id, ok: false, error: "The ledger moved to another tab." });
  pending.clear();
  worker?.terminate();
  worker = null;
}

export async function workerTransport(
  url: string,
  init?: RequestInit
): Promise<Response> {
  /* Ownership before existence: a tab that lost the Web Lock never spawns
     the worker, so it can never race the owning tab for the OPFS handles.
     The overlay (EngineBoot) is telling the user what's happening; every
     api() call in the shadowed tab answers with the same sentence. The gate
     reads the LIVE state, not the first verdict — a handover moves it. */
  const own = engineOwnership();
  if (!hooked) {
    hooked = true;
    own.onBeforeRelease(parkForHandover);
  }
  await own.decided();
  if (own.current() !== "owned") {
    return Response.json(
      { error: "This ledger is open in another tab." },
      { status: 503 }
    );
  }
  const id = ++nextId;
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((v, k) => {
    headers[k] = v;
  });
  const rpc = await new Promise<Rpc>((resolve) => {
    pending.set(id, resolve);
    engineWorker().postMessage({
      id,
      op: "dispatch",
      url,
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : null,
    });
  });
  if (!rpc.ok) {
    return Response.json({ error: rpc.error }, { status: 500 });
  }
  return new Response(rpc.result.body, {
    status: rpc.result.status,
    headers: rpc.result.headers,
  });
}
