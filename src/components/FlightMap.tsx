"use client";

/*
 * The flight map. Fully offline: the land outline is a vendored Natural
 * Earth 1:110m silhouette (see scripts/build-world.ts), projected with
 * d3-geo — no tiles, no keys, no requests, exactly like the rest of the app.
 *
 * Routes are two-point LineStrings handed to geoPath, which resamples them
 * along the great circle and cuts them at the antimeridian; the mileage math
 * in distance.ts is deliberately NOT reused here. That code answers "how far
 * is this flight" on the ellipsoid; the map draws a spherical arc for the
 * eye. Keeping them separate means neither can quietly redefine the other.
 *
 * Width scales with the square root of flight count — linear width lets one
 * commuter route ink out the map — and the same rule sizes airport dots.
 */
import { useMemo, useState } from "react";
import { geoGraticule10, geoNaturalEarth1, geoPath } from "d3-geo";
import world from "@/data/world-land.json";
import { dominantCategory, type MapData, type MapRoute } from "@/lib/map";
import { fmtInt } from "@/lib/format";

const W = 960;
const PAD = 8;
const SPHERE = { type: "Sphere" } as const;

type ColorMode = "one" | "airline" | "purpose" | "ticket";

const MODE_LABEL: Record<ColorMode, string> = {
  one: "One color",
  airline: "Airline",
  purpose: "Purpose",
  ticket: "Ticket",
};

/* Series palette, assigned to categories by flight count — the busiest
   category gets the first color, so the legend reads in map order. */
const PALETTE = [
  "var(--color-s-miles)",
  "var(--color-s-pqp)",
  "var(--color-s-gross)",
  "var(--color-s-award)",
  "var(--color-s-personal)",
  "var(--color-warning)",
];
const OVERFLOW_COLOR = "var(--color-mute)";

const TICKET_LABEL: Record<string, string> = { cash: "Cash", award: "Award" };

function facetOf(r: MapRoute, mode: ColorMode): Record<string, number> {
  if (mode === "airline") return r.carriers;
  if (mode === "purpose") return r.purposes;
  if (mode === "ticket") return r.tickets;
  return {};
}

function displayName(mode: ColorMode, category: string): string {
  if (mode === "ticket") return TICKET_LABEL[category] ?? category;
  if (mode === "purpose")
    return category.charAt(0).toUpperCase() + category.slice(1);
  return category;
}

export default function FlightMap({
  data,
  report = false,
}: {
  data: MapData;
  /** static annual-report mode: no controls, no hover, labels and legend on */
  report?: boolean;
}) {
  const [mode, setMode] = useState<ColorMode>("one");
  const [hovered, setHovered] = useState<string | null>(null);
  const activeMode: ColorMode = report ? "one" : mode;

  const { path, projection, height } = useMemo(() => {
    // precision is the adaptive-resampling threshold: the default (~0.7) lets
    // a great-circle arc flatten into visible segments at this size
    const proj = geoNaturalEarth1().fitWidth(W - 2 * PAD, SPHERE).precision(0.05);
    const p = geoPath(proj);
    const [[, y0], [, y1]] = p.bounds(SPHERE);
    return { path: p, projection: proj, height: Math.ceil(y1 - y0) + 2 * PAD };
  }, []);

  const land = useMemo(
    () => path(world.land as unknown as Parameters<typeof path>[0]),
    [path]
  );
  const graticule = useMemo(() => path(geoGraticule10()), [path]);
  const sphere = useMemo(() => path(SPHERE), [path]);

  /* colors: categories ranked by total flights across the window */
  const colorOf = useMemo(() => {
    if (activeMode === "one") return () => PALETTE[0];
    const totals = new Map<string, number>();
    for (const r of data.routes)
      for (const [k, n] of Object.entries(facetOf(r, activeMode)))
        totals.set(k, (totals.get(k) ?? 0) + n);
    const ranked = [...totals.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k]) => k);
    const assigned = new Map(
      ranked.map((k, i) => [k, PALETTE[i] ?? OVERFLOW_COLOR])
    );
    return (category: string | null) =>
      category != null ? (assigned.get(category) ?? OVERFLOW_COLOR) : PALETTE[0];
  }, [data.routes, activeMode]);

  const legend = useMemo(() => {
    if (activeMode === "one") return [];
    const totals = new Map<string, number>();
    for (const r of data.routes)
      for (const [k, n] of Object.entries(facetOf(r, activeMode)))
        totals.set(k, (totals.get(k) ?? 0) + n);
    return [...totals.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    );
  }, [data.routes, activeMode]);

  const minW = report ? 1.1 : 0.8;
  const widthOf = (count: number) => minW + Math.sqrt(count) * 0.85;
  const radiusOf = (visits: number) => 1.4 + Math.sqrt(visits) * 0.8;
  const labeled = new Set(
    data.airports.slice(0, report ? 8 : 6).map((a) => a.code)
  );

  const hoveredRoute = hovered
    ? (data.routes.find((r) => r.key === hovered) ?? null)
    : null;

  return (
    /* Capped on screen: full panel width made the lead panel swallow a laptop
       viewport. The report keeps the full width — paper has no scroll. */
    <div className={report ? undefined : "mx-auto max-w-[940px]"}>
      {!report && (
        <div className="mb-2 flex items-center gap-2">
          <span className="t-display text-[11px] tracking-[0.1em] text-mute">
            COLOR BY
          </span>
          <div className="flex overflow-hidden rounded-md border border-line">
            {(Object.keys(MODE_LABEL) as ColorMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`t-display px-3 py-1 text-[11.5px] tracking-[0.1em] transition-colors ${
                  mode === m
                    ? "bg-[var(--tint-accent-strong)] text-ink"
                    : "text-mute hover:text-ink2"
                }`}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
        </div>
      )}

      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="w-full"
        role="img"
        aria-label="Map of flown routes"
        onMouseLeave={() => setHovered(null)}
      >
        <g transform={`translate(${PAD},${PAD})`}>
          {sphere && (
            <path
              d={sphere}
              fill="var(--color-well)"
              stroke="var(--color-line)"
              strokeWidth={1}
            />
          )}
          {graticule && (
            <path
              d={graticule}
              fill="none"
              stroke="var(--color-ink)"
              strokeOpacity={0.05}
              strokeWidth={0.5}
            />
          )}
          {land && (
            <path
              d={land}
              fill="var(--color-panel2)"
              stroke="var(--color-line2)"
              strokeOpacity={0.6}
              strokeWidth={0.5}
            />
          )}

          {data.routes.map((r) => {
            const d = path({
              type: "LineString",
              coordinates: [r.from, r.to],
            });
            if (!d) return null;
            const category = dominantCategory(facetOf(r, activeMode));
            const dim = hovered != null && hovered !== r.key;
            return (
              <g key={r.key}>
                <path
                  d={d}
                  fill="none"
                  stroke={colorOf(category)}
                  strokeWidth={widthOf(r.count)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={dim ? 0.25 : hovered === r.key ? 1 : 0.75}
                />
                {!report && (
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(11, widthOf(r.count) + 6)}
                    onMouseEnter={() => setHovered(r.key)}
                  />
                )}
              </g>
            );
          })}

          {data.airports.map((a) => {
            const pt = projection([a.lon, a.lat]);
            if (!pt) return null;
            return (
              <g key={a.code}>
                <circle
                  cx={pt[0]}
                  cy={pt[1]}
                  r={radiusOf(a.visits)}
                  fill="var(--color-ink2)"
                  stroke="var(--color-deck)"
                  strokeWidth={0.6}
                >
                  <title>{`${a.code} — ${a.visits} ${a.visits === 1 ? "visit" : "visits"}`}</title>
                </circle>
                {labeled.has(a.code) && (
                  <text
                    x={pt[0] + radiusOf(a.visits) + 2.5}
                    y={pt[1] + 3}
                    className="t-num"
                    fontSize={9.5}
                    fill="var(--color-mute)"
                  >
                    {a.code}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {legend.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {legend.map(([category, n]) => (
            <span
              key={category}
              className="flex items-center gap-1.5 text-[11.5px] text-ink2"
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: colorOf(category) }}
              />
              {displayName(activeMode, category)}
              <span className="t-num text-mute">{n}</span>
            </span>
          ))}
        </div>
      )}

      {!report && (
        <p className="mt-2 min-h-[1.25rem] text-[12px] text-ink2">
          {hoveredRoute ? (
            <>
              <span className="t-num font-medium text-ink">
                {hoveredRoute.key}
              </span>
              {" · "}
              {fmtInt(hoveredRoute.count)}{" "}
              {hoveredRoute.count === 1 ? "flight" : "flights"}
              {hoveredRoute.directions.length > 1 && (
                <span className="text-mute">
                  {" ("}
                  {hoveredRoute.directions
                    .map((d) => `${d.count} ${d.route}`)
                    .join(" · ")}
                  {")"}
                </span>
              )}
              {" · "}
              {fmtInt(hoveredRoute.miles)} mi
              {" · "}
              {hoveredRoute.grossCpm != null ? (
                <>
                  <span className="t-num">{hoveredRoute.grossCpm.toFixed(1)}¢/mi</span>
                  <span className="text-mute"> gross, {hoveredRoute.cpmFlights} of {hoveredRoute.count} flights costed</span>
                </>
              ) : (
                <span className="text-mute">¢/mi not available</span>
              )}
            </>
          ) : (
            <span className="text-mute">
              {fmtInt(data.routes.length)} routes · {fmtInt(data.airports.length)} airports
              {data.countries > 1 ? ` · ${data.countries} countries` : ""} ·{" "}
              {fmtInt(data.flights)} flights · {fmtInt(data.totalMiles)} mi — hover a
              route for its numbers
            </span>
          )}
        </p>
      )}

      {data.unmapped.length > 0 && (
        <div className="mt-2 text-[12px] text-mute">
          <p>
            Map shows {fmtInt(data.mappedFlights)} of {fmtInt(data.flights)}{" "}
            flights. Couldn&apos;t place:
          </p>
          {data.unmapped.map((u) => (
            <p key={u.route} className="t-num">
              {u.route} — no coordinates for {u.missing.join(", ")}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
