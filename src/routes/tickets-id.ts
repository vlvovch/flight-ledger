import { handled, jsonError, jsonOk } from "@/lib/api";
import { deleteTicket, getTicket, updateTicket } from "@/lib/repo";
import { prepareTicket } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handled(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!getTicket(id)) return jsonError("Ticket not found", 404);
  const p = prepareTicket(await req.json(), true);
  if (!p.ok) return jsonError(p.error);
  updateTicket(id, p.values);
  return jsonOk({ ok: true });
});

export const DELETE = handled(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  return deleteTicket(id)
    ? jsonOk({ ok: true })
    : jsonError("Ticket not found", 404);
});
