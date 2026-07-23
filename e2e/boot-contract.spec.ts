import { expect, test } from "@playwright/test";

import {
  bootApp,
  installStaticOrigin,
  readLocalStorage,
  sampleOutput,
  seedLocalStorage,
  awaitEngineReady,
  SEL,
  STORAGE_KEYS,
  URLS,
} from "./helpers";

test.describe(
  "boot contract (bootstrap §1.1–1.5, runtime-modes §1.6/§1.8, transport §1.1)",
  () => {
    test.beforeEach(async ({ context }) => {
      await installStaticOrigin(context);
    });

    // BOOT-1 — expect-pass
    // Spec citations: bootstrap.md §1.1 (deterministic order — asserted as its
    // observable consequences), §1.2 (interactive editor regardless of WASM
    // readiness), §1.4 (Web Serial unavailable → console alert, app stays
    // usable), §1.5 (eager WASM preload → engine live without any eval);
    // runtime-modes.md §1.3 (default cold mode is `wasm`), §1.6 (indicator
    // distinguishes WASM from hardware), §1.8 (`startLocallyWithoutHardware`
    // default true → boots into wasm without waiting); transport.md §1.1
    // (machine boots `paused`; auto-run nudges only the interpreter);
    // expression-gutter.md §2.7/§3.5 (no active rail, no vis toggle on first load).
    test(
      "cold start reaches an interactive editor in wasm mode with transport paused",
      async ({ page }) => {
        // 1. Fresh context → truly cold storage; this variant WRITES persistence
        //    (the real user path).
        await bootApp(page, URLS.coldBoot);

        // Observations (DOM layer)
        // 2. default starter sketch present (bootstrap §1.2; editorDefaults.ts)
        await expect(page.locator(SEL.editor)).toContainText("(a1 (slow 2 bar))");

        // 3. Interactivity
        await page.locator(SEL.editor).click();
        await page.keyboard.press("Control+End");
        await page.keyboard.type(";; ping");
        await expect(
          page.locator(SEL.editorLine).filter({ hasText: ";; ping" }),
        ).toBeVisible();

        // 4. Mode indicator (runtime-modes §1.6 — exact-text `W` also proves it
        //    is not `HW`/`HW+W`)
        await expect(page.locator(SEL.connectButton)).toBeVisible();
        await expect(page.locator(SEL.connectBadge)).toHaveText("W");
        await expect(page.locator(SEL.connectBadge)).toHaveClass(/transport-wasm/);

        // 5. Transport paused signature (transport §1.1 trap — assert the machine
        //    value, not playback). Do NOT assert the interpreter is actually
        //    running — deferred-to-A2 (§7 D1).
        await expect(page.locator(SEL.transportPlay)).toBeEnabled();
        await expect(page.locator(SEL.transportPause)).toBeDisabled();
        await expect(page.locator(SEL.transportStop)).toBeEnabled();

        // 6. Console (bootstrap §1.4 quoted message; typewriter-safe via auto-retry)
        await expect(
          page
            .locator(SEL.consoleEntry)
            .filter({ hasText: "Browser-local uSEQ is ready" }),
        ).toBeVisible();

        // Observations (runtime layer)
        // 7. engine compiled+evaluating with zero user evals (bootstrap §1.5)
        await awaitEngineReady(page);

        // 8. a1 idle — the restored sketch was NOT auto-evaluated
        //    (expression-gutter §2.7; useq_eval_output returns NaN for
        //    never-assigned outputs). One-shot after step 7.
        expect(Number.isNaN(await sampleOutput(page, "a1", 0.25))).toBe(true);

        // 9. no vis toggle on first load (expression-gutter §3.5)
        await expect(page.locator(SEL.playBtnOn)).toHaveCount(0);
      },
    );

    // BOOT-2 — expect-pass
    // Spec citations: persistence.md §1.7 (session-scoped write gate; reads still
    // served), §1.2 (`uSEQ-Perform-User-Code` key); bootstrap.md §1.1 (config
    // loader reads `?nosave` before hydrating).
    test(
      "?nosave boots from persisted state and never writes back",
      async ({ context, page }) => {
        // 1–2. seed then boot under ?nosave
        await seedLocalStorage(context, {
          [STORAGE_KEYS.userCode]: "(a1 0.125)",
        });
        await bootApp(page, URLS.coldBootNosave);

        // 3. DOM: reads are honoured under ?nosave (§1.7)
        await expect(page.locator(SEL.editor)).toContainText("(a1 0.125)");

        // 4. Storage (boot-time writes gated): under ?nosave the settings key
        //    must never be created. One-shot.
        expect(
          await readLocalStorage(page, STORAGE_KEYS.userSettings),
        ).toBeNull();

        // 5. Mutate (the synchronous updateListener write attempt now happens —
        //    ground truth #10)
        await page.locator(SEL.editor).click();
        await page.keyboard.press("Control+End");
        await page.keyboard.type(" ;; scratch");
        await expect(page.locator(SEL.editor)).toContainText(";; scratch");

        // 6. Storage (edit writes gated): userCode unchanged from seed. One-shot.
        expect(await readLocalStorage(page, STORAGE_KEYS.userCode)).toBe(
          "(a1 0.125)",
        );
      },
    );

    // BOOT-3 — expect-pass
    // Purpose: proves the observation channel used by BOOT-2 actually detects
    // writes — guards BOOT-2 against a vacuous pass. Spec citations:
    // persistence.md §1.1 (all storage via the service), editor.md §1.5
    // (autosave defaults on).
    test(
      "without ?nosave, edits persist to localStorage (nosave control)",
      async ({ context, page }) => {
        // 1–2. seed then boot WITHOUT nosave
        await seedLocalStorage(context, {
          [STORAGE_KEYS.userCode]: "(a1 0.125)",
        });
        await bootApp(page, URLS.coldBoot);

        // 3. DOM: seeded read honoured
        await expect(page.locator(SEL.editor)).toContainText("(a1 0.125)");

        // 4. Mutate
        await page.locator(SEL.editor).click();
        await page.keyboard.press("Control+End");
        await page.keyboard.type(" ;; scratch");
        await expect(page.locator(SEL.editor)).toContainText(";; scratch");

        // 5. synchronous updateListener path normally satisfies this immediately;
        //    the 7 s budget also covers the editor.md §1.5 timer path (5 s
        //    default interval) without a fixed sleep.
        await expect
          .poll(() => readLocalStorage(page, STORAGE_KEYS.userCode), {
            timeout: 7_000,
          })
          .toContain(";; scratch");
      },
    );
  },
);
