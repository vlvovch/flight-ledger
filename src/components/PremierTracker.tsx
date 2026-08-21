"use client";

import { useState } from "react";
import type { PremierSource, PremierYear } from "@/lib/premier";
import { shortfall } from "@/lib/premier";
import { fmtDate, fmtInt } from "@/lib/format";
import { Panel } from "./ui";
import { AwardBalanceChart, C, LifetimeBalanceChart, PremierChart } from "@/components/charts";
import { PremierGauge, PremierMark, markColor } from "./premier-ui";
import type { GaugeSlice } from "./premier-ui";

/** Earning sources keep one colour across both rings and the table.
 *  In a stacked ring the colour is the ONLY link between a slice and its
 *  legend entry, so United and partner metal can't share a hue the way the
 *  activity log's text-labelled badges can. */
const colorOf = (key: string) =>
  key.startsWith("award_flight") ? C.award
  : key === "flight:UA" ? C.miles
  : key.startsWith("flight") ? C.personal
  : key === "credit_card" ? C.pqp
  : C.gross;

/**
 * Everything that isn't a flight or the card earns onto ONE slice.
 *
 * Four hues are spoken for — United metal, United award, partner metal, card —
 * and a sweep of the whole hue wheel inside the palette's lightness band finds
 * no fifth that stays readably apart from all four. Promotions and seat/upgrade
 * purchases were therefore both falling through to the same amber, which is not
 * a near-miss but literally one colour doing two jobs. Merging them is the
 * honest resolution: one slice, one hue, and a legend that names what went into
 * it. The per-source figures are still in the table below the rings.
 */
const OTHER_KEY = "other_earning";
const mergeOther = (sources: PremierSource[], pick: "pqp" | "pqf") => {
  const kept = sources.filter((s) => s[pick] > 0 && colorOf(s.key) !== C.gross);
  const merged = sources.filter((s) => s[pick] > 0 && colorOf(s.key) === C.gross);
  if (merged.length === 0) return kept.map((s) => ({ ...s, mergedLabel: s.label }));
  /* Name the constituents while there are few enough to read; past that the
     table is the place to look, and a legend entry that long stops being one. */
  const names = merged.map((s) => s.label);
  const mergedLabel =
    names.length <= 2 ? names.join(" · ") : `${names[0]} · +${names.length - 1} more`;
  return [
    ...kept.map((s) => ({ ...s, mergedLabel: s.label })),
    {
      key: OTHER_KEY,
      label: mergedLabel,
      mergedLabel,
      pqp: merged.reduce((a, b) => a + b.pqp, 0),
      pqf: merged.reduce((a, b) => a + b.pqf, 0),
      award: merged.reduce((a, b) => a + b.award, 0),
    } as PremierSource & { mergedLabel: string },
  ];
};

function Legend({ slices }: { slices: GaugeSlice[] }) {
  const seen = new Set<string>();
  const items = slices.filter((s) => {
    if (s.value <= 0 || seen.has(s.label)) return false;
    seen.add(s.label);
    return true;
  });
  return (
    <div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
      {items.map((s) => (
        <span key={s.label} className="flex items-center gap-1.5">
          <span
            className="inline-block h-[3px] w-3.5 rounded-full"
            style={{ background: s.color }}
          />
          <span className="text-[11px] text-mute">{s.label}</span>
        </span>
      ))}
    </div>
  );
}

/** Which of the two qualification routes the chart's tier bars refer to. */
type Route = "both" | "pqpOnly";
/** What the year chart is showing. The two routes score the same series
 *  against different bars; award miles is a different series entirely — which
 *  is why the route is held separately rather than as a third route value: it
 *  has to survive a trip through the award view unchanged. */
type ChartView = Route | "award";

function YearDetail({ y }: { y: PremierYear }) {
  /* null = follow the suggestion below; set = the user's own choice, which
     persists while they compare years. */
  const [routeChoice, setRouteChoice] = useState<Route | null>(null);
  const [awardView, setAwardView] = useState(false);
  const [lifetimeView, setLifetimeView] = useState(false);
  /* Gauges can read two ways: what United has credited, or that plus what
     the booked calendar should add. The toggle exists because both are real
     questions — "where am I" and "where do I land if these flights happen". */
  const [includeBooked, setIncludeBooked] = useState(false);
  const next = y.nextTier;
  const proj = y.projection;
  const withBooked = includeBooked && proj != null;
  const net = y.closingAward - y.openingAward;

  const slices = (pick: "pqp" | "pqf"): GaugeSlice[] => {
    const base: GaugeSlice[] = mergeOther(y.sources, pick).map((s) => ({
      label: s.mergedLabel,
      value: s[pick],
      color: colorOf(s.key),
    }));
    /* Flown-awaiting-credit is ALWAYS in the gauge — between activity
       imports that is a flight's normal state, and hiding its earning made
       the standing read low every time a leg was marked flown. Brighter
       than the booked slice: it is nearer to posted than to planned. */
    const flownPending =
      pick === "pqp" ? y.flownPendingPqp : y.flownPendingPqf;
    if (flownPending > 0)
      base.push({
        label: "Flown, awaiting credit (estimated)",
        value: flownPending,
        color: "color-mix(in oklab, var(--color-mute) 78%, black)",
      });
    const added = pick === "pqp" ? (proj?.addedPqp ?? 0) : (proj?.addedPqf ?? 0);
    if (withBooked && added > 0)
      base.push({
        label: "Booked flights (estimated)",
        value: added,
        /* a DARK neutral, by explicit choice: estimates should recede next
           to the vivid posted slices. Mixing --color-mute toward black keeps
           a step of separation from the near-black track on dark themes and
           stays visibly dark on the light theme. */
        color: "color-mix(in oklab, var(--color-mute) 50%, black)",
      });
    return base;
  };
  const pqpSlices = slices("pqp");
  const pqfSlices = slices("pqf");

  return (
    <div className="space-y-4 border-t border-line px-4 pb-4 pt-3">
      {next ? (
        <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h3 className="t-label !text-[10px]">
              Next rung — {next.name}
              <span className="ml-2 normal-case tracking-normal text-mute">
                either route qualifies
              </span>
            </h3>
            {proj && !y.closed && (
              /* United's own tracker calls this "Future flights" — same
                 words here, so the numbers match what united.com shows
                 with the box ticked */
              <label
                className="flex cursor-pointer items-center gap-1.5"
                title="Add what your booked flights should earn — estimates until United credits them"
              >
                <input
                  type="checkbox"
                  className="accent-[var(--color-s-miles)]"
                  checked={includeBooked}
                  onChange={(e) => setIncludeBooked(e.target.checked)}
                />
                <span className="text-[11.5px] text-ink2">Future flights</span>
              </label>
            )}
          </div>
          {/* Explicit column-to-row layouts, not free wrapping: wrap decides
              line breaks by fit, which could strand the "+" beside one gauge
              and the "OR" beside another. Below xl the two routes stack with
              OR between them; the gauge pair itself goes side by side from
              sm up and stacks under that, so no gauge ever clips. */}
          <div className="flex flex-col items-center justify-center gap-y-2 xl:flex-row xl:gap-x-1">
            <div className="text-center">
              <div className="mb-1 text-[11.5px] text-mute">
                points <span className="text-ink2">+</span> flights
              </div>
              <div className="flex flex-col items-center gap-1 sm:flex-row">
                <PremierGauge slices={pqpSlices} target={next.pqp} unit="PQP" size={182} />
                <span className="t-num text-[18px] text-mute">+</span>
                <PremierGauge slices={pqfSlices} target={next.pqf} unit="PQF" size={182} />
              </div>
            </div>
            <div className="mx-2 hidden h-[150px] self-center border-l border-line xl:block" />
            <span className="t-display px-1.5 text-[12px] text-mute">OR</span>
            <div className="text-center">
              <div className="mb-1 text-[11.5px] text-mute">points alone</div>
              <PremierGauge slices={pqpSlices} target={next.pqpOnly} unit="PQP" size={182} />
            </div>
          </div>
          <Legend slices={[...pqpSlices, ...pqfSlices]} />
          <p className="mt-2 text-center text-[11.5px] text-ink2">
            {shortfall(y, withBooked)}
          </p>
          <p className="mt-1 text-center text-[11.5px] text-mute">
            Minimum of {y.program.minFlights} flights operated by United or United
            Express{" "}
            {y.needMinFlights > 0 ? (
              <span className="text-[var(--ink-warning)]">
                — {fmtInt(y.uaFlights)} so far, {fmtInt(y.needMinFlights)} to go
              </span>
            ) : (
              /* A bare "✓ 19" beside "Minimum of 4" invites reading 19 as
                 the requirement. Say what the number counts. */
              <span className="text-s-award">
                ✓ {fmtInt(y.uaFlights)} flown
              </span>
            )}
          </p>
        </div>
      ) : (
        <p className="text-[12.5px] text-ink2">Top tier reached — every rung is met.</p>
      )}

      {y.monthly.length > 0 &&
        (() => {
          /* Which route's bars to draw. There is no neutral "nearer" — the two
             routes are measured in different things (10,000 PQP AND 30 flights
             versus 12,000 PQP alone), so any single answer is a judgement. The
             default is the route you have completed more of, by whichever of
             its requirements is furthest behind; the selector overrides it,
             because for a given year you may simply know which one you intend
             to take. */
          const pct = (a: number, b: number) => (b > 0 ? Math.min(1, a / b) : 1);
          const bothPct = next
            ? Math.min(pct(y.pqp, next.pqp), pct(y.pqf, next.pqf))
            : 0;
          const onlyPct = next ? pct(y.pqp, next.pqpOnly) : 0;
          const suggested: Route = bothPct >= onlyPct ? "both" : "pqpOnly";
          const route: Route = routeChoice ?? suggested;
          /* Scale to the rungs actually in play. Including 1K when you're at
             6,000 PQP flattens the line into the bottom of the frame and hides
             the thing the chart is for — the pace. */
          const reach = Math.max(
            0,
            ...y.points.map((m) =>
              Math.max(m.cumPqp ?? 0, m.projPqp ?? 0, m.flownPqp ?? 0)
            ),
            proj?.pqp ?? 0
          );
          const ceiling = next
            ? next.pqpOnly
            : Math.max(...y.program.tiers.map((t) => t.pqpOnly));
          const barOf = (t: (typeof y.program.tiers)[number]) =>
            route === "both" ? t.pqp : t.pqpOnly;
          const visible = y.program.tiers.filter(
            (t) => barOf(t) <= Math.max(reach, ceiling) * 1.02
          );
          const hasAward = y.points.some((m) => m.awardBalance != null);
          const hasLifetime = y.points.some((m) => m.lifetimeBalance != null);
          const showAward = awardView && hasAward && !(lifetimeView && hasLifetime);
          const showLifetime = lifetimeView && hasLifetime;
          return (
            <div>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <h3 className="t-label !text-[10px]">
                  {showLifetime
                    ? "Lifetime miles through the year"
                    : showAward
                      ? "Award miles through the year"
                      : "PQP through the year"}
                </h3>
                {/* Opening and closing levels with the move between them, as
                    a figure each rather than a run-on sentence. "now" is only
                    true of a year still running — on a finished year the last
                    balance is where it CLOSED, and calling that "now" claims a
                    balance that has since moved on. */}
                {showAward && (
                  <span className="flex items-baseline gap-1.5 text-[11.5px]">
                    <span className="t-label !text-[9px]">opened</span>
                    <span className="t-num text-ink2">{fmtInt(y.openingAward)}</span>
                    <span
                      className={`t-num rounded px-1.5 py-px text-[11px] ${
                        net > 0
                          ? "bg-[color-mix(in_oklab,var(--color-s-award)_16%,transparent)] text-s-award"
                          : net < 0
                            ? "bg-[color-mix(in_oklab,var(--color-s-personal)_16%,transparent)] text-s-personal"
                            : "text-mute"
                      }`}
                    >
                      {net > 0 ? "+" : ""}
                      {fmtInt(net)}
                    </span>
                    <span className="t-label !text-[9px]">
                      {y.closed ? "closed" : "now"}
                    </span>
                    <span className="t-num text-ink">{fmtInt(y.closingAward)}</span>
                  </span>
                )}
                {showLifetime && (() => {
                  const lnet = y.closingLifetime - y.openingLifetime;
                  return (
                    <span className="flex items-baseline gap-1.5 text-[11.5px]">
                      <span className="t-label !text-[9px]">opened</span>
                      <span className="t-num text-ink2">{fmtInt(y.openingLifetime)}</span>
                      <span
                        className={`t-num rounded px-1.5 py-px text-[11px] ${
                          lnet > 0
                            ? "bg-[color-mix(in_oklab,var(--color-s-miles)_16%,transparent)] text-s-miles"
                            : "text-mute"
                        }`}
                      >
                        {lnet > 0 ? "+" : ""}
                        {fmtInt(lnet)}
                      </span>
                      <span className="t-label !text-[9px]">
                        {y.closed ? "closed" : "now"}
                      </span>
                      <span className="t-num text-ink">{fmtInt(y.closingLifetime)}</span>
                    </span>
                  );
                })()}
                {/* One control, three views. The award balance was briefly its
                    own panel underneath; two stacked year-long charts made the
                    section scroll for no gain, when only one is ever being
                    read at a time. */}
                <div className="flex overflow-hidden rounded-md border border-line">
                  {(
                    [
                      ["both", "PQP + PQF"],
                      ["pqpOnly", "PQP only"],
                      ...(hasAward ? ([["award", "Award miles"]] as const) : []),
                      ...(hasLifetime ? ([["lifetime", "Lifetime miles"]] as const) : []),
                    ] as const
                  ).map(([r, text]) => (
                    <button
                      key={r}
                      onClick={() => {
                        if (r === "award") {
                          setAwardView(true);
                          setLifetimeView(false);
                        } else if (r === "lifetime") {
                          setLifetimeView(true);
                          setAwardView(false);
                        } else {
                          setAwardView(false);
                          setLifetimeView(false);
                          setRouteChoice(r);
                        }
                      }}
                      title={
                        r === "lifetime"
                          ? "Lifetime miles (est.), opening where last year closed — the Million Miler currency"
                          : r === "award"
                          ? "Redeemable-mile balance, opening where last year closed"
                          : r === "both"
                            ? `Bars at the PQP half of each tier's points-plus-flights route${
                                next ? ` — ${fmtInt(next.pqp)} PQP with ${next.pqf} PQF for ${next.name}` : ""
                              }`
                            : `Bars at each tier's points-alone route${
                                next ? ` — ${fmtInt(next.pqpOnly)} PQP, no flight minimum` : ""
                              }`
                      }
                      className={`t-display px-2.5 py-1 text-[10px] tracking-[0.1em] transition-colors pointer-coarse:py-2.5 ${
                        (showLifetime ? "lifetime" : showAward ? "award" : route) === r
                          ? "bg-[var(--tint-accent-strong)] text-ink"
                          : "text-mute hover:text-ink2"
                      }`}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </div>
              {/* Both charts stay mounted in the same grid cell and take turns
                  being visible. Swapping one component for the other made
                  ResponsiveContainer re-measure from zero width on every
                  switch, and the axis was visibly drawn narrow and then
                  stretched — `visibility` keeps the box laid out, so the
                  measurement it already has stays valid and nothing rescales. */}
              <div className="grid">
                <div
                  className="[grid-area:1/1]"
                  style={{ visibility: showAward || showLifetime ? "hidden" : "visible" }}
                  aria-hidden={showAward || showLifetime}
                >
                  <PremierChart
                    data={y.points}
                    year={y.year}
                    thresholds={visible.map((t) => ({ name: t.name, pqp: barOf(t) }))}
                  />
                </div>
                {hasAward && (
                  <div
                    className="[grid-area:1/1]"
                    style={{ visibility: showAward ? "visible" : "hidden" }}
                    aria-hidden={!showAward}
                  >
                    <AwardBalanceChart data={y.points} year={y.year} />
                  </div>
                )}
                {hasLifetime && (
                  <div
                    className="[grid-area:1/1]"
                    style={{ visibility: showLifetime ? "visible" : "hidden" }}
                    aria-hidden={!showLifetime}
                  >
                    <LifetimeBalanceChart data={y.points} year={y.year} />
                  </div>
                )}
              </div>
            </div>
          );
        })()}

      {y.sources.length > 0 && (
        <div>
          <h3 className="t-label mb-2 !text-[10px]">Where it came from</h3>
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[440px] text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-well text-left">
                  <th className="t-label !text-[9px] px-3 py-1.5">Source</th>
                  <th className="t-label !text-[9px] px-3 py-1.5 text-right">PQP</th>
                  <th className="t-label !text-[9px] px-3 py-1.5 text-right">Share</th>
                  <th className="t-label !text-[9px] px-3 py-1.5 text-right">PQF</th>
                  <th className="t-label !text-[9px] px-3 py-1.5 text-right">Award miles</th>
                  <th className="t-label !text-[9px] px-3 py-1.5 text-right">Postings</th>
                </tr>
              </thead>
              <tbody>
                {y.sources.map((s) => (
                  <tr key={s.key} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-1.5">
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-[3px] w-3.5 shrink-0 rounded-full"
                          style={{ background: colorOf(s.key) }}
                        />
                        <span className={s.pqp > 0 ? "text-ink2" : "text-mute"}>
                          {s.label}
                        </span>
                      </span>
                      {s.detail && (
                        <span className="mt-0.5 block pl-[22px] text-[11px] text-mute">
                          {s.detail}
                        </span>
                      )}
                    </td>
                    {/* a category that earned nothing reads as "—", not "0" —
                        it's listed to show it was counted, not to imply a
                        rounded-down value */}
                    <td className="t-num px-3 py-1.5 text-right text-ink">
                      {s.pqp > 0 ? fmtInt(s.pqp) : <span className="text-mute">—</span>}
                    </td>
                    <td className="t-num px-3 py-1.5 text-right text-mute">
                      {y.pqp > 0 && s.pqp > 0
                        ? `${Math.round((s.pqp / y.pqp) * 100)}%`
                        : "—"}
                    </td>
                    <td className="t-num px-3 py-1.5 text-right text-ink2">
                      {s.pqf > 0 ? fmtInt(s.pqf) : "—"}
                    </td>
                    {/* Redemptions spend the balance, so this column runs both
                        ways. A redemption showing "—" made the year look like
                        miles only ever arrived. */}
                    <td
                      className={`t-num px-3 py-1.5 text-right ${
                        s.award < 0 ? "text-s-personal" : "text-ink2"
                      }`}
                    >
                      {s.award !== 0 ? (
                        <>
                          {s.award < 0 ? "−" : ""}
                          {fmtInt(Math.abs(s.award))}
                        </>
                      ) : (
                        <span className="text-mute">—</span>
                      )}
                    </td>
                    <td className="t-num px-3 py-1.5 text-right text-mute">
                      {fmtInt(s.count)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line2 bg-well">
                  <td className="px-3 py-1.5 text-ink2">Total</td>
                  <td className="t-num px-3 py-1.5 text-right text-ink">{fmtInt(y.pqp)}</td>
                  <td className="px-3 py-1.5" />
                  <td className="t-num px-3 py-1.5 text-right text-ink">{fmtInt(y.pqf)}</td>
                  {(() => {
                    /* The NET of the year: everything earned less everything
                       redeemed. Summing the column is the only figure here
                       that answers "did my balance grow?". */
                    const net = y.sources.reduce((a, x) => a + x.award, 0);
                    return (
                      <td
                        className={`t-num px-3 py-1.5 text-right ${
                          net < 0 ? "text-s-personal" : "text-ink"
                        }`}
                        title="Miles earned this year, less miles redeemed"
                      >
                        {net < 0 ? "−" : ""}
                        {fmtInt(Math.abs(net))}
                      </td>
                    );
                  })()}
                  <td className="px-3 py-1.5" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {proj && (
        <div className="rounded-md border border-line bg-well px-3.5 py-2.5">
          <h3 className="t-label mb-1 !text-[10px]">Projected</h3>
          <p className="text-[12.5px] text-ink2">
            <span className="t-num text-ink">+{fmtInt(proj.addedPqp)} PQP</span>
            {proj.addedPqf > 0 && (
              <>
                {" "}
                and <span className="t-num text-ink">{fmtInt(proj.addedPqf)} PQF</span>
              </>
            )}{" "}
            still to come from {proj.flights} booked flight
            {proj.flights === 1 ? "" : "s"}, for{" "}
            <span className="t-num text-ink">{fmtInt(proj.pqp)} PQP</span> /{" "}
            <span className="t-num text-ink">{fmtInt(proj.pqf)} PQF</span> by year end
            {proj.tier ? (
              <>
                , reaching <span className="text-ink">{proj.tier.name}</span>
              </>
            ) : (
              ", still short of the first tier"
            )}
            .
          </p>
          <p className="mt-1 text-[11px] text-mute">
            Estimated from your booked tickets. Flights already flown but not
            yet credited sit in the standing as ≈ instead.
          </p>
        </div>
      )}

      <div>
        <h3 className="t-label mb-2 !text-[10px]">Milestones</h3>
        {y.milestones.length === 0 ? (
          <p className="text-[12.5px] text-mute">No tier reached in {y.year}.</p>
        ) : (
          <ul className="space-y-1.5">
            {y.milestones.map((m) => (
              <li
                key={m.tier}
                className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5"
              >
                <PremierMark tier={m.tier} size={14} />
                <span className="text-[12.5px] text-ink">{m.tier}</span>
                <span className="t-num text-[12px] text-ink2">{fmtDate(m.date)}</span>
                <span className="text-[11.5px] text-mute">
                  at {fmtInt(m.pqpAt)} PQP / {fmtInt(m.pqfAt)} PQF
                  {m.path === "pqp-only" ? " (PQP-only route)" : ""} · {m.source}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11px] text-mute">
        Thresholds:{" "}
        {`${y.program.from} set`}.
        {y.program.from === 2020 && Number(y.year) <= 2021 && (
          <>
            {" "}
            United also extended status outright in those pandemic years, so what you
            held may be higher than what this shows you earned.
          </>
        )}
      </p>
    </div>
  );
}

export default function PremierTracker({ years }: { years: PremierYear[] }) {
  const [selected, setSelected] = useState(years[0]?.year ?? "");
  if (years.length === 0) return null;
  const active = years.find((y) => y.year === selected) ?? years[0];
  const accent = markColor(active.tier?.name);

  return (
    <div className="reveal">
      {/* year rail — one place to choose, so the detail below is unambiguous */}
      <div className="mb-3 flex flex-wrap gap-2">
        {years.map((y) => {
          const on = y.year === active.year;
          return (
            <button
              key={y.year}
              onClick={() => setSelected(y.year)}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors ${
                on ? "border-line2 bg-panel2" : "border-line hover:border-line2"
              }`}
            >
              <PremierMark tier={y.tier?.name} size={17} hollow={!y.tier} />
              <span>
                <span className="t-num block text-[14px] text-ink">{y.year}</span>
                <span className="t-label block !text-[9px] text-mute">
                  {y.tier?.name.replace("Premier ", "") ?? "No status"}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <Panel accent={accent}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
          <div className="min-w-[130px]">
            <div className="t-num text-[15px] font-medium text-ink">{active.year}</div>
            <div className="mt-0.5 text-[11px] text-mute">
              {active.closed ? "final" : "in progress"} · status for{" "}
              {Number(active.year) + 1}
            </div>
          </div>
          <span
            className="chip flex items-center gap-1.5 !text-[10px]"
            style={{
              color: accent,
              borderColor: `color-mix(in oklab, ${accent} 45%, transparent)`,
              background: `color-mix(in oklab, ${accent} 10%, transparent)`,
            }}
          >
            <PremierMark tier={active.tier?.name} size={12} hollow={!active.tier} />
            {active.tier?.name ?? "No status"}
          </span>
          <div className="min-w-[92px]">
            <div className="t-label !text-[9px]">PQP</div>
            <div
              className="t-num mt-0.5 text-[13.5px] text-ink2"
              title={
                active.flownPendingPqp > 0
                  ? `${fmtInt(active.pqp)} posted + ≈${fmtInt(active.flownPendingPqp)} from flown flights awaiting the next activity import`
                  : undefined
              }
            >
              {active.flownPendingPqp > 0 ? "≈" : ""}
              {fmtInt(active.pqp + active.flownPendingPqp)}
            </div>
          </div>
          <div className="min-w-[70px]">
            <div className="t-label !text-[9px]">PQF</div>
            <div
              className="t-num mt-0.5 text-[13.5px] text-ink2"
              title={
                active.flownPendingPqf > 0
                  ? `${fmtInt(active.pqf)} posted + ≈${fmtInt(active.flownPendingPqf)} from flown flights awaiting the next activity import`
                  : undefined
              }
            >
              {active.flownPendingPqf > 0 ? "≈" : ""}
              {fmtInt(active.pqf + active.flownPendingPqf)}
            </div>
          </div>
          {active.projection && active.projection.unlocks.length > 0 && (
            <span className="text-[11.5px] text-s-award">
              booked flights reach{" "}
              {active.projection.unlocks[active.projection.unlocks.length - 1]}
            </span>
          )}
        </div>
        <YearDetail y={active} />
      </Panel>
    </div>
  );
}
