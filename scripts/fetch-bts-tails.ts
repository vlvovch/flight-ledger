/**
 * Fills tail numbers from the BTS on-time performance record.
 *
 *   npm run bts:tails -- --dry-run        every month your ledger needs
 *   npm run bts:tails -- 2026-05          one month
 *   npm run bts:tails                     fill for real
 *
 * The Bureau of Transportation Statistics publishes, for every US domestic
 * flight, the registration that operated it. There is no per-flight query —
 * the unit of publication is a month (~32 MB zipped, ~277 MB of CSV) — so
 * "one flight" means fetching that flight's month. Downloads are cached in
 * .bts-cache/, so the second flight in a month costs nothing.
 *
 * Privacy: the file comes FROM the government TO this machine, and the
 * matching happens here. Nothing about your itinerary is sent anywhere,
 * which is the whole reason to prefer a bulk file over an API that would
 * have to be told which flights you took.
 *
 * Two limits worth knowing before you wonder why a flight stayed empty:
 * BTS covers US DOMESTIC segments only (an IAH→FRA leg is not in it), and
 * the data lags two to three months behind the calendar.
 */
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { parseCsv } from "../src/lib/csv-parse";
import { getDb } from "../src/lib/db";
import { listSegmentsRaw, runAsActor, updateSegment } from "../src/lib/repo";
import { loadFleetRegistry, typeForTail } from "../src/lib/fleet";

const CACHE = ".bts-cache";
const url = (year: string, month: string) =>
  "https://transtats.bts.gov/PREZIP/On_Time_Reporting_Carrier_On_Time_Performance_" +
  `1987_present_${year}_${Number(month)}.zip`;

/** The columns this needs, by position in the published header. */
const COL = {
  date: 5, carrier: 6, tail: 9, flight: 10, origin: 14, dest: 23,
  /* "Cancelled" is 1.00 on a flight that never left. Those rows still
     carry the tail of the aeroplane that WOULD have flown, and the May
     file alone holds 5,330 of them — assigning one to a merely-ticketed
     leg would put an aircraft on a flight that never operated. A DIVERTED
     flight did operate, on that aeroplane, so it stays. */
  cancelled: 47,
};

const unquote = (v: string) => (v ?? "").trim();
const key = (date: string, carrier: string, flight: string, o: string, d: string) =>
  `${date}|${carrier.toUpperCase()}|${String(Number(flight))}|${o.toUpperCase()}|${d.toUpperCase()}`;

/** A zip the archiver itself calls sound — size is not integrity. */
function intact(path: string): boolean {
  if (!existsSync(path) || statSync(path).size < 1_000_000) return false;
  const r = spawnSync("unzip", ["-t", path], { stdio: "ignore" });
  return r.status === 0;
}

async function download(year: string, month: string): Promise<string | null> {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, `bts_${year}_${month}.zip`);
  if (existsSync(path) && intact(path)) return path;
  const res = await fetch(url(year, month));
  if (!res.ok || !res.body) {
    console.warn(`  ${year}-${month}: not published yet (${res.status})`);
    return null;
  }
  /* Download beside the real name and rename only on success: an
     interrupted fetch used to leave a truncated zip that was over a
     megabyte, therefore "cached", therefore permanently answering "no
     matches" for that month. */
  const part = `${path}.part`;
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(part);
    Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
      .pipe(out)
      .on("finish", () => resolve())
      .on("error", reject);
  });
  renameSync(part, path);
  if (!intact(path)) {
    rmSync(path, { force: true });
    console.warn(`  ${year}-${month}: the download arrived damaged — try again`);
    return null;
  }
  return path;
}

/** Stream the month's CSV, keeping only the rows this ledger asked about. */
async function tailsFor(zip: string, wanted: Set<string>): Promise<Map<string, string>> {
  /* `unzip -p` rather than a zip library: this is a developer script, the
     archive holds one big member, and streaming it keeps 277 MB of CSV out
     of memory. */
  const child = spawn("unzip", ["-p", zip, "*.csv"], { stdio: ["ignore", "pipe", "ignore"] });
  /* Await the exit rather than sampling a flag: the close event can arrive
     after the last line, and "some rows matched" is not proof the archive
     was read to the end. */
  const exited = new Promise<number | null>((resolve) =>
    child.on("close", (code) => resolve(code))
  );
  const found = new Map<string, string>();
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) {
      first = false;
      continue;
    }
    /* a real CSV parse, not a split: city names are quoted and carry
       commas ("Houston, TX"), which shifts every column after them */
    const f = parseCsv(line)[0] ?? [];
    if (f.length <= COL.dest) continue;
    const k = key(
      unquote(f[COL.date]),
      unquote(f[COL.carrier]),
      unquote(f[COL.flight]),
      unquote(f[COL.origin]),
      unquote(f[COL.dest])
    );
    if (!wanted.has(k)) continue;
    if (Number(unquote(f[COL.cancelled]) || 0) === 1) continue;
    const tail = unquote(f[COL.tail]);
    if (tail) found.set(k, tail);
  }
  const code = await exited;
  if (code !== 0)
    throw new Error(
      `unzip exited ${code} reading ${zip} — the file is damaged; delete it and run again`
    );
  return found;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const only = args.find((a) => /^\d{4}-\d{2}$/.test(a));

  getDb(); // opens the active account's ledger
  /* the registry is fetched on demand in the app; a script has to ask for
     it, or every tail it finds arrives without an aeroplane */
  await loadFleetRegistry();
  /* Cancelled coupons never operated: BTS reports the aeroplane that flew
     the flight, and hanging it on a leg you didn't take would invent
     history. It also stops a reissued pair (cancelled + flown, same date,
     route and number) from collapsing onto one lookup key and updating the
     wrong copy. */
  const segments = listSegmentsRaw().filter(
    (s) => !s.tail_number && s.status !== "canceled"
  );
  const byMonth = new Map<string, typeof segments>();
  for (const s of segments) {
    const m = s.flight_date.slice(0, 7);
    if (only && m !== only) continue;
    byMonth.set(m, [...(byMonth.get(m) ?? []), s]);
  }
  if (byMonth.size === 0) {
    console.log("Every flight already has a tail number.");
    return;
  }

  let filled = 0;
  let types = 0;
  /* One month's bad luck must not cost the months behind it. A download
     that died mid-stream used to abort the whole run with nothing said —
     tails then "stopped at mid-2025" for a year before anyone asked why.
     Each month stands alone, and the run ends by naming any that failed. */
  const failed: string[] = [];
  for (const month of [...byMonth.keys()].sort()) {
    const legs = byMonth.get(month)!;
    const [year, mm] = month.split("-");
    console.log(`${month}: ${legs.length} flight(s) without a tail`);
    try {
      const zip = await download(year, mm);
      if (!zip) continue;
      const wanted = new Map<string, (typeof legs)[number]>();
      for (const s of legs) {
        const k = key(
          s.flight_date, s.marketing_carrier, s.flight_number ?? "", s.origin, s.destination
        );
        const held = wanted.get(k);
        // a flown leg outranks a merely-booked twin on the same key
        const rank = (x: typeof s) => (x.status.startsWith("flown") ? 0 : 1);
        if (!held || rank(s) < rank(held)) wanted.set(k, s);
      }
      const found = await tailsFor(zip, new Set(wanted.keys()));
      for (const [k, tail] of found) {
        const seg = wanted.get(k)!;
        const patch: Record<string, string> = { tail_number: tail };
        /* while we know the airframe, name it too — at the flight's own date,
           because a registration outlives its aeroplane */
        if (!seg.aircraft) {
          const type = typeForTail(tail, { date: seg.flight_date });
          if (type) {
            patch.aircraft = type;
            types++;
          }
        }
        console.log(
          `  ${seg.flight_date} ${seg.marketing_carrier}${seg.flight_number} ` +
            `${seg.origin}→${seg.destination}  ${tail}${patch.aircraft ? ` (${patch.aircraft})` : ""}`
        );
        // the change log should say a machine did this, not a person
        if (!dryRun) runAsActor("import:bts", () => updateSegment(seg.id, patch));
        filled++;
      }
      const missed = legs.length - found.size;
      if (missed > 0)
        console.log(`  ${missed} not in this file — international legs and codeshares aren't in BTS`);
    } catch (e) {
      failed.push(month);
      console.warn(
        `  ${month}: failed (${e instanceof Error ? e.message : String(e)}) — carrying on`
      );
    }
  }
  console.log(
    dryRun
      ? `\nDry run: ${filled} tail number(s) available, ${types} aircraft type(s) with them.`
      : `\nFilled ${filled} tail number(s) and ${types} aircraft type(s).`
  );
  if (failed.length > 0)
    console.log(`Worth re-running for: ${failed.join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
