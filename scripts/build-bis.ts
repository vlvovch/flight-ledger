/**
 * Fold the BIS mileage tables in fixtures/ into src/data/bis-mileage.json.
 *
 * These are the mileages United actually credits, transcribed by FlyerTalk from
 * the airline's own figures. They are NOT computable: they differ from the
 * great-circle distance on essentially every pair, in both directions, because
 * airlines credit from published tables (IATA's Ticketed Point Mileage manual
 * lists 65,000+ city pairs) rather than from a formula. So they are shipped as
 * data, exactly like the airport coordinates.
 *
 * Keys are the two codes sorted, so one entry serves both directions.
 *
 *   npm run bis:build
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const pairKey = (a: string, b: string) => [a, b].sort().join("-");

type Entry = { miles: number; source: string };
const merged = new Map<string, Entry>();
const conflicts: string[] = [];

/** `AAA BBB 1234`, ignoring headers, rules and comments. */
function ingest(file: string, column: number, label: string) {
  const text = readFileSync(join(root, file), "utf-8");
  let added = 0;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("-")) continue;
    const cells = t.split(/\s+/);
    if (cells.length <= column) continue;
    const [a, b] = cells;
    const raw = cells[column];
    if (!/^[A-Z]{3}$/.test(a) || !/^[A-Z]{3}$/.test(b) || !/^\d+$/.test(raw)) continue;
    const key = pairKey(a, b);
    const miles = Number(raw);
    const prev = merged.get(key);
    if (prev && prev.miles !== miles) {
      // first file in wins; the disagreement is recorded, never averaged away
      conflicts.push(`${key}: ${prev.source} ${prev.miles} vs ${label} ${miles}`);
      continue;
    }
    if (!prev) added++;
    merged.set(key, { miles, source: label });
  }
  console.log(`  ${file}: ${added} new pairs`);
}

// the dedicated BIS table first, so it wins any disagreement
ingest("fixtures/BIS/BIStable.txt", 2, "BIStable");
ingest("fixtures/gcdist-reference.txt", 2, "gcdist-reference");

if (conflicts.length) {
  console.log(`\n  ${conflicts.length} conflicting pair(s), first file kept:`);
  for (const c of conflicts) console.log(`    ${c}`);
}

const out = {
  meta: {
    source: "FlyerTalk community BIS tables (fixtures/)",
    note: "Mileages United credits. Not a computed distance — see scripts/build-bis.ts.",
    builtAt: new Date().toISOString().slice(0, 10),
    count: merged.size,
  },
  pairs: Object.fromEntries(
    [...merged.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v.miles])
  ),
};
writeFileSync(join(root, "src/data/bis-mileage.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`\nwrote src/data/bis-mileage.json — ${merged.size} pairs`);
