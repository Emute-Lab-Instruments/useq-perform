import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";

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
  sampleOutputAtTime(outputName: string, timeSeconds: number): Promise<number>;
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
async function installStaticOrigin(context: BrowserContext): Promise<void> {
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

async function bootBrowserLocalApp(page: Page): Promise<void> {
  await page.goto("/?devmode=true&disableWebSerial=true&nosave");
  await page.waitForFunction(async () => {
    await window.__useqReady;
    return typeof window.__useqBrowserEval?.sampleOutputAtTime === "function";
  });
  await expect(page.locator("#panel-main-editor .cm-content")).toBeVisible();
}

async function replaceEditorText(page: Page, text: string): Promise<void> {
  const editor = page.locator("#panel-main-editor .cm-content");
  await editor.click();
  await page.keyboard.press("Control+A");
  // Clear before typing: typing "(" over a non-empty selection triggers
  // CodeMirror's wrap-selection-in-brackets behaviour instead of replacing.
  await page.keyboard.press("Backspace");
  await page.keyboard.type(text);
  await expect(editor).toContainText(text);
}

async function evaluateTopLevelFromKeyboard(page: Page): Promise<void> {
  // Playwright's keyboard input is trusted browser input. Alt+Enter is the
  // production eval.quantised binding and reaches the command router.
  await page.keyboard.press("Alt+Enter");
}

async function sampleOutput(page: Page, name: string, time: number): Promise<number> {
  return page.evaluate(
    ({ outputName, timeSeconds }) =>
      window.__useqBrowserEval!.sampleOutputAtTime(outputName, timeSeconds),
    { outputName: name, timeSeconds: time },
  );
}

test.describe("trusted user input -> frontend -> virtual uSEQ firmware", () => {
  test.beforeEach(async ({ context, page }) => {
    await installStaticOrigin(context);
    await bootBrowserLocalApp(page);
  });

  test("evaluates typed code through the production keyboard route", async ({ page }) => {
    await replaceEditorText(page, "(a1 0.25)");
    await evaluateTopLevelFromKeyboard(page);

    await expect.poll(() => sampleOutput(page, "a1", 0.5)).toBeCloseTo(0.25, 6);
    await expect(page.locator(".cm-inline-result")).toBeVisible();
  });

  test("shows an error and preserves last-known-good output", async ({ page }) => {
    await replaceEditorText(page, "(a1 0.75)");
    await evaluateTopLevelFromKeyboard(page);
    await expect.poll(() => sampleOutput(page, "a1", 0.5)).toBeCloseTo(0.75, 6);

    await replaceEditorText(page, "(a1 (not-a-real-function 1))");
    await evaluateTopLevelFromKeyboard(page);

    await expect(page.locator(".cm-lintRange-error")).toBeVisible();
    await expect(page.locator(".cm-inline-result--error")).toBeVisible();
    await expect.poll(() => sampleOutput(page, "a1", 0.5)).toBeCloseTo(0.75, 6);
  });
});
