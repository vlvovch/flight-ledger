import { handled, jsonError, jsonOk } from "@/lib/api";
import { realDate } from "@/lib/validate";
import {
  createActivity,
  getEnrichedData,
  getSettings,
  listActivities,
} from "@/lib/repo";
import { ACTIVITY_TYPES, ActivityType, isFlightActivity } from "@/lib/types";
import { DEFAULT_PREMIER_PROGRAMS, buildPremierYears } from "@/lib/premier";
import { todayStr } from "@/lib/format";

export const dynamic = "force-dynamic";

export const GET = handled(async () => {
  const data = getEnrichedData();
  const settings = getSettings();
  const segById = new Map(data.segments.map((s) => [s.id, s]));
  const activities = data.activities.map((a) => ({
    ...a,
    reasons: a.match_reason ? (JSON.parse(a.match_reason) as string[]) : null,
    segment_label: a.segment_id
      ? (() => {
          const s = segById.get(a.segment_id);
          return s ? `${s.origin}→${s.destination} ${s.flight_date}` : null;
        })()
      : null,
  }));

  const totals = activities.reduce(
    (acc, a) => {
      const flight = isFlightActivity(a.activity_type);
      acc.pqp += a.pqp ?? 0;
      acc.award += a.award_miles ?? 0;
      if (!flight) {
        acc.nonFlightPqp += a.pqp ?? 0;
        acc.nonFlightAward += a.award_miles ?? 0;
      }
      return acc;
    },
    { pqp: 0, award: 0, nonFlightPqp: 0, nonFlightAward: 0 }
  );

  // Status qualification is earned by flights AND non-flight activity, so it's
  // computed from both ledgers rather than from the activity rows alone.
  const premier = buildPremierYears(
    data.segments,
    data.activities,
    settings.premier_programs ?? DEFAULT_PREMIER_PROGRAMS,
    todayStr(),
    settings.lifetime_baseline_miles || 0
  );

  return jsonOk({
    activities,
    totals,
    premier,
    premierPrograms: settings.premier_programs ?? DEFAULT_PREMIER_PROGRAMS,
    premierProgramsAreDefaults: settings.premier_programs == null,
  });
});

export const POST = handled(async (req: Request) => {
  const body = await req.json();
  const date = String(body.activity_date ?? "").trim();
  // the calendar, not the shape: 2026-02-31 sorts into a month nothing owns
  if (!realDate(date))
    return jsonError("activity_date must be a real date, as YYYY-MM-DD");
  const description = String(body.description ?? "").trim();
  if (!description) return jsonError("description is required");
  const type = String(body.activity_type ?? "other") as ActivityType;
  if (!ACTIVITY_TYPES.includes(type))
    return jsonError(`activity_type must be one of: ${ACTIVITY_TYPES.join(", ")}`);

  const numOrNull = (v: unknown) => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return isFinite(n) ? n : undefined;
  };
  const award = numOrNull(body.award_miles);
  const pqp = numOrNull(body.pqp);
  const pqf = numOrNull(body.pqf);
  if (award === undefined || pqp === undefined || pqf === undefined)
    return jsonError("award_miles, pqp and pqf must be numbers");

  const id = createActivity({
    activity_date: date,
    description,
    activity_type: type,
    award_miles: award,
    pqp,
    pqf,
    match_status: "not_applicable",
    source: "manual",
    notes: body.notes ?? null,
  });
  return jsonOk({ ok: true, id }, 201);
});
