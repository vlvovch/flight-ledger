/*
 * The account model's pure parts, shared by both storage backends: the node
 * registry (accounts.ts, a JSON file beside the databases) and the browser
 * build's fixed single account (browser/accounts.ts). Extracted so the
 * browser variant never has to choose between importing node:fs and copying
 * validation logic — the shape checks live once, here.
 */

export interface Account {
  /** stable key, used in URLs and as the cache key */
  id: string;
  /** what the switcher shows */
  label: string;
  /** file name inside data/, never a path */
  file: string;
}

export interface AccountRegistry {
  active: string;
  accounts: Account[];
}

export class AccountError extends Error {}

/**
 * A file name, never a path. Two accounts pointing at one file would silently
 * merge two people's ledgers, and a name that escapes data/ would let the
 * registry address anything on disk — so the shape is checked rather than
 * trusted, and the check is here rather than at each call site.
 */
export function accountFileName(id: string): string {
  return `${id}.db`;
}

export function assertSafeFile(file: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}\.db$/i.test(file) || file.includes("..")) {
    throw new AccountError(`Unsafe account file name: ${file}`);
  }
}

export function slugify(label: string): string {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "account";
}
