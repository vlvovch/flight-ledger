"use client";

import { useEffect, useMemo, useState } from "react";
import type { Analytics, CashFlow, CashMonth } from "@/lib/metrics";
import type { FareClassRow, MixBucket, TravelMix } from "@/lib/mix";
import { flightCpmSpread, summarizeFareClasses, summarizeMix } from "@/lib/mix";
import type { EnrichedSegment } from "@/lib/types";
import { api, fmtCpm, fmtInt, fmtMoney, fmtMonth } from "@/lib/format";
import { rollupCashYears, rollupYears } from "@/lib/metrics";
import { EmptyState, MilesBasisToggle, Panel } from "@/components/ui";
import AnnualReport from "@/components/AnnualReport";
import FlightMap from "@/components/FlightMap";
import { buildMapData, type MapAirportInfo } from "@/lib/map";
import {
  RangeControl,
  filterByRange,
  windowLabelFor,
  type Range,
} from "@/components/RangeControl";

/* The same series tokens charts.tsx exports as C, inlined rather than
   imported: pulling anything from charts.tsx drags Recharts into a page that
   draws no charts. The names match so the panels moved here verbatim. */
const C = {
  miles: "var(--color-s-miles)",
  gross: "var(--color-s-gross)",
  pqp: "var(--color-s-pqp)",
  award: "var(--color-s-award)",
};

/**
 * The analysis tables, on their own page.
 *
 * They lived on the dashboard first, which by then was two pages wearing one
 * URL: an operations view checked weekly, and these — tables you visit with a
 * question. The split is by tempo, not importance. Everything here follows one
 * range control, exactly as the dashboard's instruments follow theirs.
 */
export default function AnalysisPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [flights, setFlights] = useState<EnrichedSegment[]>([]);
  const [range, setRange] = useState<Range>("24");
  /* The ledger's miles column answers one of two different questions — how far
     did I go, and how much of it counted toward Million Miler. They diverge on
     award tickets and other airlines' metal, so one column can't serve both. */
  const [ledgerMiles, setLedgerMiles] = useState<"flown" | "lifetime">("flown");
  const [reportOpen, setReportOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Analytics>("/api/analytics")
      .then(setData)
      .catch((e) => setError(e.message));
    api<{ flights: EnrichedSegment[] }>("/api/flights")
      .then((r) => setFlights(r.flights))
      .catch((e) => setError(e.message));
  }, []);

  /* Coordinates only for airports the ledger touches — a couple dozen rows,
     not the 8,800-airport dataset. Null until they arrive, so the map never
     renders a frame where every route reads as unplaceable. */
  const [coords, setCoords] = useState<Record<string, MapAirportInfo> | null>(null);
  useEffect(() => {
    if (!flights.length) return;
    const codes = [...new Set(flights.flatMap((f) => [f.origin, f.destination]))];
    api<{ airports: Record<string, MapAirportInfo> }>(
      `/api/airports?codes=${codes.join(",")}`
    )
      .then((r) => setCoords(r.airports))
      .catch(() => {});
  }, [flights]);

  const years = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.monthly.map((m) => m.month.slice(0, 4)))].sort().reverse();
  }, [data]);

  /* At ALL the series spans every year the ledger knows — decades, once a
     flight diary lands — so both tables step up to year rows. Every ratio
     is re-derived from summed bases inside the rollup, not averaged. */
  const yearly = range === "all";
  const monthly = useMemo(() => {
    if (!data) return [];
    const rows = filterByRange(data.monthly, range);
    return yearly ? rollupYears(rows) : rows;
  }, [data, range, yearly]);

  /* The flights inside the window on screen. Its first month comes from the
     already-filtered monthly series — the same construction the dashboard
     uses, so the two pages cannot disagree about where a window starts. */
  const windowFlights = useMemo(() => {
    if (range === "all") return flights;
    if (range.startsWith("y")) {
      const y = range.slice(1);
      return flights.filter((f) => f.flight_date.startsWith(y));
    }
    const first = monthly[0]?.month;
    return first ? flights.filter((f) => f.flight_date.slice(0, 7) >= first) : flights;
  }, [flights, range, monthly]);

  /* Cash months are their own timeline — it starts at the first purchase, not
     the first flight — so they are filtered on their own months rather than
     sliced to the flown ones. */
  const cashMonths = useMemo(
    () => {
      if (!data) return [];
      const rows = filterByRange(data.cashFlow.months, range);
      return yearly ? rollupCashYears(rows) : rows;
    },
    [data, range, yearly]
  );

  const mix = useMemo(() => summarizeMix(windowFlights), [windowFlights]);
  const mapData = useMemo(
    () => (coords ? buildMapData(windowFlights, coords) : null),
    [windowFlights, coords]
  );
  const spread = useMemo(() => flightCpmSpread(windowFlights), [windowFlights]);
  /* Unlimited here; the panel cuts to ten and SAYS it did. Splitting classes
     per airline means more rows than before, and a silent top-10 would read
     as "these are all of them". */
  const fareClasses = useMemo(
    () => summarizeFareClasses(windowFlights, Infinity),
    [windowFlights]
  );

  if (error)
    return (
      <Panel label="Error" className="mt-8 p-6">
        <p className="text-critical">{error}</p>
      </Panel>
    );
  if (!data) return <div className="t-label p-8">Loading…</div>;

  const { currency } = data;
  const windowLabel = windowLabelFor(range);
  const monthlyDesc = [...monthly].reverse();
  /* The total row sums the months ON SCREEN, rather than reporting this
     year's YTD under a table of other years. The CPM columns are ratios, so
     they are recomputed over the window's own basis — averaging the monthly
     percentages would weight a one-flight month equally with a ten-flight
     one. */
  const windowTotal = monthly.reduce(
    (a, m) => ({
      flights: a.flights + m.flights,
      distance: a.distance + m.distance,
      lifetimeEst: a.lifetimeEst + m.lifetimeEst,
      pqp: a.pqp + m.pqp,
      pqf: a.pqf + m.pqf,
      award: a.award + m.award,
      gross: a.gross + m.gross,
      personal: a.personal + m.personal,
      cpmMiles: a.cpmMiles + m.cpmMiles,
      cpmGross: a.cpmGross + m.cpmGross,
      cpmPersonal: a.cpmPersonal + m.cpmPersonal,
    }),
    { flights: 0, distance: 0, lifetimeEst: 0, pqp: 0, pqf: 0, award: 0, gross: 0, personal: 0,
      cpmMiles: 0, cpmGross: 0, cpmPersonal: 0 }
  );
  const hasData = flights.length > 0 || data.cashFlow.months.length > 0;

  return (
    <div className="mx-auto max-w-[1440px]">
      <header className="reveal mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="t-label mb-1 text-s-miles">Where the money and miles went</div>
          <h1 className="t-display text-[30px] leading-none text-ink">Analysis</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* A printable year is a year you can hand to someone. The button
              only appears once a single year is on screen — a rolling window
              is a view, not a document — and it opens the report OVER the
              page: its third shape, after a page navigation and a new tab
              each read as losing your place. */}
          {range.startsWith("y") && (
            <button className="btn btn-ghost" onClick={() => setReportOpen(true)}>
              Printable report
            </button>
          )}
          <RangeControl range={range} years={years} onChange={setRange} />
        </div>
      </header>

      {!hasData ? (
        <EmptyState
          title="Nothing to analyze yet"
          body="Log or import some flights and tickets first — every table here is computed from them."
        />
      ) : (
        <>
          {/* The map leads the page — the one panel that orients before the
              tables answer. It follows the same range control as everything
              beneath it, so the picture and the numbers describe one window. */}
          {mapData && mapData.flights > 0 && (
            <Panel
              label="Map"
              accent={C.miles}
              className="mt-3 reveal"
              right={
                <span className="t-label !text-[10px] text-mute">{windowLabel}</span>
              }
            >
              <div className="px-4 pt-2 pb-3">
                <FlightMap data={mapData} />
              </div>
            </Panel>
          )}

          {/* monthly ledger */}
          <Panel
            label={yearly ? "Yearly ledger" : "Monthly ledger"}
            accent={C.miles}
            className="mt-3 reveal"
            /* The chip mirrors the money view's "paid, not flown" — the two
               accounting views sit adjacent here precisely so the contrast
               can be read off their headers. */
            right={
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="t-label !text-[10px] text-mute"
                  title="Costs sit in the month you flew, whatever day the ticket was bought or repaid. The money view below is the other way round."
                >
                  {windowLabel} · flown, not paid
                </span>
                <MilesBasisToggle value={ledgerMiles} onChange={setLedgerMiles} />
              </div>
            }
          >
            <div className="overflow-x-auto px-1 pb-1 pt-1">
              {/* Fixed layout, because one header changes with the toggle:
                  "Miles" and "United lifetime" are different widths, so an
                  auto-laid-out table re-measured every column on each switch
                  and the whole row shifted under the pointer. The widths are
                  declared once here and the header text no longer decides
                  them. The miles column is sized for the longer of the two
                  labels so neither has to wrap. */}
              <table className="ledger w-full table-fixed">
                <colgroup>
                  <col className="w-[15%]" />
                  <col className="w-[8%]" />
                  <col className="w-[13%]" />
                  <col className="w-[8%]" />
                  <col className="w-[6%]" />
                  <col className="w-[10%]" />
                  <col className="w-[11%]" />
                  <col className="w-[11%]" />
                  <col className="w-[9%]" />
                  <col className="w-[9%]" />
                </colgroup>
                <thead>
                  <tr>
                    <th>{yearly ? "Year" : "Month"}</th>
                    <th className="!text-right">Flights</th>
                    <th className="!text-right">
                      {ledgerMiles === "flown" ? "Miles" : "United lifetime"}
                    </th>
                    <th className="!text-right">PQP</th>
                    <th className="!text-right">PQF</th>
                    <th className="!text-right">Award</th>
                    <th className="!text-right">Gross</th>
                    <th className="!text-right">Personal</th>
                    <th
                      className="!text-right"
                      title="Total cost per mile flown, over every costed, lifetime-earning mile."
                    >
                      Gross CPM
                    </th>
                    <th
                      className="!text-right"
                      title="Your out-of-pocket cost over the SAME miles — reimbursed flying included, which is what makes a heavily-reimbursed month read cheap. The gap to Gross is what someone else paid per mile. For what personally-paid travel itself costs, see the travel mix's Personal slice."
                    >
                      Pers. CPM
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyDesc.map((m) => (
                    <tr key={m.month}>
                      <td className="t-num text-ink2">
                        {fmtMonth(m.month, "long")}
                        {m.upcomingFlights > 0 && (
                          <span className="ml-2 text-[10px] uppercase tracking-wider text-s-miles">
                            {m.upcomingFlights} booked
                          </span>
                        )}
                      </td>
                      <td className="num">{m.flights || "·"}</td>
                      <td className="num">
                        {m.flights
                          ? fmtInt(ledgerMiles === "flown" ? m.distance : m.lifetimeEst)
                          : "·"}
                      </td>
                      <td className="num">{m.pqp ? fmtInt(m.pqp) : "·"}</td>
                      <td className="num">{m.pqf || "·"}</td>
                      <td className="num">{m.award ? fmtInt(m.award) : "·"}</td>
                      <td className="num">{m.gross ? fmtMoney(m.gross, currency) : "·"}</td>
                      <td className="num">
                        {m.gross || m.personal ? fmtMoney(m.personal, currency) : "·"}
                      </td>
                      <td className="num">{fmtCpm(m.grossCpm)}</td>
                      <td className="num">{fmtCpm(m.personalCpm)}</td>
                    </tr>
                  ))}
                </tbody>
                {monthlyDesc.length > 0 && (
                  <tfoot>
                    <tr>
                      <td className="t-num">{windowLabel}</td>
                      <td className="num">{windowTotal.flights}</td>
                      <td className="num">
                        {fmtInt(
                          ledgerMiles === "flown"
                            ? windowTotal.distance
                            : windowTotal.lifetimeEst
                        )}
                      </td>
                      <td className="num">{fmtInt(windowTotal.pqp)}</td>
                      <td className="num">{windowTotal.pqf}</td>
                      <td className="num">{fmtInt(windowTotal.award)}</td>
                      <td className="num">{fmtMoney(windowTotal.gross, currency)}</td>
                      <td className="num">{fmtMoney(windowTotal.personal, currency)}</td>
                      <td className="num">
                        {fmtCpm(
                          windowTotal.cpmMiles > 0
                            ? (100 * windowTotal.cpmGross) / windowTotal.cpmMiles
                            : null
                        )}
                      </td>
                      <td className="num">
                        {fmtCpm(
                          windowTotal.cpmMiles > 0
                            ? (100 * windowTotal.cpmPersonal) / windowTotal.cpmMiles
                            : null
                        )}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
              {/* The averages above are weighted by miles, so long-haul
                  outvotes everything. This line is one vote per flight — the
                  answer to "what does a TYPICAL flight cost me", and the
                  spread the average erases. Plain words, no percentile
                  vocabulary. */}
              {spread && (
                <p className="px-3 pb-2 pt-1 text-[11px] text-mute">
                  Per flight: half of your {spread.flights} cash flights cost
                  under{" "}
                  <span className="t-num text-ink2">{fmtCpm(spread.median)}</span>{" "}
                  a mile — cheapest tenth under{" "}
                  <span className="t-num">{fmtCpm(spread.p10)}</span>, dearest
                  over <span className="t-num">{fmtCpm(spread.p90)}</span>.
                </p>
              )}
            </div>
          </Panel>

          <CashFlowPanel
            flow={data.cashFlow}
            months={cashMonths}
            windowLabel={windowLabel}
            currency={currency}
            yearly={yearly}
          />
          <TravelMixPanel mix={mix} windowLabel={windowLabel} />
          <FareClassPanel
            rows={fareClasses}
            windowLabel={windowLabel}
            currency={currency}
          />
        </>
      )}
      {reportOpen && range.startsWith("y") && data && (
        <AnnualReport
          year={range.slice(1)}
          data={data}
          flights={flights}
          onClose={() => setReportOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Cash-flow accounting: money in the month it moved (§7.3).
 *
 * Deliberately its own panel rather than a column on the monthly ledger. The
 * design doc's rule is that the travel-period and cash-flow views must never
 * be mixed silently, and two money columns in one table reading different
 * dates is exactly that mixture — the label is what keeps them apart.
 */
function CashFlowPanel({
  flow,
  months,
  windowLabel,
  currency,
  yearly,
}: {
  flow: CashFlow;
  months: CashMonth[];
  windowLabel: string;
  currency: string;
  yearly: boolean;
}) {
  if (flow.months.length === 0) return null;
  const shown = [...months].reverse();
  const total = months.reduce(
    (a, m) => ({
      out: a.out + m.out,
      in: a.in + m.in,
      inAssumed: a.inAssumed + m.inAssumed,
    }),
    { out: 0, in: 0, inAssumed: 0 }
  );
  const money = (n: number) => fmtMoney(n, currency, { cents: false });
  return (
    <Panel
      /* "Cash flow" after all. A jargon pass renamed this "Money out and back"
         to match the columns, and the cure read worse than the disease —
         "cash flow" is household vocabulary, and the plain words belong in the
         notice and tooltips, not contorted into a title. */
      label="Cash flow"
      accent={C.gross}
      className="mt-3 reveal"
      right={
        <span
          className="t-label !text-[10px] text-mute"
          title="Everything else on this dashboard counts money in the month you flew. This panel counts it in the month it moved — tickets on the day you bought them, refunds and reimbursements on the day the money came back. The two views are kept apart on purpose, so neither can quietly borrow the other's dates."
        >
          {windowLabel} · paid, not flown
        </span>
      }
    >
      {/* What was assumed is stated above the table, not hidden under it — the
          ≈ on the rows below needs its explanation in plain sight, and on a
          ledger where no reimbursement carries a date this is most of the
          Back column.

          Plain words only: this is read by the person whose money it is. */}
      {(flow.assumedIn.count > 0 ||
        flow.undatedIn.count > 0 ||
        flow.undatedOut.count > 0) && (
        <p className="mx-4 mb-2 rounded-md border border-[color-mix(in_oklab,var(--color-warning)_40%,transparent)] bg-[var(--tint-warning,transparent)] px-3 py-2 text-[11.5px] text-mute">
          {flow.assumedIn.count > 0 && (
            <>
              <span className="text-ink">
                You were paid back {money(flow.assumedIn.amount)}
              </span>{" "}
              in {flow.assumedIn.count} payment
              {flow.assumedIn.count === 1 ? "" : "s"} with no date saved, shown
              in the month the ticket was bought and marked ≈. Add dates on the
              Tickets page to place them exactly.
            </>
          )}
          {flow.undatedIn.count > 0 && (
            <>
              {" "}
              {money(flow.undatedIn.amount)} more can&rsquo;t be shown at all —
              neither it nor its ticket has a date.
            </>
          )}
          {flow.undatedOut.count > 0 && (
            <>
              {" "}
              Tickets worth {money(flow.undatedOut.amount)} have no purchase
              date, so they aren&rsquo;t shown.
            </>
          )}
        </p>
      )}
      <div className="overflow-x-auto px-1 pb-1 pt-1">
        <table className="ledger w-full table-fixed">
          <colgroup>
            <col className="w-[22%]" />
            <col className="w-[19.5%]" />
            <col className="w-[19.5%]" />
            <col className="w-[19.5%]" />
            <col className="w-[19.5%]" />
          </colgroup>
          <thead>
            <tr>
              <th>{yearly ? "Year paid" : "Month paid"}</th>
              <th className="!text-right">Out</th>
              <th className="!text-right">Back</th>
              <th className="!text-right">Net</th>
              <th className="!text-right">Running total</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.month}>
                <td className="t-num">
                  {fmtMonth(m.month)}
                  {/* A real space, not just `ml-2` — otherwise the cell reads
                      as "Jul ’261 ticket" to anything consuming the text. */}
                  {m.tickets > 0 && " "}
                  {m.tickets > 0 && (
                    <span className="ml-2 text-[10.5px] text-mute">
                      {m.tickets} ticket{m.tickets === 1 ? "" : "s"}
                    </span>
                  )}
                </td>
                <td className="num">{m.out === 0 ? "·" : money(m.out)}</td>
                {/* ≈ is the app's estimate marker doing its usual job: part of
                    this month's Back sits here by assumption, not by record. */}
                <td
                  className="num"
                  title={
                    m.inAssumed > 0
                      ? `${money(m.inAssumed)} of this is a guess: the ticket was bought this month, and the payment itself has no date saved.`
                      : undefined
                  }
                >
                  {m.in === 0 ? "·" : `${m.inAssumed > 0 ? "≈" : ""}${money(m.in)}`}
                </td>
                <td className="num">
                  {m.net === 0 ? "·" : `${m.inAssumed > 0 ? "≈" : ""}${money(m.net)}`}
                </td>
                <td className="num text-mute">{money(m.cumulative)}</td>
              </tr>
            ))}
          </tbody>
          {months.length > 0 && (
            <tfoot>
              <tr>
                <td>{windowLabel}</td>
                <td className="num">{money(total.out)}</td>
                <td className="num">
                  {`${total.inAssumed > 0 ? "≈" : ""}${money(total.in)}`}
                </td>
                <td className="num">
                  {`${total.inAssumed > 0 ? "≈" : ""}${money(total.out - total.in)}`}
                </td>
                <td className="num">·</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Panel>
  );
}

/**
 * What each booking class costs, and how efficiently it buys status.
 *
 * Ordered by how much each was flown, never ranked. This ledger files PZ for
 * both a domestic First recliner and a lie-flat Polaris seat, so the code
 * cannot carry a hierarchy even within one airline, and the IATA cabin tier
 * doesn't rescue it — the airline files it that way.
 *
 * $/PQP is the column worth reading. United's PQP is revenue-based, so this is
 * literally what a dollar of that fare bought in status.
 */
function FareClassPanel({
  rows,
  windowLabel,
  currency,
}: {
  rows: FareClassRow[];
  windowLabel: string;
  currency: string;
}) {
  /* Splitting classes per airline pushed every partner fare below the
     top-ten cut — separated but invisible is not separated. The cut stays,
     and the footnote opens it. */
  const [showAll, setShowAll] = useState(false);
  if (rows.length === 0) return null;
  const SHOWN = 10;
  const shown = showAll ? rows : rows.slice(0, SHOWN);
  return (
    <Panel
      label="Fare classes"
      accent={C.pqp}
      className="mt-3 reveal"
      right={<span className="t-label !text-[10px] text-mute">{windowLabel}</span>}
    >
      <div className="overflow-x-auto px-1 pb-1 pt-1">
        <table className="ledger w-full table-fixed">
          <colgroup>
            <col className="w-[10%]" />
            <col className="w-[24%]" />
            <col className="w-[10%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
            <col className="w-[14%]" />
          </colgroup>
          <thead>
            <tr>
              <th title="The booking class as the airline wrote it. Each airline's letters are its own — L on United and L on Lufthansa are different fares — so classes are listed per airline, and rows without a tag are United's.">
                Class
              </th>
              <th>Cabin</th>
              <th className="!text-right">Flights</th>
              <th className="!text-right">Miles</th>
              <th className="!text-right">Gross</th>
              <th className="!text-right">¢/mi</th>
              <th
                className="!text-right"
                title="Dollars of fare per Premier qualifying point. United's PQP is revenue-based, so this is what a dollar of this fare actually bought in status — lower is better. Award bookings are excluded from both the cost and the PQP behind it, or points nobody paid for would make the class look free."
              >
                $/PQP
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const allAward = r.awardFlights === r.flights;
              return (
                <tr key={`${r.carrier}:${r.code}`}>
                  {/* Bare letter = United, the ledger's home airline; any other
                      fare names its airline — the Premier breakdown's own
                      convention ("Partner flights · LX"). The space is real,
                      not margin, for anything consuming the text. */}
                  <td className="t-num text-ink">
                    {r.code === "" ? (
                      <span
                        className="text-mute"
                        title="No booking class recorded — open the flight to add it."
                      >
                        —
                      </span>
                    ) : (
                      r.code
                    )}
                    {r.carrier !== "UA" && " "}
                    {r.carrier !== "UA" && (
                      <span className="text-[10.5px] text-mute">{r.carrier}</span>
                    )}
                  </td>
                  <td className="truncate text-mute" title={r.cabins.join(" · ")}>
                    {r.cabins.join(" · ") || "—"}
                    {/* Marked from the recorded award signature, never from the
                        letters: XN is an award fare and PZ is not, and nothing
                        in the codes says which. The space is real, not margin —
                        `ml-1.5` alone renders correctly but reads as one word
                        ("Economyaward") to anything consuming the text. */}
                    {r.awardFlights > 0 && " "}
                    {r.awardFlights > 0 && (
                      <span
                        className="ml-1.5 text-[10px] text-s-award"
                        title={
                          allAward
                            ? "Every flight in this class was an award booking."
                            : `${r.awardFlights} of ${r.flights} were award bookings.`
                        }
                      >
                        award{allAward ? "" : ` ${r.awardFlights}/${r.flights}`}
                      </span>
                    )}
                  </td>
                  <td className="num">{r.flights}</td>
                  <td className="num">{fmtInt(r.miles)}</td>
                  <td className="num">{fmtMoney(r.gross, currency, { cents: false })}</td>
                  <td
                    className="num"
                    title={
                      r.cashFlights === 0
                        ? "Nothing in this class was paid for in cash."
                        : `Over ${r.cashFlights} of ${r.flights} flights · ${fmtInt(r.cashMiles)} mi.`
                    }
                  >
                    {fmtCpm(r.grossCpm)}
                  </td>
                  <td
                    className="num"
                    title={
                      r.costPerPqp == null
                        ? "No cash fare and posted PQP on the same flight in this class."
                        : `${fmtMoney(r.gross, currency)} over ${fmtInt(r.cashPqp)} PQP${r.pqp !== r.cashPqp ? ` (${fmtInt(r.pqp)} PQP including award bookings, which this excludes)` : ""}.`
                    }
                  >
                    {r.costPerPqp == null ? "—" : `$${r.costPerPqp.toFixed(2)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > SHOWN && (
          <button
            className="px-3 pb-2 pt-1 text-[11px] text-mute transition-colors hover:text-ink2"
            onClick={() => setShowAll(!showAll)}
          >
            {showAll
              ? `Back to the top ${SHOWN}`
              : `Top ${SHOWN} of ${rows.length} fare classes, by flights flown — show all`}
          </button>
        )}
      </div>
    </Panel>
  );
}

/**
 * What the flying is made of — three ways of cutting the same segments.
 *
 * Each dimension partitions the whole, so the three mile totals agree; only
 * the lines through them differ. Each slice states its own gross CPM, since
 * "half my flying is covered" and "the covered half costs more per mile" are
 * different findings and the second is the one that changes behaviour.
 */
function TravelMixPanel({
  mix,
  windowLabel,
}: {
  mix: TravelMix;
  windowLabel: string;
}) {
  const dims: { title: string; note: string; buckets: MixBucket[] }[] = [
    {
      title: "Purpose",
      note: "Business is what you marked, or a ticket someone reimbursed.",
      buckets: mix.purpose,
    },
    {
      title: "Metal",
      note: "Who operated it — only United metal earns lifetime miles.",
      buckets: mix.carrier,
    },
    {
      title: "Reach",
      note: "International is any segment leaving the origin's country.",
      buckets: mix.geography,
    },
  ];
  const totalFlights = mix.carrier.reduce((a, b) => a + b.flights, 0);
  if (totalFlights === 0) return null;

  return (
    <Panel
      label="Travel mix"
      accent={C.award}
      className="mt-3 reveal"
      /* States the window, because this panel follows the range control and a
         share is meaningless without the period it is a share of. */
      right={<span className="t-label !text-[10px] text-mute">{windowLabel}</span>}
    >
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 px-4 pt-1 pb-4 sm:grid-cols-2 lg:grid-cols-4">
        {dims.map((d) => (
          <div key={d.title}>
            <div className="t-label !text-[10px] mb-2" title={d.note}>
              {d.title}
            </div>
            {/* Empty slices are dropped: on a ledger that never left the
                country, a "0 flights" international row is a line of nothing
                where the next dimension could be. The share still reads
                correctly, because it is a share of what was flown. */}
            {d.buckets
              .filter((b) => b.flights > 0)
              .map((b) => (
                <div key={b.key} className="mb-2.5 last:mb-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[12.5px] text-ink">{b.label}</span>
                    <span className="t-num ml-auto text-[12.5px] text-ink">
                      {Math.round(b.share * 100)}%
                    </span>
                  </div>
                  <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-well">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(2, Math.round(b.share * 100))}%`,
                        background: C.award,
                      }}
                    />
                  </div>
                  <div
                    className="mt-1 flex items-baseline gap-2 text-[11px] text-mute"
                    title={
                      b.cpmFlights === 0
                        ? "No flight in this slice was paid for in cash, so there is no cost per mile to report."
                        : `${fmtCpm(b.grossCpm)} over ${b.cpmFlights} of ${b.flights} flights · ${fmtInt(b.cpmMiles)} mi — the ones with a recorded cost that were paid in cash. Award travel is left out: a few dollars of tax over a long flight would read as almost free. This is a wider basis than the dashboard's headline CPM, which also requires lifetime-mile credit and so can never price another airline's metal.`
                    }
                  >
                    <span>
                      {b.flights}× · {fmtInt(b.miles)} mi
                    </span>
                    <span className="ml-auto">{fmtCpm(b.grossCpm)}</span>
                  </div>
                </div>
              ))}
          </div>
        ))}
        <div>
          <div
            className="t-label !text-[10px] mb-2"
            title="Airports counted once per flight that touched them, so a connection counts at both ends."
          >
            Airports
          </div>
          {mix.airports.map((a) => (
            <div
              key={a.code}
              className="flex items-baseline gap-2 border-b border-[color-mix(in_oklab,var(--color-line)_55%,transparent)] py-1 text-[12px] last:border-0"
            >
              <span className="t-num text-ink">{a.code}</span>
              <span className="ml-auto text-[11px] text-mute">{a.flights}×</span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

