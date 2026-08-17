import { handled, jsonError, jsonOk } from "@/lib/api";
import { transaction } from "@/lib/db";
import {
  buildImportPreview,
  parseActivityCsv,
  segmentIdentityKey,
} from "@/lib/mileageplus-import";
import {
  createActivity,
  createSegment,
  getSegment,
  listDedupKeys,
  listSegmentsRaw,
  updateSegment,
  runAsActor,
} from "@/lib/repo";
import { prepareSegment } from "@/lib/validate";
import type { ActivityType, MatchStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/** A flight row: segment action + the activity record it came from. */
interface FlightRow {
  action: "create" | "update" | "record_only";
  segmentId?: string;
  date: string;
  carrier: string;
  number: string;
  origin: string;
  destination: string;
  pqp: number | null;
  pqf: number | null;
  award: number | null;
  lifetime: number | null;
  matchScore?: number;
  matchReasons?: string[];
}

interface ActivityRowPayload {
  key: number;
  date: string;
  description: string;
  type: ActivityType;
  award: number | null;
  pqp: number | null;
  pqf: number | null;
  dedupKey: string;
}

export const POST = handled(async (req: Request) => {
  const body = await req.json();

  if (body.mode === "preview") {
    if (typeof body.csv !== "string" || body.csv.trim() === "")
      return jsonError("No CSV content received");
    const parsed = parseActivityCsv(body.csv);
    if (parsed.error) return jsonError(parsed.error);
    return jsonOk(
      buildImportPreview(parsed.rows, listSegmentsRaw(), listDedupKeys())
    );
  }

  if (body.mode === "apply") {
    const rows = (body.rows ?? []) as FlightRow[];
    const activities = (body.activities ?? []) as ActivityRowPayload[];
    if (!Array.isArray(rows) || !Array.isArray(activities))
      return jsonError("rows and activities must be arrays");
    if (rows.length + activities.length > 5000)
      return jsonError("Too many rows in one import");

    let created = 0;
    let updated = 0;
    let recorded = 0;
    let duplicates = 0;
    const errors: string[] = [];

    runAsActor("import:mileageplus", () =>
    transaction(() => {
      const existing = listDedupKeys();
      // The client's "create" is a claim, not a command: the UI reclassifies
      // rows on every preview, but the API can't assume a preview happened. A
      // replayed or hand-crafted apply naming a flight the ledger already has
      // is downgraded to record_only against that flight, and counted.
      const segmentByIdentity = new Map(
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
      // flight rows carry their own activity payload, keyed by CSV line
      const activityByKey = new Map(activities.map((a) => [a.key, a]));

      const recordActivity = (
        a: ActivityRowPayload | undefined,
        segmentId: string | null,
        match?: { status: MatchStatus; score?: number; reasons?: string[] }
      ) => {
        if (!a) return;
        if (existing.has(a.dedupKey)) {
          duplicates++;
          return;
        }
        existing.add(a.dedupKey);
        createActivity({
          activity_date: a.date,
          description: a.description,
          activity_type: a.type,
          award_miles: a.award,
          pqp: a.pqp,
          pqf: a.pqf,
          segment_id: segmentId,
          match_status: match?.status ?? "not_applicable",
          match_score: match?.score ?? null,
          match_reason: match?.reasons ? JSON.stringify(match.reasons) : null,
          source: "csv",
          dedup_key: a.dedupKey,
        });
        recorded++;
      };

      for (const row of rows) {
        const label = `${row.carrier}${row.number} ${row.origin}→${row.destination} ${row.date}`;
        const activity = activityByKey.get(
          (row as FlightRow & { key?: number }).key ?? -1
        );
        activityByKey.delete((row as FlightRow & { key?: number }).key ?? -1);
        let segmentId: string | null = row.segmentId ?? null;
        let action = row.action;

        if (action === "create") {
          const identity = segmentIdentityKey(row);
          const dup = segmentByIdentity.get(identity);
          if (dup) {
            // already in the ledger — keep the posting linked, skip the write
            duplicates++;
            segmentId = dup;
            action = "record_only";
          }
        }

        if (action === "create") {
          const p = prepareSegment({
            marketing_carrier: row.carrier,
            flight_number: row.number,
            origin: row.origin,
            destination: row.destination,
            flight_date: row.date,
            status: "flown_reconciled",
            pqp: row.pqp,
            pqf: row.pqf,
            award_miles: row.award,
            lifetime_miles: row.lifetime,
          });
          if (!p.ok) {
            errors.push(`${label}: ${p.error}`);
            continue;
          }
          segmentId = createSegment(p.values);
          segmentByIdentity.set(segmentIdentityKey(row), segmentId);
          created++;
        } else if (action === "update") {
          if (!segmentId || !getSegment(segmentId)) {
            errors.push(`${label}: matched flight no longer exists`);
            continue;
          }
          const p = prepareSegment(
            {
              marketing_carrier: row.carrier,
              flight_number: row.number,
              status: "flown_reconciled",
              pqp: row.pqp,
              pqf: row.pqf,
              award_miles: row.award,
              lifetime_miles: row.lifetime,
            },
            true
          );
          if (!p.ok) {
            errors.push(`${label}: ${p.error}`);
            continue;
          }
          // CSV blanks must not clear values the user already entered
          for (const k of ["pqp", "pqf", "award_miles", "lifetime_miles"] as const) {
            if (p.values[k] == null) delete p.values[k];
          }
          updateSegment(segmentId, p.values);
          updated++;
        }
        // record_only: nothing written to the flight (already up to date, or
        // the user kept their own values) — but the row is still this flight's
        // posting, so the link is kept either way
        recordActivity(activity, segmentId, {
          status: segmentId
            ? action === "record_only"
              ? "accepted"
              : "auto"
            : "unmatched",
          score: row.matchScore,
          reasons: row.matchReasons,
        });
      }

      // non-flight activity (and flight rows the user left out entirely)
      for (const a of activityByKey.values()) recordActivity(a, null);
    }));

    return jsonOk({
      ok: true,
      created,
      updated,
      recorded,
      duplicates,
      errors,
    });
  }

  return jsonError('mode must be "preview" or "apply"');
});
