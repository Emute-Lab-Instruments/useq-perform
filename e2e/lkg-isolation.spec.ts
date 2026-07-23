import { expect, test } from "@playwright/test";

import {
  PROGRAMS,
  SEL,
  appendEditorLine,
  awaitEngineReady,
  bootBrowserLocalApp,
  evaluateTopLevelFromKeyboard,
  installStaticOrigin,
  replaceEditorText,
  retypeLine,
  sampleOutput,
} from "./helpers";

// M1.3 — LKG isolation (see m1-design.md §3.3).
// Never sample at t = 0 anywhere in this file (ground truth #4/#5): a healthy
// t = 0 pass on the overflow program clears the per-pass fallback state.
test.describe("LKG isolation (MAIN §2.1/§2.7, failure-model §1–3)", () => {
  test.beforeEach(async ({ context, page }) => {
    await installStaticOrigin(context);
    await bootBrowserLocalApp(page);
    await awaitEngineReady(page);
  });

  // LKG-1 (FLAGSHIP) — a runtime-broken a1 falls back to LKG while a2 keeps
  // producing.
  // Spec citations: MAIN.md §2.1 (eval failure must not stop the app; prior
  // program continues); failure-model.md §1.5/§1.7 (non-finite propagation to
  // root is a time-phase-dependent runtime error), §2.1 (whole-output LKG
  // fallback), §2.2 (LKG = most recent program with a healthy committed batch),
  // §3.2 (`lkg` default mode: non-finite at root substitutes LKG + marks
  // `fallback` + surfaces an active diagnostic), §10.1 (batch isolation: one
  // output's error never aborts others); expression-gutter.md §2.5 (failure
  // pulse on the active rail, sourced from health error/fallback).
  test("a runtime-broken a1 falls back to LKG while a2 keeps producing", async ({
    page,
  }) => {
    await replaceEditorText(page, "(a1 0.75)");
    await evaluateTopLevelFromKeyboard(page);
    await expect.poll(() => sampleOutput(page, "a1", 0.5)).toBeCloseTo(0.75, 6);

    // Warm-up gate (risk R1): confirms vis registered and the frame loop is
    // sampling/committing, which is required for LKG promotion.
    await expect(
      page.locator('.cm-expr-play-btn[data-expr="a1"].is-visualising'),
    ).toBeVisible();

    await appendEditorLine(page, "(a2 0.25)");
    await evaluateTopLevelFromKeyboard(page);
    await expect.poll(() => sampleOutput(page, "a2", 0.5)).toBeCloseTo(0.25, 6);

    // Break a1: this program COMPILES (eval accepted, rail moves to it) and then
    // errors at runtime on every t > 0 pass.
    await retypeLine(page, "(a1 0.75)", PROGRAMS.overflowA1);
    await evaluateTopLevelFromKeyboard(page);

    // Runtime: non-finite at root → LKG substituted (failure-model §2.1/§3.2).
    // The value 0.75 (not 0.0) also proves LKG promotion happened — a
    // never-promoted output would yield the neutral default 0 per §2.4 (risk R1).
    await expect
      .poll(() => sampleOutput(page, "a1", 0.5), { timeout: 10_000 })
      .toBeCloseTo(0.75, 6);
    // Batch isolation (§10.1; MAIN §2.1): a2 untouched by a1's failure.
    await expect
      .poll(() => sampleOutput(page, "a2", 0.5), { timeout: 10_000 })
      .toBeCloseTo(0.25, 6);

    // DOM: failure pulse on exactly one rail — a1's active rail is in fallback,
    // a2's is not (expression-gutter §2.5; NaN → `fallback` health polled
    // per-frame from useq_active_diagnostics into outputHealthStore and consumed
    // by the gutter — the sanctioned DOM projection of health today).
    await expect(page.locator(SEL.railFailing)).toHaveCount(1, {
      timeout: 10_000,
    });
  });

  // LKG-2 — compile diagnostics are plain-language and carry a suggestion.
  // Spec citations: MAIN.md §2.7 (severity + plain-language message + optional
  // suggestion; no jargon); failure-model.md §1.3 (structured diagnostics with
  // suggestion, often a working example); code-evaluation.md §1.6 (diagnostics
  // as inline annotations); MAIN.md §2.1 (inline diagnostic + console message).
  // Unknown-name diagnostics are guaranteed to carry a suggestion
  // (graph_builder.cpp:213-236).
  test("compile diagnostics are plain-language and carry a suggestion", async ({
    page,
  }) => {
    await replaceEditorText(page, "(a1 (swa 1))");
    await evaluateTopLevelFromKeyboard(page);

    // DOM — user-visible message.
    await expect(page.locator(SEL.lintError)).toBeVisible();
    await expect(page.locator(SEL.inlineResultError)).toBeVisible();
    // Plain-language message shown to the user (MAIN §2.7)...
    await expect(page.locator(SEL.inlineResultError)).toContainText("Unknown");
    // ...and never the raw placeholder.
    await expect(page.locator(SEL.inlineResultError)).not.toContainText(
      "{error}",
    );

    // Suggestion (MAIN §2.7 "optional suggestion" — present for this category).
    // Lint hover tooltip has a ~300 ms hover delay; auto-retrying assertion
    // absorbs it (risk R2).
    await page.locator(SEL.lintError).first().hover();
    await expect(
      page.locator(SEL.lintTooltipDiagnostic).first(),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.locator(SEL.lintTooltipDiagnostic).first(),
    ).toContainText(/Did you mean|Try:|Check your spelling/);

    // Console (MAIN §2.1 "and a console message").
    await expect(
      page.locator(SEL.consoleEntry).filter({ hasText: "Unknown" }).first(),
    ).toBeVisible();

    // Runtime: the rejected eval assigned nothing; a1 remains idle
    // (failure-model §2.6: compile-time errors do not consume/alter anything).
    expect(Number.isNaN(await sampleOutput(page, "a1", 0.5))).toBe(true);
  });

  // LKG-3 — a healthy re-eval returns a fallen-back output to running and clears
  // the pulse.
  // Spec citations: failure-model.md §5.2 (fallback → running on new healthy
  // assignment), §3.3 (per-pass fallback tracking); expression-gutter.md §2.5
  // ("the pulse persists until a successful eval at the same range clears it").
  test("a healthy re-eval returns a fallen-back output to running and clears the pulse", async ({
    page,
  }) => {
    await replaceEditorText(page, "(a1 0.75)");
    await evaluateTopLevelFromKeyboard(page);
    await expect.poll(() => sampleOutput(page, "a1", 0.5)).toBeCloseTo(0.75, 6);

    await expect(
      page.locator('.cm-expr-play-btn[data-expr="a1"].is-visualising'),
    ).toBeVisible();

    await retypeLine(page, "(a1 0.75)", PROGRAMS.overflowA1);
    await evaluateTopLevelFromKeyboard(page);
    await expect(page.locator(SEL.railFailing)).toHaveCount(1, {
      timeout: 10_000,
    });

    // Recover: pass a distinctive substring of the overflow line as oldLineText.
    await retypeLine(page, "1e308))", "(a1 0.5)");
    await evaluateTopLevelFromKeyboard(page);

    // Runtime: new healthy program producing (§5.2 fallback → running).
    await expect
      .poll(() => sampleOutput(page, "a1", 0.5), { timeout: 10_000 })
      .toBeCloseTo(0.5, 6);
    // DOM: pulse cleared by the successful eval at the same range (§2.5).
    await expect(page.locator(SEL.railFailing)).toHaveCount(0, {
      timeout: 10_000,
    });
  });

  // LKG-4 — an output on LKG shows a "using previous version" badge.
  // Spec citation: src-useq/docs/specs/failure-model.md §5.3 — the health state
  // drives the "'using previous version — view error' badge that appears on
  // fallback". Status: specified-but-unbuilt in the app (code inspection
  // 2026-07-22): the only UI consumer of outputHealth is the gutter failure
  // pulse (expressionHighlights.ts); no component renders any fallback badge
  // text. Living spec-debt register row — if it ever starts passing, Playwright
  // flags it and the assertion should be promoted into LKG-1.
  test("an output on LKG shows a 'using previous version' badge", async ({
    page,
  }) => {
    test.fail(
      true,
      "failure-model.md §5.3: fallback badge unbuilt — living spec-debt register (see m1-design.md LKG-4)",
    );

    // Steps 1–3 of LKG-3: establish fallback. The railFailing count-1 assertion
    // guarantees the app *knows* the output is on LKG before the register
    // assertion runs.
    // Before the outputHealthStore error-projection fix, this railFailing setup
    // gate was the step that failed; the badge assertion below is what keeps
    // this test expected-fail now that the gate passes.
    await replaceEditorText(page, "(a1 0.75)");
    await evaluateTopLevelFromKeyboard(page);
    await expect.poll(() => sampleOutput(page, "a1", 0.5)).toBeCloseTo(0.75, 6);

    await expect(
      page.locator('.cm-expr-play-btn[data-expr="a1"].is-visualising'),
    ).toBeVisible();

    await retypeLine(page, "(a1 0.75)", PROGRAMS.overflowA1);
    await evaluateTopLevelFromKeyboard(page);
    await expect(page.locator(SEL.railFailing)).toHaveCount(1, {
      timeout: 10_000,
    });

    // Register assertion (will fail today — unbuilt behaviour).
    await expect(page.getByText(/previous version/i).first()).toBeVisible({
      timeout: 5_000,
    });
  });
});
