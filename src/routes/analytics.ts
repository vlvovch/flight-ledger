import { handled, jsonOk } from "@/lib/api";
import { todayStr } from "@/lib/format";
import { backupIsEmpty } from "@/lib/drive-sync";
import { buildAnalytics } from "@/lib/metrics";
import {
  DEFAULT_PREMIER_PROGRAMS,
  buildPremierYears,
  pathFor,
  shortfall,
  tierFor,
} from "@/lib/premier";
import { buildReconcileReport } from "@/lib/reconcile";
import { getEnrichedData, getSettings } from "@/lib/repo";

export const dynamic = "force-dynamic";

export const GET = handled(async () => {
  const data = getEnrichedData();
  const settings = getSettings();
  const analytics = buildAnalytics(data);
  const reconcile = buildReconcileReport(data, settings);

  /* The current qualification year's standing, from the same machinery the
     MileagePlus page runs — tier, next rung, and the ask, with the pqp-only
     route and the UA-flight floor already reasoned about. The dashboard card
     states the flight-inclusive ask inline and hands the full sentence to
     the tooltip; recomputing any of it client-side would be a second
     opinion.

     The standing the card prints is posted PLUS flown-awaiting-credit, so
     the tier, the next rung, and the ask are ALL read off that same number —
     mixing the lib's posted-only tier with an estimated standing let pending
     credit cross a threshold while the payload still named the old rung and
     asked for 0 more toward it. A tier the posted totals haven't confirmed
     is flagged estimated, and wears the app's ≈ on the card. */
  const thisYear = todayStr().slice(0, 4);
  const yearNow =
    buildPremierYears(
      data.segments,
      data.activities,
      settings.premier_programs ?? DEFAULT_PREMIER_PROGRAMS,
      todayStr(),
      settings.lifetime_baseline_miles || 0
    ).find((y) => y.year === thisYear) ?? null;
  let premierNow = null;
  if (yearNow) {
    const standingPqp = Math.round(yearNow.pqp + yearNow.flownPendingPqp);
    const standingPqf = yearNow.pqf + yearNow.flownPendingPqf;
    const { program } = yearNow;
    const tierEst = tierFor(standingPqp, standingPqf, program, yearNow.uaFlights);
    const nextEst =
      program.tiers.find(
        (t) =>
          !pathFor(standingPqp, standingPqf, t, program.minFlights, yearNow.uaFlights)
      ) ?? null;
    premierNow = {
      tier: tierEst?.name ?? null,
      /* reached on the ≈ standing but not yet on posted totals */
      tierIsEstimated: (tierEst?.name ?? null) !== (yearNow.tier?.name ?? null),
      next: nextEst?.name ?? null,
      needPqp: nextEst ? Math.max(0, nextEst.pqp - standingPqp) : 0,
      needPqf: nextEst ? Math.max(0, nextEst.pqf - standingPqf) : 0,
      /* the lib's sentence, against the standing-based next rung — its base
         already counts flown-awaiting-credit, so every number in it now
         refers to the same rung the card names */
      shortfall: shortfall({ ...yearNow, nextTier: nextEst }),
    };
  }

  return jsonOk({
    ...analytics,
    reconcile,
    /* "Empty" by the same test Drive sync applies — every table, not just
       flights. The demo-data button replaces the ledger through the restore
       door, and a tickets-only ledger has no flights on the board and
       everything to lose. */
    ledgerEmpty: backupIsEmpty(data),
    premierNow,
    // dashboard "needs attention" mirrors the reconciliation queue
    cards: { ...analytics.cards, openIssues: reconcile.exceptions.filter((e) => e.severity === "warn").length },
  });
});
