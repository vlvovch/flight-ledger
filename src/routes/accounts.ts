import { handled, jsonError, jsonOk } from "@/lib/api";
import {
  AccountError,
  createAccount,
  forgetAccount,
  readRegistry,
  renameAccount,
  switchAccount,
} from "@/lib/accounts";

export const dynamic = "force-dynamic";

const fail = (e: unknown) =>
  e instanceof AccountError ? jsonError(e.message) : null;

export const GET = handled(async () => {
  const reg = readRegistry();
  return jsonOk({ active: reg.active, accounts: reg.accounts });
});

export const POST = handled(async (req: Request) => {
  const body = (await req.json()) as { label?: string; adopt?: boolean };
  try {
    const { account, adopted } = createAccount(String(body.label ?? ""), {
      adopt: Boolean(body.adopt),
    });
    /* Created, not opened. Switching is a separate, deliberate act — making
       creation also switch would move the ledger out from under whatever the
       user was in the middle of reading. */
    return jsonOk({ account, adopted });
  } catch (e) {
    return fail(e) ?? jsonError("Could not create the account");
  }
});

export const PATCH = handled(async (req: Request) => {
  const body = (await req.json()) as { id?: string; active?: string; label?: string };
  try {
    if (body.active != null) return jsonOk({ account: switchAccount(String(body.active)) });
    if (body.id != null && body.label != null)
      return jsonOk({ account: renameAccount(String(body.id), String(body.label)) });
    return jsonError("Nothing to do — pass `active` to switch or `id` + `label` to rename");
  } catch (e) {
    return fail(e) ?? jsonError("Could not update the account");
  }
});

export const DELETE = handled(async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return jsonError("Pass ?id=<account>");
  try {
    return jsonOk(forgetAccount(id));
  } catch (e) {
    return fail(e) ?? jsonError("Could not remove the account");
  }
});
