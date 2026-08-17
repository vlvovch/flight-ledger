import { handled, jsonError, jsonOk } from "@/lib/api";
import { importBackup, wipeAll } from "@/lib/repo";
import type { BackupPayload } from "@/lib/repo";

export const dynamic = "force-dynamic";

/** Restore a JSON backup, replacing all current data. */
export const POST = handled(async (req: Request) => {
  const body = (await req.json()) as Partial<BackupPayload>;
  if (body.version !== 1)
    return jsonError("Unrecognized backup format (expected version 1)");
  for (const key of ["tickets", "segments", "adjustments"] as const) {
    if (body[key] != null && !Array.isArray(body[key]))
      return jsonError(`Backup field "${key}" must be an array`);
  }
  importBackup(body as BackupPayload);
  return jsonOk({
    ok: true,
    restored: {
      tickets: body.tickets?.length ?? 0,
      segments: body.segments?.length ?? 0,
      adjustments: body.adjustments?.length ?? 0,
    },
  });
});

/** Wipe all flight/ticket data (settings are kept). */
export const DELETE = handled(async (req: Request) => {
  const confirm = new URL(req.url).searchParams.get("confirm");
  if (confirm !== "wipe") return jsonError('Pass ?confirm=wipe to erase all data');
  wipeAll();
  return jsonOk({ ok: true });
});
