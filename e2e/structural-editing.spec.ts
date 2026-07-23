import { expect, test } from "@playwright/test";

import {
  awaitEngineReady,
  bootBrowserLocalApp,
  expectStructuralHalo,
  installStaticOrigin,
  placeCaretLeftFromDocEnd,
  placeCursorInLine,
  replaceEditorText,
  sampleOutput,
  SEL,
} from "./helpers";

test.describe(
  "structural editing from real keys (structural-editing §3.6.1/§5.1-5.2, keybindings defaults)",
  () => {
    test.beforeEach(async ({ context, page }) => {
      await installStaticOrigin(context);
      await bootBrowserLocalApp(page);
      await awaitEngineReady(page);
    });

    // SE-1 — expect-pass
    // Isolates the cursorFromSelection ViewPlugin (M2-GT#3) and the §3.6
    // reset-to-root rule. Pure-navigation journey: by spec §5.1 navigation leaves
    // the tree unchanged, so there is no runtime effect to cross-check — the two
    // honest observations are two structural-cursor DOM states. Spec citations:
    // structural-editing §3.6 (cursor relocates to document root when its target no
    // longer exists / document empty), §3.6.1 (halo clears when the caret leaves all
    // nodes), §1.3 (focus-primary; the text caret is a separate concept), §2.8
    // (cursor = stable node handle).
    test(
      "caret motion snaps the structural halo onto a node; emptying the doc clears it",
      async ({ page }) => {
        // 1. known single-form program
        await replaceEditorText(page, "(a1 0.25)");

        // 2. `(a1 0.25)` indices `(0 a1 12 _3 04 .5 26 57 )8`; end = 9;
        //    9−3 = 6 → caret inside the number `0.25` (positions [4,8]).
        await placeCaretLeftFromDocEnd(page, 3);

        // 3. Obs 1 (DOM): a node is focused; the snap engaged.
        await expectStructuralHalo(page, true);

        // 4. Empty the document.
        await page.locator(SEL.editor).click();
        await page.keyboard.press("Control+A");
        await page.keyboard.press("Backspace");
        await expect(page.locator(SEL.editor)).toHaveText("");

        // 5. Obs 2 (DOM): empty document ⇒ cursor relocated to the document root ⇒
        //    no polygon ⇒ halo cleared (§3.6/§3.6.1).
        await expectStructuralHalo(page, false);
      },
    );

    // SE-2 — expect-pass
    // Spec citations: structural-editing §5.2.5 (raise: `N` replaces its parent;
    // cursor moves to `N`), §2.6 (affected form reformatted — stays one line here),
    // keybindings default `edit.raise` = `Alt-r` (defaults.ts:85); MAIN §2.1 (the
    // new program runs).
    test(
      "raise replaces a parent form with the focused leaf (Alt-r), and the result evaluates",
      async ({ page }) => {
        // 1. `zz` is an unknown head, so the inner form errors before the raise;
        //    after raise `(a1 0.5)` is a clean assignment.
        await replaceEditorText(page, "(a1 (zz 0.5))");

        // 2. `(a1 (zz 0.5))` end = 13; number `0.5` at positions [8,11];
        //    13−3 = 10 → interior of `0.5`.
        await placeCaretLeftFromDocEnd(page, 3);

        // 3. the number leaf is focused.
        await expectStructuralHalo(page, true);

        // 4. real default mutation keybinding (fallback Alt-e chord — R-STRUCT-2).
        await page.keyboard.press("Alt+r");

        // 5. DOM: `0.5` raised out, parent `(zz 0.5)` gone.
        await expect(page.locator(SEL.editor)).toContainText("(a1 0.5)");
        await expect(page.locator(SEL.editor)).not.toContainText("zz");

        // 6. Runtime.
        await placeCursorInLine(page, "(a1");
        await page.keyboard.press("Control+Enter");
        await expect
          .poll(() => sampleOutput(page, "a1", 0.5))
          .toBeCloseTo(0.5, 6);
      },
    );

    // SE-3 — expect-pass
    // Spec citations: structural-editing §5.2.1 (slurp forward: `L`'s next sibling
    // becomes `L`'s last child; cursor stays on `L`), §3.6.1 (inclusive-range
    // tie-break: a caret in the gap after a list belongs to that left form),
    // keybindings default `edit.slurpFwd` = `Ctrl-]` (defaults.ts:60).
    test(
      "slurp-forward pulls the next sibling into the list (Ctrl-]), and the result evaluates",
      async ({ page }) => {
        // 1. two top-level forms: the list `(a1)` and the number `0.75`.
        await replaceEditorText(page, "(a1) 0.75");

        // 2. `(a1) 0.75` indices `(0 a1 12 )3 _4 05 .6 77 58`; end = 9;
        //    9−5 = 4 → `pos === to` of `(a1)` (range [0,4]); the space (index 4) is
        //    not a node, so the snap targets the list `(a1)` (M2-GT#7).
        await placeCaretLeftFromDocEnd(page, 5);

        // 3. the list is focused (not the `a1` symbol, whose range [1,3] excludes
        //    pos 4).
        await expectStructuralHalo(page, true);

        // 4.
        await page.keyboard.press("Control+]");

        // 5. DOM: the `0.75` is now inside the list ("(a1 0.75)" is not a substring
        //    of the pre-state "(a1) 0.75", so this alone proves the slurp).
        await expect(page.locator(SEL.editor)).toContainText("(a1 0.75)");

        // 6. Runtime.
        await placeCursorInLine(page, "(a1");
        await page.keyboard.press("Control+Enter");
        await expect
          .poll(() => sampleOutput(page, "a1", 0.5))
          .toBeCloseTo(0.75, 6);
      },
    );

    // SE-4 — expect-pass
    // Spec citations: structural-editing §5.2.3 (barf forward: `L`'s last child
    // becomes `L`'s next sibling; cursor stays on `L`), keybindings default
    // `edit.barfFwd` = `Ctrl-Shift-]` (defaults.ts:62).
    test(
      "barf-forward ejects the last child as a sibling (Ctrl-Shift-]), and the shrunk form evaluates",
      async ({ page }) => {
        // 1.
        await replaceEditorText(page, "(a1 0.2 0.9)");

        // 2. end = 12 = `pos === to` of the list `(a1 0.2 0.9)` (range [0,12]) ⇒ the
        //    list is focused. (Click + Control+End alone; no ArrowLeft.)
        await placeCaretLeftFromDocEnd(page, 0);

        // 3.
        await expectStructuralHalo(page, true);

        // 4.
        await page.keyboard.press("Control+Shift+]");

        // 5. DOM (layout-robust token pair): the closing paren moved to after `0.2`
        //    (barf happened); and the ejected sibling `0.9` survives. Both hold
        //    regardless of whether the two resulting top-level forms land on one
        //    line or two (R-STRUCT-4).
        await expect(page.locator(SEL.editor)).toContainText("(a1 0.2)");
        await expect(page.locator(SEL.editor)).toContainText("0.9");

        // 6. Runtime.
        await placeCursorInLine(page, "(a1 0.2");
        await page.keyboard.press("Control+Enter");
        await expect
          .poll(() => sampleOutput(page, "a1", 0.5))
          .toBeCloseTo(0.2, 6);
      },
    );

    // SE-5 — expect-pass
    // Spec citations: structural-editing §5.2.6 (splice: `L`'s children become
    // siblings of `L`; `L` removed; splicing a top-level `do` into the document root
    // is allowed; cursor moves to the first spliced child), keybindings default
    // `edit.splice` = `Alt-Shift-s` (defaults.ts:86).
    test(
      "splice lifts a wrapping form's children into the parent (Alt-Shift-s), and the child evaluates",
      async ({ page }) => {
        // 1.
        await replaceEditorText(page, "(do (a1 0.4))");

        // 2. end = 13 = `pos === to` of the outer `(do …)` list (range [0,13]); the
        //    inner `(a1 0.4)` range [4,12] excludes pos 13 ⇒ the outer list is
        //    focused.
        await placeCaretLeftFromDocEnd(page, 0);

        // 3.
        await expectStructuralHalo(page, true);

        // 4. Alt-e chord fallback (bare Alt+Shift+s is swallowed by headless
        //    Chromium — R-STRUCT-2; defaults.ts:100 binds `Alt-e s` for splice).
        await page.keyboard.press("Alt+e");
        await page.keyboard.press("s");

        // 5. DOM: the `(do …)` wrapper spliced away, its children lifted to top
        //    level. Per §5.2.6 splice removes only the wrapper L, lifting ALL its
        //    children — including the head symbol `do` — as siblings, so post-state
        //    is `do (a1 0.4)`. The wrapper open-paren `(do` is gone (proves splice
        //    fired), while the lifted `(a1 0.4)` child survives.
        //    [DEVIATION vs design SE-5 step 5: design asserted `not "do"`, which is
        //    spec-wrong — the `do` symbol is a lifted child, not consumed.]
        await expect(page.locator(SEL.editor)).toContainText("(a1 0.4)");
        await expect(page.locator(SEL.editor)).not.toContainText("(do");

        // 6. Runtime: the value 0.4 is invariant across the splice — the DOM
        //    structure change in step 5 is the load-bearing evidence that the
        //    mutation fired; the runtime check confirms the spliced child is a live,
        //    evaluable program.
        //    [DEVIATION vs design SE-5 step 6: design used placeCursorInLine("(a1"),
        //    which (Home+ArrowRight×2 = offset 2) lands inside the leading `do`
        //    sibling on the spec-correct post-state `do (a1 0.4)`, evaluating `do`
        //    and leaving a1 unassigned (NaN). placeCaretLeftFromDocEnd(1) lands the
        //    caret inside the `(a1 0.4)` child so Control+Enter evaluates it. The
        //    design's assertion (sample a1 ≈ 0.4) is unchanged.]
        await placeCaretLeftFromDocEnd(page, 1);
        await page.keyboard.press("Control+Enter");
        await expect
          .poll(() => sampleOutput(page, "a1", 0.5))
          .toBeCloseTo(0.4, 6);
      },
    );
  },
);
