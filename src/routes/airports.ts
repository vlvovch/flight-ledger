import { handled, jsonOk } from "@/lib/api";
import { getAirport, searchAirports } from "@/lib/airports";
import { routeDistanceMiles } from "@/lib/distance";

export const dynamic = "force-dynamic";

export const GET = handled(async (req: Request) => {
  const params = new URL(req.url).searchParams;
  // "?codes=SFO,EWR,…" — coordinates for the flight map, only for airports
  // the ledger actually touches; the client never downloads the full dataset
  const codes = params.get("codes");
  if (codes != null) {
    const out: Record<
      string,
      { lat: number; lon: number; country: string | null; city: string | null; name: string }
    > = {};
    for (const c of codes.split(",").map((s) => s.trim().toUpperCase())) {
      const a = c ? getAirport(c) : undefined;
      if (a) out[c] = { lat: a.lat, lon: a.lon, country: a.country, city: a.city, name: a.name };
    }
    return jsonOk({ airports: out });
  }
  const from = params.get("from");
  const to = params.get("to");
  if (from && to) {
    return jsonOk({
      from: getAirport(from) ?? null,
      to: getAirport(to) ?? null,
      distance: routeDistanceMiles(from, to),
    });
  }
  const q = params.get("q") ?? "";
  return jsonOk({ airports: searchAirports(q, 8) });
});
