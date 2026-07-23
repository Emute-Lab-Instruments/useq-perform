import { expect, test } from "@playwright/test";

import {
  awaitAppReady,
  awaitEngineReady,
  bootApp,
  installStaticOrigin,
  placeCursorInLine,
  readLocalStorage,
  replaceEditorText,
  sampleOutput,
  seedLocalStorage,
  startConsoleCapture,
  SEL,
  STORAGE_KEYS,
  URLS,
} from "./helpers";

test.describe(
  "persistence reload + corrupt-storage fallback (persistence §1.2/§1.4)",
  () => {
    // beforeEach installs the static origin only — each test controls its own
    // boot/seed/reload sequence (they differ materially). ?nosave is NOT
    // re-tested here (covered by M1 BOOT-2/BOOT-3).
    test.beforeEach(async ({ context }) => {
      await installStaticOrigin(context);
    });

    // PERSIST-1 — expect-pass
    // Spec citations: persistence §1.2 (`uSEQ-Perform-User-Code` raw editor
    // content persists and restores), §1.1 (all storage via the service);
    // editor.md §1.5 (autosave default on); bootstrap §1.2 (boot hydrates the
    // editor from persisted code). Relies on M2-GT#10 (reload keeps route
    // interception; no re-seed here).
    test(
      "an edit survives a full page reload (restore)",
      async ({ page }) => {
        // 1. Real cold-start path (writes ALLOWED — no ?nosave).
        await bootApp(page, URLS.coldBoot);

        // 2. Engine live.
        await awaitEngineReady(page);

        // 3. Edit — autosave writes it either per keystroke (updateListener,
        //    extensions.ts) or on the ≤5s timer (editorStore.ts); the 7s poll
        //    below absorbs both paths.
        await replaceEditorText(page, "(a1 0.42)");

        // 4. Confirm the write landed (guards against a vacuous restore).
        await expect
          .poll(() => readLocalStorage(page, STORAGE_KEYS.userCode), {
            timeout: 7_000,
          })
          .toContain("(a1 0.42)");

        // 5. Full reload — same context, no re-goto, route interception intact
        //    (M2-GT#10 Consequence A).
        await page.reload();
        await awaitAppReady(page);

        // Obs 1 (DOM, restore): the persisted code hydrated the editor after
        // reload (§1.2). Not auto-evaluated on load (expression-gutter §2.7,
        // M1-GT#9), so the runtime check below requires an explicit eval.
        await expect(page.locator(SEL.editor)).toContainText("(a1 0.42)");

        // Obs 2 (runtime): the restored text is a live, evaluable program.
        await awaitEngineReady(page);
        await placeCursorInLine(page, "(a1");
        await page.keyboard.press("Control+Enter");
        await expect
          .poll(() => sampleOutput(page, "a1", 0.5))
          .toBeCloseTo(0.42, 6);
      },
    );

    // PERSIST-2 — expect-pass
    // Spec citations: persistence §1.4 (a corrupt persisted value is logged as a
    // warning and replaced by the schema default; the user keeps a working app
    // and loses only that one piece of state), §1.1 (central service), §1.2
    // (both keys). Verified path: persistence.ts:114-123 (`load` catch →
    // console.warn("[persistence] Failed to parse key …") → return fallback).
    test(
      "corrupt persisted settings are logged and defaulted without harming valid code or the engine",
      async ({ context, page }) => {
        // 1. Attach console capture BEFORE navigation.
        const logs = startConsoleCapture(page);

        // 2. Seed a corrupt settings value AND a valid neighbour in the SAME
        //    seedLocalStorage batch (single shared init script → both keys
        //    present on load).
        await seedLocalStorage(context, {
          [STORAGE_KEYS.userSettings]: "{ not valid json",
          [STORAGE_KEYS.userCode]: "(a1 0.6)",
        });

        // 3. Boot — the corrupt settings hit load's catch path at boot.
        await bootApp(page, URLS.coldBoot);

        // 4. The app did not crash (§1.4 "keeps a working app").
        await awaitEngineReady(page);

        // Obs 1 (DOM — the valid neighbour survived; only the corrupt key was
        // defaulted): the corrupt settings did not cascade into the valid code
        // key (§1.4 "loses only that one piece of state"); and the runtime is live.
        await expect(page.locator(SEL.editor)).toContainText("(a1 0.6)");
        await placeCursorInLine(page, "(a1");
        await page.keyboard.press("Control+Enter");
        await expect
          .poll(() => sampleOutput(page, "a1", 0.5))
          .toBeCloseTo(0.6, 6);

        // Obs 2 (console — the §1.4 warning): evaluated after Obs 1 so boot-time
        // logs have flushed.
        expect(
          logs.some((l) => /\[persistence\] Failed to parse key/.test(l)),
        ).toBe(true);
      },
    );
  },
);
