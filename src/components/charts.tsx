"use client";

import {
  Area,
  Bar,
  CartesianGrid,
  ReferenceLine,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MonthlySummary } from "@/lib/metrics";
import { rollingCpm } from "@/lib/rolling";
import { fmtCpm, fmtDate, fmtInt, fmtMonth, fmtMoney } from "@/lib/format";
import { markColor } from "./premier-ui";

/* Series palette — entity-fixed (validated, see globals.css) */
export const C = {
  miles: "var(--color-s-miles)",
  gross: "var(--color-s-gross)",
  personal: "var(--color-s-personal)",
  pqp: "var(--color-s-pqp)",
  award: "var(--color-s-award)",
  // translucent siblings: the reimbursed slice, and non-flight PQP
  covered: "color-mix(in oklab, var(--color-s-gross) var(--soft-mix), transparent)",
  pqpOther: "color-mix(in oklab, var(--color-s-pqp) var(--soft-mix), transparent)",
};

const INK2 = "var(--color-ink2)";
const MUTE = "var(--color-mute)";
const GRID = "var(--color-line)";
const AXISLINE = "var(--color-line2)";
const PANEL = "var(--color-panel)";

/*
 * The last x tick is centred on the final point, so roughly half a label sits
 * outside the plot area — with only a few px of right margin "Aug '26" was
 * being cut by the panel edge. Wide enough for a month-and-year label, and
 * shared so the charts stay aligned with one another.
 */
const MONTHLY_CHART_MARGIN = { top: 6, right: 30, left: 0, bottom: 0 } as const;

const tickStyle = {
  fill: MUTE,
  fontSize: 10.5,
  fontFamily: "var(--font-plex-mono)",
};

function xAxis(dataLen: number) {
  return (
    <XAxis
      dataKey="month"
      tick={tickStyle}
      tickLine={false}
      axisLine={{ stroke: AXISLINE }}
      tickFormatter={(m: string) => fmtMonth(m)}
      minTickGap={28}
      interval="preserveStartEnd"
      padding={dataLen <= 2 ? { left: 40, right: 40 } : undefined}
    />
  );
}

/**
 * A calendar axis for the year charts: points sit where their date falls, not
 * in an evenly-spaced slot. Ticks are the twelve month starts, so the labels
 * read the same as before while the marks between them now carry real spacing
 * — a week with four flights is visibly denser than a quiet month.
 */
function yearTimeAxis(year: string) {
  const y = Number(year);
  return (
    <XAxis
      dataKey="t"
      type="number"
      scale="time"
      domain={[Date.UTC(y, 0, 1), Date.UTC(y, 11, 31)]}
      ticks={Array.from({ length: 12 }, (_, i) => Date.UTC(y, i, 1))}
      tick={tickStyle}
      tickLine={false}
      axisLine={{ stroke: AXISLINE }}
      tickFormatter={(t: number) => {
        const d = new Date(t);
        return fmtMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
      }}
      minTickGap={20}
    />
  );
}

function yAxis(fmt: (v: number) => string, width = 46) {
  return (
    <YAxis
      tick={tickStyle}
      tickLine={false}
      axisLine={false}
      tickFormatter={fmt}
      width={width}
    />
  );
}

const compactMoney = (v: number) =>
  v >= 1000 ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `$${v}`;
const compactMiles = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(v);

/* ------------------------------ tooltip -------------------------------- */

interface RowSpec {
  key: string;
  name: string;
  color: string;
  fmt: (v: number) => string;
  dashed?: boolean;
  /** hide the row when this point has no value, instead of printing "—" —
   *  for series that only exist on part of the axis (projections) */
  skipNull?: boolean;
  /** hide the row when it equals this other key's value at the same point —
   *  at the junction date a projection that adds nothing is just an echo */
  dedupeAgainst?: string;
}

function DeckTooltip({
  active,
  label,
  payload,
  rows,
  cumulative = false,
}: {
  active?: boolean;
  label?: string;
  payload?: { payload?: Record<string, number | string | null> }[];
  rows: RowSpec[];
  /** the series is a running total, so this point is the month's CLOSE */
  cumulative?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const datum = payload[0]?.payload ?? {};
  return (
    <div className="rounded-md border border-line2 bg-panel2 px-3 py-2.5 shadow-[0_12px_32px_var(--shadow-pop)]">
      {/* A running total plotted on a monthly axis sits at the tick for March
          while reporting everything up TO the end of March — the mark looks
          like the start of the month and the number is the end of it. Bar
          charts have no such gap (a March bar is March), so only the
          cumulative series say so. */}
      <div className="t-label mb-1.5 !text-[9.5px]">
        {cumulative ? "through " : ""}
        {typeof datum.date === "string"
          ? fmtDate(datum.date)
          : fmtMonth(label ?? "", "long")}
      </div>
      {rows.map((r) => {
        const raw = datum[r.key];
        const v = typeof raw === "string" ? null : raw;
        if (r.skipNull && v == null) return null;
        if (r.dedupeAgainst != null) {
          const other = datum[r.dedupeAgainst];
          if (typeof other === "number" && other === v) return null;
        }
        return (
          <div key={r.key} className="flex items-center gap-2 py-0.5">
            <span
              className="inline-block h-[3px] w-3 rounded-full"
              style={{
                background: r.dashed
                  ? `repeating-linear-gradient(90deg, ${r.color} 0 3px, transparent 3px 5px)`
                  : r.color,
              }}
            />
            <span className="text-[11.5px] text-ink2">{r.name}</span>
            <span className="t-num ml-auto pl-4 text-[12px] text-ink">
              {v == null ? "—" : r.fmt(v)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------- legend -------------------------------- */

export function Legend({ items }: { items: { name: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((it) => (
        <span key={it.name} className="flex items-center gap-1.5">
          <span
            className="inline-block h-[3px] w-3.5 rounded-full"
            style={{
              background: it.dashed
                ? `repeating-linear-gradient(90deg, ${it.color} 0 3px, transparent 3px 5px)`
                : it.color,
            }}
          />
          <span className="text-[11px] text-ink2">{it.name}</span>
        </span>
      ))}
    </div>
  );
}

/* ----------------------------- end labels ------------------------------ */

/** Selective direct label at a line's last non-null datum (text in ink, not
 *  series color). `dy` lets two coinciding labels stack instead of colliding. */
function endLabel(lastIdx: number, text: string, dy = 3) {
  return function EndLabel(props: unknown) {
    const { x, y, index, value } = props as {
      x?: number | string;
      y?: number | string;
      index?: number;
      value?: unknown;
    };
    if (index !== lastIdx || value == null || value === false || x == null || y == null)
      return <g />;
    return (
      <text
        x={Number(x) + 6}
        y={Number(y) + dy}
        fill={INK2}
        fontSize={10}
        fontFamily="var(--font-barlow-condensed)"
        letterSpacing="0.08em"
      >
        {text.toUpperCase()}
      </text>
    );
  };
}

/** Dot shown only where a point has no non-null neighbor — an isolated month
 *  would otherwise be invisible (a line needs two points). */
function seriesDot(color: string, values: (number | null)[]) {
  return function SeriesDot(props: unknown) {
    const { key, cx, cy, index, value } = props as {
      key?: string;
      cx?: number;
      cy?: number;
      index?: number;
      value?: number | null;
    };
    if (value == null || cx == null || cy == null || index == null)
      return <g key={key} />;
    const prev = index > 0 ? values[index - 1] : null;
    const next = index < values.length - 1 ? values[index + 1] : null;
    if (prev != null || next != null) return <g key={key} />;
    return (
      <circle key={key} cx={cx} cy={cy} r={3.2} fill={color} stroke={PANEL} strokeWidth={1} />
    );
  };
}

/* ------------------------------- charts -------------------------------- */

const CHART_H = 210;

export function MilesChart({ data }: { data: MonthlySummary[] }) {
  return (
    <ResponsiveContainer width="100%" height={CHART_H}>
      <ComposedChart data={data} margin={MONTHLY_CHART_MARGIN}>
        <CartesianGrid stroke={GRID} vertical={false} />
        {xAxis(data.length)}
        {yAxis(compactMiles)}
        <Tooltip
          cursor={{ fill: "var(--tint-accent-weak)" }}
          content={
            <DeckTooltip
              rows={[
                { key: "distance", name: "Miles flown", color: C.miles, fmt: fmtInt },
                { key: "flights", name: "Flights", color: MUTE, fmt: fmtInt },
              ]}
            />
          }
        />
        <Bar dataKey="distance" fill={C.miles} radius={[4, 4, 0, 0]} maxBarSize={26}  isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/**
 * Cost per mile, as bars. It was two lines, and a line implies a continuous
 * quantity moving between its readings — but CPM is a per-month ratio with no
 * value in between, and months with no costed flights are genuine gaps. Drawn
 * as lines those gaps became long diagonal strides across empty space,
 * suggesting a trend through months that had no flights at all. Bars simply
 * aren't there for a month that has nothing.
 */
export function CpmChart({
  data,
  basis = "flown",
  rollingWindow = 0,
}: {
  data: MonthlySummary[];
  /** which miles the cost is divided by */
  basis?: "flown" | "lifetime";
  /** months in the trailing average; 0 draws none */
  rollingWindow?: number;
}) {
  const gKey = basis === "flown" ? "grossCpm" : "grossCpmLifetime";
  const pKey = basis === "flown" ? "personalCpm" : "personalCpmLifetime";
  /*
   * Stacked the same way as the spend chart below it, and for the same reason:
   * these are parts of one whole. Personal and Gross could NOT simply be laid
   * on one stack — personal is already inside gross, so the bar would total
   * gross + personal and describe a month that cost half again what it did.
   * What stacks honestly is the split: what you paid, plus what was covered,
   * IS the gross. So the covered slice is derived here rather than plotted
   * directly, and the full bar height still reads as gross CPM exactly as the
   * grouped version did.
   */
  /* The bars are what each month cost; the line is what the last N months
     cost taken together. Weighted in metrics.ts — a mean of the monthly
     figures would let one cheap month offset a very expensive one. */
  const roll = rollingWindow > 0 ? rollingCpm(data, rollingWindow, basis) : [];
  const stacked = data.map((m, i) => {
    const g = (m as unknown as Record<string, number | null>)[gKey];
    const pers = (m as unknown as Record<string, number | null>)[pKey];
    return {
      ...m,
      cpmCovered:
        g == null || pers == null
          ? null
          : Math.max(0, Math.round((g - pers) * 100) / 100),
      cpmRolling: roll[i]?.gross ?? null,
    };
  });
  return (
    <ResponsiveContainer width="100%" height={CHART_H}>
      <ComposedChart data={stacked} margin={MONTHLY_CHART_MARGIN}>
        <CartesianGrid stroke={GRID} vertical={false} />
        {xAxis(data.length)}
        {yAxis((v) => `${v}\u00A2`, 40)}
        <Tooltip
          cursor={{ fill: "var(--tint-accent-weak)" }}
          content={
            <DeckTooltip
              rows={[
                { key: gKey, name: "Gross CPM", color: C.gross, fmt: fmtCpm },
                { key: "cpmCovered", name: "Covered", color: C.covered, fmt: fmtCpm },
                { key: pKey, name: "Personal CPM", color: C.personal, fmt: fmtCpm },
                ...(rollingWindow > 0
                  ? [
                      {
                        key: "cpmRolling",
                        name: `${rollingWindow}-mo average`,
                        color: C.miles,
                        fmt: fmtCpm,
                      },
                    ]
                  : []),
              ]}
            />
          }
        />
        <Bar
          dataKey={pKey}
          stackId="cpm"
          fill={C.personal}
          stroke={PANEL}
          strokeWidth={1}
          maxBarSize={26}
          isAnimationActive={false}
        />
        <Bar
          dataKey="cpmCovered"
          stackId="cpm"
          fill={C.covered}
          stroke={PANEL}
          strokeWidth={1}
          radius={[4, 4, 0, 0]}
          maxBarSize={26}
          isAnimationActive={false}
        />
        {rollingWindow > 0 && (
          <Line
            type="monotone"
            dataKey="cpmRolling"
            stroke={C.miles}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/**
 * Cumulative lifetime miles against cumulative miles flown.
 *
 * The old pairing was "posted" vs "incl. estimates", but United publishes a
 * lifetime TOTAL and never a per-segment figure, so the posted series was a
 * flat zero on every ledger — a legend entry for a line that does not exist.
 * What is worth seeing is the two real quantities: what credited (solid) and
 * everything actually flown (dashed). They start together and separate at
 * each award ticket and each flight on another airline's metal, so the gap
 * between them reads directly as miles that earned nothing.
 */
export function LifetimeChart({
  data,
}: {
  data: { month: string; posted: number; withEst: number; flown: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={CHART_H}>
      <ComposedChart data={data} margin={MONTHLY_CHART_MARGIN}>
        <defs>
          <linearGradient id="lifetimeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.miles} stopOpacity={0.22} />
            <stop offset="100%" stopColor={C.miles} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        {xAxis(data.length)}
        {yAxis(compactMiles, 54)}
        <Tooltip
          cursor={{ stroke: AXISLINE, strokeWidth: 1 }}
          content={
            <DeckTooltip
              cumulative
              rows={[
                { key: "withEst", name: "Lifetime (est.)", color: C.miles, fmt: fmtInt },
                { key: "flown", name: "All miles flown", color: C.award, fmt: fmtInt, dashed: true },
              ]}
            />
          }
        />
        <Area
          dataKey="withEst"
          stroke={C.miles}
          strokeWidth={2}
          fill="url(#lifetimeFill)"
          isAnimationActive={false}
        />
        <Line
          dataKey="flown"
          stroke={C.award}
          strokeWidth={1.5}
          strokeDasharray="5 4"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/**
 * Premier qualifying points a month at a time — flights AND everything else.
 *
 * This plotted `pqp` alone, which is segment PQP only, while the card beside
 * it counts card, shopping and partner earning too. February 2026 is the
 * case that gives it away: 329 PQP earned, none of it flying, drawn as an
 * empty month. Stacked, so the total is the bar and the split is still
 * readable — the same "flight + other" the card spells out.
 */
export function PqpChart({ data }: { data: MonthlySummary[] }) {
  return (
    <ResponsiveContainer width="100%" height={CHART_H}>
      <ComposedChart data={data} margin={MONTHLY_CHART_MARGIN}>
        <CartesianGrid stroke={GRID} vertical={false} />
        {xAxis(data.length)}
        {yAxis(compactMiles)}
        <Tooltip
          cursor={{ fill: "var(--tint-accent-weak)" }}
          content={
            <DeckTooltip
              rows={[
                { key: "pqp", name: "Flight PQP", color: C.pqp, fmt: (v) => fmtInt(v) },
                {
                  key: "nonFlightPqp",
                  name: "Card, shopping & partners",
                  color: C.pqpOther,
                  fmt: (v) => fmtInt(v),
                },
                { key: "pqf", name: "PQF", color: MUTE, fmt: (v) => String(v) },
              ]}
            />
          }
        />
        <Bar
          dataKey="pqp"
          stackId="pqp"
          fill={C.pqp}
          maxBarSize={26}
          isAnimationActive={false}
        />
        <Bar
          dataKey="nonFlightPqp"
          stackId="pqp"
          fill={C.pqpOther}
          radius={[4, 4, 0, 0]}
          maxBarSize={26}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function CostChart({ data }: { data: MonthlySummary[] }) {
  const rows = data.map((m) => ({
    ...m,
    covered: Math.max(0, Math.round((m.gross - m.personal) * 100) / 100),
  }));
  return (
    <ResponsiveContainer width="100%" height={CHART_H}>
      <ComposedChart data={rows} margin={MONTHLY_CHART_MARGIN}>
        <CartesianGrid stroke={GRID} vertical={false} />
        {xAxis(rows.length)}
        {yAxis(compactMoney, 50)}
        <Tooltip
          cursor={{ fill: "var(--tint-accent-faint)" }}
          content={
            <DeckTooltip
              rows={[
                { key: "gross", name: "Gross", color: C.gross, fmt: (v) => fmtMoney(v) },
                { key: "covered", name: "Covered", color: C.covered, fmt: (v) => fmtMoney(v) },
                { key: "personal", name: "Personal", color: C.personal, fmt: (v) => fmtMoney(v) },
              ]}
            />
          }
        />
        {/* stacked: personal (out of pocket) below, covered slice above;
            1px panel stroke keeps the 2px visual gap between segments */}
        <Bar
          dataKey="personal"
          stackId="cost"
          fill={C.personal}
          stroke={PANEL}
          strokeWidth={1}
          maxBarSize={26}
         isAnimationActive={false} />
        <Bar
          dataKey="covered"
          stackId="cost"
          fill={C.covered}
          stroke={PANEL}
          strokeWidth={1}
          radius={[4, 4, 0, 0]}
          maxBarSize={26}
         isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ------------------------- Premier qualification ------------------------ */

/*
 * Shared geometry for the two year charts. They sit in the same slot and swap
 * on a toggle, so any difference in axis width or margin moves the plot under
 * the pointer — the gridlines shift and it reads as the chart jumping rather
 * than the series changing. The right margin is sized for the PQP chart's
 * threshold labels ("Gold", "Silver"), and the award chart takes the same one
 * because matching matters more than reclaiming 38px — it also stops the last
 * x-axis tick ("Dec '26") being clipped by the frame.
 */
const YEAR_CHART_Y_WIDTH = 52;
const YEAR_CHART_MARGIN = { top: 6, right: 58, left: 0, bottom: 0 } as const;

export interface AwardPoint {
  date: string;
  t: number;
  /** balance on this date; null once the year runs past the last movement */
  awardBalance: number | null;
  /** what moved on this date, for the tooltip */
  award: number;
}

/**
 * Redeemable-mile balance across a year, opening where the previous year
 * closed.
 *
 * Not a cumulative-earnings line: redemptions are negative, so this falls as
 * well as rises, and the falls are the interesting part — they are the trips
 * the miles were saved for. A zero baseline would flatten exactly that,
 * turning a 32k redemption into a barely-visible kink near the top of the
 * chart, so the axis starts below the year's low rather than at zero. The
 * label says "balance" and every point is a real level, so a non-zero floor
 * misreads nothing — but a bar chart here WOULD, which is why this is a line.
 */
export function AwardBalanceChart({ data, year }: { data: AwardPoint[]; year: string }) {
  const vals = data.map((d) => d.awardBalance).filter((v): v is number => v != null);
  /* Bounded by the balance itself. Folding 0 into the range — which this did
     at first — flattens the whole year against an empty lower half: a balance
     moving 37k→81k was drawn on a -10k…95k axis, and the redemption that is
     the point of the chart became a ripple. A balance can go negative only if
     tracking began mid-account, and that case is bounded here too. */
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.12, 1000);
  const round = (v: number, dir: 1 | -1) =>
    dir === 1 ? Math.ceil(v / 5000) * 5000 : Math.floor(v / 5000) * 5000;
  return (
    <ResponsiveContainer width="100%" height={200} initialDimension={{ width: 640, height: 200 }}>
      <ComposedChart data={data} margin={YEAR_CHART_MARGIN}>
        <CartesianGrid stroke={GRID} vertical={false} />
        {yearTimeAxis(year)}
        <YAxis
          tickFormatter={compactMiles}
          domain={[round(lo - pad, -1), round(hi + pad, 1)]}
          tick={{ fill: MUTE, fontSize: 10.5 }}
          axisLine={false}
          tickLine={false}
          width={YEAR_CHART_Y_WIDTH}
        />
        <Tooltip
          cursor={{ stroke: MUTE, strokeWidth: 1 }}
          content={
            <DeckTooltip
              cumulative
              rows={[
                {
                  key: "awardBalance",
                  name: "Balance",
                  color: C.award,
                  fmt: (v) => fmtInt(v),
                },
                {
                  key: "award",
                  name: "Moved this date",
                  color: MUTE,
                  fmt: (v) => (v > 0 ? `+${fmtInt(v)}` : fmtInt(v)),
                },
              ]}
            />
          }
        />
        <Area
          type="monotone"
          dataKey="awardBalance"
          stroke={C.award}
          strokeWidth={2}
          fill={C.award}
          fillOpacity={0.12}
          connectNulls={false}
          dot={vals.length === 1 ? { r: 3, fill: C.award, stroke: "none" } : false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export interface PremierPoint {
  date: string;
  t: number;
  /** null after the last posting — the line stops rather than running flat */
  cumPqp: number | null;
  cumPqf: number | null;
  /** cumulative including booked-but-uncredited flights */
  projPqp?: number | null;
  projPqf?: number | null;
}

/**
 * Cumulative PQP across a qualification year against the tier bars. The point
 * is where the line crosses each threshold — the same fact the milestone list
 * states in words, read here as pace.
 */
export function PremierChart({
  data,
  thresholds,
  year,
}: {
  data: PremierPoint[];
  thresholds: { name: string; pqp: number }[];
  year: string;
}) {
  const top = Math.max(
    ...data.map((d) => Math.max(d.cumPqp ?? 0, d.projPqp ?? 0)),
    ...thresholds.map((t) => t.pqp)
  );
  /* The projection is ALWAYS drawn to 31 December — flat when nothing is
     booked. A flat dashed run is not a rendering fault but the year-end
     forecast itself: "this is where you finish if you fly nothing more",
     read against the tier bars. It starts only at the junction (null before
     the last posting), so it never twins the posted line. */
  return (
    <ResponsiveContainer width="100%" height={200} initialDimension={{ width: 640, height: 200 }}>
      <ComposedChart data={data} margin={YEAR_CHART_MARGIN}>
        <CartesianGrid stroke={GRID} vertical={false} />
        {yearTimeAxis(year)}
        <YAxis
          tickFormatter={compactMiles}
          domain={[0, Math.ceil((top * 1.06) / 1000) * 1000]}
          tick={{ fill: MUTE, fontSize: 10.5 }}
          axisLine={false}
          tickLine={false}
          width={YEAR_CHART_Y_WIDTH}
        />
        {thresholds.map((t) => (
          <ReferenceLine
            key={t.name}
            y={t.pqp}
            stroke={markColor(t.name)}
            strokeOpacity={0.55}
            strokeDasharray="3 4"
            label={{
              value: t.name.replace("Premier ", ""),
              position: "right",
              fill: markColor(t.name),
              fontSize: 10,
            }}
          />
        ))}
        <Tooltip
          cursor={{ stroke: MUTE, strokeWidth: 1 }}
          content={
            <DeckTooltip
              cumulative
              rows={[
                { key: "cumPqp", name: "PQP to date", color: C.pqp, fmt: (v) => fmtInt(v), skipNull: true },
                { key: "cumPqf", name: "Flights to date", color: MUTE, fmt: (v) => String(v), skipNull: true },
                /* the future half of the axis: what the booked year adds up to */
                { key: "projPqp", name: "Projected PQP", color: C.pqp, dashed: true, fmt: (v) => fmtInt(v), skipNull: true, dedupeAgainst: "cumPqp" },
                { key: "projPqf", name: "Projected flights", color: MUTE, dashed: true, fmt: (v) => String(v), skipNull: true, dedupeAgainst: "cumPqf" },
              ]}
            />
          }
        />
        <Line
          type="monotone"
          dataKey="projPqp"
          stroke={C.pqp}
          strokeWidth={1.5}
          strokeDasharray="5 4"
          strokeOpacity={0.75}
          dot={false}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="cumPqp"
          stroke={C.pqp}
          strokeWidth={2}
          fill={C.pqp}
          fillOpacity={0.12}
          connectNulls={false}
          dot={data.length === 1 ? { r: 3, fill: C.pqp, stroke: "none" } : false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
