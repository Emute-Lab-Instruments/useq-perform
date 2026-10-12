import { afterEach, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, redo } from "@codemirror/commands";
import { default_extensions } from "@nextjournal/clojure-mode";
import { startGrab, endGrab, moveGrab, cancelGrab, isGrabActive } from "./grabSession.ts";
import { structuralCoreExtensions } from "./extensions/structure/adapter/extension.ts";
import { dispatchAction } from "./extensions/structure/adapter/dispatcher.ts";
import { structField } from "./extensions/structure/adapter/stateField.ts";
import { identityExtensionsWithField } from "./extensions/stateIdentity/identityField.ts";
import { makeContinuitySource, entriesOf } from "./extensions/stateIdentity/identityMapState.ts";
import { defaultStatefulFormClassifier } from "./extensions/stateIdentity/identityClassify.ts";
import { deterministicIdGenerator } from "./extensions/stateIdentity/identityGenerator.ts";

const views: EditorView[] = [];
afterEach(() => { for (const view of views.splice(0)) view.destroy(); });
function createView(doc: string) {
  const identity = identityExtensionsWithField({ ids: deterministicIdGenerator(), classifier: defaultStatefulFormClassifier, continuity: makeContinuitySource(0) });
  const view = new EditorView({ parent: document.body, state: EditorState.create({
    doc, extensions: [...default_extensions, history(), ...structuralCoreExtensions(), ...identity.extensions],
  }) });
  views.push(view);
  dispatchAction(view, "nav.in");
  dispatchAction(view, "nav.in");
  return { view, identity: () => entriesOf(view.state.field(identity.field).map).map((entry) => entry.id) };
}

it("isolates concurrent grabs by document and restores text, focus and identities on cancel", () => {
  const initial = "(a b c)\n\n(synth 1 (osc/sine 440))";
  const a = createView(initial);
  const b = createView("(x y z)");
  const ids = a.identity();
  expect(ids).toHaveLength(1);
  startGrab(a.view);
  expect(isGrabActive(b.view.state)).toBe(false);
  startGrab(b.view);
  moveGrab(a.view, "edit.transposeNext");
  moveGrab(a.view, "edit.transposeNext");
  moveGrab(b.view, "edit.transposeNext");
  cancelGrab(a.view);
  expect(a.view.state.doc.toString()).toBe(initial);
  expect(a.identity()).toEqual(ids);
  const field = a.view.state.field(structField);
  const cursor = field.state.cursors.primary as { target: string };
  const range = field.idIndex.get(cursor.target)!;
  expect(a.view.state.doc.sliceString(range.from, range.to)).toBe("a");
  expect(isGrabActive(a.view.state)).toBe(false);
  expect(isGrabActive(b.view.state)).toBe(true);
  expect(b.view.state.doc.toString()).toBe("(y x z)");
  endGrab(b.view);
  undo(b.view);
  redo(b.view);
  expect(b.view.state.doc.toString()).toBe("(y x z)");
  expect(isGrabActive(b.view.state)).toBe(false);
});

it("does not count rejected moves or undo edits made before the grab", () => {
  const { view } = createView("(a b)");
  dispatchAction(view, "edit.transposeNext");
  startGrab(view);
  expect(moveGrab(view, "edit.transposeNext")).toBe(false);
  cancelGrab(view);
  expect(view.state.doc.toString()).toBe("(b a)");
});
