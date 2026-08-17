import { handled, jsonError, jsonOk } from "@/lib/api";
import { deleteSegment, getSegment, updateSegment } from "@/lib/repo";
import { prepareSegment } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handled(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const seg = getSegment(id);
  return seg ? jsonOk(seg) : jsonError("Flight not found", 404);
});

export const PATCH = handled(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!getSegment(id)) return jsonError("Flight not found", 404);
  const p = prepareSegment(await req.json(), true);
  if (!p.ok) return jsonError(p.error);
  updateSegment(id, p.values);
  return jsonOk({ ok: true, segment: getSegment(id) });
});

export const DELETE = handled(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return deleteSegment(id) ? jsonOk({ ok: true }) : jsonError("Flight not found", 404);
});
