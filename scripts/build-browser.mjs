/*
 * Builds the static browser app (design: mode 1): the whole ledger as plain
 * files, servable from any static host — no server, no accounts, data in the
 * visitor's own browser (OPFS).
 *
 * `output: "export"` refuses dynamic route handlers, so src/app/api is hidden
 * for the duration of the build and restored afterwards, crash included. The
 * handlers themselves keep working in the artifact: their bodies live in
 * src/routes, which dispatch.ts imports directly inside the engine worker —
 * the api folder is only the HTTP skin, and the browser build has no HTTP.
 *
 * Run with: npm run build:browser   →  out/
 */
import { renameSync, existsSync, rmSync, cpSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";

const API = "src/app/api";
const HIDDEN = "src/app/_api.hidden";

/* Self-heal instead of refusing: a build killed mid-flight (Ctrl-C, an OOM,
   a terminal closed) leaves the API folder renamed, and the next thing the
   developer runs is a typecheck that fails with dozens of unrelated errors
   about missing route modules. Put it back and carry on — the only state
   worth refusing is BOTH names existing, which is a real conflict. */
if (existsSync(HIDDEN)) {
  if (existsSync(API)) {
    console.error(
      `Both ${API} and ${HIDDEN} exist — resolve that by hand before building.`
    );
    process.exit(1);
  }
  console.warn(`Restoring ${HIDDEN} left behind by an interrupted build.`);
  renameSync(HIDDEN, API);
}

/* Both, every time: a half-written .next-browser from an interrupted run
   makes the next build fail deep inside page-data collection
   ("PageNotFoundError: /_document"), which reads like a code fault and
   isn't one. */
/* `--base /flight-ledger` when the copy will live under a project path
   rather than at an origin root: Next bakes asset and navigation URLs at
   build time, so this cannot be fixed by the host afterwards. */
const baseArg = process.argv.find((a) => a.startsWith("--base"));
const basePath = baseArg
  ? (baseArg.includes("=") ? baseArg.split("=")[1] : process.argv[process.argv.indexOf(baseArg) + 1])
  : "";
if (basePath && !basePath.startsWith("/")) {
  console.error(`--base must start with a slash (got "${basePath}")`);
  process.exit(1);
}

rmSync("out", { recursive: true, force: true });
rmSync(".next-browser", { recursive: true, force: true });
renameSync(API, HIDDEN);
try {
  execSync("npm run wasm:assets", { stdio: "inherit" });
  execSync("next build", {
    stdio: "inherit",
    env: {
      ...process.env,
      BROWSER_BUILD: "1",
      NEXT_PUBLIC_BROWSER_ENGINE: "1",
      NEXT_DIST_DIR: ".next-browser",
      ...(basePath ? { BASE_PATH: basePath } : {}),
    },
  });
  // with a custom distDir, the export lands IN the distDir — publish it as out/
  cpSync(".next-browser", "out", { recursive: true });
  /* The engine's wasm ships once, at the export root (public/sqlite3.wasm).
     webpack ALSO emits the package's own `new URL("sqlite3.wasm",
     import.meta.url)` as a hashed asset under _next/static/media/ — but the
     worker always boots with a locateFile override (browser/wasm-url.ts), and
     emscripten consults the asset only on its no-locateFile branch, so the
     hashed copy is unreachable. Pruned here rather than left as harmless
     residue because a future service worker's "precache everything" pass
     would push the dead 844K to every visitor. */
  const media = "out/_next/static/media";
  for (const f of readdirSync(media)) {
    if (/^sqlite3\.[0-9a-f]+\.wasm$/.test(f)) {
      rmSync(`${media}/${f}`);
      console.log(`Pruned unreachable duplicate ${media}/${f}`);
    }
  }
  console.log(
    basePath
      ? `\nStatic browser app written to out/ — serve it at <host>${basePath}/.`
      : "\nStatic browser app written to out/ — serve it at any origin's root" +
          " (for a project path, rebuild with --base /that/path)."
  );
} finally {
  renameSync(HIDDEN, API);
}
