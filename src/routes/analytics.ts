import { handled, jsonOk } from "@/lib/api";
import { buildAnalytics } from "@/lib/metrics";
import { buildReconcileReport } from "@/lib/reconcile";
import { getEnrichedData, getSettings } from "@/lib/repo";

export const dynamic = "force-dynamic";

export const GET = handled(async () => {
  const data = getEnrichedData();
  const analytics = buildAnalytics(data);
  const reconcile = buildReconcileReport(data, getSettings());
  return jsonOk({
    ...analytics,
    reconcile,
    // dashboard "needs attention" mirrors the reconciliation queue
    cards: { ...analytics.cards, openIssues: reconcile.exceptions.filter((e) => e.severity === "warn").length },
  });
});
