import { expect, test } from "@playwright/test";

import {
  awaitEngineReady,
  bootBrowserLocalApp,
  installStaticOrigin,
  replaceEditorText,
  sampleOutput,
  SEL,
} from "./helpers";

// M1.4 — real-key input dispatch. Playwright key events are trusted browser
// input; every route below is the production chokepoint (Prec.highest policy
// keymap -> executeEditorCommand -> pressEditorKey, src/editors/keymaps.ts:133-157
// — input-dispatch §7 migration verified done; expect-pass, not expected-fail).
test.describe("real-key input dispatch (input-dispatch §4.1, keybindings defaults)", () => {
  test.beforeEach(async ({ context, page }) => {
    await installStaticOrigin(context);
    await bootBrowserLocalApp(page);
    await awaitEngineReady(page);
  });

  // ID-1 — code-evaluation.md §1.1 (Immediate strategy — fires immediately, no
  // quant wait), §1.4 (inline result); input-dispatch.md §5 (keyboard bound
  // actions row); keybindings default eval.now = Mod-Enter (defaults.ts:33; Mod =
  // Control on the Linux runner).
  test("eval.now (Control+Enter) evaluates through the production router", async ({ page }) => {
    await replaceEditorText(page, "(a1 0.5)");
    await page.keyboard.press("Control+Enter");

    // Runtime layer: the immediate eval reached the engine.
    await expect.poll(() => sampleOutput(page, "a1", 0.5)).toBeCloseTo(0.5, 6);
    // DOM layer: inline result surfaced (§1.4).
    await expect(page.locator(SEL.inlineResult)).toBeVisible();
  });

  // ID-2 — code-evaluation.md §1.1 (Soft: WASM-only local preview; updates all
  // local visual surfaces — inline results included — everything except hardware
  // send); expression-gutter.md §3.4 ("Soft eval is the explicit exception: a
  // soft eval is an inspection action and does not flip the toggle"), §2.4 (soft
  // eval does not move the rail); keybindings default eval.soft = Mod-Shift-Enter
  // (defaults.ts:35).
  test("eval.soft (Control+Shift+Enter) previews without flipping the vis toggle", async ({ page }) => {
    await replaceEditorText(page, "(a1 0.9)");
    await page.keyboard.press("Control+Shift+Enter");

    // DOM layer: local surface updated (§1.1).
    await expect(page.locator(SEL.inlineResult)).toBeVisible();
    // DOM layer: the §3.4 exception — soft eval does NOT flip the vis toggle.
    await expect(page.locator(SEL.playBtnOn)).toHaveCount(0);
    await expect(page.locator('.cm-expr-play-btn[data-expr="a1"]')).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // Runtime layer: in wasm-only mode the "local" surface IS the WASM engine;
    // soft eval evaluates on it (code-evaluation §1.1). If this specific
    // assertion fails, do not weaken it — escalate for spec triage (risk R3).
    await expect.poll(() => sampleOutput(page, "a1", 0.5)).toBeCloseTo(0.9, 6);
  });

  // ID-3 — input-dispatch.md §4.1 (bracket protection, default on: Backspace
  // targeting a closing delimiter with an empty selection -> blocked no-op),
  // §1.2/§5.1 (policy lives in the router; keyboard traverses it); editor
  // editor.preventBracketUnbalancing default true.
  test("Backspace that would delete a closing delimiter is blocked at the chokepoint", async ({ page }) => {
    // Cursor ends immediately after the final ")" — Backspace's target is that
    // closing delimiter.
    await replaceEditorText(page, "(a1 1)");
    await page.keyboard.press("Backspace");

    // DOM layer: document unchanged (blocked). If the router's structural
    // handling moves the cursor without deleting, text is still unchanged —
    // the assertion holds; text mutation is what §4.1 forbids.
    await expect(page.locator(SEL.editor)).toContainText("(a1 1)");
    // Runtime coda: the doc remained balanced and evaluable end-to-end.
    await page.keyboard.press("Control+Enter");
    await expect.poll(() => sampleOutput(page, "a1", 0.5)).toBeCloseTo(1, 6);
  });

  // ID-4 — input-dispatch.md §4.1 bullet 3 (Backspace between a matched
  // auto-inserted pair removes both), §4.3 (open-bracket auto-pair).
  test("Backspace between an auto-inserted pair removes both delimiters", async ({ page }) => {
    const editor = page.locator(SEL.editor);
    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");

    // Auto-pair (§4.3): typing "(" inserts "()" with the cursor between.
    await page.keyboard.type("(");
    await expect(editor).toContainText("()");

    await page.keyboard.press("Backspace");

    // DOM layer: both delimiters removed (§4.1).
    await expect(editor).toHaveText("");
    // Runtime coda: the editor is fully functional after the policy operation.
    await page.keyboard.type("(d1 1)");
    await page.keyboard.press("Control+Enter");
    await expect.poll(() => sampleOutput(page, "d1", 0.5)).toBeCloseTo(1, 6);
  });

  // ID-5 — input-dispatch.md §4.3 ("If text is selected, the selection is
  // wrapped"), enforced in the router's handleBracketKey. (This is also the
  // documented reason replaceEditorText must clear before typing — the test
  // memorialises the gotcha as spec-intended behaviour.)
  test("typing ( over a selection wraps it (and the wrapped form evaluates)", async ({ page }) => {
    await replaceEditorText(page, "+ 1 2");
    await page.keyboard.press("Control+A");
    await page.keyboard.type("(");

    // DOM layer: wrapped, not replaced.
    await expect(page.locator(SEL.editor)).toContainText("(+ 1 2)");
    // Runtime coda: the wrapped form is a REPL eval whose result (3) flows back
    // through the production inline-result surface (code-evaluation §1.4;
    // failure-model §7.1 REPL context — no output assignment, so no sampling
    // read; the inline result IS the runtime observation surfaced to the DOM).
    await page.keyboard.press("Control+Enter");
    await expect(page.locator(SEL.inlineResult)).toContainText("3");
  });
});
