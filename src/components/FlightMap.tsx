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
import { useEffect, useMemo, useRef, useState } from "react";
import { geoGraticule10, geoNaturalEarth1, geoPath } from "d3-geo";
import world from "@/data/world-land.json";
import { dominantCategory, type MapData, type MapRoute } from "@/lib/map";
import { fmtInt } from "@/lib/format";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";

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

  /* Zoom is a viewBox, not a transform: the projection never re-fits, the
     paths never recompute — the camera moves. Widths, radii, hit strokes and
     label sizes divide by the zoom factor so they hold their on-screen size
     while the geometry spreads, which is the entire point: at 4x the SFO and
     Frankfurt tangles separate into individually hoverable arcs. */
  const MAX_Z = 8;
  type View = { x: number; y: number; w: number };
  const [view, setView] = useState<View | null>(null);
  const z = view ? W / view.w : 1;
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ px: number; py: number; moved: boolean } | null>(null);
  /* The ref is the single source the handlers compute from: the wheel
     listener is a native one bound once, and the tween writes a frame at a
     time — both would otherwise read a stale closure's view. Every write
     goes through commitView so ref and state can't drift. */
  const viewRef = useRef<View | null>(null);
  const anim = useRef<number | null>(null);
  const commitView = (v: View | null) => {
    viewRef.current = v;
    setView(v);
  };

  const clampView = (v: View): View => {
    const h = v.w * (height / W);
    return {
      x: Math.min(Math.max(v.x, 0), W - v.w),
      y: Math.min(Math.max(v.y, 0), height - h),
      w: v.w,
    };
  };

  /* the target view after zooming toward a fixed point (defaults to the
     current center); null means "whole world" */
  const computeZoom = (
    cur: View | null,
    factor: number,
    cx?: number,
    cy?: number
  ): View | null => {
    const c = cur ?? { x: 0, y: 0, w: W };
    const w = Math.min(Math.max(c.w / factor, W / MAX_Z), W);
    if (w >= W) return null;
    const fx = cx ?? c.x + c.w / 2;
    const fy = cy ?? c.y + (c.w * (height / W)) / 2;
    const k = w / c.w;
    return clampView({ x: fx - (fx - c.x) * k, y: fy - (fy - c.y) * k, w });
  };

  /* client px -> svg user coordinates under a given view */
  const toUserAt = (cur: View | null, clientX: number, clientY: number) => {
    const el = svgRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    const c = cur ?? { x: 0, y: 0, w: W };
    return {
      x: c.x + ((clientX - r.left) / r.width) * c.w,
      y: c.y + ((clientY - r.top) / r.height) * c.w * (height / W),
    };
  };

  const stopAnim = () => {
    if (anim.current != null) {
      cancelAnimationFrame(anim.current);
      anim.current = null;
    }
  };

  /* Discrete zooms (buttons, double-click) glide instead of teleporting: a
     short ease-out tween of the viewBox. Wheel zoom skips this — its many
     small steps are already smooth, and a tween would lag behind the hand. */
  const animateTo = (target: View | null) => {
    stopAnim();
    const from = viewRef.current ?? { x: 0, y: 0, w: W };
    const to = target ?? { x: 0, y: 0, w: W };
    if (from.x === to.x && from.y === to.y && from.w === to.w) {
      commitView(target);
      return;
    }
    const t0 = performance.now();
    const D = 220;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / D);
      if (t >= 1) {
        commitView(target);
        anim.current = null;
        return;
      }
      const k = 1 - Math.pow(1 - t, 3);
      commitView({
        x: from.x + (to.x - from.x) * k,
        y: from.y + (to.y - from.y) * k,
        w: from.w + (to.w - from.w) * k,
      });
      anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };

  /* Wheel zoom, at the cursor. A native non-passive listener because React
     registers wheel passively and the zoom must swallow the scroll. It only
     swallows it while it means something: wheel-out at the whole world lets
     the page scroll normally, so the map never becomes a scroll trap. */
  useEffect(() => {
    const el = svgRef.current;
    if (!el || report) return;
    const onWheel = (e: WheelEvent) => {
      const cur = viewRef.current;
      if (e.deltaY > 0 && cur == null) return;
      e.preventDefault();
      stopAnim();
      const factor = Math.pow(2, -e.deltaY * 0.0024);
      const p = toUserAt(cur, e.clientX, e.clientY);
      commitView(computeZoom(cur, factor, p?.x, p?.y));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      stopAnim();
    };
    // bound once; everything it reads lives in refs or constants
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  return (
    /* Capped on screen: full panel width made the lead panel swallow a laptop
       viewport. The report keeps the full width — paper has no scroll. */
    <div className={report ? undefined : "mx-auto max-w-[940px]"}>
      {!report && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="t-display text-[11px] tracking-[0.1em] text-mute">
            COLOR BY
          </span>
          <div className="flex flex-wrap overflow-hidden rounded-md border border-line">
            {(Object.keys(MODE_LABEL) as ColorMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`t-display px-3 py-1 text-[11.5px] tracking-[0.1em] transition-colors pointer-coarse:py-2.5 ${
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

      <div className="relative">
      {!report && (
        <div className="absolute right-2 top-2 z-10 flex flex-col overflow-hidden rounded-md border border-line bg-[var(--color-deck)]">
          <button
            type="button"
            title="Zoom in (or double-click the map)"
            aria-label="Zoom in"
            className="p-1.5 text-mute transition-colors hover:text-ink disabled:opacity-40 pointer-coarse:p-3.5"
            disabled={z >= MAX_Z}
            onClick={() => animateTo(computeZoom(viewRef.current, 2))}
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            title="Zoom out"
            aria-label="Zoom out"
            className="border-t border-line p-1.5 text-mute transition-colors hover:text-ink disabled:opacity-40 pointer-coarse:p-3.5"
            disabled={view == null}
            onClick={() => animateTo(computeZoom(viewRef.current, 0.5))}
          >
            <ZoomOut size={14} />
          </button>
          {view != null && (
            <button
              type="button"
              title="Whole world"
              aria-label="Reset zoom"
              className="border-t border-line p-1.5 text-mute transition-colors hover:text-ink pointer-coarse:p-3.5"
              onClick={() => animateTo(null)}
            >
              <Maximize2 size={14} />
            </button>
          )}
        </div>
      )}
      <svg
        ref={svgRef}
        viewBox={
          view
            ? `${view.x} ${view.y} ${view.w} ${view.w * (height / W)}`
            : `0 0 ${W} ${height}`
        }
        className={`w-full ${view ? "cursor-grab" : ""}`}
        style={{ touchAction: view ? "none" : "auto" }}
        role="img"
        aria-label="Map of flown routes"
        onMouseLeave={() => setHovered(null)}
        onDoubleClick={(e) => {
          if (report) return;
          const cur = viewRef.current;
          const p = toUserAt(cur, e.clientX, e.clientY);
          animateTo(computeZoom(cur, 2, p?.x, p?.y));
        }}
        onPointerDown={(e) => {
          if (report || !viewRef.current) return;
          stopAnim();
          drag.current = { px: e.clientX, py: e.clientY, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          const el = svgRef.current;
          const cur = viewRef.current;
          if (!d || !cur || !el) return;
          const r = el.getBoundingClientRect();
          if (r.width === 0) return;
          const dx = ((e.clientX - d.px) / r.width) * cur.w;
          const dy = ((e.clientY - d.py) / r.height) * cur.w * (height / W);
          if (Math.abs(e.clientX - d.px) + Math.abs(e.clientY - d.py) > 2)
            d.moved = true;
          drag.current = { px: e.clientX, py: e.clientY, moved: d.moved };
          commitView(clampView({ x: cur.x - dx, y: cur.y - dy, w: cur.w }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <g transform={`translate(${PAD},${PAD})`}>
          {sphere && (
            <path
              d={sphere}
              fill="var(--color-well)"
              stroke="var(--color-line)"
              strokeWidth={1 / z}
            />
          )}
          {graticule && (
            <path
              d={graticule}
              fill="none"
              stroke="var(--color-ink)"
              strokeOpacity={0.05}
              strokeWidth={0.5 / z}
            />
          )}
          {land && (
            <path
              d={land}
              fill="var(--color-panel2)"
              stroke="var(--color-line2)"
              strokeOpacity={0.6}
              strokeWidth={0.5 / z}
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
                  strokeWidth={widthOf(r.count) / z}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={dim ? 0.25 : hovered === r.key ? 1 : 0.75}
                />
                {!report && (
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={Math.max(11, widthOf(r.count) + 6) / z}
                    onMouseEnter={() => setHovered(r.key)}
                    /* touch has no hover: a tap selects, a second tap clears */
                    onClick={() => setHovered(hovered === r.key ? null : r.key)}
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
                  r={radiusOf(a.visits) / z}
                  fill="var(--color-ink2)"
                  stroke="var(--color-deck)"
                  strokeWidth={0.6 / z}
                >
                  <title>{`${a.code} — ${a.visits} ${a.visits === 1 ? "visit" : "visits"}`}</title>
                </circle>
                {labeled.has(a.code) && (
                  <text
                    x={pt[0] + (radiusOf(a.visits) + 2.5) / z}
                    y={pt[1] + 3 / z}
                    className="t-num"
                    fontSize={9.5 / z}
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
      </div>

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
              {fmtInt(data.flights)} flights · {fmtInt(data.totalMiles)} mi — hover or tap a
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
