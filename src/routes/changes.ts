import { handled, jsonOk } from "@/lib/api";
import { listChanges } from "@/lib/repo";

export const dynamic = "force-dynamic";

/** The change log (design doc §16), newest first. `?tbl=&row_id=` narrows to
 *  one row's history; `?limit=` caps the page (default 50, max 500). */
export const GET = handled(async (req: Request) => {
  const p = new URL(req.url).searchParams;
  return jsonOk({
    changes: listChanges({
      tbl: p.get("tbl") ?? undefined,
      rowId: p.get("row_id") ?? undefined,
      limit: p.get("limit") ? Number(p.get("limit")) : undefined,
    }),
  });
});
