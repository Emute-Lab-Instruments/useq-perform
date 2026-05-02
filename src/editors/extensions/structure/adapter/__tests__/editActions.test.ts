/**
 * Edit action wiring tests.
 *
 * Verifies that each edit.* action in the keybinding registry correctly
 * dispatches through the structural-editing adapter and produces the expected
 * tree mutations. These are integration tests: real CodeMirror state, real
 * Lezer parse, real core ops.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
// @ts-expect-error — clojure-mode has no type declarations
import { default_extensions } from "@nextjournal/clojure-mode";

import { structuralCoreExtensions } from "../extension.ts";
import { dispatchAction } from "../dispatcher.ts";
import { structField } from "../stateField.ts";

function createView(doc: string): EditorView {
  const ext = structuralCoreExtensions();
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [...default_extensions, ...ext],
    }),
  });
}

/** Navigate to the first top-level form (nav.down from document root). */
function navToFirstForm(view: EditorView): void {
  dispatchAction(view, "nav.down");
}

/** Navigate into a compound (nav.down twice from doc root). */
function navIntoFirstForm(view: EditorView): void {
  dispatchAction(view, "nav.down");
  dispatchAction(view, "nav.down");
}

describe("edit.* actions wired through functional core", () => {
  // ─── Slurp ───────────────────────────────────────���────────────────────────

  describe("slurp", () => {
    it("edit.slurpForward pulls next sibling into the focused compound", () => {
      const view = createView("(a) b");
      navToFirstForm(view); // cursor on (a)
      const ok = dispatchAction(view, "edit.slurpForward");
      expect(ok).toBe(true);
      expect(view.state.doc.toString()).toContain("(a b)");
      view.destroy();
    });

    it("edit.slurpBackward pulls previous sibling into the focused compound", () => {
      const view = createView("a (b)");
      navToFirstForm(view); // cursor on "a"
      dispatchAction(view, "nav.next"); // cursor on (b)
      const ok = dispatchAction(view, "edit.slurpBackward");
      expect(ok).toBe(true);
      expect(view.state.doc.toString()).toContain("(a b)");
      view.destroy();
    });
  });

  // ─── Barf ───────────���─────────────────────────────────────��───────────────

  describe("barf", () => {
    it("edit.barfForward ejects the last child of focused compound", () => {
      const view = createView("(a b)");
      navToFirstForm(view); // cursor on (a b)
      const ok = dispatchAction(view, "edit.barfForward");
      expect(ok).toBe(true);
      const text = view.state.doc.toString();
      expect(text).toContain("(a)");
      expect(text).toContain("b");
      view.destroy();
    });

    it("edit.barfBackward ejects the first child of focused compound", () => {
      const view = createView("(a b)");
      navToFirstForm(view); // cursor on (a b)
      const ok = dispatchAction(view, "edit.barfBackward");
      expect(ok).toBe(true);
      const text = view.state.doc.toString();
      expect(text).toContain("a");
      expect(text).toContain("(b)");
      view.destroy();
    });
  });

  // ─── Raise ───────────────────────────────────────────────────��────────────

  describe("raise", () => {
    it("edit.raise replaces the parent with the focused node", () => {
      const view = createView("(a (b c))");
      navToFirstForm(view); // cursor on (a (b c))
      dispatchAction(view, "nav.down"); // cursor on "a"
      dispatchAction(view, "nav.next"); // cursor on (b c)
      dispatchAction(view, "nav.down"); // cursor on "b"
      const ok = dispatchAction(view, "edit.raise");
      expect(ok).toBe(true);
      // (b c) replaced by b, so document becomes (a b)
      expect(view.state.doc.toString()).toContain("(a b)");
      view.destroy();
    });
  });

  // ─── Splice ───────────────────────────────────────────────────────────────

  describe("splice", () => {
    it("edit.splice dissolves the focused compound, keeping children", () => {
      const view = createView("(a (b c))");
      navToFirstForm(view); // cursor on (a (b c))
      dispatchAction(view, "nav.down"); // cursor on "a"
      dispatchAction(view, "nav.next"); // cursor on (b c)
      const ok = dispatchAction(view, "edit.splice");
      expect(ok).toBe(true);
      // (b c) is dissolved into parent: (a b c)
      expect(view.state.doc.toString()).toContain("(a b c)");
      view.destroy();
    });
  });

  // ─── Wrap (enclose) ────────────────���────────────────────────────────��─────

  describe("wrap / enclose", () => {
    it("edit.encloseList wraps the focused node in parentheses", () => {
      const view = createView("(a b c)");
      navIntoFirstForm(view); // cursor on "a"
      dispatchAction(view, "nav.next"); // cursor on "b"
      const ok = dispatchAction(view, "edit.encloseList");
      expect(ok).toBe(true);
      expect(view.state.doc.toString()).toContain("(a (b) c)");
      view.destroy();
    });

    it("edit.encloseVector wraps the focused node in square brackets", () => {
      const view = createView("(a b c)");
      navIntoFirstForm(view); // cursor on "a"
      dispatchAction(view, "nav.next"); // cursor on "b"
      const ok = dispatchAction(view, "edit.encloseVector");
      expect(ok).toBe(true);
      expect(view.state.doc.toString()).toContain("(a [b] c)");
      view.destroy();
    });
  });

  // ─── Transpose ─────────────────────────────────────────────���──────────────

  describe("transpose", () => {
    it("edit.transposeNext swaps the focused node with the next sibling", () => {
      const view = createView("(a b c)");
      navIntoFirstForm(view); // cursor on "a"
      const ok = dispatchAction(view, "edit.transposeNext");
      expect(ok).toBe(true);
      expect(view.state.doc.toString()).toContain("(b a c)");
      view.destroy();
    });

    it("edit.transposePrev swaps the focused node with the previous sibling", () => {
      const view = createView("(a b c)");
      navIntoFirstForm(view); // cursor on "a"
      dispatchAction(view, "nav.next"); // cursor on "b"
      const ok = dispatchAction(view, "edit.transposePrev");
      expect(ok).toBe(true);
      expect(view.state.doc.toString()).toContain("(b a c)");
      view.destroy();
    });
  });

  // ─── No-op cases ────────────────────────────────────────────��─────────────

  describe("no-op rejection", () => {
    it("slurp at document root is a no-op", () => {
      const view = createView("(a) b");
      // Don't navigate — cursor stays on document root
      const ok = dispatchAction(view, "edit.slurpForward");
      // The op should be rejected (no-op), but applyOp returns true only
      // if the editor was mutated. Since cursor stays at root, no change.
      expect(ok).toBe(false);
      expect(view.state.doc.toString()).toBe("(a) b");
      view.destroy();
    });

    it("barf on a compound with fewer than 2 children is a no-op", () => {
      const view = createView("(a)");
      navToFirstForm(view); // cursor on (a)
      const ok = dispatchAction(view, "edit.barfForward");
      expect(ok).toBe(false);
      expect(view.state.doc.toString()).toBe("(a)");
      view.destroy();
    });

    it("raise at top-level form is a no-op (parent is document root)", () => {
      const view = createView("(a b)");
      navToFirstForm(view); // cursor on (a b) — parent is document root
      const ok = dispatchAction(view, "edit.raise");
      // The raise rejects because the parent is the document root.
      expect(ok).toBe(false);
      view.destroy();
    });
  });
});
