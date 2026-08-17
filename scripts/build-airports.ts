/**
 * Builds src/data/airports.json from the OurAirports open dataset.
 * Run with: npm run airports:build
 *
 * Keeps only airports with an IATA code, records the dataset source and
 * fetch date so distance calculations are reproducible (design doc §9).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseCsv } from "../src/lib/csv-parse";

const SOURCE_URL =
  "https://davidmegginson.github.io/ourairports-data/airports.csv";

async function main() {
  console.log(`Fetching ${SOURCE_URL} ...`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const csv = await res.text();
  const rows = parseCsv(csv);
  const header = rows[0];
  const col = (name: string) => {
    const idx = header.indexOf(name);
    if (idx === -1) throw new Error(`Missing column: ${name}`);
    return idx;
  };

  const cType = col("type");
  const cName = col("name");
  const cLat = col("latitude_deg");
  const cLon = col("longitude_deg");
  const cCountry = col("iso_country");
  const cCity = col("municipality");
  const cSched = col("scheduled_service");
  const cIcao = col("ident");
  const cIata = col("iata_code");

  const sizeMap: Record<string, string> = {
    large_airport: "L",
    medium_airport: "M",
    small_airport: "S",
  };

  const airports = [];
  const seen = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const iata = (r[cIata] || "").trim().toUpperCase();
    const size = sizeMap[r[cType]];
    if (!iata || iata.length !== 3 || !size) continue;
    const lat = parseFloat(r[cLat]);
    const lon = parseFloat(r[cLon]);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    // A few IATA codes appear on more than one row; prefer the first
    // (dataset lists larger/scheduled-service airports first after sort below)
    airports.push({
      iata,
      icao: r[cIcao] || null,
      name: r[cName],
      city: r[cCity] || null,
      country: r[cCountry] || null,
      lat,
      lon,
      size,
      sched: r[cSched] === "yes" ? 1 : 0,
    });
  }

  // Rank duplicates: scheduled service first, then by size L > M > S
  const sizeRank: Record<string, number> = { L: 0, M: 1, S: 2 };
  airports.sort(
    (a, b) =>
      b.sched - a.sched ||
      sizeRank[a.size] - sizeRank[b.size] ||
      a.iata.localeCompare(b.iata)
  );
  const deduped = airports.filter((a) => {
    if (seen.has(a.iata)) return false;
    seen.add(a.iata);
    return true;
  });
  deduped.sort((a, b) => a.iata.localeCompare(b.iata));

  const out = {
    meta: {
      source: "OurAirports (public domain)",
      url: SOURCE_URL,
      fetchedAt: new Date().toISOString().slice(0, 10),
      count: deduped.length,
    },
    airports: deduped,
  };

  const outPath = join(process.cwd(), "src", "data", "airports.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out));
  console.log(`Wrote ${deduped.length} airports to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
