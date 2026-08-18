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
  const cKeywords = col("keywords");
  const cIcao = col("ident");
  const cIata = col("iata_code");

  const sizeMap: Record<string, string> = {
    large_airport: "L",
    medium_airport: "M",
    small_airport: "S",
    /* Closed airports stay in: a flight ledger is history, and history
       departed from Tegel. Filed small so search ranking prefers the
       living, and ranked dead last below so a reassigned IATA code always
       resolves to the airport that currently answers to it. */
    closed: "S",
  };

  const airports = [];
  const seen = new Set<string>();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    let iata = (r[cIata] || "").trim().toUpperCase();
    const size = sizeMap[r[cType]];
    /* OurAirports clears iata_code when an airport closes and parks the old
       code in keywords ("TXL, EDDT, …"). A ledger is history, and history
       departed from Tegel — recover the code, closed rows only. Safe
       because closed airports rank dead last: a living airport that now
       answers to the code always wins the dedup. */
    if (!iata && r[cType] === "closed" && cKeywords >= 0) {
      iata =
        (r[cKeywords] || "")
          .split(",")
          .map((k) => k.trim().toUpperCase())
          .find((k) => /^[A-Z]{3}$/.test(k)) ?? "";
    }
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
      closed: r[cType] === "closed" ? 1 : 0,
    });
  }

  // Rank duplicates: scheduled service first, then by size L > M > S
  const sizeRank: Record<string, number> = { L: 0, M: 1, S: 2 };
  airports.sort(
    (a, b) =>
      a.closed - b.closed ||
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
  // the closed flag was for ranking only — the file keeps its schema
  for (const a of deduped) delete (a as { closed?: number }).closed;

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
