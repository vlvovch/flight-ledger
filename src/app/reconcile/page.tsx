"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import type { Exception, ExceptionKind, ReconcileReport } from "@/lib/reconcile";
import type { EnrichedSegment, SegmentRow } from "@/lib/types";
import { api } from "@/lib/format";
import { EmptyState, ErrorNote, Panel } from "@/components/ui";
import FlightForm from "@/components/FlightForm";
import { RECONCILE_GROUPS as GROUPS } from "@/lib/reconcile-groups";

export default function ReconcilePage() {
  const [report, setReport] = useState<ReconcileReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [edit, setEdit] = useState<EnrichedSegment | null>(null);

  const refresh = useCallback(() => {
    api<{ reconcile: ReconcileReport }>("/api/analytics")
      .then((r) => setReport(r.reconcile))
      .catch((e) => setError(e.message));
  }, []);
  useEffect(refresh, [refresh]);

  const grouped = useMemo(() => {
    const m = new Map<ExceptionKind, Exception[]>();
    for (const e of report?.exceptions ?? []) {
      const arr = m.get(e.kind) ?? [];
      arr.push(e);
      m.set(e.kind, arr);
    }
    return m;
  }, [report]);

  const act = async (fn: () => Promise<unknown>, id: string) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const openFlight = async (segmentId?: string) => {
    if (!segmentId) return;
    try {
      const seg = await api<SegmentRow>(`/api/flights/${segmentId}`);
      setEdit(seg as EnrichedSegment);
    } catch {
      /* stale */
    }
  };

  const total = report?.exceptions.filter((e) => e.severity === "warn").length ?? 0;

  return (
    <div className="mx-auto max-w-[1100px]">
      <header className="reveal mb-5">
        <div className="t-label mb-1 text-s-miles">Ledger vs. United’s statement</div>
        <h1 className="t-display text-[30px] leading-none text-ink">Reconcile</h1>
      </header>

      <ErrorNote error={error} />

      {report == null ? (
        <div className="t-label p-8">Loading…</div>
      ) : total === 0 && report.exceptions.length === 0 ? (
        <Panel className="reveal">
          <EmptyState
            title="Everything reconciles"
            body="Every flown flight is credited, every credited flight is in the ledger, and no duplicates were found."
          />
        </Panel>
      ) : (
        <div className="stagger space-y-3">
          {GROUPS.map(({ kind, label, blurb, accent }) => {
            const items = grouped.get(kind);
            if (!items || items.length === 0) return null;
            return (
              <Panel key={kind} label={`${label} (${items.length})`} accent={accent}>
                <p className="px-4 pb-1 text-[11.5px] text-mute">{blurb}</p>
                <ul className="px-4 pb-3">
                  {items.map((e, i) => (
                    <li
                      key={i}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[color-mix(in_oklab,var(--color-line)_55%,transparent)] py-2 last:border-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[12.5px] text-ink2">{e.title}</p>
                        {e.detail && (
                          <p className="mt-0.5 text-[11px] leading-snug text-mute">
                            {e.detail}
                          </p>
                        )}
                      </div>

                      {kind === "suggested_match" && e.activityId && (
                        <span className="flex shrink-0 gap-1.5">
                          <button
                            className="btn btn-ghost !px-2 !py-1 !text-[10px]"
                            disabled={busy === e.activityId}
                            onClick={() =>
                              act(
                                () =>
                                  api(`/api/activity/${e.activityId}`, {
                                    method: "PATCH",
                                    body: JSON.stringify({ match_status: "accepted" }),
                                  }),
                                e.activityId!
                              )
                            }
                          >
                            <Check size={11} /> Confirm
                          </button>
                          <button
                            className="btn btn-ghost !px-2 !py-1 !text-[10px]"
                            disabled={busy === e.activityId}
                            onClick={() =>
                              act(
                                () =>
                                  api(`/api/activity/${e.activityId}`, {
                                    method: "PATCH",
                                    body: JSON.stringify({ match_status: "rejected" }),
                                  }),
                                e.activityId!
                              )
                            }
                          >
                            <X size={11} /> Not it
                          </button>
                        </span>
                      )}

                      {/* The blurb has promised "mark them flown, or
                          cancelled" since this exception was born; these are
                          those two verbs. Flown means UNRECONCILED — the
                          activity CSV still gets to disagree. Nothing here
                          runs on a timer: the date raised the question, and
                          a person answers it. */}
                      {kind === "past_but_upcoming" && e.segmentId && (
                        <span className="flex shrink-0 gap-1.5">
                          <button
                            className="btn btn-ghost !px-2 !py-1 !text-[10px]"
                            disabled={busy === e.segmentId}
                            onClick={() =>
                              act(
                                () =>
                                  api(`/api/flights/${e.segmentId}`, {
                                    method: "PATCH",
                                    body: JSON.stringify({ status: "flown_unreconciled" }),
                                  }),
                                e.segmentId!
                              )
                            }
                          >
                            <Check size={11} /> Mark flown
                          </button>
                          <button
                            className="btn btn-ghost !px-2 !py-1 !text-[10px]"
                            disabled={busy === e.segmentId}
                            onClick={() =>
                              act(
                                () =>
                                  api(`/api/flights/${e.segmentId}`, {
                                    method: "PATCH",
                                    body: JSON.stringify({ status: "canceled" }),
                                  }),
                                e.segmentId!
                              )
                            }
                          >
                            <X size={11} /> Cancelled
                          </button>
                        </span>
                      )}

                      {kind === "ready_to_reconcile" && e.segmentId && (
                        <button
                          className="btn btn-ghost shrink-0 !px-2 !py-1 !text-[10px]"
                          disabled={busy === e.segmentId}
                          onClick={() =>
                            act(
                              () =>
                                api(`/api/flights/${e.segmentId}`, {
                                  method: "PATCH",
                                  body: JSON.stringify({ status: "flown_reconciled" }),
                                }),
                              e.segmentId!
                            )
                          }
                        >
                          <Check size={11} /> Mark reconciled
                        </button>
                      )}

                      {e.segmentId && kind !== "ready_to_reconcile" && (
                        <button
                          className="shrink-0 text-[11px] text-mute transition-colors hover:text-s-miles"
                          onClick={() => openFlight(e.segmentId)}
                        >
                          Open flight
                        </button>
                      )}
                      {kind === "unmatched_activity" && (
                        <Link
                          href={
                            e.activityId ? `/activity?activity=${e.activityId}` : "/activity"
                          }
                          className="shrink-0 text-[11px] text-mute transition-colors hover:text-s-miles"
                        >
                          View activity
                        </Link>
                      )}
                      {e.ticketId && (
                        <Link
                          href={`/tickets?ticket=${e.ticketId}`}
                          className="shrink-0 text-[11px] text-mute transition-colors hover:text-s-miles"
                        >
                          Open ticket
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </Panel>
            );
          })}
        </div>
      )}

      {edit && (
        <FlightForm
          segment={edit}
          tickets={[]}
          onClose={() => setEdit(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
