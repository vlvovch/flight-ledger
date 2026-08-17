/*
 * Route-handler plumbing, deliberately framework-free: standard Request in,
 * standard Response out. Next.js accepts these as-is, and it is what lets
 * the same route modules serve two transports — HTTP in the server app, and
 * direct dispatch in the browser build (design: mode 1), where dispatch.ts
 * calls them with synthetic Requests and no server exists at all.
 */

export const jsonOk = (data: unknown, status = 200) =>
  Response.json(data, { status });

export const jsonError = (message: string, status = 400) =>
  Response.json({ error: message }, { status });

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Reject cross-origin writes (CSRF).
 *
 * The local server binds to loopback, which stops other machines — but not
 * other WEBSITES: a page you have open can POST to http://localhost:3000
 * without asking, and a `text/plain` body is a CORS "simple request", so no
 * preflight ever protects it. The attacker can't read the reply, and doesn't
 * need to — restoring an empty backup would erase the ledger.
 *
 * A present Origin must match the host being addressed. A MISSING Origin is
 * allowed: that is curl, the selftest, and the browser build's synthetic
 * requests (dispatch.ts calls these handlers directly, no server involved) —
 * none of which a hostile page can forge, because browsers always attach
 * Origin to cross-site writes.
 */
function crossOriginWrite(req: Request): boolean {
  if (!MUTATING.has(req.method.toUpperCase())) return false;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(req.url).host;
  } catch {
    return true; // unparseable Origin is not a same-origin claim
  }
}

/** Wrap a handler with uniform error handling and the same-origin guard. */
export function handled<A extends unknown[]>(
  fn: (...args: A) => Promise<Response> | Response
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const req = args.find((a): a is Request => a instanceof Request);
    if (req && crossOriginWrite(req))
      return jsonError("Cross-origin requests are not allowed", 403);
    try {
      return await fn(...args);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Internal error";
      return jsonError(msg, 500);
    }
  };
}
