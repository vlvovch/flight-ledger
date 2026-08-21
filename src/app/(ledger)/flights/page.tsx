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
import { EmptyState, Panel, SortTh, StatusChip } from "@/components/ui";
import FlightForm from "@/components/FlightForm";
import { learnFleet, normalizeTail } from "@/lib/fleet";
import { flightDuration, fmtDuration, wallToUtc, zoneOf } from "@/lib/duration";
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
  /* ?q= seeds the search box, so the Analysis fleet panel can link straight
     to one airframe's flights. Read in an effect, not the initializer: the
     page is prerendered with an empty box, and a first client render that
     disagrees with it is a hydration mismatch. */
  const [q, setQ] = useState("");
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("q");
    if (v) setQ(v);
  }, []);

  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [edit, setEdit] = useState<EnrichedSegment | null>(null);

  /* Page-level drop, same shape as Tickets: dragenter/leave are depth-counted
     because they refire on every child crossing, the window swallows stray
     drops so a miss can't navigate away, and an open dialog owns its own drop
     zone. A dropped CSV opens the import dialog already reading the file —
     which one (MileagePlus, myFlightradar24, Flighty) the dialog sniffs
     itself. CSV import is one file at a time, so extras are ignored. */
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<File | null>(null);
  const importOpen = useRef(false);
  useEffect(() => {
    importOpen.current = showImport;
  }, [showImport]);

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      if (!importOpen.current) setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (importOpen.current) return;
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      setDropped(file);
      setShowImport(true);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  /* Coordinates only for airports the ledger touches — same request the
     analysis map makes. They feed the gate-to-gate time column: each end's
     zone comes from its coordinates. Null until they arrive; the column
     shows the ≈ distance model in the meantime rather than a blank frame. */
  const [coords, setCoords] = useState<Record<string, { lat: number; lon: number }> | null>(null);
  useEffect(() => {
    if (!flights?.length) return;
    const codes = [...new Set(flights.flatMap((f) => [f.origin, f.destination]))];
    api<{ airports: Record<string, { lat: number; lon: number }> }>(
      `/api/airports?codes=${codes.join(",")}`
    )
      .then((r) => setCoords(r.airports))
      .catch(() => {});
  }, [flights]);
  /* The departure INSTANT, for ordering. Local wall clocks cannot order a
     multi-timezone day: an overnight's 17:51 Chicago departure is later on
     the clock but earlier on Earth than the next morning's 08:23 Amsterdam
     connection. Zone from coordinates where available; the naive reading is
     the fallback and still orders same-airport days correctly. */
  const depInstants = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of flights ?? []) {
      const [y, mo, d] = f.flight_date.split("-").map(Number);
      let t = Date.UTC(y, mo - 1, d, 12);
      if (f.departure_time) {
        const [h, mi] = f.departure_time.split(":").map(Number);
        t = Date.UTC(y, mo - 1, d, h, mi);
        const a = coords?.[f.origin];
        const zone = a ? zoneOf(a.lat, a.lon) : null;
        if (zone) t = wallToUtc(f.flight_date, f.departure_time, zone);
      }
      m.set(f.id, t);
    }
    return m;
  }, [flights, coords]);

  const durations = useMemo(() => {
    const m = new Map<string, { minutes: number; estimated: boolean } | null>();
    for (const f of flights ?? [])
      m.set(
        f.id,
        flightDuration(f, coords?.[f.origin] ?? null, coords?.[f.destination] ?? null)
      );
    return m;
  }, [flights, coords]);

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
          f.tail_number,
          f.aircraft,
          f.notes,
        ]
          .filter(Boolean)
          .some((v) => String(v).toUpperCase().includes(needle)) ||
        /* Registrations also match spelling-blind, the way the fleet panel
           groups them — a search for N37462 must find the flight logged as
           N-37462, or the panel's link undercounts the very airframe it
           names. */
        (f.tail_number != null &&
          normalizeTail(needle).length > 0 &&
          normalizeTail(f.tail_number).includes(normalizeTail(needle)))
      );
    }
    return list;
  }, [flights, year, statuses, purpose, q]);

  /* Every column sorts by the value its cells DISPLAY — the estimate where
     the cell shows an estimate, a dash sorting past everything real. Default
     is the ledger's native order, newest first. */
  type SortCol =
    | "date" | "flight" | "route" | "cabin" | "dist" | "time"
    | "award" | "pqp" | "pqf" | "gross" | "personal" | "cpm";
  const [sort, setSort] = useState<{ col: SortCol; desc: boolean }>({
    col: "date",
    desc: true,
  });
  const clickSort = (col: string) =>
    setSort((s) => ({
      col: col as SortCol,
      desc: s.col === col ? !s.desc : !["flight", "route", "cabin"].includes(col),
    }));
  const sorted = useMemo(() => {
    /* null means "the cell shows a dash" — and a dash sorts LAST whichever
       way the arrow points, because absence is not a small value */
    const val = (f: EnrichedSegment): string | number | null => {
      switch (sort.col) {
        case "date":
          return depInstants.get(f.id) ?? 0;
        case "flight":
          return f.marketing_carrier + (f.flight_number ?? "").padStart(4, "0");
        case "route":
          return f.origin + f.destination;
        case "cabin":
          return f.cabin;
        case "dist":
          return f.distance_miles;
        case "time":
          return durations.get(f.id)?.minutes ?? null;
        case "award":
          return expectsMileagePlusCredit(f)
            ? (f.award_miles ?? f.projected_award_miles ?? null)
            : null;
        case "pqp":
          return expectsMileagePlusCredit(f)
            ? (f.pqp ?? f.projected_pqp ?? null)
            : null;
        case "pqf":
          return expectsMileagePlusCredit(f)
            ? (f.pqf ?? f.projected_pqf ?? null)
            : null;
        case "gross":
          return f.gross_cost || f.estimated_gross || 0;
        case "personal":
          return f.personal_cost;
        case "cpm": {
          const milesSpent = f.award_miles_spent ?? 0;
          const fullCost = f.gross_cost + (milesSpent * mileValue) / 100;
          if (f.distance_miles && f.distance_miles > 0 && fullCost > 0)
            return (100 * fullCost) / f.distance_miles;
          if (f.estimated_gross != null && f.distance_miles && f.distance_miles > 0)
            return (100 * f.estimated_gross) / f.distance_miles;
          return null;
        }
      }
    };
    return [...filtered].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x == null || y == null) {
        if (x == null && y == null)
          return a.flight_date.localeCompare(b.flight_date);
        return x == null ? 1 : -1;
      }
      const cmp =
        typeof x === "string"
          ? x.localeCompare(y as string)
          : (x as number) - (y as number);
      return (sort.desc ? -cmp : cmp) || a.flight_date.localeCompare(b.flight_date);
    });
  }, [filtered, sort, mileValue, durations, depInstants]);

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
      /* Earn totals count only flights that credit to MileagePlus — the same
         gate the cells use, so a stray value on a non-crediting row can't
         show "—" in its cell yet still move the footer. */
      pqp: filtered.reduce(
        (a, f) => a + (expectsMileagePlusCredit(f) ? (f.pqp ?? 0) : 0),
        0
      ),
      pqf: filtered.reduce(
        (a, f) => a + (expectsMileagePlusCredit(f) ? (f.pqf ?? 0) : 0),
        0
      ),
      award: filtered.reduce(
        (a, f) => a + (expectsMileagePlusCredit(f) ? (f.award_miles ?? 0) : 0),
        0
      ),
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
      {dragging && !showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(6,11,22,0.72)] p-8 backdrop-blur-[2px]">
          <div className="pointer-events-none flex flex-col items-center rounded-lg border border-dashed border-s-miles bg-[var(--tint-accent)] px-16 py-14 text-center">
            <FileUp size={30} className="mb-3 text-s-miles" />
            <p className="t-display text-[20px] leading-none text-ink">
              Drop a CSV to import
            </p>
            <p className="mt-2 text-[12.5px] text-mute">
              MileagePlus My&nbsp;Activity, myFlightradar24 or Flighty export —
              the format is recognized automatically
            </p>
          </div>
        </div>
      )}
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
            placeholder="Search route, city, flight, tail…"
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
          <div className="ledger-scroll max-h-[calc(var(--vh-scaled)-240px)] overflow-auto">
            <table className="ledger">
              <thead>
                <tr>
                  <SortTh col="date" sort={sort} onSort={clickSort} num={false}>Date</SortTh>
                  <SortTh col="flight" sort={sort} onSort={clickSort} num={false}>Flight</SortTh>
                  <SortTh col="route" sort={sort} onSort={clickSort} num={false}>Route</SortTh>
                  <SortTh col="cabin" sort={sort} onSort={clickSort} num={false}>Cabin</SortTh>
                  <SortTh col="time" sort={sort} onSort={clickSort}>Time</SortTh>
                  <SortTh col="dist" sort={sort} onSort={clickSort}>Dist mi</SortTh>
                  <SortTh col="award" sort={sort} onSort={clickSort}>Award</SortTh>
                  <SortTh col="pqp" sort={sort} onSort={clickSort}>PQP</SortTh>
                  <SortTh col="pqf" sort={sort} onSort={clickSort}>PQF</SortTh>
                  <SortTh col="gross" sort={sort} onSort={clickSort}>Gross</SortTh>
                  <SortTh col="personal" sort={sort} onSort={clickSort}>Personal</SortTh>
                  <SortTh col="cpm" sort={sort} onSort={clickSort}>CPM</SortTh>
                </tr>
              </thead>
              <tbody>
                {sorted.map((f) => {
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
                        {/* City names live in the hover tooltip, not the row:
                            anyone scanning this table reads airport codes, and
                            the spelled-out cities were the widest thing in it. */}
                        <span
                          className="t-num text-ink"
                          title={
                            f.origin_city || f.destination_city
                              ? `${f.origin_city ?? f.origin} – ${f.destination_city ?? f.destination}`
                              : undefined
                          }
                        >
                          {f.origin} → {f.destination}
                        </span>
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
                      {/* gate-to-gate, from the clocks pinned to each
                          airport's zone; the ≈ distance model when a clock or
                          coordinate is missing */}
                      <td className="num text-ink2">
                        {(() => {
                          const t = durations.get(f.id);
                          if (!t) return "—";
                          return (
                            <span
                              className={t.estimated ? "text-mute" : undefined}
                              title={
                                t.estimated
                                  ? "Estimated from the distance — no usable clocks for this flight"
                                  : "Gate to gate from the scheduled clocks, each in its airport's timezone — not airborne time"
                              }
                            >
                              {t.estimated ? "≈" : ""}
                              {fmtDuration(t.minutes)}
                            </span>
                          );
                        })()}
                      </td>
                      {/* One column, two facts. The old Lifetime column was
                          this column's number again, or a label — on United
                          metal the estimate IS the distance until the 500-mile
                          minimum bites, and posted values only ever differed
                          as an award's zero. So the distance stays, and the
                          miles that count toward United lifetime status wear
                          the s-miles blue — the same voice the reimbursement
                          payer speaks in. Plain ink earns nothing there; the
                          tooltips say why. */}
                      <td className="num text-ink2">
                        {f.distance_miles == null ? (
                          "?"
                        ) : noEarnReason ? (
                          <span
                            title={`Earns no United lifetime miles — ${
                              noEarnReason === "Non-United"
                                ? "flown on another airline's metal."
                                : noEarnReason === "Award"
                                  ? "an award ticket, redeemed with miles."
                                  : "United metal, but this ticket credits another programme."
                            }`}
                          >
                            {fmtInt(f.distance_miles)}
                          </span>
                        ) : f.lifetime_miles != null &&
                          f.lifetime_miles !== Math.round(f.distance_miles) ? (
                          <span
                            className="text-s-miles"
                            title={`Counts toward United lifetime status — United posted ${fmtInt(f.lifetime_miles)} lifetime miles for this flight`}
                          >
                            {fmtInt(f.distance_miles)}
                          </span>
                        ) : f.lifetime_miles == null &&
                          estimatedLifetimeMiles(f) > f.distance_miles ? (
                          <span
                            className="text-s-miles"
                            title={`Counts toward United lifetime status — credits at United's ${fmtInt(MINIMUM_CREDITED_MILES)}-mile segment minimum, ≈${fmtInt(estimatedLifetimeMiles(f))} lifetime miles expected`}
                          >
                            {fmtInt(f.distance_miles)}
                          </span>
                        ) : (
                          <span
                            className="text-s-miles"
                            title="Counts toward United lifetime status"
                          >
                            {fmtInt(f.distance_miles)}
                          </span>
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
                        ) : !credits ? (
                          /* A non-crediting flight has no MileagePlus earning
                             to report, so all three earn cells dash — even
                             over a stray recorded 0, which otherwise reads as
                             "posted and earned nothing" on a flight that was
                             never in the program. */
                          "—"
                        ) : f.award_miles != null ? (
                          fmtInt(f.award_miles)
                        ) : f.projected_award_miles != null ? (
                          <Proj v={fmtInt(f.projected_award_miles)} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={`num ${earn}`}>
                        {!credits ? (
                          "—"
                        ) : f.pqp != null ? (
                          fmtInt(f.pqp)
                        ) : f.projected_pqp != null ? (
                          <Proj v={fmtInt(f.projected_pqp)} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={`num ${earn}`}>
                        {!credits ? (
                          "—"
                        ) : f.pqf != null ? (
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
                            {f.award_miles_estimated ? "*" : ""}
                            {(milesSpent / 1000).toFixed(1)}k
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
                              {/* Marker in front, like ≈ on estimates: a
                                  trailing star ragged the right-aligned
                                  column's edge. */}
                              <span className="text-mute">*</span>
                              {fmtCpm(cpm)}
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
                  {(() => {
                    let min = 0;
                    let est = false;
                    let covered = 0;
                    let flown = 0;
                    for (const f of filtered) {
                      if (f.status !== "flown_unreconciled" && f.status !== "flown_reconciled")
                        continue;
                      flown++;
                      const t = durations.get(f.id);
                      if (!t) continue;
                      covered++;
                      min += t.minutes;
                      if (t.estimated) est = true;
                    }
                    return (
                      <td
                        className="num"
                        title={`Gate-to-gate time of the flown flights on screen — scheduled blocks, not airborne; ${covered} of ${flown} carry a figure`}
                      >
                        {min > 0 ? `${est || covered < flown ? "≈" : ""}${fmtDuration(min)}` : "—"}
                      </td>
                    );
                  })()}
                  <td
                    className="num"
                    title={`≈${fmtInt(totals.lifetimeEst)} of these miles count toward United lifetime status (posted so far: ${fmtInt(totals.lifetime)}); the blue distances are the ones that count`}
                  >
                    {fmtInt(totals.dist)}
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
        <ImportModal
          context="flights"
          initialFile={dropped}
          onClose={() => {
            setShowImport(false);
            setDropped(null);
          }}
          onApplied={refresh}
        />
      )}
    </div>
  );
}
