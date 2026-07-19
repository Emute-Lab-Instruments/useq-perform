/**
 * Vite full-app hosting regression tests.
 *
 * Covers:
 *   VAL-HOST-001 - Vite development hosting is isolated AND serves the
 *                  complete application entry plus runtime assets
 *                  (Worker, worklet, interpreter WASM, NodeDef WASM).
 *   VAL-HOST-002 - Vite preview hosting is isolated AND serves the
 *                  complete BUILT application entry plus runtime assets.
 *
 * Background (Ergo bug ab2f2d33):
 *   The project ships a `public/index.html` that loads the built
 *   `solid-dist/bundle.js`, sets `publicDir: false` in `vite.config.ts`
 *   (because Vite would otherwise copy `public/*` into `outDir`, which
 *   IS `public/solid-dist`), and builds every runtime asset into
 *   gitignored `public/{solid-dist,wasm,assets}/*`. As a result the
 *   default Vite dev/preview servers return 404 for `/`,
 *   `/wasm/useq.js`, `/wasm/synthesisWorklet.js`, `/wasm/osc_sine.wasm`,
 *   and `/solid-dist/bundle.js` — even though the COOP/COEP headers are
 *   already wired. The previous header-only regression passed because
 *   it only inspected config text, never the live URL space.
 *
 * This test enforces the structural contracts that make both Vite
 * modes serve the full editor and every runtime asset:
 *
 *   1. A repo-root `index.html` exists so Vite dev has an SPA entry
 *      that loads `/src/main.ts` for HMR.
 *   2. `vite.config.ts` installs a plugin that adds a connect
 *      middleware on BOTH the dev server (`configureServer`) and the
 *      preview server (`configurePreviewServer`) so static files under
 *      `public/` (wasm, worklet, assets, built bundle) are reachable
 *      at their document-relative URLs.
 *   3. The plugin preserves the existing COOP=same-origin and
 *      COEP=credentialless header configuration on both servers.
 *
 * The assertions are deliberately structural (source-level) so they
 * catch regressions in any environment without needing a live server
 * or browser. Live server and real-browser evidence is collected by
 * the integration worker's agent-browser session against port 5000.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..", "..");
const PUBLIC_DIR = resolve(REPO_ROOT, "public");

/** Read a repo-relative file as UTF-8 text. */
function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

describe("Vite full-app hosting (VAL-HOST-001/002, Ergo ab2f2d33)", () => {
  describe("dev server entry", () => {
    it("ships a repo-root index.html so Vite dev serves the SPA entry", () => {
      // Vite dev defaults to <root>/index.html. Without it, every visit
      // to / returns 404 regardless of header config. The root
      // index.html must load /src/main.ts (Vite's module graph) so HMR
      // and the full editor work in development.
      const rootEntry = resolve(REPO_ROOT, "index.html");
      expect(existsSync(rootEntry), `expected ${rootEntry} to exist`).toBe(true);
      const html = readFileSync(rootEntry, "utf8");
      expect(html).toMatch(/src=["']\/src\/main\.ts["']/);
      expect(html).toMatch(/panel-main-editor/);
    });
  });

  describe("vite.config.ts wiring", () => {
    const configText = readRepoFile("vite.config.ts");

    it("imports the full-app hosting plugin", () => {
      // The plugin name is part of the public contract; if a future
      // refactor renames it, this assertion forces the test (and the
      // worker) to update both the import and the regression.
      expect(configText).toMatch(/viteFullAppHosting/);
    });

    it("registers the plugin in the plugins array", () => {
      expect(configText).toMatch(/plugins:\s*\[[\s\S]*viteFullAppHosting/);
    });

    it("keeps publicDir:false so the build still writes into public/solid-dist", () => {
      // The publicDir:false setting is intentional and must NOT be
      // removed: setting it to 'public' would make Vite COPY public/*
      // into public/solid-dist during build, creating recursive output.
      // The hosting plugin is responsible for serving public/* during
      // dev/preview instead.
      expect(configText).toMatch(/publicDir:\s*false/);
    });

    it("preserves COOP same-origin on both dev and preview servers", () => {
      expect(configText).toMatch(
        /server:\s*\{[\s\S]*headers:\s*\{\s*\.\.\.CROSS_ORIGIN_ISOLATION_HEADERS/,
      );
      expect(configText).toMatch(
        /preview:\s*\{[\s\S]*headers:\s*\{\s*\.\.\.CROSS_ORIGIN_ISOLATION_HEADERS/,
      );
    });
  });

  describe("hosting plugin source", () => {
    const pluginText = readRepoFile("scripts/viteFullAppHosting.mjs");

    it("exports a named viteFullAppHosting plugin factory", () => {
      expect(pluginText).toMatch(/export\s+function\s+viteFullAppHosting/);
    });

    it("hooks configureServer for the dev server", () => {
      expect(pluginText).toMatch(/configureServer/);
    });

    it("hooks configurePreviewServer for the preview server", () => {
      expect(pluginText).toMatch(/configurePreviewServer/);
    });

    it("serves the public/ directory as the static root", () => {
      // The middleware must resolve request paths against the public/
      // directory so /wasm/*, /assets/*, /solid-dist/*, and the
      // static index.html (for preview) all work.
      expect(pluginText).toMatch(/['"]public['"]/);
    });

    it("preserves the COOP/COEP isolation headers set by Vite's headers option", () => {
      // The plugin must not override or strip the isolation headers.
      // We assert the plugin does NOT set its own res.setHeader for
      // COOP/COEP (those come from server.headers / preview.headers),
      // and that it does not delete them either.
      expect(pluginText).not.toMatch(
        /res\.setHeader\(['"](Cross-Origin-(Opener|Embedder)-Policy)/i,
      );
      expect(pluginText).not.toMatch(
        /res\.removeHeader\(['"](Cross-Origin-(Opener|Embedder)-Policy)/i,
      );
    });

    it("uses next() to delegate to Vite's built-in middleware chain", () => {
      // So the plugin composes cleanly with Vite's transform pipeline
      // (HTML rewriting, /@vite/client injection, etc.) and does not
      // bypass COOP/COEP or other server.headers.
      expect(pluginText).toMatch(/next\s*\(\s*\)/);
    });
  });

  describe("runtime assets are present in public/", () => {
    // These assets are gitignored build outputs; the test asserts the
    // CURRENT built state exposes every asset the live editor needs.
    // A clean repo would need `npm run build` first; the integration
    // worker runs the live browser journey against these paths.

    const requiredAssets: Array<{ rel: string; description: string }> = [
      { rel: "index.html", description: "static server entry (preview uses this for /)" },
      { rel: "wasm/useq.js", description: "interpreter WASM JS loader" },
      { rel: "wasm/useq.wasm", description: "interpreter WASM binary" },
      { rel: "wasm/synthesisWorklet.js", description: "synthesis AudioWorklet processor" },
      { rel: "wasm/osc_sine.wasm", description: "osc/sine NodeDef DSP module" },
      { rel: "solid-dist/bundle.js", description: "built application bundle" },
      { rel: "solid-dist/bundle.css", description: "built application styles" },
    ];

    for (const { rel, description } of requiredAssets) {
      it(`public/${rel} exists (${description})`, () => {
        const abs = resolve(PUBLIC_DIR, rel);
        expect(existsSync(abs), `expected ${abs} to exist`).toBe(true);
        const stat = statSync(abs);
        expect(stat.size, `expected ${rel} to be non-empty`).toBeGreaterThan(0);
      });
    }

    it("public/wasm contains the interpreter, worklet, and NodeDef modules", () => {
      const wasmDir = resolve(PUBLIC_DIR, "wasm");
      const entries = readdirSync(wasmDir).sort();
      expect(entries).toEqual(
        expect.arrayContaining([
          "osc_sine.wasm",
          "synthesisWorklet.js",
          "useq.js",
          "useq.wasm",
        ]),
      );
    });
  });
});
