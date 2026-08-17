"use client";

import { fmtInt } from "@/lib/format";

/**
 * United marks each tier with a ribbon bookmark. Colours approximate the
 * metals rather than the brand palette used for data series — this is an
 * emblem, not a series, so it doesn't share the chart hues.
 */
export const TIER_MARK: Record<string, { fill: string; ink: string }> = {
  "Premier Silver": { fill: "#A9B4C0", ink: "var(--on-accent)" },
  "Premier Gold": { fill: "#C9A227", ink: "#231A02" },
  "Premier Platinum": { fill: "#DFE5EC", ink: "var(--on-accent)" },
  "Premier 1K": { fill: "#3D6FD4", ink: "#F2F6FF" },
};
export const markColor = (tier: string | undefined) =>
  (tier && TIER_MARK[tier]?.fill) || "#5B6B80";

export function PremierMark({
  tier,
  size = 18,
  hollow = false,
}: {
  tier: string | undefined;
  size?: number;
  /** unearned tiers show as an outline, the way United greys them out */
  hollow?: boolean;
}) {
  const c = (tier && TIER_MARK[tier]) || { fill: "#5B6B80", ink: "var(--on-accent)" };
  const is1K = tier === "Premier 1K";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d="M5 2.5h14a1 1 0 0 1 1 1v18.2a.8.8 0 0 1-1.25.66L12 17.9l-6.75 4.46A.8.8 0 0 1 4 21.7V3.5a1 1 0 0 1 1-1Z"
        fill={hollow ? "none" : c.fill}
        stroke={hollow ? c.fill : "none"}
        strokeWidth={hollow ? 1.6 : 0}
      />
      {is1K && !hollow && (
        <text
          x="12"
          y="12.5"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="8.5"
          fontWeight="700"
          fill={c.ink}
          fontFamily="var(--font-display), sans-serif"
        >
          1K
        </text>
      )}
    </svg>
  );
}

/* ------------------------------- gauges -------------------------------- */

export interface GaugeSlice {
  label: string;
  value: number;
  color: string;
}

/**
 * The 270° arc United uses on "Your Premier activity". Segments stack in order
 * so the make-up of a total is visible in the ring itself, not just a legend.
 */
export function PremierGauge({
  slices,
  target,
  unit,
  size = 132,
}: {
  slices: GaugeSlice[];
  target: number;
  unit: string;
  size?: number;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  /* Everything inside the ring scales with it. The type and its offsets were
     absolute numbers tuned for 132px, so a larger gauge otherwise came out as
     a big ring wrapped around small, badly-centred text. */
  const k = size / 132;
  const stroke = Math.round(9 * k);
  const r = (size - stroke) / 2 - 2;
  const cx = size / 2;
  const cy = size / 2;
  // pt() measures degrees clockwise from 12 o'clock, so 225° is the 7:30
  // position: the arc opens at the bottom the way United's does.
  const SWEEP = 270;
  const START = 225;

  const pt = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
  };
  const arc = (fromPct: number, toPct: number) => {
    const a0 = START + SWEEP * fromPct;
    const a1 = START + SWEEP * toPct;
    const [x0, y0] = pt(a0);
    const [x1, y1] = pt(a1);
    return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };

  let acc = 0;
  const drawn = slices
    .filter((s) => s.value > 0)
    .map((s) => {
      const from = target > 0 ? Math.min(1, acc / target) : 0;
      acc += s.value;
      const to = target > 0 ? Math.min(1, acc / target) : 0;
      return { ...s, from, to };
    })
    .filter((s) => s.to > s.from);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
      <path
        d={arc(0, 1)}
        fill="none"
        stroke="var(--color-well)"
        strokeWidth={stroke}
        strokeLinecap="round"
      />
      {/* Flat joints, round outer tips. A path's linecap rounds BOTH ends,
          so capping the last slice made its inner end bulge backwards over
          its neighbour — a pill biting into the slice before it. Every
          slice is butt-capped instead, and the two outer tips get their
          rounding from same-colour dots, whose inward half disappears into
          the slice it matches. */}
      {drawn.length > 0 &&
        (() => {
          const [sx, sy] = pt(START + SWEEP * drawn[0].from);
          const [ex, ey] = pt(START + SWEEP * drawn[drawn.length - 1].to);
          return (
            <>
              <circle cx={sx} cy={sy} r={stroke / 2} fill={drawn[0].color} />
              <circle cx={ex} cy={ey} r={stroke / 2} fill={drawn[drawn.length - 1].color} />
            </>
          );
        })()}
      {drawn.map((s, i) => (
        <path
          key={i}
          d={arc(s.from, s.to)}
          fill="none"
          stroke={s.color}
          strokeWidth={stroke}
          strokeLinecap="butt"
        >
          <title>{`${s.label}: ${fmtInt(s.value)}`}</title>
        </path>
      ))}
      <text
        x={cx}
        y={cy - 3 * k}
        textAnchor="middle"
        className="t-num"
        fontSize={18 * k}
        fill="var(--color-ink)"
      >
        {fmtInt(total)}
      </text>
      <text
        x={cx}
        y={cy + 13 * k}
        textAnchor="middle"
        className="t-label"
        fontSize={9 * k}
        fill="var(--color-ink2)"
      >
        {unit}
      </text>
      <text
        x={cx}
        y={cy + 36 * k}
        textAnchor="middle"
        className="t-num"
        fontSize={10.5 * k}
        fill="var(--color-mute)"
      >
        of {fmtInt(target)}
      </text>
    </svg>
  );
}
