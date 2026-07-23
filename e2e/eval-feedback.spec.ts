import { expect, test } from "@playwright/test";

import {
  appendEditorLine,
  awaitEngineReady,
  bootBrowserLocalApp,
  evaluateTopLevelFromKeyboard,
  installStaticOrigin,
  replaceEditorText,
  retypeLine,
  sampleOutput,
  SEL,
} from "./helpers";

// M1.2 — eval feedback depth.
// beforeEach: installStaticOrigin -> bootBrowserLocalApp -> awaitEngineReady.
// All evals use evaluateTopLevelFromKeyboard (Alt+Enter, quantised — the green
// lane's proven route; binding variants are input-dispatch.spec.ts's job).
test.describe("eval feedback depth (code-evaluation, MAIN §2.8, expression-gutter §2.1/§3.4)", () => {
  test.beforeEach(async ({ context, page }) => {
    await installStaticOrigin(context);
    await bootBrowserLocalApp(page);
    await awaitEngineReady(page);
  });

  // EF-1 — expect-pass.
  // Spec: MAIN.md §2.1 (independent outputs), code-evaluation.md §1.1 (quantised
  // strategy), §1.4 (inline result), §1.8 (head-position recognition -> implicit
  // vis); expression-gutter.md §3.4 (eval implicitly toggles vis on, per-output
  // slots), §3.1 (different outputs independent).
  test("two outputs evaluated independently both go live with vis on", async ({ page }) => {
    // 1. Evaluate a1.
    await replaceEditorText(page, "(a1 0.25)");
    await evaluateTopLevelFromKeyboard(page);

    // 2. Runtime: a1 produces.
    await expect.poll(() => sampleOutput(page, "a1", 0.5)).toBeCloseTo(0.25, 6);

    // 3. Evaluate a2 on its own line.
    await appendEditorLine(page, "(a2 0.75)");
    await evaluateTopLevelFromKeyboard(page);

    // 4. Runtime: a2 produces; a1 undisturbed (MAIN §2.1).
    await expect.poll(() => sampleOutput(page, "a2", 0.5)).toBeCloseTo(0.75, 6);
    expect(await sampleOutput(page, "a1", 0.5)).toBeCloseTo(0.25, 6);

    // 5. DOM: both outputs' variants toggled on (§3.4; §3.1 independence).
    await expect(page.locator(SEL.playBtnOn)).toHaveCount(2);

    // 6. DOM: each output's play button is pressed.
    await expect(
      page.locator('.cm-expr-play-btn[data-expr="a1"]'),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator('.cm-expr-play-btn[data-expr="a2"]'),
    ).toHaveAttribute("aria-pressed", "true");

    // 7. DOM: inline result present (§1.4).
    await expect(page.locator(SEL.inlineResult).first()).toBeVisible();
  });

  // EF-2 — expect-pass.
  // Spec: MAIN.md §2.8 (successful eval clears prior diagnostics for the affected
  // outputs, not the whole document); code-evaluation.md §1.6 (per-range
  // persistence), §1.7; failure-model.md §4.1.
  test("successful re-eval clears diagnostics for its own output only", async ({ page }) => {
    // 1. a1 with an unknown name -> one lint error.
    await replaceEditorText(page, "(a1 (nope1 1))");
    await evaluateTopLevelFromKeyboard(page);
    await expect(page.locator(SEL.lintError)).toHaveCount(1);

    // 2. a2 with an unknown name -> two lint errors.
    await appendEditorLine(page, "(a2 (nope2 1))");
    await evaluateTopLevelFromKeyboard(page);
    await expect(page.locator(SEL.lintError)).toHaveCount(2);

    // 3. Fix output 1 only.
    await retypeLine(page, "(a1 (nope1 1))", "(a1 0.5)");
    await evaluateTopLevelFromKeyboard(page);

    // 4. DOM: a1's diagnostic cleared, a2's persisted (MAIN §2.8).
    await expect(page.locator(SEL.lintError)).toHaveCount(1);

    // 5. DOM: the survivor is a2's.
    await expect(
      page.locator(SEL.editorLine).filter({ hasText: "(a2" }).locator(SEL.lintError),
    ).toHaveCount(1);
    await expect(
      page.locator(SEL.editorLine).filter({ hasText: "(a1" }).locator(SEL.lintError),
    ).toHaveCount(0);

    // 6. Runtime: fix landed; a2 never compiled -> idle (failure-model §2.6).
    await expect.poll(() => sampleOutput(page, "a1", 0.5)).toBeCloseTo(0.5, 6);
    expect(Number.isNaN(await sampleOutput(page, "a2", 0.5))).toBe(true);
  });

  // EF-3 — expect-pass.
  // Spec: expression-gutter.md §2.1 (active assignment on eval; latest accepted
  // eval wins), §3.4 (implicit toggle is exclusive per output), §3.1 (per-output
  // exclusivity); code-evaluation.md §1.8.
  test("evaluating a second variant of the same output moves the vis toggle exclusively", async ({
    page,
  }) => {
    // 1. First variant of a1.
    await replaceEditorText(page, "(a1 0.25)");
    await evaluateTopLevelFromKeyboard(page);
    await expect.poll(() => sampleOutput(page, "a1", 0.5)).toBeCloseTo(0.25, 6);

    // 2. Second variant of a1 on its own line.
    await appendEditorLine(page, "(a1 0.75)");
    await evaluateTopLevelFromKeyboard(page);

    // 3. Runtime: latest accepted eval wins (§2.1), observed at output value.
    await expect.poll(() => sampleOutput(page, "a1", 0.5)).toBeCloseTo(0.75, 6);

    // 4. DOM: exclusive toggle (§3.4/§3.1). Buttons gutter-ordered by line.
    const btns = page.locator('.cm-expr-play-btn[data-expr="a1"]');
    await expect(btns).toHaveCount(2);
    await expect(
      page.locator('.cm-expr-play-btn[data-expr="a1"].is-visualising'),
    ).toHaveCount(1);
    await expect(btns.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(btns.nth(0)).toHaveAttribute("aria-pressed", "false");
  });
});
