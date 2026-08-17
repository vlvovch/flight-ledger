/**
 * Builds src/data/fleet.json — US registrations (N-numbers) → aircraft type,
 * so a tail number typed into a flight names its own aeroplane.
 *
 * Run with: npm run fleet:build -- ~/Downloads/ReleasableAircraft
 *
 * Source is the FAA's Releasable Aircraft Database: a work of the US
 * government, public domain, and the authority on what wears which N-number.
 * Unlike the other datasets here it is NOT fetched by this script — the FAA
 * blocks automated downloads — so the zip is downloaded by hand from
 * https://registry.faa.gov/database/ReleasableAircraft.zip, unzipped, and the
 * folder passed as an argument. The output is checked in, so this only runs
 * when someone wants a fresher fleet.
 *
 * Two files matter. MASTER.txt is every current registration and carries a
 * MFR MDL CODE; ACFTREF.txt turns that code into a manufacturer, a model and
 * a seat count. Joining them and keeping the 30-seats-and-up rows leaves the
 * airliners: every aeroplane a passenger buys a ticket on, and few of the
 * business jets that would otherwise triple the file for nobody's benefit.
 *
 * The FAA's model strings are the manufacturer's, not the traveller's: a
 * United 777 is "777-224", where the 24 is Continental's old customer code,
 * and an E175 is filed as "ERJ 170-200 LR". `friendlyType` below is where
 * that vocabulary is translated, and its rules are checked in the selftest.
 */
import { writeFileSync, mkdirSync, existsSync, createReadStream } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { parseCsv } from "../src/lib/csv-parse";
import { friendlyType } from "../src/lib/fleet";

/** Seats alone would drop the aeroplanes people still buy tickets on: a
 *  Caravan seats nine, a Beech 1900 nineteen, and both fly scheduled
 *  service. Keep the airliners by seat count and the commuters by name. */
const COMMUTER = /^(208B?|402[A-C]?|1900|B-?1900|PC-12|DHC-6|EMB-110|BN-2|340[AB]?|J-?3[12])/;
const carriesPassengers = (model: string, seats: number) =>
  seats >= 30 || (seats >= 8 && COMMUTER.test(model.trim().toUpperCase()));

/** "20100408" → "2010-04-08"; anything else → null. */
const faaDate = (v: string): string | null =>
  /^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : null;

async function main() {
  const dir = process.argv[2];
  if (!dir || !existsSync(join(dir, "MASTER.txt"))) {
    console.error(
      "Usage: npm run fleet:build -- <folder with MASTER.txt, ACFTREF.txt and DEREG.txt>\n\n" +
        "Download https://registry.faa.gov/database/ReleasableAircraft.zip in a\n" +
        "browser (the FAA blocks scripted downloads), unzip it, and pass the folder."
    );
    process.exit(1);
  }
  const col = (row: string[], head: string[], name: string) =>
    (row[head.indexOf(name)] ?? "").trim();

  /* DEREG.txt is 277 MB and MASTER.txt 193 MB — reading either into one
     string, let alone one array of arrays, exhausts the heap. Stream them a
     line at a time, parsing each line as its own small CSV so a comma inside
     a registrant's name still cannot shift the columns.

     latin1 because a few names carry high bytes; the UTF-8 BOM therefore
     arrives as three literal characters rather than U+FEFF. */
  const eachRow = async (
    file: string,
    onRow: (row: string[], head: string[]) => void
  ) => {
    const rl = createInterface({
      input: createReadStream(join(dir, file), { encoding: "latin1" }),
      crlfDelay: Infinity,
    });
    let head: string[] | null = null;
    for await (const line of rl) {
      if (!line.trim()) continue;
      const row = parseCsv(line.replace(/^(\uFEFF|ï»¿)/, ""))[0] ?? [];
      if (!head) {
        head = row.map((h) => h.trim());
        continue;
      }
      onRow(row, head);
    }
  };

  const ref = new Map<string, { type: string; seats: number; model: string }>();
  await eachRow("ACFTREF.txt", (row, head) => {
    const code = col(row, head, "CODE");
    if (!code) return;
    const model = col(row, head, "MODEL");
    ref.set(code, {
      type: friendlyType(col(row, head, "MFR"), model),
      seats: Number(col(row, head, "NO-SEATS")) || 0,
      model,
    });
  });

  /* Types are shared by thousands of airframes, so the file stores each one
     once and every registration points at it by index. */
  const types: string[] = [];
  const typeIndex = new Map<string, number>();
  const idOf = (t: string) => {
    const held = typeIndex.get(t);
    if (held != null) return held;
    types.push(t);
    typeIndex.set(t, types.length - 1);
    return types.length - 1;
  };

  /** tail → [start, type index]: a live registration has a beginning too, so
   *  a flight before it can say "not this aeroplane" instead of guessing. */
  const current: Record<string, [string, number]> = {};
  let skippedStatus = 0;
  await eachRow("MASTER.txt", (row, head) => {
    const n = col(row, head, "N-NUMBER");
    const entry = ref.get(col(row, head, "MFR MDL CODE"));
    if (!n || !entry || !carriesPassengers(entry.model, entry.seats)) return;
    /* Status V is a live registration. The rest — revoked, cancelled, in
       process, reserved — are not aircraft anyone is flying under that mark
       today, and letting them stand as "current" is how a tail comes back
       naming an aeroplane that no longer wears it. */
    if (col(row, head, "STATUS CODE") !== "V") {
      skippedStatus++;
      return;
    }
    const began =
      faaDate(col(row, head, "CERT ISSUE DATE")) ??
      faaDate(col(row, head, "AIR WORTH DATE")) ??
      "";
    current[`N${n}`] = [began, idOf(entry.type)];
  });

  /* A registration outlives its aeroplane, and it also has a BEGINNING.
     N125AA was a DC-10 until 2010 and is an A321 now; N208LS was a Caravan
     until 1993, a 767 for a few months in 2004, and is a Caravan again — a
     map holding only end dates would tell a 1990 flight it was on the 767.
     So each cancelled record becomes a real interval [start, end], and a
     record is kept even when its type matches today's: it describes a
     different stretch of the mark's life, which is the whole point. */
  const history: Record<string, [string, string, number][]> = {};
  await eachRow("DEREG.txt", (row, head) => {
    const n = col(row, head, "N-NUMBER");
    const entry = ref.get(col(row, head, "MFR-MDL-CODE"));
    if (!n || !entry || !carriesPassengers(entry.model, entry.seats)) return;
    const ended = faaDate(col(row, head, "CANCEL-DATE"));
    if (!ended) return;
    // when this registration began: its certificate, else airworthiness
    const began =
      faaDate(col(row, head, "CERT-ISSUE-DATE")) ??
      faaDate(col(row, head, "AIR-WORTH-DATE")) ??
      "";
    const tail = `N${n}`;
    const id = idOf(entry.type);
    const arr = (history[tail] ??= []);
    if (!arr.some(([b, e, t]) => b === began && e === ended && t === id))
      arr.push([began, ended, id]);
  });
  for (const arr of Object.values(history))
    arr.sort((a, b) => a[1].localeCompare(b[1]));

  const out = {
    meta: {
      source: "FAA Releasable Aircraft Database (US government work, public domain)",
      url: "https://registry.faa.gov/database/ReleasableAircraft.zip",
      builtAt: new Date().toISOString().slice(0, 10),
      count: Object.keys(current).length,
      historical: Object.keys(history).length,
      note:
        "US registrations only. Airliners (30+ seats) and scheduled commuter types. " +
        "`current` holds live (status V) registrations as [startDate, typeIndex]; " +
        "`history` holds cancelled ones " +
        "as [startDate, cancelDate, typeIndex] — real intervals, so a flight resolves " +
        "to the aeroplane wearing the mark on that day, even when the mark has been " +
        "reused more than once. Foreign marks are not in this registry.",
    },
    types,
    current,
    history,
  };
  const path = join(process.cwd(), "src/data/fleet.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(out));
  console.log(
    `Wrote ${out.meta.count} current registrations, ${out.meta.historical} with history ` +
      `(${types.length} types, ${skippedStatus} non-live records skipped)`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
