/*
 * The browser build's "network": the same route modules the server app
 * mounts over HTTP, called directly with synthetic Requests (design: mode 1).
 *
 * This works because the routes were already transport-free — standard
 * Request in, standard Response out, params as a Promise — so dispatch is a
 * table, not a reimplementation. There is deliberately no second copy of any
 * handler logic here: a route fixed once is fixed for both transports, and
 * the selftest exercises THIS path, so the table cannot silently fall out of
 * step with the filesystem routes.
 *
 * Never import this from client components in the server app — it pulls the
 * whole route surface (and through it node:sqlite) into the bundle. Its
 * consumers are the future browser/worker entry and the selftest.
 */
import * as accounts from "@/routes/accounts";
import * as activity from "@/routes/activity";
import * as activityId from "@/routes/activity-id";
import * as adjustments from "@/routes/adjustments";
import * as adjustmentsId from "@/routes/adjustments-id";
import * as airports from "@/routes/airports";
import * as analytics from "@/routes/analytics";
import * as backup from "@/routes/backup";
import * as changes from "@/routes/changes";
import * as exportRoute from "@/routes/export";
import * as flights from "@/routes/flights";
import * as flightsId from "@/routes/flights-id";
import * as importMileageplus from "@/routes/import-mileageplus";
import * as importReceipt from "@/routes/import-receipt";
import * as payments from "@/routes/payments";
import * as paymentsId from "@/routes/payments-id";
import * as settings from "@/routes/settings";
import * as tickets from "@/routes/tickets";
import * as ticketsId from "@/routes/tickets-id";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Ctx = { params: Promise<Record<string, string>> };
type Handler = (req: Request, ctx: Ctx) => Promise<Response> | Response;

type RouteModule = Partial<Record<Method, unknown>>;
const methodsOf = (m: RouteModule): Partial<Record<Method, Handler>> => ({
  GET: m.GET as Handler | undefined,
  POST: m.POST as Handler | undefined,
  PUT: m.PUT as Handler | undefined,
  PATCH: m.PATCH as Handler | undefined,
  DELETE: m.DELETE as Handler | undefined,
});

const STATIC: Record<string, Partial<Record<Method, Handler>>> = {
  "/api/accounts": methodsOf(accounts),
  "/api/activity": methodsOf(activity),
  "/api/adjustments": methodsOf(adjustments),
  "/api/airports": methodsOf(airports),
  "/api/analytics": methodsOf(analytics),
  "/api/backup": methodsOf(backup),
  "/api/changes": methodsOf(changes),
  "/api/export": methodsOf(exportRoute),
  "/api/flights": methodsOf(flights),
  "/api/import/mileageplus": methodsOf(importMileageplus),
  "/api/import/receipt": methodsOf(importReceipt),
  "/api/payments": methodsOf(payments),
  "/api/settings": methodsOf(settings),
  "/api/tickets": methodsOf(tickets),
};

/** "[id]" routes: prefix → handlers; the rest of the path is the id. */
const DYNAMIC: [string, Partial<Record<Method, Handler>>][] = [
  ["/api/activity/", methodsOf(activityId)],
  ["/api/adjustments/", methodsOf(adjustmentsId)],
  ["/api/flights/", methodsOf(flightsId)],
  ["/api/payments/", methodsOf(paymentsId)],
  ["/api/tickets/", methodsOf(ticketsId)],
];

/**
 * Route a request exactly as the server would. Relative URLs are the norm —
 * the synthetic base never leaves this function; routes only read pathname
 * and searchParams off it.
 */
export async function dispatch(url: string, init?: RequestInit): Promise<Response> {
  const u = new URL(url, "http://ledger.local");
  const method = (init?.method ?? "GET").toUpperCase() as Method;
  const req = new Request(u, init);

  const exact = STATIC[u.pathname]?.[method];
  if (exact) return exact(req, { params: Promise.resolve({}) });

  for (const [prefix, handlers] of DYNAMIC) {
    if (!u.pathname.startsWith(prefix)) continue;
    const id = decodeURIComponent(u.pathname.slice(prefix.length));
    if (!id || id.includes("/")) continue;
    const h = handlers[method];
    if (h) return h(req, { params: Promise.resolve({ id }) });
  }

  return Response.json(
    { error: `No route for ${method} ${u.pathname}` },
    { status: 404 }
  );
}

/** Drop-in for setApiTransport() — the browser build's whole network stack. */
export const dispatchTransport = (url: string, init?: RequestInit): Promise<Response> =>
  dispatch(url, init);
