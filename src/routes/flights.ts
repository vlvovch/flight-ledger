import { handled, jsonError, jsonOk } from "@/lib/api";
import { createSegment, getEnrichedData, getSegment } from "@/lib/repo";
import { prepareSegment } from "@/lib/validate";

export const dynamic = "force-dynamic";

export const GET = handled(async () => {
  const data = getEnrichedData();
  return jsonOk({ flights: data.segments });
});

export const POST = handled(async (req: Request) => {
  const body = await req.json();
  const p = prepareSegment(body);
  if (!p.ok) return jsonError(p.error);
  const id = createSegment(p.values);
  return jsonOk({ ok: true, id, segment: getSegment(id) }, 201);
});
