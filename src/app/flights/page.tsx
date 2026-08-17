"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, FileUp, Plus, Search } from "lucide-react";
import type { EnrichedSegment, TicketRow } from "@/lib/types";
import {
  estimatedLifetimeMiles,
  expectsMileagePlusCredit,
  isCpmEligible,
  MINIMUM_CREDITED_MILES,
} from "@/lib/types";
import { api, fmtCpm, fmtInt, fmtMoney, STATUS_LABELS } from "@/lib/format";
import { EmptyState, Panel, StatusChip } from "@/components/ui";
import FlightForm from "@/components/FlightForm";
import { learnFleet } from "@/lib/fleet";
import ImportModal from "@/components/ImportModal";
import { C } from "@/components/charts";

const sel = "field !w-auto !py-1.5 text-[12.5px]";

/**
 * Status filter as a tick-list. Hiding canceled flights isn't a "status" the
 * way Flown or Missed are, so it doesn't belong as a sibling option in a
 * single-choice dropdown — here every status is independently on or off, and
 * the default simply arrives with Canceled unticked.
 */
function StatusFilter({
  selected,
  onChange,
}: {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const all = Object.keys(STATUS_LABELS);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (s: string) => {
    const next = new Set(selected);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    onChange(next);
  };

  const label =
    selected.size === all.length
      ? "All statuses"
      : selected.size === 0
        ? "No statuses"
        : selected.size === 1
          ? STATUS_LABELS[[...selected][0] as keyof typeof STATUS_LABELS]
          : `${selected.size} of ${all.length} statuses`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={`${sel} flex items-center gap-2 !pr-2`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>{label}</span>
        <ChevronDown size={13} className={`text-mute transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[190px] overflow-hidden rounded-md border border-line2 bg-panel shadow-[0_12px_28px_var(--shadow-pop)]">
          {all.map((s) => {
            const on = selected.has(s);
            return (
              <button
                key={s}
                type="button"
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12.5px] text-ink2 transition-colors hover:bg-[var(--tint-accent-weak)] hover:text-ink"
                onClick={() => toggle(s)}
              >
                <span
                  className={`flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] border ${
                    on ? "border-s-miles bg-[var(--color-s-miles)]" : "border-line2"
                  }`}
                >
                  {on && <Check size={10} strokeWidth={3} className="text-[var(--on-accent)]" />}
                </span>
                {STATUS_LABELS[s as keyof typeof STATUS_LABELS]}
              </button>
            );
          })}
          <div className="flex border-t border-line">
            {(
              [
                ["All", () => new Set(all)],
                ["None", () => new Set<string>()],
              ] as const
            ).map(([text, make]) => (
              <button
                key={text}
                type="button"
                className="t-display flex-1 px-3 py-1.5 text-[10px] tracking-[0.08em] text-mute transition-colors hover:text-ink"
                onClick={() => onChange(make())}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Booking-time projection from a receipt — not a posted value. */
function Proj({ v }: { v: string }) {
  return (
    <span
      className="text-mute"
      title="Estimated when you booked — United hasn’t credited it yet"
    >
      ≈{v}
    </span>
  );
}

export default function FlightsPage() {
  const [flights, setFlights] = useState<EnrichedSegment[] | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [currency, setCurrency] = useState("USD");
  const [mileValue, setMileValue] = useState(1.2); // ¢ per mile, from Settings

  const [year, setYear] = useState<string>("all");
  /* Canceled legs earn nothing and cost nothing, but they're the audit trail
     for why a reissued ticket exists — kept in the ledger, ticked off in the
     default view. */
  const [statuses, setStatuses] = useState<Set<string>>(
    () => new Set(Object.keys(STATUS_LABELS).filter((s) => s !== "canceled"))
  );
  const [purpose, setPurpose] = useState<string>("all");
  const [q, setQ] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [edit, setEdit] = useState<EnrichedSegment | null>(null);

  const refresh = useCallback(() => {
    api<{ flights: EnrichedSegment[] }>("/api/flights").then((r) => setFlights(r.flights));
    api<{ tickets: TicketRow[] }>("/api/tickets").then((r) => setTickets(r.tickets));
    api<{ settings: { reporting_currency: string; award_valuation_cpm: number } }>(
      "/api/settings"
    ).then((r) => {
      setCurrency(r.settings.reporting_currency);
      if (r.settings.award_valuation_cpm) setMileValue(r.settings.award_valuation_cpm);
    });
  }, []);
  useEffect(refresh, [refresh]);

  /* the ledger teaching itself: every flight that names both a tail and a
     type makes the next entry of that airframe fill itself in */
  const fleet = useMemo(() => learnFleet(flights ?? []), [flights]);

  const years = useMemo(() => {
    const ys = new Set((flights ?? []).map((f) => f.flight_date.slice(0, 4)));
    return [...ys].sort().reverse();
  }, [flights]);

  const filtered = useMemo(() => {
    let list = flights ?? [];
    if (year !== "all") list = list.filter((f) => f.flight_date.startsWith(year));
    list = list.filter((f) => statuses.has(f.status));
    if (purpose !== "all") list = list.filter((f) => f.effective_purpose === purpose);
    if (q.trim()) {
      const needle = q.trim().toUpperCase();
      list = list.filter((f) =>
        [
          f.origin,
          f.destination,
          f.origin_city,
          f.destination_city,
          f.marketing_carrier + (f.flight_number ?? ""),
          f.notes,
        ]
          .filter(Boolean)
          .some((v) => String(v).toUpperCase().includes(needle))
      );
    }
    return list;
  }, [flights, year, statuses, purpose, q]);

  const totals = useMemo(() => {
    const isFlown = (f: EnrichedSegment) =>
      f.status === "flown_unreconciled" || f.status === "flown_reconciled";
    const flown = filtered.filter(isFlown);
    const dist = flown.reduce((a, f) => a + (f.distance_miles ?? 0), 0);
    const gross = filtered.reduce((a, f) => a + f.gross_cost, 0);
    const personal = filtered.reduce((a, f) => a + f.personal_cost, 0);
    return {
      count: filtered.length,
      flownCount: flown.length,
      dist,
      pqp: filtered.reduce((a, f) => a + (f.pqp ?? 0), 0),
      pqf: filtered.reduce((a, f) => a + (f.pqf ?? 0), 0),
      award: filtered.reduce((a, f) => a + (f.award_miles ?? 0), 0),
      lifetime: filtered.reduce((a, f) => a + (f.lifetime_miles ?? 0), 0),
      // posted where available; flown-but-unposted estimate distance on
      // UA-operated flights and 0 on non-UA (no lifetime accrual)
      lifetimeEst: filtered.reduce(
        (a, f) => a + (isFlown(f) ? estimatedLifetimeMiles(f) : (f.lifetime_miles ?? 0)),
        0
      ),
      gross,
      personal,
      /* Recorded cost plus the PQP-derived estimate for flights no ticket
         covers — the same shape the lifetime-miles total already uses. Rows
         showing "≈ $168.02" summing to "$0.00" reads as "these were free";
         the total has to speak the same language its rows do. Kept separate
         from `gross`/`personal` so nothing but the display ever sees it. */
      grossEst: filtered.reduce(
        (a, f) => a + (f.gross_cost || f.estimated_gross || 0),
        0
      ),
      cpmFlights: filtered.filter(isCpmEligible).length,
      cpmMiles: filtered
        .filter(isCpmEligible)
        .reduce((a, f) => a + (f.distance_miles ?? 0), 0),
      cpmGross: filtered
        .filter(isCpmEligible)
        .reduce((a, f) => a + f.gross_cost, 0),
    };
  }, [filtered]);


  return (
    <div className="mx-auto max-w-[1440px]">
      <header className="reveal mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="t-label mb-1 text-s-miles">Flight ledger</div>
          <h1 className="t-display text-[30px] leading-none text-ink">Flights</h1>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={() => setShowImport(true)}>
            <FileUp size={14} /> Import CSV
          </button>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>
            <Plus size={14} /> Log flight
          </button>
        </div>
      </header>

      {/* filter rail — above the table: its reveal animation makes each panel
          its own stacking context, so an open dropdown needs the rail to win */}
      <div className="reveal relative z-30 mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" />
          <input
            className="field !w-[220px] !py-1.5 !pl-8 text-[12.5px]"
            placeholder="Search route, city, flight…"
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
        <StatusFilter selected={statuses} onChange={setStatuses} />
        <select className={sel} value={purpose} onChange={(e) => setPurpose(e.target.value)}>
          <option value="all">Business + personal</option>
          <option value="business">Business</option>
          <option value="personal">Personal</option>
        </select>
        <span className="ml-auto text-[11.5px] text-mute">
          {totals.count} segment{totals.count === 1 ? "" : "s"}
        </span>
      </div>

      <Panel className="reveal" accent={C.miles}>
        {flights == null ? (
          <div className="t-label p-8">Loading…</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={flights.length === 0 ? "The ledger is empty" : "No matches"}
            body={
              flights.length === 0
                ? "Log a flight to start the ledger — or import your united.com activity CSV on the MileagePlus page, which creates the flights for you."
                : "Try loosening the filters."
            }
            action={
              flights.length === 0 ? (
                <button className="btn btn-primary" onClick={() => setShowForm(true)}>
                  <Plus size={14} /> Log flight
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="max-h-[calc(var(--vh-scaled)-240px)] overflow-auto">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Flight</th>
                  <th>Route</th>
                  <th>Cabin</th>
                  <th className="!text-right">Dist mi</th>
                  <th className="!text-right">Lifetime</th>
                  <th className="!text-right">Award</th>
                  <th className="!text-right">PQP</th>
                  <th className="!text-right">PQF</th>
                  <th className="!text-right">Gross</th>
                  <th className="!text-right">Personal</th>
                  <th className="!text-right">CPM</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((f) => {
                  /* A flight that earns nothing in MileagePlus can never be
                     reconciled — there is no statement line to match it to —
                     so "Flown" on one is a permanent false alarm, not a task.
                     27 of the 29 unreconciled flights here are on other
                     airlines' metal. Instead of a chip that never clears, the
                     earning columns themselves go quiet. */
                  const credits = expectsMileagePlusCredit(f);
                  /* Bought with miles. "0" in these columns is arithmetically
                     true and tells you nothing — a zero that means "this fare
                     was paid in miles" looks identical to one meaning "United
                     hasn't posted". The word says which. */
                  const isAward = f.ticket_is_award === true || f.award_miles === 0;
                  /* Why a flight earns no lifetime miles — three different
                     answers that all used to print "≈0". Metal first: a leg on
                     another airline earns nothing here whatever the ticket
                     says. Then the ticket: bought with miles. Then the
                     accrual: United's own metal, credited somewhere else (LH
                     stock, or flagged by hand). */
                  const onUaMetal =
                    (f.operating_carrier ?? f.marketing_carrier ?? "UA").toUpperCase() ===
                    "UA";
                  const noEarnReason = !onUaMetal
                    ? "Non-United"
                    : isAward
                      ? "Award"
                      : !credits
                        ? "Non-MileagePlus"
                        : null;
                  const earn = credits ? "text-ink2" : "text-mute";
                  /* Miles are money you already bought. Valuing them at the
                     rate in Settings puts an award flight on the same axis as
                     a paid one — otherwise $5.60 over 862 miles reads as
                     0.65¢ and quietly beats every real fare in the ledger. */
                  const milesSpent = f.award_miles_spent ?? 0;
                  const milesValue = (milesSpent * mileValue) / 100;
                  const fullCost = f.gross_cost + milesValue;
                  const cpm =
                    f.distance_miles && f.distance_miles > 0 && fullCost > 0
                      ? (100 * fullCost) / f.distance_miles
                      : null;
                  const estCpm =
                    cpm == null &&
                    f.estimated_gross != null &&
                    f.distance_miles &&
                    f.distance_miles > 0
                      ? (100 * f.estimated_gross) / f.distance_miles
                      : null;
                  return (
                    <tr
                      key={f.id}
                      /* Three states, not two. Amber means the flight earned
                         NOTHING in MileagePlus. A partner leg on a
                         United-issued ticket did earn — it just earns no
                         LIFETIME miles, since those want United metal — so it
                         takes an indigo wash: still blue, still "this
                         counted", visibly not a United flight. Lumping it
                         with the amber rows said it earned nothing, which is
                         wrong: those three legs carry 136, 264 and 207 award
                         miles. United's own metal stays clean.
                         Indigo rather than a deeper cyan because the table's
                         hover IS cyan — same-hue washes either vanish on
                         hover or, if stronger, appear to dim when hovered. */
                      className={`cursor-pointer ${
                        !credits
                          ? "bg-[color-mix(in_oklab,var(--color-s-gross)_9%,transparent)]"
                          : onUaMetal
                            ? ""
                            : "bg-[var(--tint-accent)]"
                      }`}
                      onClick={() => setEdit(f)}
                    >
                      <td className="t-num text-ink2">{f.flight_date}</td>
                      <td className="t-num">
                        {f.marketing_carrier}
                        {f.flight_number ?? ""}
                      </td>
                      <td>
                        <span className="t-num text-ink">
                          {f.origin} → {f.destination}
                        </span>
                        {(f.origin_city || f.destination_city) && (
                          <span className="ml-2 hidden text-[10.5px] text-mute xl:inline">
                            {f.origin_city} – {f.destination_city}
                          </span>
                        )}
                      </td>
                      {/* Status rides along with the cabin instead of owning a
                          column: 165 of 205 flights are "Reconciled", so a
                          column of identical green chips spent real width
                          saying nothing. It appears only when the status is
                          something you'd want to catch. */}
                      <td className="text-[12px] text-ink2">
                        {f.cabin ?? "—"}
                        {/* Fixed width: a two-letter booking code (XN) is wider
                            than a one-letter one (W), and without this the chip
                            after it sits a few pixels right on those rows only,
                            which reads as a broken column. */}
                        {f.booking_class && (
                          <span className="ml-1 inline-block w-[3.4ch] text-center font-mono text-[10.5px] text-mute">
                            ({f.booking_class})
                          </span>
                        )}
                        {f.status !== "flown_reconciled" && credits && (
                          <span className="ml-2 inline-block align-middle">
                            <StatusChip status={f.status} />
                          </span>
                        )}
                      </td>
                      <td className="num text-ink2">
                        {f.distance_miles != null ? fmtInt(f.distance_miles) : "?"}
                      </td>
                      <td className={`num ${earn}`}>
                        {noEarnReason ? (
                          <span
                            className="text-[10.5px] uppercase tracking-wider text-mute"
                            title={
                              noEarnReason === "Non-United"
                                ? "Flown on another airline's metal — earns nothing toward United lifetime miles"
                                : noEarnReason === "Award"
                                  ? "Award ticket — redeemed with miles, so it earns no lifetime miles"
                                  : "United metal, but this ticket doesn't credit to MileagePlus — another programme earned it"
                            }
                          >
                            {noEarnReason}
                          </span>
                        ) : f.lifetime_miles != null ? (
                          fmtInt(f.lifetime_miles)
                        ) : (f.status === "flown_unreconciled" ||
                            f.status === "flown_reconciled") &&
                          f.distance_miles != null ? (
                          estimatedLifetimeMiles(f) > 0 ? (
                            <span
                              className="text-mute"
                              title={
                                estimatedLifetimeMiles(f) > (f.distance_miles ?? 0)
                                  ? `${fmtInt(f.distance_miles)} mi flown, credited at United's ${fmtInt(MINIMUM_CREDITED_MILES)}-mile segment minimum. United hasn’t posted yet; enter the posted value to override.`
                                  : "Estimated from the flown distance — United hasn’t posted yet. Enter the posted value to override."
                              }
                            >
                              {/* the ESTIMATE, not the distance: they are the
                                  same number until the 500-mile minimum bites */}
                              ≈{fmtInt(estimatedLifetimeMiles(f))}
                            </span>
                          ) : (
                            <span
                              className="text-mute"
                              title={`${
                                f.award_miles === 0
                                  ? "Award travel (0 award miles)"
                                  : "Non-UA operated"
                              } — no lifetime miles accrue. Enter a posted value to override.`}
                            >
                              ≈0
                            </span>
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={`num ${earn}`}>
                        {isAward ? (
                          <span
                            className="text-[10.5px] uppercase tracking-wider text-mute"
                            title="Award ticket — redeemed with miles, so it earns none"
                          >
                            Award
                          </span>
                        ) : f.award_miles != null ? (
                          fmtInt(f.award_miles)
                        ) : f.projected_award_miles != null ? (
                          <Proj v={fmtInt(f.projected_award_miles)} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={`num ${earn}`}>
                        {f.pqp != null ? (
                          fmtInt(f.pqp)
                        ) : f.projected_pqp != null ? (
                          <Proj v={fmtInt(f.projected_pqp)} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={`num ${earn}`}>
                        {f.pqf != null ? (
                          f.pqf
                        ) : f.projected_pqf != null ? (
                          <Proj v={String(f.projected_pqf)} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="num">
                        {/* An award fare cost cash AND miles; showing only the
                            $5.60 of tax is the part that isn't the price. */}
                        {milesSpent > 0 && (
                          <span
                            className="text-[11px] text-mute"
                            title={`${milesSpent.toLocaleString()} miles redeemed${
                              f.award_miles_estimated
                                ? " — derived from this flight's award PQP × 100, not a recorded payment"
                                : ", recorded on the ticket"
                            }. Valued at ${mileValue}¢ each = ${fmtMoney(milesValue, currency)}.`}
                          >
                            {(milesSpent / 1000).toFixed(1)}k
                            {f.award_miles_estimated ? "*" : ""}
                            {" + "}
                          </span>
                        )}
                        {f.gross_cost ? (
                          fmtMoney(f.gross_cost, currency)
                        ) : f.estimated_gross != null ? (
                          <span
                            className="text-mute"
                            title={`Estimated from ${fmtInt(f.pqp)} PQP plus typical tax — no ticket recorded for this flight`}
                          >
                            ≈{fmtMoney(f.estimated_gross, currency)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      {/* A fully reimbursed flight costs you $0.00 — true, but
                          the fact worth reading is WHO covered it. The payer
                          replaces the zero when the reimbursement names one;
                          without a name it stays $0.00 rather than inventing
                          an attribution. */}
                      <td className="num">
                        {f.personal_cost === 0 && f.gross_cost > 0 && f.reimbursed_by ? (
                          <span
                            className="text-[11.5px] text-s-miles"
                            title={`Reimbursed in full by ${f.reimbursed_by} — ${fmtMoney(f.gross_cost, currency)} gross, $0.00 to you`}
                          >
                            {f.reimbursed_by}
                          </span>
                        ) : f.personal_cost || f.gross_cost ? (
                          fmtMoney(f.personal_cost, currency)
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="num">
                        {cpm != null ? (
                          milesSpent > 0 ? (
                            <span
                              title={`${fmtMoney(f.gross_cost, currency)} cash + ${milesSpent.toLocaleString()} miles at ${mileValue}¢ = ${fmtMoney(fullCost, currency)} over ${fmtInt(f.distance_miles)} mi${
                                f.award_miles_estimated ? ". Miles derived from PQP × 100." : ""
                              }`}
                            >
                              {fmtCpm(cpm)}
                              <span className="text-mute">*</span>
                            </span>
                          ) : (
                            fmtCpm(cpm)
                          )
                        ) : estCpm != null ? (
                          <span className="text-mute" title="Based on the estimated cost">
                            ≈{fmtCpm(estCpm)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  {/* Date, Flight, Route, Cabin — four now that Status is gone.
                      This spanned five, so every total sat one column right of
                      the figures it was totalling. */}
                  <td colSpan={4} className="t-num text-[11.5px] uppercase tracking-wider text-mute">
                    {totals.flownCount} flown of {totals.count}
                  </td>
                  <td className="num">{fmtInt(totals.dist)}</td>
                  <td className="num">
                    {totals.lifetimeEst > totals.lifetime ? (
                      <span title={`United-posted: ${fmtInt(totals.lifetime)}`}>
                        ≈{fmtInt(totals.lifetimeEst)}
                      </span>
                    ) : totals.lifetime ? (
                      fmtInt(totals.lifetime)
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="num">{totals.award ? fmtInt(totals.award) : "—"}</td>
                  <td className="num">{totals.pqp ? fmtInt(totals.pqp) : "—"}</td>
                  <td className="num">{totals.pqf || "—"}</td>
                  <td className="num">
                    {totals.grossEst > totals.gross ? (
                      <span
                        title={`Recorded: ${fmtMoney(totals.gross, currency)} — the rest is estimated from PQP for flights with no ticket`}
                      >
                        ≈{fmtMoney(totals.grossEst, currency)}
                      </span>
                    ) : (
                      fmtMoney(totals.gross, currency)
                    )}
                  </td>
                  {/* Personal stays recorded-only: its per-flight cells show
                      "—" for a flight with no ticket, because an estimate is a
                      GROSS figure and nothing is known about reimbursements.
                      A total may only claim what its own column claims. */}
                  <td className="num">{fmtMoney(totals.personal, currency)}</td>
                  <td
                    className="num"
                    title={
                      totals.cpmMiles > 0
                        ? `Over ${totals.cpmFlights} cost-tracked, lifetime-earning flight${totals.cpmFlights === 1 ? "" : "s"} (${fmtInt(totals.cpmMiles)} mi). Flights without recorded cost, award travel and non-UA flights are excluded.`
                        : "No cost-tracked, lifetime-earning flights in this view"
                    }
                  >
                    {fmtCpm(
                      totals.cpmMiles > 0
                        ? (100 * totals.cpmGross) / totals.cpmMiles
                        : null
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>

      {(showForm || edit) && (
        <FlightForm
          segment={edit}
          tickets={tickets}
          currency={currency}
          fleet={fleet}
          onClose={() => {
            setShowForm(false);
            setEdit(null);
          }}
          onSaved={refresh}
        />
      )}

      {showImport && (
        <ImportModal onClose={() => setShowImport(false)} onApplied={refresh} />
      )}
    </div>
  );
}
