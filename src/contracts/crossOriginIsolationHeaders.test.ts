/**
 * Regression tests for the COOP/COEP header configuration that enables
 * `window.crossOriginIsolated === true` and `SharedArrayBuffer` in real
 * browsers.
 *
 * The standards-required value for the Cross-Origin-Opener-Policy header
 * that unlocks cross-origin isolation is `same-origin` (NOT `same-site`).
 * `same-site` only relaxes same-site popup relationships and does *not*
 * enable `crossOriginIsolated`, which means `SharedArrayBuffer` stays
 * unavailable. This regression guards against the value silently reverting
 * to `same-site`.
 *
 * Cross-Origin-Embedder-Policy stays at `credentialless` (not
 * `require-corp`) so `?gist`, CORS-capable `?txt`, and `?config` deep links
 * keep their existing deterministic success/fallback behaviour under COEP
 * (VAL-HOST-010).
 *
 * Covers:
 *   VAL-HOST-001 — Vite dev server is isolated
 *   VAL-HOST-002 — Vite preview server is isolated
 *   VAL-HOST-003 — port-5000 static hosting is isolated
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..", "..");

/** Read a repo-relative file as UTF-8 text. */
function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

/**
 * Parse a `public/serve.json` file (used by the `serve` static server on
 * port 5000) and return the header value for the given key, or undefined.
 */
function readServeHeader(key: string): string | undefined {
  const raw = readRepoFile("public/serve.json");
  const parsed = JSON.parse(raw) as {
    headers: Array<{
      source: string;
      headers: Array<{ key: string; value: string }>;
    }>;
  };
  // All matching header blocks contribute; the last match wins per `serve`
  // semantics, but for our single `**/*` block there is exactly one match.
  let value: string | undefined;
  for (const block of parsed.headers) {
    for (const h of block.headers) {
      if (h.key === key) value = h.value;
    }
  }
  return value;
}

describe("cross-origin isolation header config (VAL-HOST-001/002/003)", () => {
  describe("vite.config.ts (dev + preview servers)", () => {
    const configText = readRepoFile("vite.config.ts");

    it("uses COOP=same-origin (not same-site) so crossOriginIsolated becomes true", () => {
      // The standards-required value that unlocks crossOriginIsolated.
      expect(configText).toContain(
        "'Cross-Origin-Opener-Policy': 'same-origin'",
      );
      // Guard against the known-bad regression.
      expect(configText).not.toMatch(
        /Cross-Origin-Opener-Policy['"]?\s*:\s*['"]same-site['"]/,
      );
    });

    it("keeps COEP=credentialless so ?gist/?txt/?config behaviour is preserved", () => {
      expect(configText).toContain(
        "'Cross-Origin-Embedder-Policy': 'credentialless'",
      );
    });

    it("applies the headers to both the dev and preview servers", () => {
      // Both server.headers and preview.headers should reference the shared
      // header constant. We assert both objects spread the constant rather
      // than hard-coding literal header values (which previously drifted
      // between the two servers).
      expect(configText).toMatch(/server:\s*\{[\s\S]*headers:\s*\{\s*\.\.\.CROSS_ORIGIN_ISOLATION_HEADERS/);
      expect(configText).toMatch(/preview:\s*\{[\s\S]*headers:\s*\{\s*\.\.\.CROSS_ORIGIN_ISOLATION_HEADERS/);
    });
  });

  describe("public/serve.json (port-5000 static hosting)", () => {
    it("uses COOP=same-origin (not same-site)", () => {
      expect(readServeHeader("Cross-Origin-Opener-Policy")).toBe(
        "same-origin",
      );
    });

    it("uses COEP=credentialless", () => {
      expect(readServeHeader("Cross-Origin-Embedder-Policy")).toBe(
        "credentialless",
      );
    });
  });
});
