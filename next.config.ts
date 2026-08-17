import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
  /* The static browser build (design: mode 1): scripts/build-browser.mjs
     sets BROWSER_BUILD=1, hides src/app/api for the duration, and exports
     the whole app as static files — no server exists in the artifact, so
     EngineBoot (NEXT_PUBLIC_BROWSER_ENGINE=1) routes every api() call into
     the OPFS engine worker instead. */
  ...(process.env.BROWSER_BUILD === "1"
    ? {
        output: "export" as const,
        /* Hosting under a project path (github.io/flight-ledger/) needs the
           asset and navigation URLs rewritten at BUILD time — they are
           absolute in the export, so no amount of server config fixes them
           afterwards. `npm run build:browser -- --base /flight-ledger` sets
           this; the engine's wasm follows automatically, because the worker
           derives the app root from its own URL (browser/wasm-url.ts). */
        ...(process.env.BASE_PATH
          ? {
              basePath: process.env.BASE_PATH,
              assetPrefix: process.env.BASE_PATH,
            }
          : {}),
        /* the main tsconfig deliberately includes the OTHER dist dirs'
           generated types (so `npm run typecheck` covers them) — during the
           export those reference the hidden api folder, so this build checks
           against its own include list */
        typescript: { tsconfigPath: "tsconfig.browser.json" },
      }
    : {}),
  // node:sqlite is a Node built-in; keep it external to the server bundle
  serverExternalPackages: [],
  /* `next build` and `next dev` both write here, and a build run while the dev
     server is up leaves it serving half-deleted chunks — "Cannot find module
     for page: /_document", a 404 on every route, a missing vendor chunk. They
     are not the same artefact, so they don't share a directory: `npm run build`
     sets NEXT_DIST_DIR and the two can run at the same time. */
  distDir: process.env.NEXT_DIST_DIR || ".next",

  /* The two-backend seam (design: mode 1). In CLIENT compilations — pages and
     the engine worker alike — the db and accounts shells resolve to their
     browser implementations: OPFS-backed WASM engine, fixed single account.
     Server compilations keep node:sqlite and the JSON registry. This also
     closes an old trap for good: the client bundle structurally CANNOT
     contain node:sqlite anymore, where before only discipline kept it out. */
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      const here = process.cwd();
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /^@\/lib\/db$/,
          resolve(here, "src/lib/browser/db.ts")
        ),
        new webpack.NormalModuleReplacementPlugin(
          /^@\/lib\/accounts$/,
          resolve(here, "src/lib/browser/accounts.ts")
        ),
        new webpack.NormalModuleReplacementPlugin(/^\.\/db$/, (resource: {
          context: string;
          request: string;
        }) => {
          // repo.ts's relative import; the browser shell's own "./accounts"
          // stays put because its context is src/lib/browser already
          if (resource.context === resolve(here, "src/lib"))
            resource.request = resolve(here, "src/lib/browser/db.ts");
        }),
        new webpack.NormalModuleReplacementPlugin(/^\.\/accounts$/, (resource: {
          context: string;
          request: string;
        }) => {
          if (resource.context === resolve(here, "src/lib"))
            resource.request = resolve(here, "src/lib/browser/accounts.ts");
        })
      );
    }
    return config;
  },
};

export default nextConfig;
