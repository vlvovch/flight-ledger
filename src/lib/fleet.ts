/*
 * Tail number → aircraft type.
 *
 * Two sources, in order of authority over YOUR flights:
 *
 *  1. The ledger itself. Every flight where you named both the tail and the
 *     type teaches a map, and your own words win — you may write "757-200W"
 *     or "Polaris 767", and a registry has no business overruling that.
 *  2. The FAA's Releasable Aircraft Database (public domain), vendored as
 *     src/data/fleet.json by scripts/build-fleet.ts. US marks only: an
 *     N-number resolves, a D-, G- or JA- mark is simply not in the registry
 *     the US government keeps.
 *
 * The registry answers the first time you meet an airframe; the ledger takes
 * over the moment you correct it.
 */
/* The vendored registry is ~1.3 MB and most sessions never type a tail
   number, so it is NOT part of the initial bundle: `loadFleetRegistry()`
   pulls it in on demand and everything below answers from the ledger alone
   until it arrives. The lookup stays synchronous — it runs while a form
   renders — so the module keeps the loaded data rather than returning a
   promise from every call. */
type Registry = {
  meta: FleetMeta;
  types: string[];
  current: Record<string, [string, number]>;
  history: Record<string, [string, string, number][]>;
};
type FleetMeta = {
  source: string;
  url: string;
  builtAt: string;
  count: number;
  historical: number;
  note: string;
};

let REG: Registry | null = null;
let loading: Promise<void> | null = null;

/** Bring the FAA registry into memory; safe to call as often as you like. */
export function loadFleetRegistry(): Promise<void> {
  if (REG) return Promise.resolve();
  loading ??= import("@/data/fleet.json").then((m) => {
    REG = (m.default ?? m) as unknown as Registry;
  });
  return loading;
}

/** True once the registry can answer — the UI uses it to re-render. */
export const fleetRegistryReady = () => REG != null;

export const fleetDatasetMeta = (): FleetMeta | null => REG?.meta ?? null;

/** Compare registrations the way people write them: case and hyphens vary. */
export const normalizeTail = (tail: string): string =>
  tail.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * The manufacturer's model as the FAA files it, said the way a passenger
 * says it.
 *
 * The FAA records what the factory called the frame, which is not what the
 * airline sells: a United 777 is filed as "777-224" — the 24 is Continental's
 * customer code, a fingerprint of who ordered it — and the aeroplane everyone
 * calls an E175 is an "ERJ 170-200 LR", the stretch of the 170 airframe.
 * Exported (and checked) because these rules are guesses about vocabulary,
 * not facts about data, and they should fail loudly if they drift.
 */
export function friendlyType(mfr: string, model: string): string {
  const m = model.trim().toUpperCase().replace(/\s+/g, " ");
  const maker = mfr.trim().toUpperCase();

  /* MODEL first, maker second. The registry spells one manufacturer many
     ways — an A220 arrives as "AIRBUS CANADA", "C" or "MHI"; an E195 as
     "EMPRESA" — so keying on the maker's name loses aircraft to whoever
     owned the programme that year. The model signature does not move. */
  const a220 = m.match(/^BD-500-1A(1[01])/);
  if (a220) return a220[1] === "11" ? "A220-300" : "A220-100";

  const crj: Record<string, string> = {
    "2B19": "CRJ-200", "2C10": "CRJ-700", "2C11": "CRJ-550",
    "2D24": "CRJ-900", "2E25": "CRJ-1000",
  };
  const crjm = m.match(/^CL-600-(2[A-Z]\d{2})/);
  if (crjm && crj[crjm[1]]) return crj[crjm[1]];

  const ejet = m.match(/^ERJ\s*(1[79]0)-([12])00/);
  if (ejet) {
    const map: Record<string, string> = {
      "170-1": "E170", "170-2": "E175", "190-1": "E190", "190-2": "E195",
    };
    return map[`${ejet[1]}-${ejet[2]}`] ?? `E${ejet[1]}`;
  }
  const erj = m.match(/^EMB-(1[34][05])/);
  if (erj) return `ERJ-${erj[1]}`;
  if (/^EMB-110/.test(m)) return "EMB-110 Bandeirante";

  const dash = m.match(/^DHC-8-([1234])0[0-9]/);
  if (dash) return dash[1] === "4" ? "Q400" : `Dash 8-${dash[1]}00`;
  if (/^DHC-6/.test(m)) return "DHC-6 Twin Otter";

  const atr = m.match(/^ATR[- ]?(42|72)/);
  if (atr) return `ATR ${atr[1]}`;

  // the commuter aeroplanes people still buy tickets on
  if (/^208B?/.test(m)) return "C208 Caravan";
  if (/^402[A-C]?$/.test(m)) return "C402";
  if (/^(1900|B-?1900)/.test(m)) return "Beech 1900";
  if (/^PC-12/.test(m)) return "PC-12";
  if (/^SAAB|^340[AB]?$/.test(m)) return "Saab 340";

  const md = m.match(/^DC-9-(8[0-7])/);
  if (md) return `MD-${md[1]}`;
  if (/^MD-(11|8[0-9]|90)/.test(m)) return m;

  // Boeing: a bare variant is a MAX; otherwise collapse the customer code
  const max = m.match(/^737-(7|8|9|10)$/);
  if (max) return `B737 MAX ${max[1]}`;
  const dreamliner = m.match(/^787-(8|9|10)$/);
  if (dreamliner) return `B787-${dreamliner[1]}`;
  /* the customer code collapses ("777-222" is a 777-200 United ordered),
     but a trailing ER/LR is the airplane, not the buyer — keep it. Most
     FAA rows omit it even for ERs (the type certificate doesn't split
     them), so absence proves nothing; presence does. */
  const boeing = m.match(/^(7[0-9]7)-([0-9])[A-Z0-9]{2}\s*(ER|LR)?/);
  if (boeing) return `B${boeing[1]}-${boeing[2]}00${boeing[3] ?? ""}`;

  // Airbus: the family name alone on the narrowbodies, variant on the rest
  const airbus = m.match(/^A(3[0-8][0-9])-([0-9])[0-9A-Z]{2}(N|NX)?$/);
  if (airbus) {
    const [, series, variant, neo] = airbus;
    const base = /^3[3-8]/.test(series) ? `A${series}-${variant}00` : `A${series}`;
    return neo ? `${base}neo` : base;
  }

  // some rows arrive with the B already on ("B777-200ER") — don't double it
  if (maker.startsWith("BOEING")) return m.startsWith("B") ? m : `B${m}`;
  if (maker.startsWith("AIRBUS")) return m.startsWith("A") ? m : `A${m}`;
  // everything else keeps the factory's own words, one maker word for context
  return `${maker.split(/\s+/)[0]} ${m}`.trim();
}

/** What YOU logged this tail as, and when — oldest first. */
export type LearnedFleet = Map<string, { date: string; type: string }[]>;

/**
 * The types this tail has worn in your own ledger.
 *
 * A registration outlives its aeroplane, and so does a ledger: the same mark
 * can be a DC-10 in 2005 and an A321 today. Keeping every entry with its date
 * lets an old flight answer with the aeroplane that flew it.
 */
export function learnFleet(
  segments: {
    tail_number?: string | null;
    aircraft?: string | null;
    flight_date: string;
  }[]
): LearnedFleet {
  const out: LearnedFleet = new Map();
  for (const s of segments) {
    const tail = (s.tail_number ?? "").trim();
    const type = (s.aircraft ?? "").trim();
    if (!tail || !type) continue;
    const key = normalizeTail(tail);
    const arr = out.get(key) ?? [];
    arr.push({ date: s.flight_date, type });
    out.set(key, arr);
  }
  for (const arr of out.values()) arr.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/**
 * What this tail flew as on a given date.
 *
 * Your own ledger first, then the registry — and both are read AT THE DATE,
 * because an N-number is reissued: N125AA was a DC-10 until 2010 and is an
 * A321 now, so a 2005 flight answered with today's registration would name
 * an aeroplane that did not exist on that route. With no date, the question
 * is "what is it now", and the current registration answers.
 */
export function typeForTail(
  tail: string,
  opts: { date?: string | null; learned?: LearnedFleet } = {}
): string | null {
  const key = normalizeTail(tail);
  if (!key) return null;
  const { date, learned } = opts;
  const mine = learned?.get(key);

  /* Which registration was in force on a date — the interval that contains
     it, and nothing else. A mark can be reused twice with years of silence
     between (a Caravan, then a 767 for a season, then a Caravan again), and
     answering for a gap would be invention, not knowledge. */
  const periodAt = (d: string): { id: number; from: string } | null => {
    if (!REG) return null;
    const spans = (REG.history[key] ?? []).filter(
      ([from, to]) => to >= d && (!from || from <= d)
    );
    const live = REG.current[key];
    if (live && (!live[0] || live[0] <= d)) {
      const noneLater = spans.every(([from]) => from <= (live[0] || ""));
      if (spans.length === 0 || noneLater) return { id: live[1], from: live[0] };
    }
    if (spans.length === 0) return null;
    const best = spans.reduce((a, b) => (a[0] >= b[0] ? a : b));
    return { id: best[2], from: best[0] };
  };

  if (!date) {
    // "what is it now": your latest word, else the live registration
    if (mine && mine.length > 0) return mine[mine.length - 1].type;
    const live = REG?.current[key];
    return live ? (REG!.types[live[1]] ?? null) : null;
  }

  const era = periodAt(date);
  if (mine && mine.length > 0) {
    /* Your own flight answers only for its OWN registration period. You flew
       this mark as a DC-10 in 2005; that says nothing about 2020, when the
       number had been reissued to an Airbus — in either direction. */
    const inSameEra = (e: { date: string }) => {
      if (!era) return false;
      const theirs = periodAt(e.date);
      return theirs != null && theirs.from === era.from;
    };
    /* Within one registration the airframe is the same aeroplane, so any
       flight of yours on it can answer — but the nearest one AT OR BEFORE
       this date is the best witness, and only if none exists does a later
       flight on the same registration speak. */
    const sameEra =
      [...mine].reverse().find((e) => e.date <= date && inSameEra(e)) ??
      mine.find((e) => inSameEra(e));
    if (sameEra) return sameEra.type;
    if (!era) {
      /* Nothing in the registry covers this date, and that means two very
         different things. A mark the FAA never holds at all (D-AIMA,
         JA873A) — or the registry not loaded yet — leaves your ledger as
         the only witness, so any flight of yours answers. But a KNOWN gap
         between two registrations is not silence: the registry says this
         mark was on nothing then, and projecting a DC-10 you flew in 2005
         into 2020 invents an aeroplane. There, only a flight whose own
         date falls in the same gap can speak. */
      const unknownTail =
        !REG || (REG.current[key] == null && (REG.history[key] ?? []).length === 0);
      /* Two silences are not the same silence. A mark can be unregistered
         in 2008, wear an aeroplane from 2009 to 2011, and fall quiet again
         in 2012 — a flight logged in the first gap says nothing about the
         second. A gap is identified by the registration that CLOSED it:
         same neighbours, same gap. */
      const gapId = (d: string): string => {
        if (!REG) return "";
        const spans = [
          ...(REG.history[key] ?? []).map(([, ended]) => ended),
          ...(REG.current[key]?.[0] ? [REG.current[key][0]] : []),
        ].sort();
        const before = spans.filter((x) => x <= d).pop() ?? "";
        const after = spans.find((x) => x > d) ?? "";
        return `${before}|${after}`;
      };
      const here = gapId(date);
      const eligible = unknownTail
        ? mine
        : mine.filter((e) => periodAt(e.date) == null && gapId(e.date) === here);
      if (eligible.length === 0) return null;
      const before = [...eligible].reverse().find((e) => e.date <= date);
      return (before ?? eligible[0]).type;
    }
  }
  return era ? (REG!.types[era.id] ?? null) : null;
}
