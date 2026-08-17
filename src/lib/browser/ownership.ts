/*
 * Who owns the browser engine — decided BEFORE the worker exists, and
 * transferable afterwards.
 *
 * OPFS sync-access handles are exclusive, so only one tab can run the engine.
 * Ownership used to be adjudicated twice, independently: a Web Lock in
 * EngineBoot decided who saw the "close the other tab" overlay, while the
 * OPFS pool itself decided who actually got the storage — and because the
 * worker was allowed to boot before the lock resolved, two tabs opened
 * together could split the verdicts. One state machine settles it now: the
 * transport awaits the verdict before spawning the worker, so a tab that
 * lost never touches OPFS, and the overlay reads the same answer.
 *
 * Losing is no longer a life sentence. A shadowed tab can ask for the
 * ledger: it broadcasts a handover request, the owner drains its in-flight
 * work and parks its engine (releasing the OPFS handles), the Web Lock
 * passes to the asker, and the asker reloads itself into a clean boot. The
 * old owner becomes the shadowed tab — the same button brings it back.
 */

export type Ownership = "owned" | "lost";

/** The lock API's shape, injectable so the machine is testable off-browser. */
export interface LocksLike {
  request(
    name: string,
    options: { ifAvailable?: boolean; signal?: AbortSignal },
    callback: (lock: unknown) => Promise<unknown> | void
  ): Promise<unknown>;
}

/** The slice of BroadcastChannel the handover needs. */
export interface ChannelLike {
  postMessage(message: unknown): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export interface OwnershipHandle {
  /** The initial verdict; resolves once, before any worker may exist. */
  decided(): Promise<Ownership>;
  /** The live state — handovers move it after the initial verdict. */
  current(): Ownership | null;
  subscribe(fn: (o: Ownership) => void): () => void;
  /** Ask the owning tab for the ledger. Resolves once THIS tab holds the
   *  lock; rejects if no owner lets go within the timeout (an old build, a
   *  hung tab). The caller reloads itself on success — a fresh boot beats
   *  patching up pages that spent their first render being told no. */
  takeover(timeoutMs?: number): Promise<void>;
  /** Runs after this tab is marked lost and before the lock is released —
   *  the transport drains pending work and parks the worker here. */
  onBeforeRelease(fn: () => Promise<void> | void): void;
}

const LOCK_NAME = "flight-ledger-engine";
const HANDOVER = "fl-handover-request";

export function createOwnership(
  locks: LocksLike | undefined,
  channel: ChannelLike | null
): OwnershipHandle {
  let state: Ownership | null = null;
  let decision: Promise<Ownership> | null = null;
  let releaseHeld: (() => void) | null = null;
  const listeners = new Set<(o: Ownership) => void>();
  const beforeRelease: Array<() => Promise<void> | void> = [];

  const set = (o: Ownership) => {
    state = o;
    for (const fn of listeners) fn(o);
  };

  /* The owner's half of a handover: announce the loss first (the overlay
     should appear while the drain runs), then let the transport park the
     worker, then release the lock so the asker's queued request lands. */
  const handOver = async () => {
    if (state !== "owned") return;
    set("lost");
    for (const fn of beforeRelease) await fn();
    releaseHeld?.();
    releaseHeld = null;
  };

  if (channel) {
    channel.onmessage = (ev) => {
      if ((ev.data as { t?: string } | null)?.t === HANDOVER) void handOver();
    };
  }

  const decide = () =>
    new Promise<Ownership>((resolve) => {
      const settle = (o: Ownership) => {
        set(o);
        resolve(o);
      };
      /* No Web Locks API: let OPFS itself referee, the pre-lock behavior —
         better a working single tab than deference to a lock the browser
         doesn't have. */
      if (!locks) {
        settle("owned");
        return;
      }
      void Promise.resolve(
        locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
          if (!lock) {
            settle("lost");
            return;
          }
          settle("owned");
          /* hold until the tab closes or a handover releases it */
          return new Promise<void>((r) => {
            releaseHeld = r;
          });
        })
      ).catch(() => settle("owned"));
    });

  return {
    decided: () => (decision ??= decide()),
    current: () => state,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    onBeforeRelease: (fn) => beforeRelease.push(fn),
    takeover: (timeoutMs = 4000) => {
      if (state === "owned") return Promise.resolve();
      if (!locks) return Promise.reject(new Error("no lock API"));
      channel?.postMessage({ t: HANDOVER });
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      return new Promise<void>((resolve, reject) => {
        void Promise.resolve(
          locks.request(LOCK_NAME, { signal: ctrl.signal }, (lock) => {
            clearTimeout(timer);
            if (!lock) {
              reject(new Error("lock not granted"));
              return;
            }
            set("owned");
            resolve();
            return new Promise<void>((r) => {
              releaseHeld = r;
            });
          })
        ).catch((e) => {
          clearTimeout(timer);
          reject(e instanceof Error ? e : new Error(String(e)));
        });
      });
    },
  };
}

let singleton: OwnershipHandle | null = null;

/** This tab's ownership, over the real browser APIs. */
export function engineOwnership(): OwnershipHandle {
  singleton ??= createOwnership(
    typeof navigator !== "undefined"
      ? (navigator.locks as LocksLike | undefined)
      : undefined,
    typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
      ? (new BroadcastChannel(LOCK_NAME) as unknown as ChannelLike)
      : null
  );
  return singleton;
}
