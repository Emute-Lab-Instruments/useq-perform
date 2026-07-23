import { expect, test } from "@playwright/test";

import {
  awaitEngineReady,
  bootBrowserLocalApp,
  clickTransport,
  installStaticOrigin,
  readProgressScaleX,
  replaceEditorText,
  sampleOutput,
  SEL,
} from "./helpers";

// M2 — transport clicks -> XState -> WASM local clock.
// beforeEach: installStaticOrigin -> bootBrowserLocalApp -> awaitEngineReady
// (sampling `t` saves/restores the clock, so it does not perturb transport —
// M1-GT#4). Two honest observations per journey; one journey per test;
// waitForTimeout is banned; all waiting is web-first assertions / expect.poll.
test.describe("transport clicks -> XState -> WASM clock (transport §1.1-1.2/§1.5/§1.7)", () => {
  test.beforeEach(async ({ context, page }) => {
    await installStaticOrigin(context);
    await bootBrowserLocalApp(page);
    await awaitEngineReady(page);
  });

  // TR-1 — expect-pass.
  // The auto-run-but-`paused` trap (transport §1.1), proven via a real click
  // *transition* (M1 BOOT-1 only snapshots the static boot state). If the machine
  // had been `playing`, `PLAY` would be ignored (§1.2) and the signature would not
  // change; the observed transition is the proof it was `paused`. Spec citations:
  // transport §1.1 (machine boots `paused`; browser-local startup auto-runs the
  // interpreter only), §1.2 (`paused` + `PLAY` -> `playing`), §1.7 (button
  // enabled/disabled reflects state).
  test("cold boot is paused-not-playing despite interpreter auto-run; clicking Play transitions and the engine stays live", async ({
    page,
  }) => {
    // 1. Obs 1a (DOM, paused signature).
    await expect(page.locator(SEL.transportPlay)).toBeEnabled();
    await expect(page.locator(SEL.transportPause)).toBeDisabled();
    await expect(page.locator(SEL.transportStop)).toBeEnabled();

    // 2. Click Play.
    await clickTransport(page, "play");

    // 3. Obs 1b (DOM, playing signature — the transition).
    await expect(page.locator(SEL.transportPlay)).toBeDisabled();
    await expect(page.locator(SEL.transportPause)).toBeEnabled();
    await expect(page.locator(SEL.transportStop)).toBeEnabled();

    // 4. Obs 2 (runtime): the interpreter is live and accepts evals under
    //    `playing` (the `(useq-play)` path did not wedge the engine).
    await replaceEditorText(page, "(a1 0.3)");
    await page.keyboard.press("Control+Enter");
    await expect.poll(() => sampleOutput(page, "a1", 0.5)).toBeCloseTo(0.3, 6);
  });

  // TR-2 — expect-pass.
  // Spec citations: transport §1.5 (wasm mode: `stopped` resets the internal clock
  // to zero; `playing` resumes), §1.2 (`paused`/`playing` + `STOP` -> `stopped`),
  // §1.7 (stopped signature), §1.4 (internal clock is the real performance.now/rAF
  // time in wasm mode).
  test("Stop resets the transport position display to zero", async ({ page }) => {
    // 1. Click Play — machine -> `playing`, local clock resumes.
    await clickTransport(page, "play");

    // 2. Obs 1 (runtime/clock): the bar advances while playing (condition-poll,
    //    no wall-clock assertion; the bar wraps but is > 0 almost always while
    //    advancing — M2-GT#9).
    await expect
      .poll(() => readProgressScaleX(page), { timeout: 10_000 })
      .toBeGreaterThan(0.01);

    // 3. Click Stop.
    await clickTransport(page, "stop");

    // 4. Obs 2a (DOM, stopped signature).
    await expect(page.locator(SEL.transportStop)).toBeDisabled();
    await expect(page.locator(SEL.transportPause)).toBeDisabled();
    await expect(page.locator(SEL.transportPlay)).toBeEnabled();

    // 5. Obs 2b (runtime/clock — the §1.5 reset): `stopped` reset the clock to 0
    //    and froze it there, so the bar converges to and stays at 0 (a fixed
    //    target, not a timing assertion).
    await expect
      .poll(() => readProgressScaleX(page), { timeout: 10_000 })
      .toBeLessThan(0.02);
  });

  // TR-3 — expect-pass.
  // The complementary half of §1.5, and the distinguishing evidence that
  // Pause != Stop. Spec citations: transport §1.5 (`paused` freezes the internal
  // clock; `stopped` resets it), §1.2 (`playing` + `PAUSE` -> `paused`), §1.7
  // (paused signature).
  test("Pause freezes the clock rather than resetting it (contrast with Stop)", async ({
    page,
  }) => {
    // 1. Click Play.
    await clickTransport(page, "play");

    // 2. Advance to a value safely off zero.
    await expect
      .poll(() => readProgressScaleX(page), { timeout: 10_000 })
      .toBeGreaterThan(0.05);

    // 3. Click Pause.
    await clickTransport(page, "pause");

    // 4. Obs 1 (DOM, paused signature).
    await expect(page.locator(SEL.transportPause)).toBeDisabled();
    await expect(page.locator(SEL.transportPlay)).toBeEnabled();
    await expect(page.locator(SEL.transportStop)).toBeEnabled();

    // 5. Obs 2 (runtime/clock — freeze, NOT reset): the bar holds its accumulated
    //    position (frozen), the direct contrast with TR-2's reset-to-0. (The
    //    freeze happens at the click; the pre-pause `> 0.05` guarantee leaves
    //    ample margin — R-TR-2.)
    await expect
      .poll(() => readProgressScaleX(page), { timeout: 5_000 })
      .toBeGreaterThan(0.01);
  });
});
