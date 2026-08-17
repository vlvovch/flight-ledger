import { handled, jsonError, jsonOk } from "@/lib/api";
import { deletePayment, updatePayment } from "@/lib/repo";
import { preparePayment } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handled(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const p = preparePayment(await req.json(), true);
  if (!p.ok) return jsonError(p.error);
  return updatePayment(id, p.values)
    ? jsonOk({ ok: true })
    : jsonError("Payment not found", 404);
});

export const DELETE = handled(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return deletePayment(id)
    ? jsonOk({ ok: true })
    : jsonError("Payment not found", 404);
});
