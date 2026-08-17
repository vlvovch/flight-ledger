/**
 * Where the SQLite wasm binary lives, seen from inside the engine worker.
 *
 * The worker is a bundled chunk under /_next/static/chunks/, while the binary
 * is copied to the export ROOT (public/sqlite3.wasm → /sqlite3.wasm). So
 * neither naive answer works: an absolute "/sqlite3.wasm" breaks a copy
 * served under a project path (/flight-ledger/), and resolving beside the
 * worker looks for it in the chunks folder, where it has never been.
 *
 * The app root is the worker's own URL with the bundler's folder cut off —
 * true at an origin root and under any subpath. A worker started from a blob
 * has no such path to cut, so that case falls back to the root.
 */
export function wasmUrl(workerHref: string, file = "sqlite3.wasm"): string {
  const cut = workerHref.indexOf("/_next/");
  if (cut < 0) {
    try {
      const u = new URL(workerHref);
      return new URL(file, `${u.origin}/`).href;
    } catch {
      return `/${file}`;
    }
  }
  return new URL(file, workerHref.slice(0, cut + 1)).href;
}
