import { handled, jsonError, jsonOk } from "@/lib/api";
import { createTicket, getEnrichedData } from "@/lib/repo";
import { prepareTicket } from "@/lib/validate";

export const dynamic = "force-dynamic";

export const GET = handled(async () => {
  const data = getEnrichedData();
  const label = (t: { confirmation_code: string | null; ticket_number: string | null }) =>
    [t.confirmation_code, t.ticket_number].filter(Boolean).join(" · ") ||
    "(untitled ticket)";
  const tickets = data.tickets.map((t) => {
    const predecessor = t.predecessor_ticket_id
      ? data.tickets.find((x) => x.id === t.predecessor_ticket_id)
      : undefined;
    const successor = data.tickets.find((x) => x.predecessor_ticket_id === t.id);
    return {
      ...t,
      allocation: data.allocations[t.id],
      adjustments: data.adjustments.filter((a) => a.ticket_id === t.id),
      payments: data.payments.filter((p) => p.ticket_id === t.id),
      segments: data.segments.filter((s) => s.ticket_id === t.id),
      predecessor_label: predecessor ? label(predecessor) : null,
      successor_id: successor?.id ?? null,
      successor_label: successor ? label(successor) : null,
    };
  });
  return jsonOk({ tickets });
});

export const POST = handled(async (req: Request) => {
  const p = prepareTicket(await req.json());
  if (!p.ok) return jsonError(p.error);
  const id = createTicket(p.values);
  return jsonOk({ ok: true, id }, 201);
});
