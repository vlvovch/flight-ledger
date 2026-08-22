"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Plus, Upload } from "lucide-react";
import type { Analytics, LifetimeForecast } from "@/lib/metrics";
import type { ReconcileReport } from "@/lib/reconcile";
import type { EnrichedSegment, SegmentRow, TicketRow } from "@/lib/types";
import { rollupYears } from "@/lib/metrics";
import { trackEvent } from "@/lib/track";
import { api, fmtCpm, fmtDate, fmtInt, fmtMoney, fmtMonth } from "@/lib/format";
import { EmptyState, MilesBasisToggle, Panel, StatCard, StatusChip, toast } from "@/components/ui";
import FlightForm from "@/components/FlightForm";
import {
  C,
  CostChart,
  CpmChart,
  Legend,
  LifetimeChart,
  MilesChart,
  PqpChart,
} from "@/components/charts";
import {
  RangeControl,
  filterByRange,
  type Range,
} from "@/components/RangeControl";

/** what /api/analytics returns beyond the Analytics core */
type DashPayload = Analytics & {
  reconcile: ReconcileReport;
  /** authoritative — every table empty, by the same test Drive sync applies */
  ledgerEmpty: boolean;
  /** current qualification year's standing, from the premier machinery —
   *  tier, next and the ask all read off the ≈ standing (posted + flown
   *  awaiting credit), never a mix */
  premierNow: {
    tier: string | null;
    /** reached on the ≈ standing but not yet on posted totals */
    tierIsEstimated: boolean;
    next: string | null;
    needPqp: number;
    needPqf: number;
    shortfall: string | null;
  } | null;
};

export default function DashboardPage() {
  const [data, setData] = useState<DashPayload | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [range, setRange] = useState<Range>("24");
  /* Cents per mile FLOWN, or cents per mile that credited toward Million
     Miler — two different questions that part company on short hops, where
     326 miles in the air credit 500. */
  const [cpmRolling, setCpmRolling] = useState<number>(12);
  const [cpmBasis, setCpmBasis] = useState<"flown" | "lifetime">("flown");
  const [showForm, setShowForm] = useState(false);
  const [editSegment, setEditSegment] = useState<SegmentRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  const refresh = useCallback(() => {
    api<DashPayload>("/api/analytics")
      .then(setData)
      .catch((e) => setError(e.message));
    api<{ tickets: TicketRow[] }>("/api/tickets").then((r) => setTickets(r.tickets)).catch(() => {});
  }, []);
  useEffect(refresh, [refresh]);

  /* Every year the ledger touches. A 12- or 24-month window cannot reach 2020
     through 2023 at all, so without this four of the seven years on file were
     simply unviewable. */
  const years = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.monthly.map((m) => m.month.slice(0, 4)))].sort().reverse();
  }, [data]);

  /* At ALL the series spans every year the ledger knows — decades, once a
     flight diary lands — so the instrument charts step up to year bars, the
     same altitude change the Analysis ledger makes at this range. Ratios are
     re-derived from summed bases inside the rollup, never averaged. */
  const yearly = range === "all";
  const monthly = useMemo(() => {
    if (!data) return [];
    const rows = filterByRange(data.monthly, range);
    return yearly ? rollupYears(rows) : rows;
  }, [data, range, yearly]);
  /* The cumulative series is a RUNNING TOTAL, so slicing it to one window
     keeps each point's true running value — the line starts wherever the
     window began rather than at zero, which is the honest reading of
     "lifetime so far". Day-resolution points, so the steps jump on the
     dates flights actually flew; the window follows the monthly filter. */
  const lifetime = useMemo(() => {
    if (!data) return [];
    const rows = data.lifetimeDaily;
    if (range === "all") return rows;
    if (range.startsWith("y")) {
      const y = range.slice(1);
      return rows.filter((r) => r.date.startsWith(y));
    }
    const first = monthly[0]?.month;
    return first ? rows.filter((r) => r.date >= first) : rows;
  }, [data, range, monthly]);

  /* One click stands up a full sample ledger on an empty install, through
     the same door a real backup restore takes — so what the visitor
     explores is exactly what the app does with data, reconcile queue and
     all. The fixture rides the bundle and loads only on click. Offered
     only while the ledger is EMPTY — every table, not just flights, since
     restore REPLACES and a tickets-only ledger has everything to lose —
     and emptiness is re-established at click time, because the rendered
     flag is as old as the page data and another tab may have imported
     something since. */
  const loadDemo = async () => {
    setDemoBusy(true);
    try {
      const fresh = await api<DashPayload>("/api/analytics");
      if (!fresh.ledgerEmpty) {
        setData(fresh);
        toast(
          "This ledger already holds data, so the demo stays out. Erase all data from Settings first if you really want it."
        );
        return;
      }
      const demo = (await import("@/data/demo-ledger.json")).default;
      const r = await api<{ restored: Record<string, number> }>("/api/backup", {
        method: "POST",
        body: JSON.stringify(demo),
      });
      toast(
        `Demo ledger loaded — ${r.restored.segments} flights on ${r.restored.tickets} tickets. Erase it any time from Settings.`
      );
      /* the one number the launch needs: how many visitors try the demo.
         Name-only, hostname-gated, counted once per session */
      trackEvent("demo_loaded", true);
      refresh();
    } catch (e) {
      /* setError would replace the whole dashboard with the error panel —
         a failed demo load is a toast-sized event, not a dead page */
      toast(e instanceof Error ? e.message : "Demo data failed to load");
    } finally {
      setDemoBusy(false);
    }
  };

  if (error)
    return (
      <Panel label="Error" className="mt-8 p-6">
        <p className="text-critical">{error}</p>
      </Panel>
    );
  if (!data) return <div className="t-label p-8">Loading…</div>;

  const { cards, currency } = data;
  const hasData = data.totals.flights > 0 || data.upcoming.length > 0;
  const year = new Date().getFullYear();

  /* The Premier card's second line: standing and the ask. "7,193 / 24"
     answers where you are; the next threshold and what it still wants is
     the question a status chaser actually has. The flight/other split and
     the booked figure move to the tooltip, alongside the full shortfall
     sentence with the pqp-only route. */
  const premier = data.premierNow;
  const tierShort = (name: string | null) => name?.replace("Premier ", "");
  const premierAsk =
    premier?.next != null
      ? [
          premier.needPqp > 0 ? `${fmtInt(premier.needPqp)} PQP` : null,
          premier.needPqf > 0 ? `${premier.needPqf} PQF` : null,
        ]
          .filter(Boolean)
          .join(" + ")
      : "";


  return (
    <div className="mx-auto max-w-[1440px]">
      {/* header */}
      <header className="reveal mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="t-label mb-1 text-s-miles">United MileagePlus · Personal ledger</div>
          <h1 className="t-display text-[30px] leading-none text-ink">
            Operations Dashboard
          </h1>
        </div>
        {/* wraps: badge plus two buttons outgrow a 320px screen */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Reconciliation's entire dashboard presence: a badge, straight
              to the queue. The panel it used to anchor turned the board
              into an error console — and a ledger can hold permanently
              unresolvable exceptions, which a "needs attention" heading
              recast as standing guilt. The WARN count, and says so;
              info-level nudges live in Reconcile alone. */}
          {cards.openIssues > 0 && (
            <Link href="/reconcile" className="chip !text-[10.5px]" style={{
              color: "var(--color-warning)",
              borderColor: "color-mix(in oklab, var(--color-warning) 45%, transparent)",
              background: "color-mix(in oklab, var(--color-warning) 10%, transparent)",
            }}>
              <AlertTriangle size={11} />
              {cards.openIssues} warning{cards.openIssues === 1 ? "" : "s"}
            </Link>
          )}
          {/* The recurring gesture leads: a fresh My Activity CSV is how this
              ledger is maintained, where logging a flight by hand is the
              exception. Same deep link the empty state uses. */}
          <Link href="/activity?import=1" className="btn btn-primary">
            <Upload size={14} /> Import CSV
          </Link>
          <button className="btn btn-ghost" onClick={() => setShowForm(true)}>
            <Plus size={14} /> Log flight
          </button>
        </div>
      </header>

      {!hasData ? (
        <Panel className="reveal">
          <EmptyState
            title="No flights on the board"
            /* The fastest on-ramp leads: one united.com CSV creates the
               flights AND their MileagePlus postings — logging flights by
               hand is the slowest possible start and shouldn't be the only
               door shown. */
            body={
              'Fastest start: import your united.com "My Activity" CSV — it creates the flights and their MileagePlus postings at once. A myFlightradar24 flight-diary export, dropped on the Flights page, brings any airline’s history. Or drop eTicket receipts on the Tickets page, log a flight by hand, or restore a backup from Settings.'
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {/* The demo leads while the ledger is truly empty: a visitor
                    deciding whether to care has no CSV in hand, and the demo
                    is the one click that shows the app full. A returning
                    user's ledger has data, the demo button is gone, and the
                    import path stands first again. (Truly empty: tickets or
                    activity with no flights still shows this board, but a
                    restore would take that data with it.) */}
                {data.ledgerEmpty && (
                  <button className="btn btn-primary" onClick={loadDemo} disabled={demoBusy}>
                    {demoBusy ? "Loading…" : "Load demo data"}
                  </button>
                )}
                {/* deep-link straight into the import dialog — landing on the
                    page and hunting for a second Import button is a step a
                    first user shouldn't need */}
                <Link
                  href="/activity?import=1"
                  className={`btn ${data.ledgerEmpty ? "btn-ghost" : "btn-primary"}`}
                >
                  Import MileagePlus CSV
                </Link>
                <button className="btn btn-ghost" onClick={() => setShowForm(true)}>
                  <Plus size={14} /> Log a flight
                </button>
              </div>
            }
          />
        </Panel>
      ) : (
        <>
          {/* stat cards */}
          {/* Six cards, so every step is a divisor of six — 6, 3, 2 — and a row is
              never left ragged. The widths are raw-viewport thresholds because
              that is what media queries see: --ui-scale shrinks the space the
              cards actually get (a 1440 window leaves 851px here) without
              moving the breakpoint, so xl:grid-cols-6 was arriving ~200px of
              real estate early and clipping figures like ≈301,678. These
              thresholds already have the scale folded in; if --ui-scale
              changes materially, they need revisiting. */}
          <div className="stagger grid grid-cols-2 gap-3 min-[780px]:grid-cols-3 min-[1520px]:grid-cols-6">
            <StatCard
              label={`${year} miles flown`}
              value={fmtInt(cards.ytdMiles)}
              sub={`${cards.ytdFlights} flights YTD`}
              accent={C.miles}
              title="Distance actually flown this year — every segment, whatever it earned. Not the same as lifetime miles, which count only what credits to MileagePlus."
            />
            <StatCard
              /* Premier is two bars, not one — PQP and PQF — so the card
                 carries both. PQF used to appear only when there was no
                 non-flight PQP, which is the rarer case, so most of the time
                 the second qualifying currency was simply absent. */
              label={`${year} PQP / PQF`}
              /* At full size the pair wrapped and made this card taller than
                 its neighbours, dragging the whole row down. PQF is the
                 smaller bar and the smaller number, so it rides at a smaller
                 weight — both visible, one line, row height unchanged. */
              value={
                /* Flown-but-uncredited projections ride IN the headline,
                   ≈-marked — between activity imports that is a flight's
                   normal state, and a headline that dropped every flown leg
                   until the next CSV upload always read low. Booked stays
                   out: that travel hasn't happened. */
                <span
                  title={
                    cards.pendingFlownPqp > 0 || cards.pendingFlownPqf > 0
                      ? `${fmtInt(cards.ytdQualifyingPqp)} PQP / ${cards.ytdPqf} PQF posted, plus ≈${fmtInt(cards.pendingFlownPqp)} PQP${cards.pendingFlownPqf > 0 ? ` / ${cards.pendingFlownPqf} PQF` : ""} from flown flights awaiting the next activity import`
                      : undefined
                  }
                >
                  {cards.pendingFlownPqp > 0 ? "≈" : ""}
                  {fmtInt(cards.ytdQualifyingPqp + cards.pendingFlownPqp)}
                  <span className="text-[15px] text-mute">
                    {" / "}
                    {cards.pendingFlownPqf > 0 ? "≈" : ""}
                    {cards.ytdPqf + cards.pendingFlownPqf}
                  </span>
                </span>
              }
              sub={
                premier?.next != null && premierAsk
                  ? `${premier.tierIsEstimated ? "≈" : ""}${tierShort(premier.tier) ?? "No tier yet"} · ${tierShort(premier.next)} in ${premierAsk}`
                  : premier?.next == null && premier?.tier != null
                    ? `${premier.tierIsEstimated ? "≈" : ""}${tierShort(premier.tier)} — the top rung`
                    : [
                        cards.ytdNonFlightPqp > 0
                          ? `${fmtInt(cards.ytdPqp)} flight + ${fmtInt(cards.ytdNonFlightPqp)} other PQP`
                          : `${fmtInt(cards.ytdPqp)} flight PQP`,
                        cards.pendingBookedPqp > 0
                          ? `+${fmtInt(cards.pendingBookedPqp)} booked`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
              }
              accent={C.pqp}
              title={
                "The two Premier qualifying currencies. PQP counts flights plus card, shopping and partner earning; PQF counts qualifying flight segments. The ≈ includes flown flights whose credit hasn't posted." +
                (cards.ytdNonFlightPqp > 0
                  ? `\n\n${fmtInt(cards.ytdPqp)} flight + ${fmtInt(cards.ytdNonFlightPqp)} other PQP.`
                  : "") +
                (cards.pendingBookedPqp > 0
                  ? `\n${fmtInt(cards.pendingBookedPqp)} more PQP is receipt-projected on booked flights not yet flown.`
                  : "") +
                (premier?.shortfall ? `\n\n${premier.shortfall}` : "")
              }
            />
            <StatCard
              label="United lifetime miles"
              value={
                cards.lifetimeWithEst > cards.lifetimePosted
                  ? `≈${fmtInt(cards.lifetimeWithEst)}`
                  : fmtInt(cards.lifetimePosted)
              }
              /* "0 United-posted" was on every ledger: United publishes a
                 lifetime TOTAL, never a per-segment figure, so that number can
                 only ever be zero. What the figure is worth comparing against
                 is everything flown. */
              sub={`of ${fmtInt(data.totals.miles)} mi flown`}
              accent={C.miles}
              title="Estimated from the distance of every flight that credits to MileagePlus, at United's 500-mile segment minimum. United posts a lifetime total, not per-flight values — enter a posted figure on a flight to override its estimate."
            />
            <StatCard
              label={`${year} spend`}
              /* Some of this year's flights have no ticket behind them, so
                 their cost is reconstructed from PQP. Printing a bare total
                 would claim a precision the ledger doesn't have — the ≈ says
                 the figure is partly inferred, exactly as it does on lifetime
                 miles and gross CPM. */
              value={
                cards.ytdEstFlights > 0
                  ? `≈${fmtMoney(cards.ytdEstGross, currency, { cents: false })}`
                  : fmtMoney(cards.ytdGross, currency, { cents: false })
              }
              sub={
                cards.ytdEstFlights > 0
                  ? `${fmtMoney(cards.ytdGross, currency, { cents: false })} recorded · ${fmtInt(cards.ytdEstFlights)} estimated`
                  : `${fmtMoney(cards.ytdPersonal, currency, { cents: false })} personal`
              }
              accent={C.gross}
              title="Gross ticket cost for the year. Flights with no ticket recorded are reconstructed from their PQP, so the figure carries a ≈ until every flight has a fare behind it."
            />
            <StatCard
              label="Gross CPM"
              value={fmtCpm(cards.ytdGrossCpm)}
              sub={
                cards.ytdEstFlights > 0 && cards.ytdEstGrossCpm != null
                  ? `≈${fmtCpm(cards.ytdEstGrossCpm)} incl. ${fmtInt(cards.ytdEstFlights)} PQP-estimated`
                  : cards.ytdCpmMiles > 0
                    ? `YTD · ${fmtInt(cards.ytdCpmMiles)} costed mi`
                    : "YTD · no costed flights yet"
              }
              accent={C.gross}
              title="Cents per mile over flights with recorded cost that earn lifetime miles. The ≈ figure additionally reconstructs uncosted flights from their PQP (PQP ≈ base fare, plus typical tax)."
            />
            <StatCard
              label="Personal CPM"
              value={fmtCpm(cards.ytdPersonalCpm)}
              sub={
                cards.ytdEffectiveCpm != null
                  ? `${fmtCpm(cards.ytdEffectiveCpm)} net of awards @ ${data.settings.award_valuation_cpm}¢`
                  : "YTD · after reimbursements"
              }
              accent={C.personal}
              /* The effective figure credits earned award miles at a valuation
                 you chose, so the band says how much it depends on that choice.
                 A conclusion that survives 1¢ to 2¢ is about the flying; one
                 that doesn't was always about the assumption. */
              title={
                cards.awardScenarios.length > 0 && cards.ytdEffectiveCpm != null
                  ? `Same basis as gross CPM — every costed mile, reimbursed flying included, so heavy reimbursement reads as cheap flying; the travel mix prices personal travel alone.\n\nEffective CPM credits award miles at a valuation you set — an assumption, so here is what it rests on:\n${cards.awardScenarios
                      .map((s) => `  at ${s.cpm}¢/mile → ${fmtCpm(s.effective)}`)
                      .join("\n")}`
                  : "Same basis as gross CPM — every costed mile, reimbursed flying included, so heavy reimbursement reads as cheap flying; the travel mix prices personal travel alone."
              }
            />
          </div>

          {/* The flying itself, before any chart: what flew and what's next
              are the dashboard's temporal story, and the reconciliation
              queue is not part of it — a queue can hold permanently
              unresolvable exceptions, and a panel of them turned the board
              into an error console. Reconcile keeps the full list; the
              header badge carries the count. */}
          <div className="stagger mt-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Panel label="Recent flights" accent={C.award}>
              <SegmentList
                segments={data.recent}
                empty="No flown segments yet."
                onPick={(s) => setEditSegment(s)}
              />
            </Panel>
            <Panel label="Up next" accent={C.miles}>
              <SegmentList
                segments={data.upcoming}
                /* an equal-height panel with one line of "nothing" in it is
                   dead space — say what would put something here */
                empty={
                  <>
                    Nothing scheduled.{" "}
                    <button
                      className="underline decoration-[var(--color-line2)] underline-offset-2 transition-colors hover:text-ink"
                      onClick={() => setShowForm(true)}
                    >
                      Log a planned flight
                    </button>
                    , or drop a booking receipt on the{" "}
                    <Link
                      href="/tickets"
                      className="underline decoration-[var(--color-line2)] underline-offset-2 transition-colors hover:text-ink"
                    >
                      Tickets page
                    </Link>
                    .
                  </>
                }
                onPick={(s) => setEditSegment(s)}
              />
            </Panel>
          </div>

          {/* range control — wraps below the label on narrow screens rather
              than squeezing beside it */}
          <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="t-label">Instruments</h2>
            <RangeControl range={range} years={years} onChange={setRange} />
          </div>

          {/* charts */}
          <div className="stagger grid grid-cols-1 gap-3 lg:grid-cols-2">
            {/* The feature visualization opens the section, full width: the
                longest timeline on the page, the natural continuation of the
                lifetime KPI card, and the one chart no generic tracker has.
                The chart takes the left ~three-quarters; the Million Miler
                rungs stand as a column on the right, and drop below the
                chart on narrow screens. */}
            <Panel
              label="Lifetime miles — cumulative"
              accent={C.miles}
              className="pb-2 lg:col-span-2"
              right={
                <Legend
                  items={[
                    { name: "Lifetime (est.)", color: C.miles },
                    { name: "All miles flown", color: C.award, dashed: true },
                  ]}
                />
              }
            >
              <div className="flex flex-col lg:flex-row">
                <div className="min-w-0 flex-1 px-2 pt-1">
                  <LifetimeChart data={lifetime} />
                </div>
                <MillionMiler forecast={data.lifetimeForecast} />
              </div>
            </Panel>
            <Panel label={`Miles flown — ${yearly ? "yearly" : "monthly"}`} accent={C.miles} className="pb-2">
              <div className="px-2 pt-1">
                <MilesChart data={monthly} />
              </div>
            </Panel>
            <Panel
              label={`Cost per mile — ${cpmBasis === "flown" ? "flown" : "United lifetime"}`}
              accent={C.gross}
              className="pb-2"
              /* Controls only. This panel has three of them and a title, and
                 in a half-width card that is already more than one line holds
                 — the legend moved below the chart, where it sits beside the
                 marks it names anyway. */
              right={
                <div className="flex flex-wrap items-center gap-2">
                  {/* A trailing N-month average has no meaning over year bars,
                      so at year altitude the control steps aside rather than
                      offering windows it would silently misapply. */}
                  {!yearly && (
                    <select
                      className="field !w-auto !py-1 text-[11.5px]"
                      value={cpmRolling}
                      onChange={(e) => setCpmRolling(Number(e.target.value))}
                      title="Trailing average, weighted by miles rather than averaging the monthly figures"
                    >
                      <option value={0}>No average</option>
                      <option value={3}>3-mo avg</option>
                      <option value={6}>6-mo avg</option>
                      <option value={12}>12-mo avg</option>
                    </select>
                  )}
                  <MilesBasisToggle value={cpmBasis} onChange={setCpmBasis} />
                </div>
              }
            >
              <div className="px-2 pt-1">
                <CpmChart
                  data={monthly}
                  basis={cpmBasis}
                  rollingWindow={yearly ? 0 : cpmRolling}
                />
                {/* Naming the two SEGMENTS, not the total: the bar's full
                    height is still gross CPM, but gross has no colour of its
                    own, so listing it would point at a swatch that isn't in
                    the chart. */}
                <div className="mt-1 flex justify-center">
                  <Legend
                    items={[
                      { name: "Personal", color: C.personal },
                      { name: "Covered", color: C.covered },
                      ...(!yearly && cpmRolling > 0
                        ? [{ name: "Average", color: C.miles }]
                        : []),
                    ]}
                  />
                </div>
              </div>
            </Panel>
            <Panel
              label="Spend — personal vs covered"
              accent={C.personal}
              className="pb-2"
              right={
                <Legend
                  items={[
                    { name: "Personal", color: C.personal },
                    { name: "Covered", color: C.covered },
                  ]}
                />
              }
            >
              <div className="px-2 pt-1">
                <CostChart data={monthly} />
              </div>
            </Panel>
            <Panel
              label={`Premier qualifying points — ${yearly ? "yearly" : "monthly"}`}
              accent={C.pqp}
              className="pb-2"
              right={
                <Legend
                  items={[
                    { name: "Flights", color: C.pqp },
                    { name: "Card, shopping & partners", color: C.pqpOther },
                  ]}
                />
              }
            >
              <div className="px-2 pt-1">
                <PqpChart data={monthly} />
              </div>
            </Panel>
          </div>

          <footer className="mt-6 flex items-center justify-between pb-4">
            <p className="text-[11px] text-mute">
              All-time: {fmtInt(data.totals.flights)} flights ·{" "}
              {fmtInt(data.totals.miles)} mi · {fmtMoney(data.totals.gross, currency)} gross
            </p>
            <Link href="/flights" className="t-label !text-[10px] text-s-miles hover:underline">
              Open flight ledger →
            </Link>
          </footer>
        </>
      )}

      {(showForm || editSegment) && (
        <FlightForm
          segment={editSegment as EnrichedSegment | null}
          tickets={tickets}
          onClose={() => {
            setShowForm(false);
            setEditSegment(null);
          }}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

/**
 * Million Miler rungs at the current rate of flying.
 *
 * The rate and the window it came from sit on the same line as the years,
 * never behind a tooltip: a projection read without its assumption is just a
 * date someone will plan around. A rung past the horizon shows "—" rather than
 * a year in the 2090s, which would be arithmetic pretending to be a forecast.
 *
 * Renders nothing at all until there is a rate — a ledger three months old has
 * no business projecting a million miles, and saying so would be noise on a
 * panel that reads perfectly well without it.
 */
function MillionMiler({ forecast }: { forecast: LifetimeForecast | null }) {
  if (!forecast) return null;
  const { milestones, ratePerYear, windowMonths, to, horizonYears } = forecast;
  /* A rung this rate cannot reach inside the horizon is dropped, not dashed.
     "2 Million —" occupies the width of an answer to say there isn't one, and
     since the rungs ascend it says it once per rung above. The payload keeps
     all four; the display carries only the ones that mean something. */
  const shown = milestones.filter((m) => m.reached || m.year != null);
  if (shown.length === 0) return null;
  /* Only describe the forecast if one is being made. Where every rung shown is
     already behind you, the rate did no work and quoting it explains nothing. */
  const projects = shown.some((m) => !m.reached);
  /* Two shapes from one component: a footnote row under the chart on
     narrow screens, a standing column beside it from lg up — where the
     full-width panel gives the chart the left three-quarters and the
     rungs read as a ladder, each one on its own line. */
  return (
    <div
      className="mt-1 border-t border-line px-4 pt-2.5 pb-1 lg:mt-1 lg:mb-1 lg:w-[230px] lg:shrink-0 lg:self-stretch lg:border-t-0 lg:border-l lg:pt-1.5"
      title={`Million Miler progress. A crossed rung shows the month the ledger passed it. A ≈ year is a straight-line projection from the miles credited over the last ${windowMonths} complete months, to ${fmtMonth(to, "long")} — a year rather than a date, because the rate is an average over a lumpy history. Rungs more than ${horizonYears} years out are not shown.`}
    >
      <div className="t-label mb-1 hidden !text-[10px] text-mute lg:block">
        Million Miler
      </div>
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 lg:flex-col lg:items-stretch lg:gap-y-2">
        {shown.map((m) => (
          <span
            key={m.miles}
            className="flex items-baseline gap-1.5 lg:justify-between"
          >
            <span className="t-label !text-[10px]">{m.label}</span>
            {/* A crossed rung is a fact and carries its month; a projected one
                takes the ≈ this app puts on every estimated figure, so the
                difference between the two needs no legend. */}
            <span
              className={`t-num text-[13px] ${m.reached ? "text-good" : "text-ink"}`}
            >
              {m.reached
                ? (m.crossedAt ? fmtMonth(m.crossedAt) : "reached")
                : `≈${m.year}`}
            </span>
          </span>
        ))}
      </div>
      {projects && (
        <p className="mt-1 text-[11px] leading-snug text-mute lg:mt-2.5">
          ≈ forecast at {fmtInt(ratePerYear)} mi/yr over the last {windowMonths}{" "}
          months, to {fmtMonth(to)}
        </p>
      )}
    </div>
  );
}

function SegmentList({
  segments,
  empty,
  onPick,
}: {
  segments: EnrichedSegment[];
  empty: React.ReactNode;
  onPick: (s: EnrichedSegment) => void;
}) {
  if (segments.length === 0)
    return <p className="px-4 py-6 text-[13px] text-mute">{empty}</p>;
  /* Three, not six: these lists brief, they don't archive — the Flights
     page holds the ledger, and six recent rows beside an empty "Up next"
     read as a tower next to a hole. */
  return (
    <ul className="px-4 pb-3">
      {segments.slice(0, 3).map((s) => (
        <li
          key={s.id}
          className="flex cursor-pointer items-center gap-3 border-b border-[color-mix(in_oklab,var(--color-line)_55%,transparent)] py-2 transition-colors last:border-0 hover:bg-[var(--tint-accent-faint)]"
          onClick={() => onPick(s)}
        >
          <div className="min-w-0">
            <div className="t-num text-[13px] text-ink">
              {s.origin} → {s.destination}
              <span className="ml-2 text-[11px] text-mute">
                {s.marketing_carrier}
                {s.flight_number}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-mute">{fmtDate(s.flight_date)}</div>
          </div>
          <div className="ml-auto shrink-0">
            <StatusChip status={s.status} />
          </div>
        </li>
      ))}
    </ul>
  );
}
