import { afterEach, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undoDepth, redoDepth } from "@codemirror/commands";
import { default_extensions } from "@nextjournal/clojure-mode";
import { structuralCoreExtensions } from "./extensions/structure/adapter/extension.ts";
import { getHandler } from "./commands/actionHandlers.ts";
const views: EditorView[] = [];
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

function createView(doc: string, anchor = 0): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [...default_extensions, history(), ...structuralCoreExtensions()],
    }),
  });
  views.push(view);
  return view;
}

it.each(["(a)\n\n\n(b)", "(do\n\n\n  (b))", "(do\n   \n   \n  (b))"])("undo Ctrl-k whitespace: %j", async (doc) => {
  const view = createView(doc, doc.indexOf("\n") + 1);
  getHandler("edit.killToEndOfList")!(view);
  await Promise.resolve();
  const deleted = view.state.doc.toString();
  expect(undoDepth(view.state)).toBe(1);
  expect(view.state.doc.toString()).not.toBe(doc);
  getHandler("edit.undo")!(view);
  await Promise.resolve();
  expect(undoDepth(view.state)).toBe(0);
  expect(redoDepth(view.state)).toBe(1);
  expect(view.state.doc.toString()).toBe(doc);
  getHandler("edit.redo")!(view);
  await Promise.resolve();
  expect(view.state.doc.toString()).toBe(deleted);
});

it("does not apply queued newline formatting after immediate undo", async () => {
  const doc = "(do\n   (b))";
  const view = createView(doc);
  view.dispatch({changes: {from: 4, insert: "\n"}, userEvent: "input.type", filter: false});
  getHandler("edit.undo")!(view);
  await Promise.resolve();
  expect(view.state.doc.toString()).toBe(doc);
  expect(redoDepth(view.state)).toBe(1);
});
