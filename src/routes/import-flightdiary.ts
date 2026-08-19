import { handled, jsonError, jsonOk } from "@/lib/api";
import { transaction } from "@/lib/db";
import {
  buildFlightDiaryPreview,
  diaryFills,
  parseFlightLog,
  type DiaryRow,
} from "@/lib/flightdiary-import";
import { segmentIdentityKey } from "@/lib/mileageplus-import";
import {
  createSegment,
  getSegment,
  listSegmentsRaw,
  runAsActor,
  updateSegment,
} from "@/lib/repo";
import { prepareSegment } from "@/lib/validate";

export const dynamic = "force-dynamic";

interface ApplyRow {
  action: "create" | "fill";
  segmentId?: string;
  status?: "flown_unreconciled" | "ticketed";
  row: DiaryRow;
}

export const POST = handled(async (req: Request) => {
  const body = await req.json();

  if (body.mode === "preview") {
    if (typeof body.csv !== "string" || body.csv.trim() === "")
      return jsonError("No CSV content received");
    const parsed = parseFlightLog(body.csv);
    if (parsed.error) return jsonError(parsed.error);
    const preview = buildFlightDiaryPreview(parsed.rows, listSegmentsRaw());
    return jsonOk({
      rows: preview.rows,
      skipped: [...parsed.skipped, ...preview.skipped],
    });
  }

  if (body.mode === "apply") {
    const rows = (body.rows ?? []) as ApplyRow[];
    if (!Array.isArray(rows)) return jsonError("rows must be an array");
    if (rows.length > 5000) return jsonError("Too many rows in one import");

    let created = 0;
    let filled = 0;
    let duplicates = 0;
    const errors: string[] = [];

    runAsActor("import:flightdiary", () =>
      transaction(() => {
        // The client's "create" is a claim, not a command (same rule as the
        // MileagePlus import): re-key every row against the ledger inside
        // the transaction, so a replayed apply cannot double a flight.
        const byIdentity = new Map(
          listSegmentsRaw().map((s) => [
            segmentIdentityKey({
              date: s.flight_date,
              carrier: s.marketing_carrier,
              number: s.flight_number,
              origin: s.origin,
              destination: s.destination,
            }),
            s.id,
          ])
        );

        for (const r of rows) {
          const row = r.row;
          const label = `${row.carrier ?? ""}${row.flight_number ?? ""} ${row.origin}→${row.destination} ${row.date}`;
          const identity = segmentIdentityKey({
            date: row.date,
            carrier: row.carrier,
            number: row.flight_number,
            origin: row.origin,
            destination: row.destination,
          });

          let action = r.action;
          let segmentId = r.segmentId ?? null;
          if (action === "create" && byIdentity.has(identity)) {
            action = "fill";
            segmentId = byIdentity.get(identity)!;
            duplicates++;
          }

          if (action === "create") {
            const p = prepareSegment({
              marketing_carrier: row.carrier,
              flight_number: row.flight_number,
              origin: row.origin,
              destination: row.destination,
              flight_date: row.date,
              departure_time: row.departure_time,
              arrival_time: row.arrival_time,
              cabin: row.cabin,
              seat: row.seat,
              aircraft: row.aircraft,
              tail_number: row.tail_number,
              purpose: row.purpose,
              notes: row.note,
              status: r.status ?? "flown_unreconciled",
            });
            if (!p.ok) {
              errors.push(`${label}: ${p.error}`);
              continue;
            }
            byIdentity.set(identity, createSegment(p.values));
            created++;
            continue;
          }

          // fill: blanks only, recomputed server-side against the row as it
          // is NOW — the preview's list may predate another import's write
          const seg = segmentId ? getSegment(segmentId) : null;
          if (!seg) {
            errors.push(`${label}: matched flight no longer exists`);
            continue;
          }
          const fills = diaryFills(row, seg);
          if (fills.length === 0) continue;
          const patch: Record<string, string | null> = {};
          // an ACTUAL time corrects a differing stored one; a schedule only
          // ever fills a blank — mirrors diaryFills exactly
          if (
            row.departure_time != null &&
            (seg.departure_time == null ||
              (row.departure_actual === true &&
                seg.departure_time !== row.departure_time))
          )
            patch.departure_time = row.departure_time;
          if (
            row.arrival_time != null &&
            (seg.arrival_time == null ||
              (row.arrival_actual === true &&
                seg.arrival_time !== row.arrival_time))
          )
            patch.arrival_time = row.arrival_time;
          if (seg.cabin == null && row.cabin != null) patch.cabin = row.cabin;
          if (seg.seat == null && row.seat != null) patch.seat = row.seat;
          if (seg.aircraft == null && row.aircraft != null)
            patch.aircraft = row.aircraft;
          if (seg.tail_number == null && row.tail_number != null)
            patch.tail_number = row.tail_number;
          if (seg.purpose == null && row.purpose != null)
            patch.purpose = row.purpose;
          if (seg.notes == null && row.note != null) patch.notes = row.note;
          const p = prepareSegment(patch, true);
          if (!p.ok) {
            errors.push(`${label}: ${p.error}`);
            continue;
          }
          updateSegment(seg.id, p.values);
          filled++;
        }
      })
    );

    return jsonOk({ ok: true, created, filled, duplicates, errors });
  }

  return jsonError("Unknown mode");
});
