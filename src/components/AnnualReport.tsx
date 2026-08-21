"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import type { Analytics } from "@/lib/metrics";
import {
  flightCpmSpread,
  summarizeFareClasses,
  summarizeMix,
  summarizeRoutes,
} from "@/lib/mix";
import type { RouteSummary } from "@/lib/mix";
import { buildPremierYears } from "@/lib/premier";
import type { ActivityRecord, EnrichedSegment } from "@/lib/types";
import { api, fmtCpm, fmtDate, fmtInt, fmtMoney } from "@/lib/format";
import FlightMap from "./FlightMap";
import { buildMapData, type MapAirportInfo } from "@/lib/map";

/**
 * The annual travel report (design doc §20), as an overlay on Analysis.
 *
 * Its third shape, each on user feedback: first a page (navigating away lost
 * your place), then a new tab (a second window for one click), now a pop-up —
 * you stay where you are and the document comes to you. It renders through a
 * portal to <body> so the print rules can drop everything that is not the
 * report without fighting the page's own tree.
 *
 * Deliberately not a PDF library: the stack is offline-first with bundled
 * fonts, and the browser's own Print → Save as PDF is a better renderer than
 * anything worth vendoring. On screen the report wears the app's theme; light
 * is forced only while the print dialog is open — light text on dark panels
 * prints as nothing on white paper.
 */
export default function AnnualReport({
  year,
  data,
  flights,
  onClose,
}: {
  year: string;
  data: Analytics;
  flights: EnrichedSegment[];
  onClose: () => void;
}) {
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  useEffect(() => {
    api<{ activities: ActivityRecord[] }>("/api/activity")
      .then((r) => setActivities(r.activities))
      .catch(() => {});
  }, []);

  /* Modal manners, borrowed from ui.tsx: Escape closes, the page behind
     doesn't scroll. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  /* Light only while PRINTING, restored when the dialog closes. beforeprint
     fires for window.print() and Cmd+P alike. */
  useEffect(() => {
    let prev: string | undefined;
    const toLight = () => {
      prev = document.documentElement.dataset.theme;
      document.documentElement.dataset.theme = "light";
    };
    const restore = () => {
      if (prev) document.documentElement.dataset.theme = prev;
      else delete document.documentElement.dataset.theme;
    };
    window.addEventListener("beforeprint", toLight);
    window.addEventListener("afterprint", restore);
    return () => {
      window.removeEventListener("beforeprint", toLight);
      window.removeEventListener("afterprint", restore);
    };
  }, []);

  const yearFlights = useMemo(
    () => flights.filter((f) => f.flight_date.startsWith(year)),
    [flights, year]
  );
  const [coords, setCoords] = useState<Record<string, MapAirportInfo> | null>(null);
  useEffect(() => {
    const codes = [...new Set(yearFlights.flatMap((f) => [f.origin, f.destination]))];
    if (!codes.length) return;
    api<{ airports: Record<string, MapAirportInfo> }>(
      `/api/airports?codes=${codes.join(",")}`
    )
      .then((r) => setCoords(r.airports))
      .catch(() => {});
  }, [yearFlights]);
  const mapData = useMemo(
    () => (coords ? buildMapData(yearFlights, coords) : null),
    [yearFlights, coords]
  );
  const mix = useMemo(() => summarizeMix(yearFlights), [yearFlights]);
  const routes = useMemo(() => summarizeRoutes(yearFlights, 8), [yearFlights]);
  const fares = useMemo(
    () => summarizeFareClasses(yearFlights, Infinity).slice(0, 6),
    [yearFlights]
  );
  const spread = useMemo(() => flightCpmSpread(yearFlights), [yearFlights]);
  const premier = useMemo(() => {
    if (yearFlights.length === 0 && activities.length === 0) return null;
    return (
      buildPremierYears(
        yearFlights,
        activities.filter((a) => a.activity_date.startsWith(year))
      ).find((y) => y.year === year) ?? null
    );
  }, [yearFlights, activities, year]);

  const { currency } = data;
  const months = data.monthly.filter((m) => m.month.startsWith(year));
  const sum = (f: (m: (typeof months)[number]) => number) =>
    months.reduce((a, m) => a + f(m), 0);
  const totals = {
    flights: sum((m) => m.flights),
    miles: Math.round(sum((m) => m.distance)),
    lifetimeEst: Math.round(sum((m) => m.lifetimeEst)),
    pqp: Math.round(sum((m) => m.pqp)),
    pqf: sum((m) => m.pqf),
    award: sum((m) => m.award),
    gross: sum((m) => m.gross),
    personal: sum((m) => m.personal),
    cpmMiles: sum((m) => m.cpmMiles),
    cpmGross: sum((m) => m.cpmGross),
  };
  const cash = data.cashFlow.months.filter((m) => m.month.startsWith(year));
  const cashTotals = {
    out: cash.reduce((a, m) => a + m.out, 0),
    in: cash.reduce((a, m) => a + m.in, 0),
    assumed: cash.reduce((a, m) => a + m.inAssumed, 0),
  };
  const money = (n: number) => fmtMoney(n, currency, { cents: false });
  const monthName = (m: string) =>
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
      Number(m.slice(5, 7)) - 1
    ];
  const active = months.filter((m) => m.flights > 0);

  const body =
    totals.flights === 0 ? (
      <>
        <h1 className="t-display text-[26px] text-ink">No flying in {year}</h1>
        <p className="mt-2 text-[13px] text-mute">
          The ledger holds no flown flights in this year, so there is nothing to
          report.
        </p>
      </>
    ) : (
      <>
        {/* headline */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {(
            [
              ["Flights", fmtInt(totals.flights)],
              ["Miles flown", fmtInt(totals.miles)],
              ["United lifetime", `≈${fmtInt(totals.lifetimeEst)}`],
              ["Award miles", fmtInt(totals.award)],
              ["Spent", money(totals.gross)],
              ["Your own money", money(totals.personal)],
              ["PQP / PQF", `${fmtInt(totals.pqp)} / ${totals.pqf}`],
              [
                "Cost per mile",
                totals.cpmMiles > 0
                  ? fmtCpm((100 * totals.cpmGross) / totals.cpmMiles)
                  : "—",
              ],
            ] as [string, string][]
          ).map(([label, value]) => (
            <div key={label}>
              <div className="t-label !text-[10px]">{label}</div>
              <div className="t-num mt-0.5 text-[20px] text-ink">{value}</div>
            </div>
          ))}
        </div>

        {/* the year, drawn — the same undirected routes the table below
            prints, so the picture and the numbers can never disagree */}
        {mapData && mapData.routes.length > 0 && (
          <section className="mt-7">
            <h2 className="t-label mb-2">The year on the map</h2>
            <FlightMap data={mapData} report />
            <p className="mt-1.5 text-[12px] text-mute">
              {fmtInt(mapData.routes.length)}{" "}
              {mapData.routes.length === 1 ? "route" : "routes"} ·{" "}
              {fmtInt(mapData.airports.length)} airports
              {mapData.countries > 1 ? ` · ${mapData.countries} countries` : ""}
            </p>
          </section>
        )}

        {premier && (
          <section className="mt-7">
            <h2 className="t-label mb-2">Premier status</h2>
            <p className="text-[13px] text-ink2">
              {premier.tier
                ? `${year} flying earned ${premier.tier.name}.`
                : `${year} flying earned no Premier tier.`}
              {premier.milestones.length > 0 &&
                " " +
                  premier.milestones
                    .map((m) => `${m.tier} on ${fmtDate(m.date)} (${m.source})`)
                    .join(" · ") +
                  "."}
            </p>
          </section>
        )}

        <section className="mt-7">
          <h2 className="t-label mb-2">Month by month</h2>
          <div className="ledger-scroll">
          <table className="ledger w-full">
            <thead>
              <tr>
                <th>Month</th>
                <th className="!text-right">Flights</th>
                <th className="!text-right">Miles</th>
                <th className="!text-right">PQP</th>
                <th className="!text-right">Spent</th>
                <th className="!text-right">Your money</th>
                <th className="!text-right">¢/mi</th>
              </tr>
            </thead>
            <tbody>
              {active.map((m) => (
                <tr key={m.month}>
                  <td className="t-num">{monthName(m.month)}</td>
                  <td className="num">{m.flights}</td>
                  <td className="num">{fmtInt(m.distance)}</td>
                  <td className="num">{m.pqp ? fmtInt(m.pqp) : "·"}</td>
                  <td className="num">{m.gross ? money(m.gross) : "·"}</td>
                  <td className="num">
                    {m.gross || m.personal ? money(m.personal) : "·"}
                  </td>
                  <td className="num">{fmtCpm(m.grossCpm)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="t-num">{year}</td>
                <td className="num">{totals.flights}</td>
                <td className="num">{fmtInt(totals.miles)}</td>
                <td className="num">{fmtInt(totals.pqp)}</td>
                <td className="num">{money(totals.gross)}</td>
                <td className="num">{money(totals.personal)}</td>
                <td className="num">
                  {totals.cpmMiles > 0
                    ? fmtCpm((100 * totals.cpmGross) / totals.cpmMiles)
                    : "—"}
                </td>
              </tr>
            </tfoot>
          </table>
          </div>
          {spread && (
            <p className="mt-1.5 text-[11.5px] text-mute">
              Per flight: half of the {spread.flights} cash flights cost under{" "}
              {fmtCpm(spread.median)} a mile — cheapest tenth under{" "}
              {fmtCpm(spread.p10)}, dearest over {fmtCpm(spread.p90)}.
            </p>
          )}
        </section>

        <div className="mt-7 grid grid-cols-1 gap-7 sm:grid-cols-2">
          <section>
            <h2 className="t-label mb-2">Routes</h2>
            <div className="ledger-scroll">
            <table className="ledger w-full">
              <thead>
                <tr>
                  <th>Route</th>
                  <th className="!text-right">Flights</th>
                  <th className="!text-right">Miles</th>
                  <th className="!text-right">¢/mi</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r: RouteSummary) => (
                  <tr key={r.route}>
                    <td className="t-num">{r.route}</td>
                    <td className="num">{r.count}</td>
                    <td className="num">{fmtInt(r.miles)}</td>
                    <td className="num">{fmtCpm(r.grossCpm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </section>
          <section>
            <h2 className="t-label mb-2">The mix</h2>
            {[
              ["Purpose", mix.purpose],
              ["Airline", mix.carrier],
              ["Reach", mix.geography],
            ].map(([title, buckets]) => (
              <p key={title as string} className="mb-1.5 text-[12.5px] text-ink2">
                <span className="t-label !text-[10px]">{title as string}</span>{" "}
                {(buckets as typeof mix.purpose)
                  .filter((b) => b.flights > 0)
                  .map(
                    (b) =>
                      `${b.label} ${Math.round(b.share * 100)}%` +
                      (b.grossCpm != null ? ` at ${fmtCpm(b.grossCpm)}` : "")
                  )
                  .join(" · ")}
              </p>
            ))}
            <h2 className="t-label mb-2 mt-4">Fare classes</h2>
            <p className="text-[12.5px] text-ink2">
              {fares
                .map(
                  (f) =>
                    `${f.code === "" ? "no class" : f.code}${
                      f.carrier !== "UA" ? ` (${f.carrier})` : ""
                    } ×${f.flights}` +
                    (f.costPerPqp != null
                      ? ` at $${f.costPerPqp.toFixed(2)}/PQP`
                      : "")
                )
                .join(" · ")}
            </p>
          </section>
        </div>

        <section className="mt-7">
          <h2 className="t-label mb-2">Money in and out of your account</h2>
          <p className="text-[13px] text-ink2">
            Tickets bought in {year}: {money(cashTotals.out)}. Paid back to you:{" "}
            {cashTotals.assumed > 0 ? "≈" : ""}
            {money(cashTotals.in)}. Net: {cashTotals.assumed > 0 ? "≈" : ""}
            {money(cashTotals.out - cashTotals.in)}.
            {cashTotals.assumed > 0 &&
              ` The ≈ marks ${money(cashTotals.assumed)} of repayments with no date of their own.`}
          </p>
        </section>

        <footer className="mt-8 border-t border-line pt-3 text-[11px] text-mute">
          Generated by Flight Ledger on {new Date().toISOString().slice(0, 10)}.
          Costs count in the month flown; the money section counts in the month
          paid. Not affiliated with United Airlines.
        </footer>
      </>
    );

  return createPortal(
    <div
      className="report-overlay fixed inset-0 z-50 overflow-y-auto bg-[rgba(4,8,16,0.72)] p-4 backdrop-blur-[3px] sm:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="report-sheet reveal panel mx-auto my-4 w-full max-w-[860px] border-line2 bg-panel2 px-6 py-5 shadow-[0_24px_80px_var(--shadow-pop)]">
        <div className="report-page">
          <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
            <div>
              <div className="t-label mb-1 text-s-miles">
                Flight Ledger · Travel report
              </div>
              <h1 className="t-display text-[34px] leading-none text-ink">
                {year}
              </h1>
            </div>
            <div className="no-print flex items-center gap-2">
              <button className="btn btn-primary" onClick={() => window.print()}>
                <Printer size={14} /> Print / save as PDF
              </button>
              <button
                className="rounded-md p-1.5 text-mute transition-colors hover:bg-well hover:text-ink"
                onClick={onClose}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
          </header>
          {body}
        </div>
      </div>
    </div>,
    document.body
  );
}
