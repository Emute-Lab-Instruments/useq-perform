/**
 * Auto-sync of structural cursor from CodeMirror selection.
 *
 * Verifies the legacy "polygon follows the caret" behaviour is restored on
 * top of the new functional core: a CM selection change snaps the structural
 * primary cursor to the smallest addressable node enclosing the caret.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
// @ts-expect-error — clojure-mode has no type declarations
import { default_extensions } from "@nextjournal/clojure-mode";

import { _internals } from "../cursorFromSelection.ts";
import { dispatchAction } from "../dispatcher.ts";
import { structuralCoreExtensions } from "../extension.ts";
import { structField } from "../stateField.ts";

const { findSmallestEnclosingAddressableNode } = _internals;

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

const flushMicrotasks = () => new Promise((r) => queueMicrotask(() => r(null)));

describe("structuralCursorFromSelection", () => {
  it("findSmallestEnclosingAddressableNode descends to the deepest enclosing node", () => {
    const view = createView("(a 1 2)");
    const value = view.state.field(structField);
    // Position 3 is in `1`; smallest enclosing should be the number node.
    const id = findSmallestEnclosingAddressableNode(
      value.state.tree.root,
      value.idIndex,
      3,
    );
    expect(id).not.toBeNull();
    const list = value.state.tree.root.children[0]!;
    type C = { children: Array<{ id: string; kind: string }> };
    const numberNode = (list as unknown as C).children[1]!;
    expect(numberNode.kind).toBe("number");
    expect(id).toBe(numberNode.id);
    view.destroy();
  });

  it("returns null when the caret is outside every top-level form", () => {
    const view = createView("   (a 1 2)");
    const value = view.state.field(structField);
    // Position 0 is in leading whitespace — no addressable node encloses it
    // (the document root is intentionally skipped).
    const id = findSmallestEnclosingAddressableNode(
      value.state.tree.root,
      value.idIndex,
      0,
    );
    expect(id).toBeNull();
    view.destroy();
  });

  it("snaps the structural cursor to the smallest enclosing node on selection change", async () => {
    const view = createView("(a 1 2)");
    const before = view.state.field(structField);
    // Cursor starts at the document root.
    expect((before.state.cursors.primary as { target: string }).target).toBe(
      before.state.tree.root.id,
    );

    // Move CM selection to position 3 (inside `1`).
    view.dispatch({ selection: { anchor: 3 } });
    await flushMicrotasks();

    const after = view.state.field(structField);
    const list = after.state.tree.root.children[0]!;
    type C = { children: Array<{ id: string; kind: string }> };
    const numberNode = (list as unknown as C).children[1]!;
    expect((after.state.cursors.primary as { target: string }).target).toBe(
      numberNode.id,
    );
    view.destroy();
  });

  it("does not clobber a structural-nav-driven cursor in the same transaction", async () => {
    // nav.out moves the cursor to a parent compound; without the
    // setStructState skip, the auto-sync would drag it back down.
    const view = createView("(a (b 1) c)");
    dispatchAction(view, "nav.in"); // onto outer list
    dispatchAction(view, "nav.in"); // onto symbol `a`
    dispatchAction(view, "nav.next"); // onto inner list (b 1)
    dispatchAction(view, "nav.in"); // onto symbol `b`
    await flushMicrotasks();

    const before = view.state.field(structField);
    type C = { children: Array<{ id: string; kind: string }> };
    const outer = before.state.tree.root.children[0]! as unknown as C;
    const innerList = outer.children[1]!;
    const sym_b = (innerList as unknown as C).children[0]!;
    expect((before.state.cursors.primary as { target: string }).target).toBe(
      sym_b.id,
    );

    // Now nav.out — should land on the inner list, not get dragged back to `b`.
    dispatchAction(view, "nav.out");
    await flushMicrotasks();
    const after = view.state.field(structField);
    expect((after.state.cursors.primary as { target: string }).target).toBe(
      innerList.id,
    );
    view.destroy();
  });
});
