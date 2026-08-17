"use client";

import { useCallback, useEffect, useState } from "react";
import { Cloud, RefreshCw } from "lucide-react";
import { agoLabel, api } from "@/lib/format";
import { ErrorNote, Field, Modal, Panel, toast } from "@/components/ui";
import { C } from "@/components/charts";
import {
  DRIVE_BACKUP_NAME,
  createDriveClient,
  syncOnce,
  type LedgerSummary,
  type SyncOutcome,
  type SyncPorts,
} from "@/lib/drive-sync";
import {
  clearDriveToken,
  driveTokenSource,
  localMarkerStore,
} from "@/lib/browser/drive";
import type { BackupPayload } from "@/lib/repo";

/* Phase 2 of design doc §23: the UI over the sync lib. Everything that can
   be decided was decided in drive-sync.ts; this file collects the client id,
   wires the ports to api(), and renders the outcomes. The hook exists
   because the sidebar is a second sync control: one implementation, two
   places to press it. */

/** Baked at build for a hosted deployment; anyone else pastes their own,
 *  which stays in localStorage. There is no server to hold a secret — the
 *  GIS token flow is designed for exactly this, a public client id. */
const ENV_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? null;
const CLIENT_ID_KEY = "drive-client-id";
/** A property of this browser and its Google grant, so localStorage, not
 *  ledger settings — a synced setting that says how to sync would carry
 *  one browser's choice into every other. */
const AUTO_KEY = "drive-sync-auto";

interface LastSync {
  at: string;
  action: string;
}

/* Reader language, not planner language: what happened to their data, not
   which branch the sync took. The mechanics stay in the FAQ and the docs. */
export const SYNC_DONE: Record<string, string> = {
  push: "Backed up to Drive.",
  pull: "Restored from Drive.",
  noop: "Up to date.",
};

const fmt = (iso: string) => iso.slice(0, 16).replace("T", " ");

/** One side of the conflict, said in counts. A summary that could not be
 *  loaded says so rather than pretending the side is empty. */
function sideLabel(s: LedgerSummary | null | undefined): string {
  if (!s) return "contents unknown";
  const base = `${s.flights} flights · ${s.tickets} tickets`;
  return s.lastEdited ? `${base} · edited ${s.lastEdited.slice(0, 10)}` : base;
}

/** Two controls, one sync: the panel and the sidebar must never race each
 *  other into Drive. */
let inFlight = false;

export function useDriveSync(onPulled?: () => void) {
  const [clientId, setClientId] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);
  const [conflict, setConflict] = useState<SyncOutcome | null>(null);
  const [last, setLast] = useState<LastSync | null>(null);

  useEffect(() => {
    setClientId(ENV_CLIENT_ID ?? localStorage.getItem(CLIENT_ID_KEY));
    /* The marker is per-ledger: two desktop accounts must not share a sync
       history just because they share a browser. */
    api<{ active: string }>("/api/accounts")
      .then((r) => setAccount(r.active))
      .catch(() => setAccount("default"));
  }, []);

  const markerKey = account ? `drive-sync-marker:${account}` : null;
  const lastKey = account ? `drive-sync-last:${account}` : null;

  useEffect(() => {
    if (!lastKey) return;
    const read = () => {
      try {
        const raw = localStorage.getItem(lastKey);
        setLast(raw ? (JSON.parse(raw) as LastSync) : null);
      } catch {
        setLast(null);
      }
    };
    read();
    /* our own event covers this tab ("storage" deliberately doesn't fire in
       the tab that wrote); "storage" covers a sync done in another tab */
    window.addEventListener("drive-sync-changed", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("drive-sync-changed", read);
      window.removeEventListener("storage", read);
    };
  }, [lastKey]);

  const run = useCallback(
    async (resolve?: "push" | "pull"): Promise<SyncOutcome | null> => {
      if (!clientId || !markerKey || !lastKey || inFlight) return null;
      inFlight = true;
      setBusy(true);
      setError(null);
      setOutcome(null);
      setConflict(null);
      try {
        const ports: SyncPorts = {
          client: createDriveClient({ getToken: driveTokenSource(clientId) }),
          /* One file per ledger. Two ledgers sharing a Google account must
             never share a file: the planner cannot tell "my other device
             pushed" from "my other LEDGER pushed", and the second reading
             turns a routine pull into silent cross-ledger data loss. The
             default account keeps the original name so existing Drive
             copies stay linked, and because ids are label slugs the same
             ledger on two devices still meets in the same file. */
          fileName:
            account === "default"
              ? DRIVE_BACKUP_NAME
              : `flight-ledger-${account}.json`,
          loadLocal: () => api<BackupPayload>("/api/export?what=backup"),
          applyRemote: async (json) => {
            await api("/api/backup", { method: "POST", body: json });
          },
          markerStore: localMarkerStore(markerKey),
        };
        const out = await syncOnce(ports, resolve);
        if (out.action === "conflict") {
          setConflict(out);
          return out;
        }
        const stamp: LastSync = { at: new Date().toISOString(), action: out.action };
        localStorage.setItem(lastKey, JSON.stringify(stamp));
        window.dispatchEvent(new Event("drive-sync-changed"));
        setLast(stamp);
        setOutcome(out);
        /* The push toast lives here because a push never reloads; a pull's
           toast belongs to the caller, who knows whether the page it would
           appear on is about to be replaced. */
        if (out.action === "push") toast("Backed up to Google Drive.");
        if (out.action === "pull") onPulled?.();
        return out;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Sync failed");
        return null;
      } finally {
        inFlight = false;
        setBusy(false);
      }
    },
    [clientId, markerKey, lastKey, onPulled]
  );

  /* Forgets, doesn't revoke: the marker and session token live here, the
     grant lives in the user's Google account settings. The Drive copy stays
     — forgetting a connection should never delete a backup. */
  const disconnect = useCallback(() => {
    if (markerKey) localStorage.removeItem(markerKey);
    if (lastKey) localStorage.removeItem(lastKey);
    window.dispatchEvent(new Event("drive-sync-changed"));
    clearDriveToken();
    setLast(null);
    setOutcome(null);
    setConflict(null);
    setError(null);
  }, [markerKey, lastKey]);

  const saveClientId = useCallback((id: string) => {
    localStorage.setItem(CLIENT_ID_KEY, id);
    setClientId(id);
  }, []);
  const clearClientId = useCallback(() => {
    localStorage.removeItem(CLIENT_ID_KEY);
    setClientId(null);
  }, []);

  return {
    clientId,
    envClientId: ENV_CLIENT_ID != null,
    account,
    busy,
    error,
    outcome,
    conflict,
    last,
    connected: last != null,
    run,
    disconnect,
    saveClientId,
    clearClientId,
  };
}

export function autoSyncEnabled(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) === "1";
  } catch {
    return false;
  }
}

/** The one place both sides of a divergence are chosen between. Shown only
 *  on an explicit press — never popped by an automatic sync. */
export function ConflictChooser({
  conflict,
  onResolve,
  onClose,
}: {
  conflict: SyncOutcome;
  onResolve: (choice: "push" | "pull") => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Both sides have changed"
      subtitle="Pick which version to keep"
      onClose={onClose}
    >
      <p className="text-[13.5px] text-ink2">
        This ledger and the copy in your Drive have both changed since they
        last matched. They can&rsquo;t be combined, so one has to win. Here is
        what each side holds:
      </p>
      {/* Facts, not adjectives — and two equal buttons. The old chooser
          styled "Keep this ledger" as the affirmative default and said
          nothing about contents, and a stale ledger overwrote a real one
          because the blue button looked like "OK". */}
      {/* Stacked, not side-by-side: the facts line runs long ("249 flights ·
          174 tickets · edited … · exported …") and as a flex row it clipped
          out of the modal. A label over a line that may wrap survives any
          width. */}
      <div className="mt-3 space-y-2.5 rounded-md border border-line bg-well px-3 py-2.5">
        <div>
          <div className="t-label !text-[9px]">This ledger</div>
          <div className="t-num mt-0.5 break-words text-[12px] leading-relaxed text-ink">
            {sideLabel(conflict.localSummary)}
          </div>
        </div>
        <div>
          <div className="t-label !text-[9px]">Drive copy</div>
          <div className="t-num mt-0.5 break-words text-[12px] leading-relaxed text-ink">
            {sideLabel(conflict.remoteSummary)}
            {conflict.remote?.exportedAt
              ? ` · exported ${conflict.remote.exportedAt.slice(0, 10)}`
              : ""}
          </div>
        </div>
      </div>
      <p className="mt-2 text-[12px] text-mute">
        Not sure? Cancel and download a backup first. Then either choice is
        safe.
      </p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose}>
          Not now
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => onResolve("pull")}
          title="Replaces every flight, ticket and adjustment here with the Drive copy"
        >
          Keep the Drive copy
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => onResolve("push")}
          title="Overwrites the Drive copy with this ledger"
        >
          Keep this ledger
        </button>
      </div>
    </Modal>
  );
}

export function DriveSyncPanel({ onPulled }: { onPulled?: () => void }) {
  const sync = useDriveSync(onPulled);
  const [idDraft, setIdDraft] = useState("");
  const [chooser, setChooser] = useState(false);
  const [auto, setAuto] = useState(false);
  useEffect(() => setAuto(autoSyncEnabled()), []);

  const press = async (resolve?: "push" | "pull") => {
    setChooser(false);
    const out = await sync.run(resolve);
    if (out?.action === "conflict") setChooser(true);
  };

  return (
    <Panel label="Google Drive sync" accent={C.miles}>
      <div className="px-4 pb-4">
        <p className="mb-3 text-[12.5px] text-mute">
          Keeps a copy of your ledger in a private folder of your own Google
          Drive. Nothing is sent until you press sync.
        </p>
        <ErrorNote error={sync.error} />
        {!sync.clientId ? (
          <div className="max-w-[460px]">
            <Field
              label="Google OAuth client ID"
              hint="From the Google Cloud console: an OAuth client (Web application) with this page's origin allowed, and the Drive API enabled. Stays in this browser."
            >
              <input
                className="field"
                value={idDraft}
                placeholder="…apps.googleusercontent.com"
                onChange={(e) => setIdDraft(e.target.value)}
              />
            </Field>
            <button
              className="btn btn-ghost mt-2"
              disabled={!idDraft.trim()}
              onClick={() => sync.saveClientId(idDraft.trim())}
            >
              Save client ID
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn btn-primary"
                disabled={sync.busy || !sync.account}
                onClick={() => void press()}
              >
                {sync.busy ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : (
                  <Cloud size={13} />
                )}
                {sync.connected ? "Sync now" : "Connect & sync"}
              </button>
              {sync.connected && (
                <button
                  className="btn btn-ghost"
                  onClick={sync.disconnect}
                  title="Forgets the connection in this browser. The Drive copy stays; revoke the app's access in your Google account settings."
                >
                  Forget connection
                </button>
              )}
              <span className="text-[12px] text-mute">
                {sync.outcome
                  ? SYNC_DONE[sync.outcome.action]
                  : sync.last
                    ? `Synced ${agoLabel(sync.last.at)}`
                    : sync.connected
                      ? "Connected."
                      : ""}
              </span>
            </div>
            {sync.connected && (
              <label className="mt-3 flex items-center gap-2 text-[12px] text-ink2">
                <input
                  type="checkbox"
                  className="accent-[var(--color-s-miles)]"
                  checked={auto}
                  onChange={(e) => {
                    localStorage.setItem(AUTO_KEY, e.target.checked ? "1" : "0");
                    setAuto(e.target.checked);
                  }}
                />
                Back up automatically
                <span className="text-mute">
                  · runs for about an hour after each sync, then a click
                  renews it
                </span>
              </label>
            )}
            {!sync.envClientId && (
              <button
                className="mt-2 text-[11px] text-mute underline decoration-dotted underline-offset-2 transition-colors hover:text-ink2"
                onClick={() => {
                  sync.clearClientId();
                  setIdDraft("");
                }}
              >
                Change client ID
              </button>
            )}
          </>
        )}
      </div>

      {chooser && sync.conflict && (
        <ConflictChooser
          conflict={sync.conflict}
          onResolve={(choice) => void press(choice)}
          onClose={() => setChooser(false)}
        />
      )}
    </Panel>
  );
}
