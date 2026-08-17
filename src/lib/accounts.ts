import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Which ledgers exist and which one is open.
 *
 * Each account is a whole separate SQLite file. That is the point: two
 * people's miles, status years and costs must never be summed by accident,
 * and the strongest way to guarantee that is for a query to have no way of
 * reaching the other account's rows. Everything downstream — backup, export,
 * wipe, reconcile — already operates on "the current database", so each one
 * becomes per-account without knowing accounts exist.
 *
 * The registry lives beside the databases rather than inside one of them: a
 * file cannot hold the list of files, and asking "which account is open"
 * must not require opening an account first.
 */
export {
  AccountError,
  accountFileName,
  assertSafeFile,
  slugify,
} from "./accounts-shared";
export type { Account, AccountRegistry } from "./accounts-shared";
import {
  AccountError,
  accountFileName,
  assertSafeFile,
  slugify,
  type Account,
  type AccountRegistry,
} from "./accounts-shared";

const DATA_DIR = () => join(process.cwd(), "data");
const REGISTRY = () => join(DATA_DIR(), "accounts.json");

/** The ledger this app had before it could have more than one. */
const LEGACY_FILE = "tracker.db";

function defaultRegistry(): AccountRegistry {
  return {
    active: "default",
    accounts: [{ id: "default", label: "Main", file: LEGACY_FILE }],
  };
}

export function readRegistry(): AccountRegistry {
  const path = REGISTRY();
  if (!existsSync(path)) {
    /* First run after accounts existed: the single tracker.db that was here
       becomes the default account rather than being orphaned or copied. */
    const reg = defaultRegistry();
    mkdirSync(DATA_DIR(), { recursive: true });
    writeRegistry(reg);
    return reg;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new AccountError("data/accounts.json is not valid JSON");
  }
  const reg = raw as AccountRegistry;
  if (!reg || !Array.isArray(reg.accounts) || reg.accounts.length === 0) {
    throw new AccountError("data/accounts.json has no accounts");
  }
  for (const a of reg.accounts) assertSafeFile(a.file);
  const files = reg.accounts.map((a) => a.file.toLowerCase());
  if (new Set(files).size !== files.length) {
    // two accounts on one file is the exact failure this design exists to stop
    throw new AccountError("Two accounts point at the same database file");
  }
  const ids = reg.accounts.map((a) => a.id);
  if (new Set(ids).size !== ids.length) {
    throw new AccountError("Duplicate account ids");
  }
  /* An `active` naming an account that isn't there would resolve to nothing;
     falling back to the first is better than failing to open anything. */
  if (!reg.accounts.some((a) => a.id === reg.active)) reg.active = reg.accounts[0].id;
  return reg;
}

export function writeRegistry(reg: AccountRegistry): void {
  for (const a of reg.accounts) assertSafeFile(a.file);
  mkdirSync(DATA_DIR(), { recursive: true });
  /* Write-then-rename: a half-written registry would leave the app unable to
     name any ledger, including the one that already has all the data. */
  const tmp = `${REGISTRY()}.tmp`;
  writeFileSync(tmp, JSON.stringify(reg, null, 2) + "\n", "utf8");
  renameSync(tmp, REGISTRY());
}

export function activeAccount(): Account {
  const reg = readRegistry();
  return reg.accounts.find((a) => a.id === reg.active) ?? reg.accounts[0];
}

/** Absolute path of an account's database. */
export function accountPath(a: Account): string {
  assertSafeFile(a.file);
  return join(DATA_DIR(), a.file);
}

export function createAccount(
  label: string,
  opts: { adopt?: boolean } = {}
): { account: Account; adopted: boolean } {
  const reg = readRegistry();
  const trimmed = label.trim();
  if (!trimmed) throw new AccountError("An account needs a name");
  let id = slugify(trimmed);
  if (reg.accounts.some((a) => a.id === id)) {
    let n = 2;
    while (reg.accounts.some((a) => a.id === `${id}-${n}`)) n++;
    id = `${id}-${n}`;
  }
  const account: Account = { id, label: trimmed, file: accountFileName(id) };
  assertSafeFile(account.file);
  /* A file already there belongs to something — most likely an account that
     was removed from the list, since removal deliberately keeps the database.
     Attaching it silently would bind an unknown ledger to a new name, so it
     takes a second, explicit answer; without that the removal would strand
     the file with no way back. */
  const adopted = existsSync(accountPath(account));
  if (adopted && !opts.adopt) {
    throw new AccountError(
      `data/${account.file} already exists — reattach it to use that ledger`
    );
  }
  reg.accounts.push(account);
  writeRegistry(reg);
  return { account, adopted };
}

export function switchAccount(id: string): Account {
  const reg = readRegistry();
  const found = reg.accounts.find((a) => a.id === id);
  if (!found) throw new AccountError(`No account "${id}"`);
  reg.active = id;
  writeRegistry(reg);
  return found;
}

export function renameAccount(id: string, label: string): Account {
  const reg = readRegistry();
  const found = reg.accounts.find((a) => a.id === id);
  if (!found) throw new AccountError(`No account "${id}"`);
  const trimmed = label.trim();
  if (!trimmed) throw new AccountError("An account needs a name");
  /* The label changes; the id and file never do. Renaming a file would break
     every backup already taken against it. */
  found.label = trimmed;
  writeRegistry(reg);
  return found;
}

/**
 * Drop an account from the registry. The database file is deliberately LEFT
 * ON DISK — removing an entry from a list should not be able to destroy a
 * travel history, and the file can be re-registered or opened directly.
 */
export function forgetAccount(id: string): { removed: Account; fileKept: string } {
  const reg = readRegistry();
  if (reg.accounts.length === 1) {
    throw new AccountError("This is the only account");
  }
  const found = reg.accounts.find((a) => a.id === id);
  if (!found) throw new AccountError(`No account "${id}"`);
  reg.accounts = reg.accounts.filter((a) => a.id !== id);
  if (reg.active === id) reg.active = reg.accounts[0].id;
  writeRegistry(reg);
  return { removed: found, fileKept: `data/${found.file}` };
}
