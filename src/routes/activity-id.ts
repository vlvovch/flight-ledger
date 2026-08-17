import { handled, jsonError, jsonOk } from "@/lib/api";
import { deleteActivity, getActivity, getSegment, updateActivity } from "@/lib/repo";
import { ACTIVITY_TYPES, ActivityType } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Accept or reject a proposed match, relink, or edit a manual row. */
export const PATCH = handled(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const activity = getActivity(id);
  if (!activity) return jsonError("Activity not found", 404);
  const body = await req.json();
  const patch: Record<string, unknown> = {};

  if ("segment_id" in body) {
    const segId = body.segment_id;
    if (segId != null && !getSegment(String(segId)))
      return jsonError("Flight not found", 404);
    patch.segment_id = segId;
    patch.match_status = segId ? "accepted" : "rejected";
  }
  if ("match_status" in body) {
    patch.match_status = body.match_status;
    if (body.match_status === "rejected") patch.segment_id = null;
  }
  if ("activity_type" in body) {
    const t = String(body.activity_type) as ActivityType;
    if (!ACTIVITY_TYPES.includes(t)) return jsonError("Unknown activity_type");
    patch.activity_type = t;
  }
  for (const k of ["description", "notes"] as const) {
    if (k in body) patch[k] = body[k];
  }
  for (const k of ["award_miles", "pqp", "pqf"] as const) {
    if (k in body) {
      const v = body[k];
      if (v === null || v === "") patch[k] = null;
      else {
        const n = Number(v);
        if (!isFinite(n)) return jsonError(`${k} must be a number`);
        patch[k] = n;
      }
    }
  }
  if (Object.keys(patch).length === 0) return jsonError("Nothing to update");
  updateActivity(id, patch);
  return jsonOk({ ok: true, activity: getActivity(id) });
});

export const DELETE = handled(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return deleteActivity(id)
    ? jsonOk({ ok: true })
    : jsonError("Activity not found", 404);
});
