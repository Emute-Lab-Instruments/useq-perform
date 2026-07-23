import { expect, test } from "@playwright/test";

import {
  assertFreshBuild,
  awaitEngineReady,
  bootBrowserLocalApp,
  clickTransport,
  freezeClock,
  installStaticOrigin,
  isClockFrozen,
  readProgressScaleX,
  replaceEditorText,
  resumeClock,
  sampleOutput,
  stepClock,
} from "./helpers";

// A3 — the deterministic clock seam (A1) proven end-to-end through the real app.
//
// The A1 hook drives ONE injectable time source in
// `src/effects/visualisationRuntime.ts`; every ModuLisp local-time read goes
// through it. This journey proves the seam does what it claims across the full
// freeze → step → resume cycle, against the production rAF tick path.
//
// Spec citations: transport.md §1.4 (the internal clock is the rAF-driven
// `performance.now`; the sole time source in wasm-only mode) and §1.5 (`playing`
// advances that clock). The seam substitutes a controllable source for
// `performance.now` WITHOUT changing which code reads it.
//
// TWO honest observations, at two layers, kept together at every phase:
//   Obs A — the transport progress bar (`readProgressScaleX`): the DOM
//     projection of the local clock (visStore.bar; transport §1.4-1.5). This is
//     the LIVE-clock witness — it holds while frozen, advances on a step, and
//     resumes real-time motion on resume.
//   Obs B — `sampleOutputAtTime("a1", …)` on the time-dependent program
//     `(a1 t)`: the runtime/interpreter witness. Sampling is explicit-time and
//     clock-ISOLATED by design (it save/restores the interpreter clock —
//     transport.spec M1-GT#4; the awaitEngineReady contract), so it returns the
//     exact expected value at EVERY phase, INCLUDING while the live clock is
//     frozen. That is precisely what makes it the guard: it proves the engine
//     is alive and evaluating deterministically under the frozen clock, so a
//     "held" progress bar means "clock pinned", not "rAF/engine dead" — the
//     dead-clock false-pass this whole surface exists to prevent
//     (src/runtime/browserEvalSurface.ts header).
//
// No waitForTimeout anywhere; all waiting is web-first assertions / expect.poll.
test.describe("deterministic clock seam end-to-end (A1; transport §1.4-1.5)", () => {
  // Fail fast on the stale-bundle trap: this journey asserts on the A1 clock
  // hooks, which only exist in a bundle built after they landed. Kept local to
  // this spec (see assertFreshBuild note) so it never reddens unrelated suites.
  test.beforeAll(() => {
    assertFreshBuild();
  });

  test.beforeEach(async ({ context, page }) => {
    await installStaticOrigin(context);
    await bootBrowserLocalApp(page);
    await awaitEngineReady(page);
  });

  test("freeze holds both witnesses, step advances them deterministically, resume returns real-time motion", async ({
    page,
  }) => {
    // 0. Program the interpreter so a1 == t. Now Obs B, sampleOutputAtTime,
    //    reads back exactly its argument once compiled (a1 is idle/NaN until
    //    evaluated — boot-contract BOOT-1 step 8).
    await replaceEditorText(page, "(a1 t)");
    await page.keyboard.press("Control+Enter");
    await expect.poll(() => sampleOutput(page, "a1", 0.5)).toBeCloseTo(0.5, 6);
    expect(await isClockFrozen(page)).toBe(false);

    // 1. Play — wasm-only internal clock starts advancing (transport §1.4/§1.5
    //    `playing`). Obs A leaves zero (condition-poll, no wall-clock assertion;
    //    the bar wraps but is > 0 almost always while advancing — M2-GT#9).
    await clickTransport(page, "play");
    await expect
      .poll(() => readProgressScaleX(page), { timeout: 10_000 })
      .toBeGreaterThan(0.02);

    // 2. Freeze. Settle any sample in flight from just before the freeze with a
    //    zero-length step (pumps frames + drains without advancing time), then
    //    capture the pinned bar value.
    await freezeClock(page);
    expect(await isClockFrozen(page)).toBe(true);
    await stepClock(page, 0);

    // 3. Obs A HOLDS: actively pump 12 real animation frames and prove the bar
    //    never moves. Frozen source → constant local time → no new tick → bar
    //    pinned. This is frame-driven, not timer-driven.
    const held = await page.evaluate(async () => {
      const read = (): number => {
        const el = document.getElementById("toolbar-bar-progress");
        if (!el) return Number.NaN;
        const t = getComputedStyle(el).transform;
        if (!t || t === "none") return 1;
        const m = t.match(/matrix\(([^)]+)\)/);
        return m ? parseFloat(m[1].split(",")[0]) : Number.NaN;
      };
      const raf = (): Promise<void> =>
        new Promise((r) => requestAnimationFrame(() => r()));
      await raf();
      const first = read();
      let maxDelta = 0;
      for (let i = 0; i < 12; i++) {
        await raf();
        maxDelta = Math.max(maxDelta, Math.abs(read() - first));
      }
      return { first, maxDelta };
    });
    expect(held.maxDelta).toBeLessThan(1e-6);

    // 3b. Obs B under the frozen clock: the interpreter is still live and
    //     deterministic (explicit-time sampling is clock-isolated), so a1 == t
    //     holds exactly even though the live clock is pinned. Guards step 3
    //     against a dead-engine false "hold".
    expect(await sampleOutput(page, "a1", 0.25)).toBeCloseTo(0.25, 6);
    expect(await sampleOutput(page, "a1", 0.5)).toBeCloseTo(0.5, 6);

    // 4. Step the frozen clock. Motion here is caused ONLY by the step (time was
    //    provably held in step 3), so an advance is deterministic seam evidence,
    //    not accumulated wall time. stepClock resolves after the tick + drain.
    const beforeStep = held.first;
    await stepClock(page, 150);
    const afterStep = await readProgressScaleX(page);
    // "Changed" rather than strictly-greater so the assertion is robust to a
    // bar wrap (the phase is in [0,1) and a 150 ms step can cross the boundary);
    // combined with the proven hold, any motion is step-caused.
    expect(Math.abs(afterStep - beforeStep)).toBeGreaterThan(1e-3);

    // 4b. A second identical step advances again from a fresh hold — the seam is
    //     repeatable, and time is pinned between steps.
    const held2 = await page.evaluate(async () => {
      const read = (): number => {
        const el = document.getElementById("toolbar-bar-progress");
        if (!el) return Number.NaN;
        const t = getComputedStyle(el).transform;
        if (!t || t === "none") return 1;
        const m = t.match(/matrix\(([^)]+)\)/);
        return m ? parseFloat(m[1].split(",")[0]) : Number.NaN;
      };
      const raf = (): Promise<void> =>
        new Promise((r) => requestAnimationFrame(() => r()));
      await raf();
      const first = read();
      let maxDelta = 0;
      for (let i = 0; i < 12; i++) {
        await raf();
        maxDelta = Math.max(maxDelta, Math.abs(read() - first));
      }
      return { first, maxDelta };
    });
    expect(held2.maxDelta).toBeLessThan(1e-6);
    await stepClock(page, 150);
    const afterStep2 = await readProgressScaleX(page);
    expect(Math.abs(afterStep2 - held2.first)).toBeGreaterThan(1e-3);

    // 5. Resume real time. The seam re-anchors (no jump); with transport still
    //    playing, Obs A advances on its own again — proof the live clock is back
    //    on `performance.now`. expect.poll drives real frames until it moves.
    await resumeClock(page);
    expect(await isClockFrozen(page)).toBe(false);
    const afterResume = await readProgressScaleX(page);
    await expect
      .poll(() => readProgressScaleX(page).then((v) => Math.abs(v - afterResume)), {
        timeout: 10_000,
      })
      .toBeGreaterThan(1e-3);

    // 5b. Obs B after resume: engine still deterministic — the freeze/step/resume
    //     cycle left the interpreter's eval path uncorrupted.
    expect(await sampleOutput(page, "a1", 0.5)).toBeCloseTo(0.5, 6);
  });
});
