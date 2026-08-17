import airportData from "@/data/airports.json";

export interface Airport {
  iata: string;
  icao: string | null;
  name: string;
  city: string | null;
  country: string | null;
  lat: number;
  lon: number;
  size: string; // L | M | S
  sched: number;
}

export const AIRPORT_DATASET_META = airportData.meta as {
  source: string;
  url: string;
  fetchedAt: string;
  count: number;
};

const byIata = new Map<string, Airport>();
for (const a of airportData.airports as Airport[]) {
  byIata.set(a.iata, a);
}

export function getAirport(iata: string): Airport | undefined {
  return byIata.get(iata.trim().toUpperCase());
}

const sizeRank: Record<string, number> = { L: 0, M: 1, S: 2 };

/** Search by IATA code, city, or name. Exact IATA match ranks first. */
export function searchAirports(query: string, limit = 8): Airport[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const qUpper = q.toUpperCase();
  const results: { a: Airport; score: number }[] = [];
  for (const a of byIata.values()) {
    let score = -1;
    if (a.iata === qUpper) score = 1000;
    else if (a.iata.startsWith(qUpper) && q.length <= 3) score = 500;
    else if (a.city && a.city.toLowerCase().startsWith(q)) score = 300;
    else if (a.city && a.city.toLowerCase().includes(q)) score = 150;
    else if (a.name.toLowerCase().includes(q)) score = 100;
    if (score < 0) continue;
    score += (a.sched ? 50 : 0) + (10 - sizeRank[a.size] * 5);
    results.push({ a, score });
  }
  results.sort((x, y) => y.score - x.score || x.a.iata.localeCompare(y.a.iata));
  return results.slice(0, limit).map((r) => r.a);
}
