"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileUp, Plus, Search, Trash2 } from "lucide-react";
import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  ActivityRecord,
  ActivityType,
  isFlightActivity,
} from "@/lib/types";
import { api, fmtInt, todayStr } from "@/lib/format";
import { Confirm, EmptyState, ErrorNote, Field, Modal, Panel, StatCard } from "@/components/ui";
import ImportModal from "@/components/ImportModal";
import PremierTracker from "@/components/PremierTracker";
import type { PremierYear } from "@/lib/premier";
import { C } from "@/components/charts";

interface ActivityView extends ActivityRecord {
  reasons: string[] | null;
  segment_label: string | null;
}

const TYPE_COLOR: Partial<Record<ActivityType, string>> = {
  united_flight: C.miles,
  partner_flight: C.miles,
  credit_card: C.pqp,
  shopping: C.award,
  dining: C.award,
  hotel: C.award,
  car_rental: C.award,
  rideshare: C.award,
  ancillary: C.gross,
  promotion: C.gross,
  adjustment: "var(--color-serious)",
  redemption: C.personal,
};

/** Where a linked-to row should sit from the top of the viewport, in px. */
const LANDING_OFFSET = 96;

export default function ActivityPage() {
  const [rows, setRows] = useState<ActivityView[] | null>(null);
  const [year, setYear] = useState("all");
  const [type, setType] = useState("all");
  const [q, setQ] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ActivityView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [premier, setPremier] = useState<PremierYear[]>([]);
  /** the row a Reconcile link asked for, lit until it has been seen */
  const [landed, setLanded] = useState<string | null>(null);
  const [member, setMember] = useState<{
    member_first_name: string | null;
    member_last_name: string | null;
  } | null>(null);
  const [tab, setTab] = useState<"status" | "log">("status");

  const refresh = useCallback(() => {
    api<{ activities: ActivityView[]; premier: PremierYear[] }>("/api/activity")
      .then((r) => {
        setRows(r.activities);
        setPremier(r.premier);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(refresh, [refresh]);
  /* ?import=1 — the dashboard's empty-state CTA lands straight in the import
     dialog. window.location, not useSearchParams: the static export has no
     server to resolve params through, and this page is client-only anyway.
     Deliberately NO dependency array: the router keeps this page instance
     alive when only the query changes (visit MileagePlus, go back, click the
     CTA), so a mount-only effect would miss the param. The check is cheap
     and idempotent — the param is scrubbed on arrival, which also keeps a
     later reload from re-opening a dialog the user closed. */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("import") != null) {
      setShowImport(true);
      window.history.replaceState(null, "", window.location.pathname);
    }
  });
  useEffect(() => {
    api<{ settings: typeof member }>("/api/settings")
      .then((r) => setMember(r.settings))
      .catch(() => {});
  }, []);

  /* Arriving from Reconcile as /activity?activity=<id>. Same landing as the
     tickets page: open on the row the exception named, not on the top of the
     log. The Log tab is selected because the row lives there, and the filters
     are cleared because the row may sit outside the year the page opens on. */
  useEffect(() => {
    if (!rows) return;
    const want = new URLSearchParams(window.location.search).get("activity");
    if (!want || !rows.some((r) => r.id === want)) return;
    setTab("log");
    setYear("all");
    setType("all");
    setQ("");
    setLanded(want);
  }, [rows]);

  /* Landing on a row is a race against the page, not a single action. The row
     may not be mounted on the commit that sets `landed` (the second fetch and
     the filter reset each re-render the list), and the router puts a fresh
     navigation back at the top AFTER our effects run — a one-shot scroll gets
     silently undone. So re-assert every frame until the row has held still in
     view, and give up on a deadline rather than looping forever. Instant, not
     smooth: a smooth scroll animates over frames and any reset cancels it.
     Timers rather than requestAnimationFrame, which is suspended entirely in a
     background tab — the landing would then depend on the window having focus. */
  useEffect(() => {
    if (!landed) return;
    let tries = 0;
    let settled = 0;
    let tick: ReturnType<typeof setTimeout>;
    const attempt = () => {
      const box = document
        .querySelector<HTMLElement>(`[data-landing-id="${landed}"]`)
        ?.getBoundingClientRect();
      /* Anchor the row's TOP just below the header, not its middle: an
         expanded row is taller than the viewport, so centring it puts the
         header line — the part that identifies it — off the top of screen. */
      if (box) {
        const want = Math.max(0, window.scrollY + box.top - LANDING_OFFSET);
        if (Math.abs(window.scrollY - want) > 4) {
          window.scrollTo({ top: want });
          settled = 0;
        } else settled += 1;
      }
      if (settled < 3 && tries++ < 30) tick = setTimeout(attempt, 50);
    };
    attempt();
    const clear = setTimeout(() => setLanded(null), 2600);
    return () => {
      clearTimeout(tick);
      clearTimeout(clear);
    };
  }, [landed]);

  const years = useMemo(() => {
    const s = new Set((rows ?? []).map((r) => r.activity_date.slice(0, 4)));
    return [...s].sort().reverse();
  }, [rows]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (year !== "all") list = list.filter((r) => r.activity_date.startsWith(year));
    if (type === "non_flight") list = list.filter((r) => !isFlightActivity(r.activity_type));
    else if (type !== "all") list = list.filter((r) => r.activity_type === type);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter((r) => r.description.toLowerCase().includes(needle));
    }
    return list;
  }, [rows, year, type, q]);

  const totals = useMemo(() => {
    const t = { pqp: 0, award: 0, nonFlightPqp: 0, nonFlightAward: 0, pqf: 0 };
    for (const r of filtered) {
      t.pqp += r.pqp ?? 0;
      t.award += r.award_miles ?? 0;
      t.pqf += r.pqf ?? 0;
      if (!isFlightActivity(r.activity_type)) {
        t.nonFlightPqp += r.pqp ?? 0;
        t.nonFlightAward += r.award_miles ?? 0;
      }
    }
    return t;
  }, [filtered]);

  const del = async (row: ActivityView) => {
    setConfirmDelete(null);
    try {
      await api(`/api/activity/${row.id}`, { method: "DELETE" });
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const sel = "field !w-auto !py-1.5 text-[12.5px]";

  return (
    <div className="mx-auto max-w-[1200px]">
      <header className="reveal mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="t-label mb-1 text-s-miles">Every posting on your account</div>
          <h1 className="t-display text-[30px] leading-none text-ink">MileagePlus activity</h1>
          {/* Only when it has been filled in — a header with a blank where a
              name should be says less than no line at all. */}
          {(() => {
            const name = [member?.member_first_name, member?.member_last_name]
              .filter(Boolean)
              .join(" ");
            return name ? (
              <div className="mt-2 text-[12px] text-ink2">{name}</div>
            ) : null;
          })()}
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={() => setShowAdd(true)}>
            <Plus size={14} /> Add manually
          </button>
          <button className="btn btn-primary" onClick={() => setShowImport(true)}>
            <FileUp size={14} /> Import CSV
          </button>
        </div>
      </header>

      <ErrorNote error={error} />

      <div className="reveal mb-4 flex gap-1 border-b border-line">
        {(
          [
            ["status", "Premier status"],
            ["log", "Activity log"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`t-display -mb-px border-b-2 px-3.5 py-2 text-[13px] tracking-[0.06em] transition-colors ${
              tab === k
                ? "border-s-pqp text-ink"
                : "border-transparent text-mute hover:text-ink2"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "status" && <PremierTracker years={premier} />}

      {tab === "log" && (
        <>
      <div className="stagger mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Rows" value={fmtInt(filtered.length)} accent={C.miles} />
        <StatCard
          label="PQP total"
          value={fmtInt(totals.pqp)}
          sub={`${fmtInt(totals.nonFlightPqp)} from non-flight`}
          accent={C.pqp}
          title="All PQP on these rows — flights plus card, shopping and partner earning"
        />
        <StatCard
          label="Award miles"
          value={fmtInt(totals.award)}
          sub={`${fmtInt(totals.nonFlightAward)} from non-flight`}
          accent={C.award}
        />
        <StatCard label="PQF" value={fmtInt(totals.pqf)} accent={C.miles} />
      </div>

      <div className="reveal mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
          <input
            className="field !w-[220px] !py-1.5 !pl-8 text-[12.5px]"
            placeholder="Search description…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select className={sel} value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="all">All years</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select className={sel} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All activity</option>
          <option value="non_flight">Non-flight only</option>
          {ACTIVITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {ACTIVITY_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      <Panel className="reveal" accent={C.pqp}>
        {rows == null ? (
          <div className="t-label p-8">Loading…</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={rows.length === 0 ? "No activity recorded" : "No matches"}
            body={
              rows.length === 0
                ? "Import your united.com activity CSV — every row lands here, including card and shopping earning."
                : "Try loosening the filters."
            }
            action={
              rows.length === 0 ? (
                <button className="btn btn-primary" onClick={() => setShowImport(true)}>
                  <FileUp size={14} /> Import CSV
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="max-h-[calc(var(--vh-scaled)-380px)] overflow-auto">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Type</th>
                  <th>Matched flight</th>
                  <th className="!text-right">Award</th>
                  <th className="!text-right">PQP</th>
                  <th className="!text-right">PQF</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    data-landing-id={r.id}
                    className={`transition-colors duration-500 ${
                      landed === r.id ? "bg-[var(--tint-accent)]" : ""
                    }`}
                  >
                    <td className="t-num text-ink2">{r.activity_date}</td>
                    <td className="max-w-[320px] truncate text-[12.5px] text-ink">
                      {r.description}
                    </td>
                    <td>
                      <span
                        className="chip !text-[9.5px]"
                        style={{
                          color: TYPE_COLOR[r.activity_type] ?? "var(--color-mute)",
                          borderColor: `color-mix(in oklab, ${TYPE_COLOR[r.activity_type] ?? "var(--color-mute)"} 45%, transparent)`,
                          background: `color-mix(in oklab, ${TYPE_COLOR[r.activity_type] ?? "var(--color-mute)"} 10%, transparent)`,
                        }}
                      >
                        {ACTIVITY_TYPE_LABELS[r.activity_type] ?? r.activity_type}
                      </span>
                    </td>
                    <td className="t-num text-[12px] text-mute">
                      {r.segment_label ? (
                        <span title={r.reasons?.join(" · ") ?? undefined}>
                          {r.segment_label}
                        </span>
                      ) : isFlightActivity(r.activity_type) ? (
                        <span className="text-[var(--color-warning)]">unmatched</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="num text-ink2">
                      {r.award_miles != null ? fmtInt(r.award_miles) : "—"}
                    </td>
                    <td className="num text-ink2">{r.pqp != null ? fmtInt(r.pqp) : "—"}</td>
                    <td className="num text-ink2">{r.pqf ?? "—"}</td>
                    <td className="w-8 !py-1 text-right">
                      <button
                        className="rounded p-1 text-mute transition-colors hover:bg-[var(--tint-critical)] hover:text-[var(--ink-critical)]"
                        title="Delete row"
                        onClick={() => setConfirmDelete(r)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="t-num text-[11.5px] uppercase tracking-wider text-mute">
                    {filtered.length} rows
                  </td>
                  <td className="num">{fmtInt(totals.award)}</td>
                  <td className="num">{fmtInt(totals.pqp)}</td>
                  <td className="num">{fmtInt(totals.pqf)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>
        </>
      )}

      {showImport && (
        <ImportModal onClose={() => setShowImport(false)} onApplied={refresh} />
      )}
      {showAdd && (
        <AddActivityForm onClose={() => setShowAdd(false)} onSaved={refresh} />
      )}
      {confirmDelete && (
        <Confirm
          message={`Delete “${confirmDelete.description}”?`}
          detail="Removes this row from your activity ledger. Flights are not affected."
          onConfirm={() => del(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function AddActivityForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    activity_date: todayStr(),
    description: "",
    activity_type: "credit_card" as ActivityType,
    pqp: "",
    award_miles: "",
    pqf: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/api/activity", {
        method: "POST",
        body: JSON.stringify({
          activity_date: f.activity_date,
          description: f.description,
          activity_type: f.activity_type,
          pqp: f.pqp === "" ? null : f.pqp,
          award_miles: f.award_miles === "" ? null : f.award_miles,
          pqf: f.pqf === "" ? null : f.pqf,
        }),
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add activity"
      subtitle="For earning that isn’t in the CSV yet — card PQP, promotions, corrections"
      onClose={onClose}
    >
      <ErrorNote error={error} />
      <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
        <Field label="Date">
          <input
            type="date"
            className="field t-num"
            value={f.activity_date}
            onChange={(e) => set("activity_date", e.target.value)}
          />
        </Field>
        <Field label="Type">
          <select
            className="field"
            value={f.activity_type}
            onChange={(e) => set("activity_type", e.target.value)}
          >
            {ACTIVITY_TYPES.filter((t) => !isFlightActivity(t)).map((t) => (
              <option key={t} value={t}>
                {ACTIVITY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description" className="col-span-2">
          <input
            className="field"
            placeholder="PQP Earn Explorer Card"
            autoFocus
            value={f.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>
        <Field label="PQP">
          <input
            className="field t-num"
            inputMode="decimal"
            value={f.pqp}
            onChange={(e) => set("pqp", e.target.value)}
          />
        </Field>
        <Field label="Award miles">
          <input
            className="field t-num"
            inputMode="numeric"
            value={f.award_miles}
            onChange={(e) => set("award_miles", e.target.value)}
          />
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={save}
          disabled={busy || !f.description.trim()}
        >
          {busy ? "Saving…" : "Add activity"}
        </button>
      </div>
    </Modal>
  );
}
