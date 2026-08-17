import { handled, jsonError, jsonOk } from "@/lib/api";
import { createPayment, getTicket } from "@/lib/repo";
import { preparePayment } from "@/lib/validate";

export const dynamic = "force-dynamic";

export const POST = handled(async (req: Request) => {
  const p = preparePayment(await req.json());
  if (!p.ok) return jsonError(p.error);
  if (!getTicket(String(p.values.ticket_id)))
    return jsonError("Ticket not found", 404);
  const id = createPayment(p.values);
  return jsonOk({ ok: true, id }, 201);
});
