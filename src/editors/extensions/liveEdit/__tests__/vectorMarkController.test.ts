/**
 * Tests for the vector-mark sub-mode controller (§3.7).
 *
 * Tests use a real CodeMirror EditorView with the structural state field
 * and vector-marking decorations. The controller is exercised via its
 * public API (enter/next/prev/toggle/commit/cancel).
 */

import { describe, expect, it, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
// @ts-expect-error — clojure-mode has no type declarations
import { default_extensions } from "@nextjournal/clojure-mode";

import { structuralCoreExtensions } from "../../structure/adapter/extension.ts";
import { dispatchAction } from "../../structure/adapter/dispatcher.ts";
import { structField } from "../../structure/adapter/stateField.ts";
import {
  createVectorMarkController,
  type VectorMarkController,
} from "../vectorMarkController.ts";
import { vectorMarkSessionField } from "../vectorMarking.ts";

// ── Helpers ──────────────────────────────────────────────────────────────

function createView(doc: string): EditorView {
  const structExt = structuralCoreExtensions();
  // Only include the StateField (not the full extension with its ViewPlugin
  // that uses block decorations — those aren't supported in jsdom).
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [...default_extensions, ...structExt, vectorMarkSessionField],
    }),
  });
}

function navigateTo(view: EditorView, ...actions: string[]): EditorView {
  for (const action of actions) {
    dispatchAction(view, `nav.${action}`);
  }
  return view;
}

function currentNodeText(view: EditorView): string {
  const sv = view.state.field(structField);
  const cursor = sv.state.cursors.primary;
  if (cursor.kind !== "node") return "<range-cursor>";
  const range = sv.idIndex.get(cursor.target);
  if (!range) return "<no-range>";
  return view.state.doc.sliceString(range.from, range.to);
}

function getSession(view: EditorView) {
  return view.state.field(vectorMarkSessionField, false);
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("vectorMarkController — enter", () => {
  it("enters sub-mode on a vector with all elements selected by default", () => {
    const view = createView("(a [1 2 3])");
    const ctrl = createVectorMarkController();

    // Navigate to the vector: doc → list → in → sym "a" → next → vector [1 2 3]
    navigateTo(view, "in", "in", "next");
    expect(currentNodeText(view)).toBe("[1 2 3]");

    const ok = ctrl.enter(view);
    expect(ok).toBe(true);
    expect(ctrl.active).toBe(true);

    const session = getSession(view);
    expect(session).not.toBeNull();
    expect(session!.elements).toHaveLength(3);
    expect(session!.elements[0].state).toBe("selected");
    expect(session!.elements[1].state).toBe("selected");
    expect(session!.elements[2].state).toBe("selected");
    expect(session!.focusIndex).toBe(0);

    view.destroy();
  });

  it("enters with defaultMarkState: 'none' → all deselected", () => {
    const view = createView("(a [1 2 3])");
    const ctrl = createVectorMarkController({ defaultMarkState: "none" });

    navigateTo(view, "in", "in", "next");
    const ok = ctrl.enter(view);
    expect(ok).toBe(true);

    const session = getSession(view);
    expect(session!.elements[0].state).toBe("deselected");
    expect(session!.elements[1].state).toBe("deselected");
    expect(session!.elements[2].state).toBe("deselected");

    view.destroy();
  });

  it("marks non-literal elements as non-markable", () => {
    const view = createView("(a [1 foo 3])");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    expect(currentNodeText(view)).toBe("[1 foo 3]");

    ctrl.enter(view);
    const session = getSession(view);
    expect(session!.elements).toHaveLength(3);
    expect(session!.elements[0].state).toBe("selected"); // 1 is a number
    expect(session!.elements[1].state).toBe("non-markable"); // foo is a symbol
    expect(session!.elements[2].state).toBe("selected"); // 3 is a number

    view.destroy();
  });

  it("returns false on an empty vector (§3.7.4)", () => {
    const view = createView("(a [])");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    expect(currentNodeText(view)).toBe("[]");

    const ok = ctrl.enter(view);
    expect(ok).toBe(false);
    expect(ctrl.active).toBe(false);

    view.destroy();
  });

  it("returns false on a vector with no markable elements", () => {
    const view = createView("(a [foo bar])");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");

    const ok = ctrl.enter(view);
    expect(ok).toBe(false);
    expect(ctrl.active).toBe(false);

    view.destroy();
  });

  it("returns false when cursor is on a non-vector (list)", () => {
    const view = createView("(a (b 1))");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next"); // on list (b 1)

    const ok = ctrl.enter(view);
    expect(ok).toBe(false);

    view.destroy();
  });

  it("returns false when cursor is on a leaf", () => {
    const view = createView("(a 42)");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next"); // on number 42

    const ok = ctrl.enter(view);
    expect(ok).toBe(false);

    view.destroy();
  });

  it("focuses the first markable element (skipping non-markable prefix)", () => {
    const view = createView("(a [foo 2 3])");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);

    const session = getSession(view);
    expect(session!.focusIndex).toBe(1); // skipped foo at index 0

    view.destroy();
  });
});

describe("vectorMarkController — navigation", () => {
  it("next() moves to the next markable element", () => {
    const view = createView("(a [1 2 3])");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);
    expect(getSession(view)!.focusIndex).toBe(0);

    ctrl.next(view);
    expect(getSession(view)!.focusIndex).toBe(1);

    ctrl.next(view);
    expect(getSession(view)!.focusIndex).toBe(2);

    view.destroy();
  });

  it("next() wraps around from the last to the first", () => {
    const view = createView("(a [1 2 3])");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);

    ctrl.next(view); // → 1
    ctrl.next(view); // → 2
    ctrl.next(view); // wraps → 0

    expect(getSession(view)!.focusIndex).toBe(0);

    view.destroy();
  });

  it("prev() moves to the previous markable element", () => {
    const view = createView("(a [1 2 3])");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);

    ctrl.next(view); // → 1
    ctrl.next(view); // → 2

    ctrl.prev(view);
    expect(getSession(view)!.focusIndex).toBe(1);

    view.destroy();
  });

  it("prev() wraps around from the first to the last", () => {
    const view = createView("(a [1 2 3])");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);

    ctrl.prev(view); // wraps → 2
    expect(getSession(view)!.focusIndex).toBe(2);

    view.destroy();
  });

  it("next()/prev() skip non-markable elements", () => {
    const view = createView("(a [1 foo 3])");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);
    expect(getSession(view)!.focusIndex).toBe(0); // 1

    ctrl.next(view); // skips foo, lands on 3
    expect(getSession(view)!.focusIndex).toBe(2);

    ctrl.prev(view); // skips foo, lands on 1
    expect(getSession(view)!.focusIndex).toBe(0);

    view.destroy();
  });
});

describe("vectorMarkController — toggle", () => {
  it("toggles a selected element to deselected", () => {
    const view = createView("(a [1 2 3])");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);
    expect(getSession(view)!.elements[0].state).toBe("selected");

    ctrl.toggle(view);
    expect(getSession(view)!.elements[0].state).toBe("deselected");

    view.destroy();
  });

  it("toggles a deselected element back to selected", () => {
    const view = createView("(a [1 2 3])");
    const ctrl = createVectorMarkController({ defaultMarkState: "none" });

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);
    expect(getSession(view)!.elements[0].state).toBe("deselected");

    ctrl.toggle(view);
    expect(getSession(view)!.elements[0].state).toBe("selected");

    view.destroy();
  });

  it("double-toggle returns to original state", () => {
    const view = createView("(a [1 2 3])");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);

    ctrl.toggle(view); // selected → deselected
    ctrl.toggle(view); // deselected → selected
    expect(getSession(view)!.elements[0].state).toBe("selected");

    view.destroy();
  });

  it("toggle does not affect non-focused elements", () => {
    const view = createView("(a [1 2 3])");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);

    // Focus is on 0, toggle only affects 0
    ctrl.toggle(view);
    expect(getSession(view)!.elements[0].state).toBe("deselected");
    expect(getSession(view)!.elements[1].state).toBe("selected");
    expect(getSession(view)!.elements[2].state).toBe("selected");

    view.destroy();
  });
});

describe("vectorMarkController — commit", () => {
  it("wraps all selected elements with (live-edit ...)", () => {
    const view = createView("(a [1 2 3])");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);
    ctrl.commit(view);

    const text = view.state.doc.toString();
    // Each number should be wrapped
    const wrapperPattern = /\(live-edit \d+ :id "[a-z2-9]{4}"/g;
    const matches = text.match(wrapperPattern);
    expect(matches).toHaveLength(3);

    // Sub-mode should be exited
    expect(ctrl.active).toBe(false);
    expect(getSession(view)).toBeNull();

    view.destroy();
  });

  it("only wraps selected elements (deselected ones left untouched)", () => {
    const view = createView("(a [1 2 3])");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);

    // Deselect the middle element
    ctrl.next(view); // focus on 2
    ctrl.toggle(view); // deselect 2

    ctrl.commit(view);

    const text = view.state.doc.toString();
    // 1 and 3 wrapped, 2 not
    expect(text).toMatch(/\(live-edit 1 :id/);
    expect(text).not.toMatch(/\(live-edit 2 :id/);
    expect(text).toMatch(/\(live-edit 3 :id/);
    // The bare "2" should still be present
    expect(text).toContain(" 2 ");

    view.destroy();
  });

  it("does not modify document if no elements are selected", () => {
    const view = createView("(a [1 2 3])");
    const ctrl = createVectorMarkController({ defaultMarkState: "none" });

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);
    ctrl.commit(view);

    expect(view.state.doc.toString()).toBe("(a [1 2 3])");
    expect(ctrl.active).toBe(false);

    view.destroy();
  });

  it("each wrapped element gets a unique :id", () => {
    const view = createView("(a [1 2 3])");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);
    ctrl.commit(view);

    const text = view.state.doc.toString();
    const ids = [...text.matchAll(/:id "([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(3);
    // All IDs should be distinct
    expect(new Set(ids).size).toBe(3);

    view.destroy();
  });

  it("exits the sub-mode after commit", () => {
    const view = createView("(a [1 2])");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);
    ctrl.commit(view);

    expect(ctrl.active).toBe(false);
    expect(getSession(view)).toBeNull();

    view.destroy();
  });
});

describe("vectorMarkController — cancel", () => {
  it("leaves the document unchanged", () => {
    const view = createView("(a [1 2 3])");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);

    // Toggle some elements to make sure cancel doesn't apply changes
    ctrl.toggle(view);
    ctrl.next(view);
    ctrl.toggle(view);

    ctrl.cancel(view);

    expect(view.state.doc.toString()).toBe("(a [1 2 3])");
    expect(ctrl.active).toBe(false);
    expect(getSession(view)).toBeNull();

    view.destroy();
  });

  it("exits the sub-mode", () => {
    const view = createView("(a [1 2])");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);
    expect(ctrl.active).toBe(true);

    ctrl.cancel(view);
    expect(ctrl.active).toBe(false);
    expect(getSession(view)).toBeNull();

    view.destroy();
  });
});

describe("vectorMarkController — mixed element types", () => {
  it("handles vector with booleans", () => {
    const view = createView("(a [true false])");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);

    const session = getSession(view);
    expect(session!.elements).toHaveLength(2);
    // Booleans are markable (they're symbols "true"/"false")
    expect(session!.elements[0].state).toBe("selected");
    expect(session!.elements[1].state).toBe("selected");

    ctrl.commit(view);
    const text = view.state.doc.toString();
    expect(text).toMatch(/\(live-edit true :id/);
    expect(text).toMatch(/\(live-edit false :id/);

    view.destroy();
  });

  it("handles vector with keywords", () => {
    const view = createView("(a [:up :down])");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);

    const session = getSession(view);
    expect(session!.elements).toHaveLength(2);
    expect(session!.elements[0].state).toBe("selected");
    expect(session!.elements[1].state).toBe("selected");

    ctrl.commit(view);
    const text = view.state.doc.toString();
    expect(text).toMatch(/\(live-edit :up :id/);
    expect(text).toMatch(/\(live-edit :down :id/);

    view.destroy();
  });

  it("handles mixed numbers and non-markable nested compounds", () => {
    const view = createView("(a [1 (b 2) 3])");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);

    const session = getSession(view);
    expect(session!.elements).toHaveLength(3);
    expect(session!.elements[0].state).toBe("selected"); // 1
    expect(session!.elements[1].state).toBe("non-markable"); // (b 2)
    expect(session!.elements[2].state).toBe("selected"); // 3

    view.destroy();
  });
});

describe("vectorMarkController — range inference in commit", () => {
  it("applies range inference for numeric elements", () => {
    const view = createView("(a [0.5])");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);
    ctrl.commit(view);

    const text = view.state.doc.toString();
    // 0.5 in generic context → min 0, max 1
    expect(text).toContain(":min 0");
    expect(text).toContain(":max 1");

    view.destroy();
  });

  it("boolean elements do not get :min/:max", () => {
    const view = createView("(a [true])");
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);
    ctrl.commit(view);

    const text = view.state.doc.toString();
    expect(text).toMatch(/\(live-edit true :id "[a-z2-9]{4}"\)/);
    expect(text).not.toContain(":min");
    expect(text).not.toContain(":max");

    view.destroy();
  });
});

describe("vectorMarkController — no-ops when inactive", () => {
  it("next/prev/toggle/commit/cancel are no-ops when not active", () => {
    const view = createView("(a [1 2 3])");
    const ctrl = createVectorMarkController();

    // These should not throw
    ctrl.next(view);
    ctrl.prev(view);
    ctrl.toggle(view);
    ctrl.commit(view);
    ctrl.cancel(view);

    expect(view.state.doc.toString()).toBe("(a [1 2 3])");
    expect(ctrl.active).toBe(false);

    view.destroy();
  });
});

describe("vectorMarkController — pre-existing live-edit wrappers", () => {
  it("enter() pre-selects elements with existing live-edit Meta (§3.7.5)", () => {
    const view = createView('(a [1 (live-edit 2 :id "x") 3])');
    const ctrl = createVectorMarkController({ defaultMarkState: "none" });

    // Navigate to the vector [1 (live-edit 2 :id "x") 3]
    navigateTo(view, "in", "in", "next");
    expect(currentNodeText(view)).toBe('[1 (live-edit 2 :id "x") 3]');

    const ok = ctrl.enter(view);
    expect(ok).toBe(true);

    const session = getSession(view);
    expect(session).not.toBeNull();
    expect(session!.elements).toHaveLength(3);

    // With defaultMarkState "none", unmarked elements are deselected.
    // But the already-wrapped element should be pre-selected regardless.
    expect(session!.elements[0].state).toBe("deselected"); // bare 1
    expect(session!.elements[1].state).toBe("selected");   // (live-edit 2 ...) — pre-selected
    expect(session!.elements[2].state).toBe("deselected"); // bare 3

    view.destroy();
  });

  it("enter() element range for a wrapped child covers the full wrapper text", () => {
    const view = createView('(a [1 (live-edit 2 :id "x") 3])');
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);

    const session = getSession(view);
    const wrappedEl = session!.elements[1];
    const rangeText = view.state.doc.sliceString(
      wrappedEl.range.from,
      wrappedEl.range.to,
    );
    // The range stored in the session should cover the full wrapper.
    expect(rangeText).toBe('(live-edit 2 :id "x")');

    view.destroy();
  });

  it("commit() skips re-wrapping a pre-selected wrapped element (idempotent)", () => {
    const view = createView('(a [1 (live-edit 2 :id "x") 3])');
    const ctrl = createVectorMarkController();

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);
    // All three are selected (default "all"); 2 is already wrapped.
    ctrl.commit(view);

    const text = view.state.doc.toString();
    // The pre-existing wrapper must be preserved verbatim.
    expect(text).toContain('(live-edit 2 :id "x")');
    // 1 and 3 should have been newly wrapped.
    expect(text).toMatch(/\(live-edit 1 :id "[a-z2-9]{4}"/);
    expect(text).toMatch(/\(live-edit 3 :id "[a-z2-9]{4}"/);
    // No double-wrapping: (live-edit (live-edit ...) must not appear.
    expect(text).not.toMatch(/\(live-edit \(live-edit/);

    view.destroy();
  });

  it("commit() unwraps a deselected element that has a live-edit wrapper", () => {
    const view = createView('(a [1 (live-edit 2 :id "x") 3])');
    const ctrl = createVectorMarkController({ defaultMarkState: "none" });

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);

    // Only the wrapped element is pre-selected; explicitly keep it deselected by
    // starting with "none" — but verify it was pre-selected first, then toggle.
    // With defaultMarkState "none", wrapped elements are still pre-selected per §3.7.5.
    // Toggle it off.
    ctrl.next(view); // move to index 1 (the wrapped element)
    ctrl.toggle(view); // deselect it
    ctrl.commit(view);

    const text = view.state.doc.toString();
    // The wrapper should be stripped, leaving just the bare literal.
    expect(text).not.toContain("(live-edit 2");
    expect(text).toContain(" 2 ");
    // 1 and 3 remain untouched (they were deselected).
    expect(text).toBe("(a [1 2 3])");

    view.destroy();
  });

  it("enter() with all three elements wrapped: all are pre-selected with defaultMarkState 'none'", () => {
    const view = createView(
      '(a [(live-edit 1 :id "a") (live-edit 2 :id "b") (live-edit 3 :id "c")])',
    );
    const ctrl = createVectorMarkController({ defaultMarkState: "none" });

    navigateTo(view, "in", "in", "next");
    ctrl.enter(view);

    const session = getSession(view);
    expect(session).not.toBeNull();
    expect(session!.elements).toHaveLength(3);
    expect(session!.elements[0].state).toBe("selected");
    expect(session!.elements[1].state).toBe("selected");
    expect(session!.elements[2].state).toBe("selected");

    view.destroy();
  });
});
