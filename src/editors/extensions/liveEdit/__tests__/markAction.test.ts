/**
 * Tests for liveEdit.mark action (§3).
 *
 * Tests use a real CodeMirror EditorView with the structural state field
 * extension, driving mark/unmark via `executeLiveEditMark` and checking
 * the resulting document text.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
// @ts-expect-error — clojure-mode has no type declarations
import { default_extensions } from "@nextjournal/clojure-mode";

import { structuralCoreExtensions } from "../../structure/adapter/extension.ts";
import { dispatchAction } from "../../structure/adapter/dispatcher.ts";
import { structField } from "../../structure/adapter/stateField.ts";
import {
  executeLiveEditMark,
  generateId,
  ID_ALPHABET,
  ID_LENGTH,
} from "../markAction.ts";

// ── Helpers ────────────────────────────────────────────────────────────────

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

/**
 * Navigate the structural cursor to a specific node by navigating
 * into the tree. Returns the view for chaining.
 *
 * Path is a series of nav actions: "in" navigates into children,
 * "next" moves to the next sibling.
 */
function navigateTo(view: EditorView, ...actions: string[]): EditorView {
  for (const action of actions) {
    dispatchAction(view, `nav.${action}`);
  }
  return view;
}

/** Get the text of the node the structural cursor is currently on. */
function currentNodeText(view: EditorView): string {
  const sv = view.state.field(structField);
  const cursor = sv.state.cursors.primary;
  if (cursor.kind !== "node") return "<range-cursor>";
  const range = sv.idIndex.get(cursor.target);
  if (!range) return "<no-range>";
  return view.state.doc.sliceString(range.from, range.to);
}

// ── Mark tests ─────────────────────────────────────────────────────────────

describe("liveEdit.mark — marking", () => {
  it("marks a number literal → wraps with (live-edit ...)", () => {
    const view = createView("(osc 0.5)");
    // nav: doc → list (osc 0.5) → symbol osc → number 0.5
    navigateTo(view, "in", "in", "next");
    expect(currentNodeText(view)).toBe("0.5");

    const ok = executeLiveEditMark(view);
    expect(ok).toBe(true);

    const text = view.state.doc.toString();
    // Should contain the live-edit wrapper
    expect(text).toMatch(/\(live-edit 0\.5 :id "[a-z2-9]{4}" :min \d+ :max \d+/);
    // Parent osc context: inferRange(0.5, "osc") → min 20, max 2000
    expect(text).toContain(":min 20");
    expect(text).toContain(":max 2000");
    view.destroy();
  });

  it("marks a number literal in unit range context", () => {
    const view = createView("(a 0.5)");
    navigateTo(view, "in", "in", "next");
    expect(currentNodeText(view)).toBe("0.5");

    executeLiveEditMark(view);
    const text = view.state.doc.toString();
    // inferRange(0.5) with no special parent → min 0, max 1
    expect(text).toContain(":min 0");
    expect(text).toContain(":max 1");
    view.destroy();
  });

  it("marks a boolean literal (true)", () => {
    const view = createView("(a true)");
    navigateTo(view, "in", "in", "next");
    expect(currentNodeText(view)).toBe("true");

    const ok = executeLiveEditMark(view);
    expect(ok).toBe(true);

    const text = view.state.doc.toString();
    // Boolean seed → inferRange returns null → no :min/:max
    expect(text).toMatch(/\(live-edit true :id "[a-z2-9]{4}"\)/);
    expect(text).not.toContain(":min");
    expect(text).not.toContain(":max");
    view.destroy();
  });

  it("marks a boolean literal (false)", () => {
    const view = createView("(a false)");
    navigateTo(view, "in", "in", "next");
    expect(currentNodeText(view)).toBe("false");

    const ok = executeLiveEditMark(view);
    expect(ok).toBe(true);

    const text = view.state.doc.toString();
    expect(text).toMatch(/\(live-edit false :id "[a-z2-9]{4}"\)/);
    view.destroy();
  });

  it("marks a keyword literal", () => {
    const view = createView("(a :up)");
    navigateTo(view, "in", "in", "next");
    expect(currentNodeText(view)).toBe(":up");

    const ok = executeLiveEditMark(view);
    expect(ok).toBe(true);

    const text = view.state.doc.toString();
    // Keyword seed → inferRange returns null → no :min/:max
    expect(text).toMatch(/\(live-edit :up :id "[a-z2-9]{4}"\)/);
    view.destroy();
  });

  it("generates a unique :id in the wrapper", () => {
    const view = createView("(a 42)");
    navigateTo(view, "in", "in", "next");
    executeLiveEditMark(view);

    const text = view.state.doc.toString();
    const match = text.match(/:id "([^"]+)"/);
    expect(match).not.toBeNull();
    const id = match![1]!;
    expect(id).toHaveLength(ID_LENGTH);
    // Every character should be from the alphabet
    for (const ch of id) {
      expect(ID_ALPHABET).toContain(ch);
    }
    view.destroy();
  });
});

// ── Unmark tests ──────────────────────────────────────────────────────────

describe("liveEdit.mark — unmarking", () => {
  it("unmarking removes the wrapper and restores the inner literal", () => {
    const view = createView('(a (live-edit 0.5 :id "xyz" :min 0 :max 1))');
    // The tree-from-lezer wrapper recognition folds this into a NumberNode
    // with a live-edit Meta. Navigate to it.
    // doc → list (a ...) → first child "a" → next is the wrapped 0.5
    navigateTo(view, "in", "in", "next");

    const sv = view.state.field(structField);
    const cursor = sv.state.cursors.primary;
    expect(cursor.kind).toBe("node");

    const ok = executeLiveEditMark(view);
    expect(ok).toBe(true);

    const text = view.state.doc.toString();
    expect(text).toBe("(a 0.5)");
    view.destroy();
  });

  it("unmark then remark produces a new wrapper", () => {
    const view = createView('(a (live-edit 0.5 :id "old" :min 0 :max 1))');
    navigateTo(view, "in", "in", "next");

    // Unmark
    executeLiveEditMark(view);
    expect(view.state.doc.toString()).toBe("(a 0.5)");

    // Re-navigate to the now-bare literal
    // After the text change, the tree is reparsed. We need to navigate again.
    navigateTo(view, "in", "in", "next");

    // Mark
    executeLiveEditMark(view);
    const text = view.state.doc.toString();
    expect(text).toMatch(/\(live-edit 0\.5 :id "[a-z2-9]{4}" :min 0 :max 1/);
    // The new id should not be "old"
    const match = text.match(/:id "([^"]+)"/);
    // (Could coincidentally be "old" but astronomically unlikely)
    expect(match).not.toBeNull();
    view.destroy();
  });
});

// ── Rejection tests ───────────────────────────────────────────────────────

describe("liveEdit.mark — rejections", () => {
  it("no-ops when cursor is on a symbol (not a literal)", () => {
    const view = createView("(foo 1 2)");
    navigateTo(view, "in", "in"); // on symbol "foo"
    expect(currentNodeText(view)).toBe("foo");

    const ok = executeLiveEditMark(view);
    expect(ok).toBe(false);

    // Document unchanged
    expect(view.state.doc.toString()).toBe("(foo 1 2)");
    view.destroy();
  });

  it("no-ops when cursor is on a list", () => {
    const view = createView("(a (b 1))");
    navigateTo(view, "in", "in", "next"); // on list (b 1)
    expect(currentNodeText(view)).toBe("(b 1)");

    const ok = executeLiveEditMark(view);
    expect(ok).toBe(false);

    expect(view.state.doc.toString()).toBe("(a (b 1))");
    view.destroy();
  });

  it("no-ops when cursor is on the document root", () => {
    const view = createView("(a 1)");
    // Cursor starts on document root
    const ok = executeLiveEditMark(view);
    expect(ok).toBe(false);
    expect(view.state.doc.toString()).toBe("(a 1)");
    view.destroy();
  });

  it("no-ops when cursor is on a string literal", () => {
    const view = createView('(a "hello")');
    navigateTo(view, "in", "in", "next"); // on string "hello"

    const ok = executeLiveEditMark(view);
    expect(ok).toBe(false);

    expect(view.state.doc.toString()).toBe('(a "hello")');
    view.destroy();
  });
});

// ── ID generation ─────────────────────────────────────────────────────────

describe("generateId", () => {
  it("generates IDs of the correct length", () => {
    const id = generateId(new Set());
    expect(id).toHaveLength(ID_LENGTH);
  });

  it("uses only characters from the ID alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const id = generateId(new Set());
      for (const ch of id) {
        expect(ID_ALPHABET).toContain(ch);
      }
    }
  });

  it("avoids collisions with existing IDs", () => {
    // Fill a set with many IDs, verify the generated one is not in the set
    const existing = new Set<string>();
    for (let i = 0; i < 100; i++) {
      existing.add(generateId(new Set()));
    }
    const newId = generateId(existing);
    expect(existing.has(newId)).toBe(false);
  });

  it("returns a 5-char fallback when all 4-char IDs are exhausted (unlikely)", () => {
    // Create a mock set whose `has` always returns true for 4-char IDs
    const exhausted = {
      has(id: string) {
        return id.length === ID_LENGTH;
      },
    } as Set<string>;
    const id = generateId(exhausted);
    expect(id).toHaveLength(ID_LENGTH + 1);
  });
});
