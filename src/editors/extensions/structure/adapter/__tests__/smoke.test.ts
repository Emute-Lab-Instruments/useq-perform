/**
 * Adapter smoke test (round-2).
 *
 * Round 1's 70 unit tests cover the functional core. The brief explicitly
 * scopes round-2 testing to a single smoke check that the adapter wires up
 * without exploding and that one nav op + one mutation op drives the editor
 * end-to-end.
 *
 * Anything more comprehensive (whitespace round-trips, hole semantics in
 * source, complex multi-cursor scenarios) is round 3.
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

describe("structural-editing adapter (round 2 smoke)", () => {
  it("parses a doc into a core tree on mount", () => {
    const view = createView("(a 1 2)\n[3 4]");
    const value = view.state.field(structField);
    expect(value.state.tree.root.kind).toBe("document");
    expect(value.state.tree.root.children.length).toBe(2);
    expect(value.state.tree.root.children[0]!.kind).toBe("list");
    expect(value.state.tree.root.children[1]!.kind).toBe("vector");
    view.destroy();
  });

  it("nav.down moves the cursor into the first top-level form", () => {
    const view = createView("(a 1 2)");
    const before = view.state.field(structField);
    expect(before.state.cursors.primary.kind).toBe("node");
    expect((before.state.cursors.primary as { target: string }).target).toBe(
      before.state.tree.root.id,
    );

    const ok = dispatchAction(view, "nav.down");
    expect(ok).toBe(true);
    const after = view.state.field(structField);
    // Now sitting on the (a 1 2) list.
    const targetId = (after.state.cursors.primary as { target: string }).target;
    const list = after.state.tree.root.children[0]!;
    expect(targetId).toBe(list.id);
    view.destroy();
  });

  it("nav.next advances cursor across siblings", () => {
    const view = createView("(a 1 2)");
    dispatchAction(view, "nav.down"); // into list
    dispatchAction(view, "nav.down"); // onto symbol "a"
    const after1 = view.state.field(structField);
    const list = after1.state.tree.root.children[0]!;
    expect(list.kind).toBe("list");
    const sym = (list as { children: Array<{ id: string }> }).children[0]!;
    expect((after1.state.cursors.primary as { target: string }).target).toBe(
      sym.id,
    );

    dispatchAction(view, "nav.next"); // onto "1"
    const after2 = view.state.field(structField);
    const list2 = after2.state.tree.root.children[0]!;
    const second = (list2 as { children: Array<{ id: string }> }).children[1]!;
    expect((after2.state.cursors.primary as { target: string }).target).toBe(
      second.id,
    );
    view.destroy();
  });

  it("edit.slurpForward mutates the doc text", () => {
    const view = createView("(a) b");
    // Place cursor on (a)
    dispatchAction(view, "nav.down"); // into doc → first child is list (a)
    const before = view.state.field(structField);
    expect(before.state.tree.root.children.length).toBe(2);

    const ok = dispatchAction(view, "edit.slurpForward");
    expect(ok).toBe(true);
    // After slurp the document text should contain (a b) as a single form.
    const docText = view.state.doc.toString();
    expect(docText).toContain("(a b)");
    // And the document should now have a single top-level form.
    const after = view.state.field(structField);
    expect(after.state.tree.root.children.length).toBe(1);
    expect(after.state.tree.root.children[0]!.kind).toBe("list");
    view.destroy();
  });
});
