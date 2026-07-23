import { expect, test } from "@playwright/test";

import {
  bootBrowserLocalApp,
  evaluateTopLevelFromKeyboard,
  installStaticOrigin,
  replaceEditorText,
  sampleOutput,
} from "./helpers";

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
