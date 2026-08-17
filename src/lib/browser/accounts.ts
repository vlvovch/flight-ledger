/*
 * The browser build's account layer (design: mode 1): one ledger, fixed.
 *
 * Multiple accounts are a desktop feature — the node registry exists so two
 * people's SQLite files can sit side by side in data/. The browser build is
 * the try-it tier: one origin, one OPFS pool, one ledger. Every mutating
 * operation says so instead of half-working, and the shared shape checks
 * come from accounts-shared so the two backends can't drift.
 *
 * The client-compilation alias in next.config resolves "@/lib/accounts" HERE
 * for browser bundles; server bundles keep the node registry. Nothing else
 * changes anywhere.
 */
import {
  AccountError,
  type Account,
  type AccountRegistry,
} from "../accounts-shared";
// cycle with ./db is deliberate and safe: both sides call, never evaluate,
// the other at module init
import { getDb } from "./db";

export {
  AccountError,
  accountFileName,
  assertSafeFile,
  slugify,
} from "../accounts-shared";
export type { Account, AccountRegistry } from "../accounts-shared";

const BROWSER_ACCOUNT: Account = {
  id: "default",
  label: "This browser",
  file: "ledger.db",
};

/** The label is the profile name when one is set — "Taylor's ledger" beats
 *  "This browser". Read at call time from the ledger's own settings, with
 *  the fallback covering the moment before the engine is up. */
function currentLabel(): string {
  try {
    const row = getDb()
      .prepare("SELECT value FROM settings WHERE key = 'member_first_name'")
      .get() as { value: string | null } | undefined;
    // settings values are stored JSON-encoded ("Taylor", quotes and all)
    let name = row?.value ?? "";
    try {
      name = String(JSON.parse(name));
    } catch {
      /* older raw value — use as is */
    }
    name = name.trim();
    return name && name !== "null" ? `${name}’s ledger` : BROWSER_ACCOUNT.label;
  } catch {
    return BROWSER_ACCOUNT.label;
  }
}

export function readRegistry(): AccountRegistry {
  const account = activeAccount();
  return { active: account.id, accounts: [account] };
}

export function writeRegistry(): void {
  throw new AccountError("The browser ledger keeps a single account");
}

export function activeAccount(): Account {
  return { ...BROWSER_ACCOUNT, label: currentLabel() };
}

export function accountPath(a: Account): string {
  return `opfs://flight-ledger/${a.file}`;
}

export function createAccount(): never {
  throw new AccountError(
    "Multiple accounts are a desktop feature — the browser ledger is one account. Run the app locally for more."
  );
}

export function switchAccount(id: string): Account {
  if (id === BROWSER_ACCOUNT.id) return BROWSER_ACCOUNT;
  throw new AccountError("The browser ledger keeps a single account");
}

export function renameAccount(): never {
  throw new AccountError(
    "The browser ledger takes its name from your profile — set your first name in Settings"
  );
}

export function forgetAccount(): never {
  throw new AccountError(
    "The browser ledger keeps a single account — erase its data from Settings instead"
  );
}
