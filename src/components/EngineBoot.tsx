"use client";

/*
 * Flips api() onto the in-browser engine (design: mode 1) — at MODULE scope,
 * deliberately: the transport must be set before any page's first fetch, and
 * module evaluation precedes every effect. Two switches turn it on:
 *
 *   - NEXT_PUBLIC_BROWSER_ENGINE=1 — baked in by the static browser build,
 *     where there is no server and this is simply what the app is;
 *   - localStorage "flight-ledger:browser-engine" = "1" — a dev toggle for
 *     testing the whole app against OPFS from the normal dev server.
 *
 * When active, a badge says so: which engine your data is in should never be
 * something the user has to deduce.
 */
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { setApiTransport } from "@/lib/format";
import { workerTransport } from "@/lib/browser/transport";
import { engineOwnership } from "@/lib/browser/ownership";

const active =
  typeof window !== "undefined" &&
  (process.env.NEXT_PUBLIC_BROWSER_ENGINE === "1" ||
    window.localStorage.getItem("flight-ledger:browser-engine") === "1");

if (active) {
  setApiTransport(workerTransport);
  // best-effort: ask the browser not to evict the ledger under pressure
  void navigator.storage?.persist?.();
}

/* Pages that are prose, not ledger: they render fine while another tab
   holds the data, so the second-tab notice would be a lie there. */
const PROSE_PAGES = ["/privacy", "/faq"];

export default function EngineBoot() {
  const pathname = usePathname();
  /* The badge renders only after mount: the server can't know the flag, so
     SSR emits nothing — painting it during hydration would be a mismatch. */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /* One tab owns the ledger: OPFS sync-access handles are exclusive, so a
     second tab's engine cannot boot — it used to fail as a cryptic broken
     dashboard. Ownership is decided in lib/browser/ownership.ts, and the
     transport awaits that same verdict before it will spawn the worker — so
     the overlay here and the storage below can never disagree about who
     won. This component renders the answer, and offers the handover. */
  const [otherTab, setOtherTab] = useState(false);
  const [taking, setTaking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    const own = engineOwnership();
    const unsub = own.subscribe((o) => setOtherTab(o === "lost"));
    void own.decided().then(() => setOtherTab(own.current() === "lost"));
    return unsub;
  }, []);

  /* "Use it here": ask the owning tab to let go, then reload into a clean
     boot — a fresh page beats patching up one that spent its first render
     being told no. The other tab gets this same overlay, same button. */
  const takeover = () => {
    setTaking(true);
    setHint(null);
    engineOwnership()
      .takeover()
      .then(() => window.location.reload())
      .catch(() => {
        setTaking(false);
        setHint(
          "The other tab didn't let go — it may be an older version. Close it, then reload this one."
        );
      });
  };

  if (active && mounted && otherTab && !PROSE_PAGES.includes(pathname)) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[color:var(--color-deck)] p-6">
        <div className="panel max-w-md border-line2 bg-panel2 p-6 text-center shadow-[0_24px_80px_var(--shadow-pop)]">
          <div className="t-display mb-2 text-[19px] text-ink">
            This ledger is open in another tab
          </div>
          <p className="text-[13.5px] leading-relaxed text-ink2">
            Your data lives in this browser, and only one tab can hold it at
            a time. Take it over here — the other tab will let go — or close
            that tab and reload this one.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <button className="btn btn-primary" onClick={takeover} disabled={taking}>
              {taking ? "Waiting for the other tab…" : "Use the ledger here"}
            </button>
            <button className="btn btn-ghost" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
          {hint && (
            <p className="mt-3 text-[12px] text-[var(--ink-warning)]">{hint}</p>
          )}
        </div>
      </div>
    );
  }

  if (!active || !mounted) return null;
  return (
    <div
      data-engine="browser"
      className="fixed bottom-3 right-3 z-50 rounded-full border border-line2 bg-panel2 px-3 py-1 text-[11px] text-ink2 shadow-lg"
      title="The ledger lives in this browser's storage (OPFS). Export from Settings to back it up."
    >
      Browser engine — data stays in this browser
    </div>
  );
}
