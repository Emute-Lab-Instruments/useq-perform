import { readFile } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";

// --------------------------------------------------------------------------
// Static origin (— verbatim from wasm-user-journeys.spec.ts)
// --------------------------------------------------------------------------

const PUBLIC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public",
);

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const ISOLATION_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

type BrowserEvalSurface = {
  evalToplevelNow(): {
    ok: boolean;
    evalAccepted?: boolean;
    error?: string;
  };
  sampleOutputAtTime(outputName: string, timeSeconds: number): Promise<number>;
  // Deterministic clock control (A1 hook — src/runtime/browserEvalSurface.ts).
  freezeClock(): void;
  stepClock(stepMs: number): Promise<void>;
  resumeClock(): void;
  isClockFrozen(): boolean;
};

declare global {
  interface Window {
    __useqReady?: Promise<void>;
    __useqBrowserEval?: BrowserEvalSurface;
  }
}

// The intercepted origin must be potentially trustworthy (localhost qualifies;
// an arbitrary http:// host does not) or Chrome ignores the COOP/COEP headers
// and crossOriginIsolated stays false, silently disabling SAB/synthesis paths.
export async function installStaticOrigin(context: BrowserContext): Promise<void> {
  await context.route("http://localhost/**", async (route) => {
    const url = new URL(route.request().url());
    const relativePath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const filePath = path.resolve(PUBLIC_ROOT, `.${relativePath}`);

    if (!filePath.startsWith(`${PUBLIC_ROOT}${path.sep}`)) {
      await route.fulfill({ status: 403 });
      return;
    }

    try {
      const body = await readFile(filePath);
      const contentType = MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream";
      await route.fulfill({
        status: 200,
        body,
        contentType,
        headers: ISOLATION_HEADERS,
      });
    } catch {
      await route.fulfill({ status: 404, body: "Not found" });
    }
  });
}

export interface StaticOriginServer {
  readonly origin: string;
  close(): Promise<void>;
}

/**
 * Serve the built public tree from a real loopback origin.
 *
 * Most browser tests use `installStaticOrigin`, but Chromium fetches an
 * AudioWorklet module outside Playwright's page-routing interception. Audio
 * lifecycle tests therefore need a real server while retaining the same
 * isolation headers and MIME types as the intercepted origin.
 */
export async function startStaticOriginServer(): Promise<StaticOriginServer> {
  const server: Server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const relativePath = decodeURIComponent(
      requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname,
    );
    const filePath = path.resolve(PUBLIC_ROOT, `.${relativePath}`);

    if (!filePath.startsWith(`${PUBLIC_ROOT}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }

    try {
      const body = await readFile(filePath);
      response.writeHead(200, {
        ...ISOLATION_HEADERS,
        "Content-Type": MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream",
        "Content-Length": body.byteLength,
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

// --------------------------------------------------------------------------
// Boot (— verbatim, plus a parameterised variant)
// --------------------------------------------------------------------------

export async function bootBrowserLocalApp(page: Page): Promise<void> {
  await page.goto("/?devmode=true&disableWebSerial=true&nosave");
  await page.waitForFunction(async () => {
    await window.__useqReady;
    return typeof window.__useqBrowserEval?.sampleOutputAtTime === "function";
  });
  await expect(page.locator("#panel-main-editor .cm-content")).toBeVisible();
}

// — new: same waits as bootBrowserLocalApp but with a caller-chosen URL.
// devmode=true is REQUIRED in every M1 url (it gates __useqBrowserEval —
// the accepted A2 compromise); disableWebSerial=true forces wasm-only mode.
export async function bootApp(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForFunction(async () => {
    await window.__useqReady;
    return typeof window.__useqBrowserEval?.sampleOutputAtTime === "function";
  });
  await expect(page.locator("#panel-main-editor .cm-content")).toBeVisible();
}

// --------------------------------------------------------------------------
// Editing (— verbatim)
// --------------------------------------------------------------------------

// NOTE: single-line text only. Never pass "\n" — the toContainText assertion
// normalises whitespace and multi-line docs join WITHOUT a separator in the
// DOM, so the assertion would fail. Use appendEditorLine for further lines.
export async function replaceEditorText(page: Page, text: string): Promise<void> {
  const editor = page.locator("#panel-main-editor .cm-content");
  await editor.click();
  await page.keyboard.press("Control+A");
  // Clear before typing: typing "(" over a non-empty selection triggers
  // CodeMirror's wrap-selection-in-brackets behaviour instead of replacing.
  await page.keyboard.press("Backspace");
  await page.keyboard.type(text);
  await expect(editor).toContainText(text);
}

export async function evaluateTopLevelFromKeyboard(page: Page): Promise<void> {
  // Playwright's keyboard input is trusted browser input. Alt+Enter is the
  // production eval.quantised binding and reaches the command router.
  await page.keyboard.press("Alt+Enter");
}

export async function sampleOutput(page: Page, name: string, time: number): Promise<number> {
  return page.evaluate(
    ({ outputName, timeSeconds }) =>
      window.__useqBrowserEval!.sampleOutputAtTime(outputName, timeSeconds),
    { outputName: name, timeSeconds: time },
  );
}

// --------------------------------------------------------------------------
// New helpers (— new)
// --------------------------------------------------------------------------

/**
 * Engine-readiness probe. `sampleOutputAtTime` returns NaN BOTH when the
 * worker/engine is not yet up AND when a named output is idle, so NaN is
 * ambiguous until this has passed. "t" is not an output name, so the WASM
 * wrapper compiles it as an expression and evaluates it at the given time
 * (wasm_wrapper.cpp useq_eval_output → eval_expression_at_time): once the
 * engine is live, sampling "t" at 0.5 returns exactly 0.5.
 */
export async function awaitEngineReady(page: Page): Promise<void> {
  await expect
    .poll(() => sampleOutput(page, "t", 0.5), { timeout: 15_000 })
    .toBeCloseTo(0.5, 6);
}

/**
 * Append a new top-level line at the end of the document and verify it
 * renders as its own .cm-line. Single-line text only.
 */
export async function appendEditorLine(page: Page, text: string): Promise<void> {
  const editor = page.locator("#panel-main-editor .cm-content");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(text);
  await expect(
    page.locator("#panel-main-editor .cm-line").filter({ hasText: text }),
  ).toBeVisible();
}

/**
 * Put the cursor INSIDE the top-level form on the first editor line whose
 * text contains `lineText`. Click may land anywhere in the line; Home +
 * ArrowRight×2 lands deterministically two characters in — inside the form,
 * matching the position the browserEvalSurface uses for toplevel lookup.
 */
export async function placeCursorInLine(page: Page, lineText: string): Promise<void> {
  const line = page
    .locator("#panel-main-editor .cm-line")
    .filter({ hasText: lineText })
    .first();
  await line.click();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
}

/**
 * Select the whole current line and retype it. Deletion of a non-empty
 * selection is permitted by bracket protection (input-dispatch.md §4.1
 * "All other deletions: permitted"); typing then starts from an empty
 * selection so auto-pair (not wrap) applies.
 */
export async function retypeLine(page: Page, oldLineText: string, newText: string): Promise<void> {
  await placeCursorInLine(page, oldLineText);
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(newText);
  await expect(
    page.locator("#panel-main-editor .cm-line").filter({ hasText: newText }),
  ).toBeVisible();
}

/** Seed localStorage before any page script runs (applies on navigation). */
export async function seedLocalStorage(
  context: BrowserContext,
  entries: Record<string, string>,
): Promise<void> {
  await context.addInitScript((kv: Record<string, string>) => {
    for (const [k, v] of Object.entries(kv)) window.localStorage.setItem(k, v);
  }, entries);
}

export function readLocalStorage(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k) => window.localStorage.getItem(k), key);
}

// --------------------------------------------------------------------------
// Shared constants (— new)
// --------------------------------------------------------------------------

export const URLS = {
  /** Real cold-start path (writes allowed). devmode gates __useqBrowserEval. */
  coldBoot: "/?devmode=true&disableWebSerial=true",
  /** Canonical no-writes boot used by most journeys. */
  coldBootNosave: "/?devmode=true&disableWebSerial=true&nosave",
} as const;

export const STORAGE_KEYS = {
  userCode: "uSEQ-Perform-User-Code",        // persistence.md §1.2 (raw string)
  userSettings: "uSEQ-Perform-User-Settings", // persistence.md §1.2
} as const;

export const SEL = {
  editor: "#panel-main-editor .cm-content",
  editorLine: "#panel-main-editor .cm-line",
  inlineResult: ".cm-inline-result",
  inlineResultError: ".cm-inline-result--error",
  lintError: ".cm-lintRange-error",
  lintTooltipDiagnostic: ".cm-tooltip .cm-diagnostic",
  playBtn: ".cm-expr-play-btn",
  playBtnOn: ".cm-expr-play-btn.is-visualising",
  railFailing: ".cm-expr-rail-failing",
  connectButton: '#panel-toolbar button[aria-label="Connect (WASM)"]',
  connectBadge: "#panel-toolbar .connect-badge",
  transportPlay: '#panel-top-toolbar button[aria-label="Play"]',
  transportPause: '#panel-top-toolbar button[aria-label="Pause"]',
  transportStop: '#panel-top-toolbar button[aria-label="Stop"]',
  consoleEntry: ".console-entry",
  transportRewind: '#panel-top-toolbar button[aria-label="Rewind"]',
  transportClear: '#panel-top-toolbar button[aria-label="Clear"]',
  progressBar: "#toolbar-bar-progress",
  editorRoot: "#panel-main-editor .cm-editor",
} as const;

export const PROGRAMS = {
  /**
   * Runtime-error (non-finite) program: +Inf for every t > 0, finite at t = 0;
   * not constant-foldable. Mirrors OVERFLOW_PROG in
   * src-useq/test/signal_engine/test_failure_mode.cpp. NEVER sample at t = 0
   * in tests using this program — a healthy pass clears the per-pass fallback
   * state (failure-model.md §3.3).
   */
  overflowA1: "(a1 (* (* t 1e308) 1e308))",
} as const;

// ==========================================================================
// M2 additions (additive — do not modify anything above this line)
// ==========================================================================

/**
 * Readiness wait WITHOUT navigation — for use after page.reload() (which keeps
 * the same context, route interception, and URL, so no goto is needed).
 * Mirrors the waits inside bootApp/bootBrowserLocalApp.
 */
export async function awaitAppReady(page: Page): Promise<void> {
  await page.waitForFunction(async () => {
    await window.__useqReady;
    return typeof window.__useqBrowserEval?.sampleOutputAtTime === "function";
  });
  await expect(page.locator("#panel-main-editor .cm-content")).toBeVisible();
}

/**
 * Click a transport control by aria-label. Only ENABLED buttons are clickable;
 * Playwright throws on a disabled target, which correctly encodes the transport
 * machine's ignored transitions (transport.md §1.2). See M2-GT#8.
 */
export async function clickTransport(
  page: Page,
  control: "play" | "pause" | "stop" | "rewind" | "clear",
): Promise<void> {
  const label = { play: "Play", pause: "Pause", stop: "Stop", rewind: "Rewind", clear: "Clear" }[control];
  await page.locator(`#panel-top-toolbar button[aria-label="${label}"]`).click();
}

/**
 * Read the transport progress-bar scaleX in [0,1]. #toolbar-bar-progress renders
 * visStore.bar as `transform: scaleX(n)` (ProgressBar.tsx); the computed transform
 * is matrix(a,b,c,d,e,f) whose `a` component is scaleX. In wasm mode this is the
 * local-clock bar phase (transport §1.4-1.5) — a runtime/clock-sourced observation.
 * Identity (scaleX=1) computes to "none"; treat that as 1.
 */
export async function readProgressScaleX(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.getElementById("toolbar-bar-progress");
    if (!el) return Number.NaN;
    const t = getComputedStyle(el).transform;
    if (!t || t === "none") return 1;
    const m = t.match(/matrix\(([^)]+)\)/);
    if (!m) return Number.NaN;
    return parseFloat(m[1].split(",")[0]);
  });
}

/**
 * Assert the structural cursor halo is / isn't rendered. The halo has no
 * dedicated class; nodeOverlays toggles `useq-hide-bracket-match` on `.cm-editor`
 * precisely when a highlight polygon is drawn (nodeOverlays.ts:755) — the
 * sanctioned DOM projection of "a structural node is focused", i.e. the production
 * cursorFromSelection path the YAML corpus never runs (M2-GT#3/#6). Measurement is
 * rAF-debounced; the web-first assertion auto-retries.
 */
export async function expectStructuralHalo(page: Page, active: boolean): Promise<void> {
  const editor = page.locator("#panel-main-editor .cm-editor");
  if (active) await expect(editor).toHaveClass(/useq-hide-bracket-match/);
  else await expect(editor).not.toHaveClass(/useq-hide-bracket-match/);
}

/**
 * Place the caret `presses` positions left of the document end. Click focuses the
 * editor and fires a selectionSet (waking cursorFromSelection); Control+End then
 * normalises to the true end regardless of where the click landed; ArrowLeft×presses
 * lands a deterministic character offset. For the single-form docs the structural
 * tests use, this makes the cursorFromSelection snap target unambiguous (M2-GT#7).
 */
export async function placeCaretLeftFromDocEnd(page: Page, presses: number): Promise<void> {
  const editor = page.locator("#panel-main-editor .cm-content");
  await editor.click();
  await page.keyboard.press("Control+End");
  for (let i = 0; i < presses; i++) await page.keyboard.press("ArrowLeft");
}

/**
 * Seed a deliberately corrupt (non-JSON) value under a storage key so the boot-time
 * persistence.load hits its catch path (persistence.ts:120). Thin wrapper over
 * seedLocalStorage. Applies on navigation via addInitScript — do NOT use with
 * page.reload() (it re-seeds every load; M2-GT#10 Consequence B).
 */
export async function seedCorruptStorage(
  context: BrowserContext,
  key: string,
  rawValue: string,
): Promise<void> {
  await seedLocalStorage(context, { [key]: rawValue });
}

/**
 * Begin capturing browser console messages. Attach BEFORE the navigation that
 * should emit them. Returns a live array of "type: text" strings.
 */
export function startConsoleCapture(page: Page): string[] {
  const messages: string[] = [];
  page.on("console", (msg) => messages.push(`${msg.type()}: ${msg.text()}`));
  return messages;
}

// ==========================================================================
// A3 additions — deterministic clock control + stale-build precheck
// (additive — do not modify anything above this line)
// ==========================================================================

/**
 * Pin ModuLisp local time at its current value via the A1 devmode hook
 * (`src/runtime/browserEvalSurface.ts` freezeClock). The rAF loop keeps
 * painting/polling; only the local-time branch reads a constant. Idempotent.
 * Throws in-page (surfaced by page.evaluate) if the synthesis engine owns the
 * timeline (VAL-ENGINE-002) — journeys must keep audio off to use the seam.
 */
export async function freezeClock(page: Page): Promise<void> {
  await page.evaluate(() => window.__useqBrowserEval!.freezeClock());
}

/**
 * Advance frozen local time by `stepMs`. The A1 hook resolves only after the
 * production rAF tick has observed the new time AND the sampling queue has
 * drained, so the caller may assert immediately with no wall-clock wait.
 * `stepMs === 0` pumps two frames + a drain without advancing time — a clean
 * way to settle any in-flight sample before a hold assertion.
 */
export async function stepClock(page: Page, stepMs: number): Promise<void> {
  await page.evaluate((ms) => window.__useqBrowserEval!.stepClock(ms), stepMs);
}

/**
 * Restore the real `performance.now` source. The seam re-anchors so local time
 * continues from the frozen value with no jump. No-op when not frozen.
 */
export async function resumeClock(page: Page): Promise<void> {
  await page.evaluate(() => window.__useqBrowserEval!.resumeClock());
}

/** Read the current deterministic-clock freeze state (A1 hook). */
export function isClockFrozen(page: Page): Promise<boolean> {
  return page.evaluate(() => window.__useqBrowserEval!.isClockFrozen());
}

/**
 * Artifact-freshness precheck for the classic stale-bundle trap. The E2E suite
 * serves the prebuilt `public/` tree (no webServer that rebuilds), so if the
 * app bundle predates a source edit the journeys silently exercise stale code.
 * `npm run test:e2e` rebuilds first; a bare `npx playwright test` does NOT — so
 * specs that depend on freshly-built behaviour guard themselves with this.
 *
 * Pure fs mtime comparison (no page) so it can run in a `beforeAll`: fails fast
 * with an actionable message when `public/solid-dist/bundle.js` is older than
 * the newest file under `src/`.
 *
 * NOT wired into the shared boot helpers: other agents actively edit `src/`, so
 * a stale bundle is the *expected* state during parallel dev, and gating the
 * whole suite on it would turn every existing journey red for an unrelated
 * reason. It belongs only in specs whose assertions require the fresh build.
 */
export function assertFreshBuild(): void {
  const bundlePath = path.resolve(PUBLIC_ROOT, "solid-dist/bundle.js");
  const srcRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src",
  );

  let bundleMtimeMs: number;
  try {
    bundleMtimeMs = statSync(bundlePath).mtimeMs;
  } catch {
    throw new Error(
      `assertFreshBuild: ${bundlePath} does not exist. Build the app before ` +
        "running E2E: `npm run build:assets && npx vite build` (or `npm run test:e2e`).",
    );
  }

  let newestSrcMtimeMs = 0;
  let newestSrcPath = "";
  const stack: string[] = [srcRoot];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        const m = statSync(full).mtimeMs;
        if (m > newestSrcMtimeMs) {
          newestSrcMtimeMs = m;
          newestSrcPath = full;
        }
      }
    }
  }

  if (bundleMtimeMs < newestSrcMtimeMs) {
    throw new Error(
      "assertFreshBuild: the app bundle is STALE. " +
        `${newestSrcPath} (${new Date(newestSrcMtimeMs).toISOString()}) is newer ` +
        `than public/solid-dist/bundle.js (${new Date(bundleMtimeMs).toISOString()}). ` +
        "Rebuild before running these journeys: " +
        "`npm run build:assets && npx vite build` (or run via `npm run test:e2e`).",
    );
  }
}
