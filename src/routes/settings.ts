import { handled, jsonError, jsonOk } from "@/lib/api";
import { realDate } from "@/lib/validate";
import { AIRPORT_DATASET_META } from "@/lib/airports";
import { deriveTaxRates } from "@/lib/cost-estimate";
import { getSettings, listSegmentsRaw, listTickets, saveSettings } from "@/lib/repo";
import { DEFAULT_SETTINGS } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = handled(async () => {
  const settings = getSettings();
  return jsonOk({
    settings,
    airportDataset: AIRPORT_DATASET_META,
    // what the estimator actually learned from this ledger
    taxRates: deriveTaxRates(listTickets(), listSegmentsRaw(), {
      domestic: settings.tax_rate_domestic,
      international: settings.tax_rate_international,
    }),
  });
});

export const PUT = handled(async (req: Request) => {
  const body = await req.json();
  const patch: Record<string, unknown> = {};

  if ("reporting_currency" in body) {
    const c = String(body.reporting_currency ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(c)) return jsonError("reporting_currency must be a 3-letter code");
    patch.reporting_currency = c;
  }
  for (const key of [
    "award_valuation_cpm",
    "lifetime_baseline_miles",
    "missing_posting_delay_days",
  ] as const) {
    if (key in body) {
      const n = Number(body[key]);
      if (!isFinite(n) || n < 0) return jsonError(`${key} must be a non-negative number`);
      patch[key] = n;
    }
  }
  if ("estimate_cost_from_pqp" in body) {
    patch.estimate_cost_from_pqp = Boolean(body.estimate_cost_from_pqp);
  }
  // tax rates are entered as percentages and stored as fractions
  for (const key of ["tax_rate_domestic", "tax_rate_international"] as const) {
    if (key in body) {
      const v = body[key];
      if (v === null || v === "") {
        patch[key] = null;
        continue;
      }
      const n = Number(v);
      if (!isFinite(n) || n < 0 || n > 1.5)
        return jsonError(`${key} must be a fraction between 0 and 1.5`);
      patch[key] = n;
    }
  }
  /* Free text, trimmed, and empty means "not set" rather than an empty
     string — everything downstream tests for absence, not for "". */
  for (const key of ["member_first_name", "member_last_name"] as const) {
    if (key in body) {
      const v = String(body[key] ?? "").trim();
      if (v.length > 60) return jsonError(`${key} is too long`);
      patch[key] = v === "" ? null : v;
    }
  }
  for (const key of ["lifetime_baseline_date", "cost_tracking_start"] as const) {
    if (key in body) {
      const d = body[key];
      if (d != null && d !== "" && !realDate(String(d)))
        return jsonError(`${key} must be a real date, as YYYY-MM-DD`);
      patch[key] = d === "" ? null : d;
    }
  }

  if ("premier_programs" in body) {
    const v = body.premier_programs;
    if (v === null) {
      patch.premier_programs = null; // fall back to the built-in table
    } else if (!Array.isArray(v) || v.length === 0) {
      return jsonError("premier_programs must be a non-empty array, or null to reset");
    } else {
      const programs = [];
      for (const raw of v) {
        const from = Number(raw?.from);
        const minFlights = Number(raw?.minFlights);
        if (!isFinite(from) || from < 0)
          return jsonError("each Premier program needs a numeric start year");
        if (!isFinite(minFlights) || minFlights < 0)
          return jsonError("minFlights must be a non-negative number");
        if (!Array.isArray(raw?.tiers) || raw.tiers.length === 0)
          return jsonError(`the ${from} Premier program needs at least one tier`);
        const tiers = [];
        for (const t of raw.tiers) {
          const name = String(t?.name ?? "").trim();
          if (!name) return jsonError("every Premier tier needs a name");
          const nums: Record<string, number> = {};
          for (const k of ["pqp", "pqf", "pqpOnly"] as const) {
            const n = Number(t?.[k]);
            if (!isFinite(n) || n < 0)
              return jsonError(`${name}: ${k} must be a non-negative number`);
            nums[k] = n;
          }
          tiers.push({ name, pqp: nums.pqp, pqf: nums.pqf, pqpOnly: nums.pqpOnly });
        }
        programs.push({ from, minFlights, tiers });
      }
      patch.premier_programs = programs.sort((a, b) => a.from - b.from);
    }
  }

  const settings = saveSettings(patch as Partial<typeof DEFAULT_SETTINGS>);
  return jsonOk({ ok: true, settings });
});
