/**
 * Builds src/data/world-land.json — the land outline behind the flight map.
 * Run with: npm run map:build
 *
 * Source is the world-atlas package's 110m land layer, which is itself
 * derived from Natural Earth (public domain; world-atlas is ISC). 1:110m is
 * the resolution Natural Earth designed for small world maps — the map draws
 * continents for context, not streets, so anything finer is wasted bytes.
 *
 * The file ships as TopoJSON; the app renders GeoJSON. The conversion is done
 * HERE, at build time, rather than shipping topojson-client to production:
 * the decoded MultiPolygon is quantized to two decimals (~1.1 km — invisible
 * at world scale), verified, stamped with its source, and checked in — the
 * same pattern as the airports dataset (design doc §9).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const SOURCE_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json";

type Topology = {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: [number, number][][];
  objects: {
    land: {
      type: "GeometryCollection";
      geometries: { type: "MultiPolygon" | "Polygon"; arcs: number[][][] }[];
    };
  };
};

/** Delta-decode one arc into absolute [lon, lat] pairs. */
function decodeArc(
  arc: [number, number][],
  t: Topology["transform"]
): [number, number][] {
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [
      Math.round((x * t.scale[0] + t.translate[0]) * 100) / 100,
      Math.round((y * t.scale[1] + t.translate[1]) * 100) / 100,
    ];
  });
}

/** Stitch arc indices into a ring: negative index ~i is arc i reversed, and
 *  every arc after the first repeats the joint point, which is dropped. */
function ring(
  indices: number[],
  arcs: [number, number][][],
  t: Topology["transform"]
): [number, number][] {
  const out: [number, number][] = [];
  for (const idx of indices) {
    const decoded =
      idx >= 0 ? decodeArc(arcs[idx], t) : decodeArc(arcs[~idx], t).reverse();
    out.push(...(out.length ? decoded.slice(1) : decoded));
  }
  return out;
}

async function main() {
  console.log(`Fetching ${SOURCE_URL} ...`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const topo = (await res.json()) as Topology;

  // land is a GeometryCollection holding one MultiPolygon; flatten whatever
  // polygons it carries so a future world-atlas restructure fails loudly in
  // the sanity checks below instead of silently dropping land
  const polygons: number[][][] = topo.objects.land.geometries.flatMap((g) =>
    g.type === "MultiPolygon" ? g.arcs : ([g.arcs] as unknown as number[][][])
  );
  const coordinates = polygons.map((polygon) =>
    polygon.map((r) => ring(r, topo.arcs, topo.transform))
  );

  // sanity: every ring closes, every coordinate is on the globe
  let points = 0;
  for (const polygon of coordinates) {
    for (const r of polygon) {
      points += r.length;
      const [first, last] = [r[0], r[r.length - 1]];
      if (first[0] !== last[0] || first[1] !== last[1])
        throw new Error("Unclosed ring in decoded land outline");
      for (const [lon, lat] of r) {
        if (lon < -180 || lon > 180 || lat < -90 || lat > 90)
          throw new Error(`Coordinate off the globe: ${lon},${lat}`);
      }
    }
  }

  const out = {
    meta: {
      source: "world-atlas 2.0.2 (Natural Earth 1:110m land, public domain)",
      url: SOURCE_URL,
      fetched: new Date().toISOString().slice(0, 10),
    },
    land: { type: "MultiPolygon", coordinates },
  };

  const dest = join(process.cwd(), "src/data/world-land.json");
  mkdirSync(dirname(dest), { recursive: true });
  const json = JSON.stringify(out);
  writeFileSync(dest, json);
  console.log(
    `Wrote ${dest}: ${coordinates.length} polygons, ${points} points, ${(json.length / 1024).toFixed(0)} KB`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
