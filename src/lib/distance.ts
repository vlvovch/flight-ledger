import { getAirport } from "./airports";
import bisData from "@/data/bis-mileage.json";
import { MINIMUM_CREDITED_MILES } from "./types";

/** Earth mean radius in statute miles — the sphere the haversine fallback uses. */
const EARTH_RADIUS_MILES = 3958.7613;

/* WGS84 ellipsoid */
const WGS84_A = 6378137; // semi-major axis, metres
const WGS84_F = 1 / 298.257223563; // flattening
const WGS84_B = (1 - WGS84_F) * WGS84_A; // semi-minor axis
const METRES_PER_MILE = 1609.344;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in statute miles on a sphere, via haversine. */
export function haversineMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lon2 - lon1);
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_MILES * c;
}

/**
 * Geodesic distance in statute miles on the WGS84 ellipsoid — Vincenty's
 * inverse solution.
 *
 * A single-radius sphere cannot be right everywhere: the Earth's radius of
 * curvature grows toward the poles, so a mean radius under-measures
 * mid-latitude routes and over-measures equatorial ones. On IAH–SFO the sphere
 * gives 1,632 where the ellipsoid gives 1,635 — and 1,635 is the figure the
 * flying world quotes, because Great Circle Mapper and the mileage tables
 * everyone checks against solve on the ellipsoid too. Being consistently 0.17%
 * light against the numbers this ledger is reconciled with is not a rounding
 * detail; it is a bias.
 *
 * Vincenty fails to converge on near-antipodal pairs (no airport route is, but
 * the guard is cheap), where it falls back to the spherical answer.
 */
export function geodesicMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const L = toRad(lon2 - lon1);
  const U1 = Math.atan((1 - WGS84_F) * Math.tan(toRad(lat1)));
  const U2 = Math.atan((1 - WGS84_F) * Math.tan(toRad(lat2)));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);

  let lambda = L;
  let lambdaPrev = 0;
  let iterations = 0;
  let sinSigma = 0;
  let cosSigma = 0;
  let sigma = 0;
  let sinAlpha = 0;
  let cos2SigmaM = 0;

  do {
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    sinSigma = Math.sqrt(
      (cosU2 * sinLambda) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) ** 2
    );
    if (sinSigma === 0) return 0; // coincident points
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    const cosSqAlpha = 1 - sinAlpha * sinAlpha;
    // 0 on an equatorial line, where the correction term is undefined
    cos2SigmaM = cosSqAlpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha;
    const C = (WGS84_F / 16) * cosSqAlpha * (4 + WGS84_F * (4 - 3 * cosSqAlpha));
    lambdaPrev = lambda;
    lambda =
      L +
      (1 - C) *
        WGS84_F *
        sinAlpha *
        (sigma +
          C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));
  } while (Math.abs(lambda - lambdaPrev) > 1e-12 && ++iterations < 200);

  if (iterations >= 200) return haversineMiles(lat1, lon1, lat2, lon2);

  const uSq = ((1 - sinAlpha * sinAlpha) * (WGS84_A ** 2 - WGS84_B ** 2)) / WGS84_B ** 2;
  const A =
    1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma =
    B *
    sinSigma *
    (cos2SigmaM +
      (B / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM ** 2) -
          (B / 6) *
            cos2SigmaM *
            (-3 + 4 * sinSigma ** 2) *
            (-3 + 4 * cos2SigmaM ** 2)));

  return (WGS84_B * A * (sigma - deltaSigma)) / METRES_PER_MILE;
}

/** United's published credited mileages, one entry per unordered pair. */
const bisPairs = bisData.pairs as Record<string, number>;
export const BIS_TABLE_META = bisData.meta as {
  source: string;
  note: string;
  builtAt: string;
  count: number;
};

const pairKey = (a: string, b: string) => [a, b].sort().join("-");

/** The published figure for a pair, either direction, or null if unlisted. */
export function publishedMiles(origin: string, destination: string): number | null {
  const a = origin.trim().toUpperCase();
  const b = destination.trim().toUpperCase();
  return bisPairs[pairKey(a, b)] ?? null;
}

/**
 * How far this pair actually is, or null when the route can't be placed.
 *
 * The published table wins where it has an entry, because United's own figure
 * is a better answer than our geometry for a pair it covers. The one exception
 * is an entry of exactly 500 on a pair shorter than that: it is the crediting
 * minimum baked into the table, not a distance, so the geometry is the honest
 * answer. This is a DISTANCE — no minimum is applied here. See
 * `creditedMiles` for what United pays out on it.
 */
export function routeDistanceMiles(
  origin: string,
  destination: string
): number | null {
  const o = getAirport(origin);
  const d = getAirport(destination);
  if (!o || !d) return null;
  const geo = geodesicMiles(o.lat, o.lon, d.lat, d.lon);
  const published = publishedMiles(origin, destination);
  const publishedIsTheFloor =
    published === MINIMUM_CREDITED_MILES && geo < MINIMUM_CREDITED_MILES;
  return published != null && !publishedIsTheFloor ? published : geo;
}

/**
 * Miles United credits for flying it: the distance, but never less than the
 * per-segment minimum. Keep this away from anything measuring how far you
 * actually went — a 135-mile hop credits 500 and flies 135, and quoting the
 * credited figure as distance makes its cents-per-mile read a third of the
 * truth.
 */
export function creditedMiles(origin: string, destination: string): number | null {
  const d = routeDistanceMiles(origin, destination);
  return d == null ? null : Math.max(d, MINIMUM_CREDITED_MILES);
}
