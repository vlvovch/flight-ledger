import { handled, jsonError, jsonOk } from "@/lib/api";
import { deleteAdjustment, updateAdjustment } from "@/lib/repo";
import { prepareAdjustment } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handled(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const p = prepareAdjustment(await req.json(), true);
  if (!p.ok) return jsonError(p.error);
  return updateAdjustment(id, p.values)
    ? jsonOk({ ok: true })
    : jsonError("Adjustment not found", 404);
});

export const DELETE = handled(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return deleteAdjustment(id)
    ? jsonOk({ ok: true })
    : jsonError("Adjustment not found", 404);
});
