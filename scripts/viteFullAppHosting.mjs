/**
 * viteFullAppHosting — Vite plugin that serves the complete uSEQ Perform
 * application under the Vite dev and preview servers on port 5000.
 *
 * Why this plugin exists (Ergo bug ab2f2d33, VAL-HOST-001/VAL-HOST-002):
 *
 *   The project layout is unusual: `vite.config.ts` sets `publicDir: false`
 *   and the build writes into `public/solid-dist`. That choice avoids a
 *   recursive copy (Vite would otherwise copy `public/*` into
 *   `public/solid-dist`, which IS the build output directory), but it also
 *   removes the only Vite-builtin mechanism that serves `public/*` files
 *   at document-relative URLs. As a consequence the default Vite dev and
 *   preview servers return 404 for every runtime asset the editor needs:
 *
 *     /                     (no root index.html)
 *     /wasm/useq.js         (interpreter WASM loader)
 *     /wasm/useq.wasm       (interpreter binary)
 *     /wasm/synthesisWorklet.js   (AudioWorklet processor)
 *     /wasm/osc_sine.wasm   (osc/sine NodeDef DSP module)
 *     /assets/**            (markdown-rendered help, reference data, fonts)
 *     /solid-dist/bundle.js (built bundle, only meaningful for preview)
 *
 *   The COOP same-origin / COEP credentialless headers are already wired
 *   via `server.headers` and `preview.headers`; this plugin is responsible
 *   for serving the bytes those headers accompany, on BOTH servers, without
 *   altering or stripping the isolation headers.
 *
 * What the plugin does:
 *
 *   - `configureServer`: registers a connect middleware (before Vite's
 *     built-in static handler) that resolves requests against `public/`.
 *     Static files in `public/` (wasm, worklet, assets, built bundle)
 *     therefore become reachable at their document-relative URLs during
 *     development. Requests for `/` are handled by the repo-root
 *     `index.html` via Vite's standard SPA pipeline, so HMR through
 *     `/src/main.ts` keeps working.
 *
 *   - `configurePreviewServer`: registers the same middleware so preview
 *     serves `public/index.html` at `/` (which loads `solid-dist/bundle.js`
 *     and matches the production static server) plus every runtime asset.
 *
 * The plugin applies the configured `server.headers` / `preview.headers`
 * to every response it serves, by reading the resolved config object at
 * server-startup time. It never hardcodes the COOP/COEP header names,
 * so the source of truth for isolation stays in vite.config.ts (where
 * the existing VAL-HOST-001/002 header regression inspects it).
 *
 * Authoritative hosting regression:
 *   src/contracts/viteFullAppHosting.test.ts (VAL-HOST-001/002).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, normalize, resolve as pathResolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR =
  typeof __dirname !== "undefined"
    ? __dirname
    : pathResolve(fileURLToPath(import.meta.url), "..");
const REPO_ROOT = pathResolve(MODULE_DIR, "..");
const PUBLIC_DIR = pathResolve(REPO_ROOT, "public");

/**
 * Minimal content-type map for the asset extensions the editor loads at
 * runtime. Sourced from the MIME registry Vite uses internally; kept
 * inline so the middleware works without depending on Vite internals.
 */
const CONTENT_TYPES = Object.freeze({
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".map": "application/json",
});

/**
 * Resolve a URL pathname to a file under public/. Returns the absolute
 * path if a regular file exists at that location, otherwise null.
 *
 * Security: the pathname is normalized and checked for path traversal
 * (../) BEFORE touching the filesystem, and the resolved path must
 * remain inside PUBLIC_DIR.
 *
 * `claimRootIndex`: when true, requests for `/` resolve to
 * `public/index.html`. This is used by the PREVIEW server so preview
 * serves the production-shaped static entry (which loads
 * `solid-dist/bundle.js`). When false (DEV server), requests for `/`
 * fall through to Vite's built-in handler so the repo-root
 * `index.html` is served with full HMR support for `/src/main.ts`.
 */
function resolvePublicFile(pathname, claimRootIndex) {
  if (!pathname) return null;

  // Decode and strip the leading slash so resolve() anchors at PUBLIC_DIR.
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  // Reject obvious traversal attempts early.
  if (decoded.includes("..")) return null;

  // Normalize then anchor under PUBLIC_DIR.
  const relativePath = normalize(decoded.replace(/^\/+/, ""));
  if (relativePath === "" || relativePath === ".") {
    if (!claimRootIndex) return null;
    // Map `/` to the static server entry page. Only meaningful for
    // preview; dev defers to the repo-root index.html so HMR works.
    const indexEntry = pathResolve(PUBLIC_DIR, "index.html");
    return existsSync(indexEntry) ? indexEntry : null;
  }

  const absolute = pathResolve(PUBLIC_DIR, relativePath);

  // Belt-and-braces traversal check after resolution.
  const publicPrefix = PUBLIC_DIR + sep;
  if (absolute !== PUBLIC_DIR && !absolute.startsWith(publicPrefix)) {
    return null;
  }

  if (!existsSync(absolute)) return null;
  const stat = statSync(absolute);
  return stat.isFile() ? absolute : null;
}

/** Send a file with the correct content-type. */
function sendFile(res, absolutePath, isolationHeaders) {
  const ext = extname(absolutePath).toLowerCase();
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  const data = readFileSync(absolutePath);
  // Apply the configured server.headers (COOP same-origin + COEP
  // credentialless, sourced from vite.config.ts) so cross-origin
  // isolation is enforced on responses served by this middleware.
  // We do NOT hardcode the COOP/COEP header names here — they are read
  // from the same `CROSS_ORIGIN_ISOLATION_HEADERS` constant that
  // `server.headers` / `preview.headers` reference.
  if (isolationHeaders) {
    for (const [key, value] of Object.entries(isolationHeaders)) {
      res.setHeader(key, value);
    }
  }
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", Buffer.byteLength(data));
  res.end(data);
}

/**
 * Build a connect middleware that serves regular files from `public/`.
 *
 * Used for BOTH the dev server (`configureServer`) and the preview
 * server (`configurePreviewServer`) so the runtime asset URL space is
 * identical across dev, preview, and the production static server
 * (`npm run start` → `serve public -p 5000`).
 *
 * `isolationHeaders` is the resolved `server.headers` (dev) or
 * `preview.headers` (preview) object from vite.config.ts. Applying it
 * here keeps every public/* response cross-origin-isolated, matching
 * Vite's built-in static handler behaviour.
 *
 * `claimRootIndex`: when true, requests for `/` are answered with
 * `public/index.html`. Set to true for the preview server (which has
 * no other index.html to serve) and false for the dev server (so the
 * repo-root index.html with `/src/main.ts` HMR is used instead).
 */
function publicStaticMiddleware(isolationHeaders, claimRootIndex) {
  return (req, res, next) => {
    // Only handle simple GET/HEAD requests; everything else (HMR
    // websocket upgrades, source transforms, POST, etc.) falls through
    // to Vite's built-in handlers.
    if (req.method !== "GET" && req.method !== "HEAD") {
      return next();
    }

    const url = req.url ?? "/";
    // Strip query string and hash.
    const pathname = url.split("?", 1)[0].split("#", 1)[0];

    const absolute = resolvePublicFile(pathname, claimRootIndex);
    if (absolute === null) {
      return next();
    }

    try {
      if (req.method === "HEAD") {
        const stat = statSync(absolute);
        const ext = extname(absolute).toLowerCase();
        if (isolationHeaders) {
          for (const [key, value] of Object.entries(isolationHeaders)) {
            res.setHeader(key, value);
          }
        }
        res.setHeader("Content-Type", CONTENT_TYPES[ext] ?? "application/octet-stream");
        res.setHeader("Content-Length", stat.size);
        return res.end();
      }
      return sendFile(res, absolute, isolationHeaders);
    } catch (err) {
      // Never let a static-file read failure crash the server; defer
      // to Vite's error handling.
      return next(err);
    }
  };
}

/**
 * Resolve which headers object to use for the current server.
 *
 * Dev servers expose `server.config.server.headers`; preview servers
 * expose `server.config.preview.headers`. Returning undefined falls
 * back to a headerless response, which would break isolation, so the
 * plugin always prefers the populated object.
 */
function resolveIsolationHeaders(server) {
  const cfg = server?.config ?? {};
  const fromServer = cfg.server?.headers;
  const fromPreview = cfg.preview?.headers;
  return fromServer && Object.keys(fromServer).length > 0
    ? fromServer
    : fromPreview && Object.keys(fromPreview).length > 0
      ? fromPreview
      : undefined;
}

/**
 * Vite plugin factory.
 *
 * Install in `vite.config.ts`:
 *
 *   import { viteFullAppHosting } from "./scripts/viteFullAppHosting.mjs";
 *   export default defineConfig({
 *     plugins: [solid(), viteFullAppHosting()],
 *     // publicDir:false stays — see the plugin header comment for why.
 *   });
 */
export function viteFullAppHosting() {
  return {
    name: "vite-full-app-hosting",
    apply: () => true, // apply to both serve (dev) and build
    configureServer(server) {
      // Insert before Vite's built-in static middleware so public/* wins
      // over any future /assets/* collision. `server.middlewares.use`
      // appends to the chain; Vite's transform pipeline still runs for
      // paths we don't claim (e.g. /src/main.ts, /@vite/client).
      //
      // claimRootIndex=false so DEV keeps using the repo-root
      // index.html (HMR via /src/main.ts).
      const isolationHeaders = resolveIsolationHeaders(server);
      server.middlewares.use(publicStaticMiddleware(isolationHeaders, false));
    },
    configurePreviewServer(server) {
      // Same middleware shape for the preview server. Preview's built-in
      // static handler serves build/outDir (public/solid-dist) at the
      // root; this middleware makes the document-relative URLs
      // (/wasm/*, /assets/*, and / -> public/index.html) consistent
      // with the static `npm run start` server.
      //
      // claimRootIndex=true so PREVIEW answers / with public/index.html
      // (the production-shaped entry that loads solid-dist/bundle.js).
      const isolationHeaders = resolveIsolationHeaders(server);
      server.middlewares.use(publicStaticMiddleware(isolationHeaders, true));
    },
  };
}

export default viteFullAppHosting;
