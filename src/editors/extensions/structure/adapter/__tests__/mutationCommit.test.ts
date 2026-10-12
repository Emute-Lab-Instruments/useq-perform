import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo, redo, undoDepth } from "@codemirror/commands";
import { default_extensions } from "@nextjournal/clojure-mode";
import { structuralCoreExtensions } from "../extension.ts";
import { dispatchAction } from "../dispatcher.ts";
import { structField } from "../stateField.ts";
import * as projection from "../treeFromLezer.ts";
import { findById, defaultIdGen } from "../../core/index.ts";
import { applyMenuVerb } from "../../../../menu/verbApplication.ts";
import type { Manifest, MenuStateOpen, TabId, CategoryId, ItemId } from "../../../../../lib/menu/types.ts";
import { getAppSettings, replaceAppSettings } from "../../../../../runtime/appSettingsRepository.ts";

const views: EditorView[] = [];
const originalSettings = getAppSettings();
afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  replaceAppSettings(originalSettings);
  vi.restoreAllMocks();
});

function focusText(state: EditorState): string {
  const value = state.field(structField);
  const cursor = value.state.cursors.primary;
  const range = value.idIndex.get(cursor.kind === "node" ? cursor.target : cursor.start)!;
  return state.doc.sliceString(range.from, range.to);
}

function createView(doc: string, observe?: (state: EditorState) => void): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc, extensions: [
      ...default_extensions, history(), ...structuralCoreExtensions(),
      EditorView.updateListener.of((update) => { if (update.docChanged) observe?.(update.state); }),
    ] }),
  });
  views.push(view);
  return view;
}

describe("AST mutation commits", () => {
  it("publishes moved text and intended focus together, folds once, and restores both through undo/redo", async () => {
    const observed: Array<[string, string]> = [];
    const view = createView("(a b c)", (state) => observed.push([state.doc.toString(), focusText(state)]));
    dispatchAction(view, "nav.in");
    dispatchAction(view, "nav.in");
    dispatchAction(view, "nav.next");
    await Promise.resolve();
    const fold = vi.spyOn(projection, "treeFromLezer");

    dispatchAction(view, "edit.transposeNext");
    expect(observed).toEqual([["(a c b)", "b"]]);
    expect(fold).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(focusText(view.state)).toBe("b");

    undo(view);
    expect(observed.at(-1)).toEqual(["(a b c)", "b"]);
    redo(view);
    expect(observed.at(-1)).toEqual(["(a c b)", "b"]);
  });

  it("commits radial-menu insertion with its first hole focused and preserves scene gaps", async () => {
    const observed: string[] = [];
    const view = createView("(a)\n\n; scene\n\n(b)", (state) => observed.push(focusText(state)));
    dispatchAction(view, "nav.in");
    const manifest: Manifest = { version: 1, tabs: [{ id: "functions" as TabId, label: "Functions", categories: [{
      id: "osc" as CategoryId, label: "Osc", items: [{ kind: "function", id: "saw" as ItemId, label: "saw", head: "saw", signature: [{ name: "freq", type: "number" }] }],
    }] }] };
    const state = {
      phase: "open", leftTabIdx: 0, rightTabIdx: 0, leftHover: 0, rightHover: 0,
      shoulderHeld: "right", target: {}, manifest,
      frozen: { leftTabIdx: 0, rightTabIdx: 0, leftPicked: "osc", rightPicked: "saw" },
    } as MenuStateOpen;

    expect(applyMenuVerb({ state, manifest, view, verbKind: "insert", ids: defaultIdGen() }).kind).toBe("committed");
    expect(observed).toEqual(["($ freq :number)"]);
    expect(view.state.doc.toString()).toContain("\n\n; scene\n\n");
    await Promise.resolve();
    const value = view.state.field(structField);
    const cursor = value.state.cursors.primary;
    expect(cursor.kind).toBe("node");
    expect(findById(value.state.tree.root, (cursor as { target: string }).target)?.kind).toBe("hole");
    expect(undoDepth(view.state)).toBe(1);
    undo(view);
    expect(view.state.doc.toString()).toBe("(a)\n\n; scene\n\n(b)");
    expect(focusText(view.state)).toBe("(a)");
  });

  it("keeps fixed-point auto-formatting in the mutation's single history step", () => {
    replaceAppSettings({ ...originalSettings, format: { ...originalSettings.format, autoFormatStrategy: "indent-fixed-point" } });
    const initial = "(do (a)) (b)";
    const observed: string[] = [];
    const view = createView(initial, (state) => observed.push(focusText(state)));
    dispatchAction(view, "nav.in");
    dispatchAction(view, "edit.slurpForward");
    expect(observed).toHaveLength(1);
    expect(observed[0]).toBe(view.state.doc.toString());
    expect(undoDepth(view.state)).toBe(1);
    undo(view);
    expect(view.state.doc.toString()).toBe(initial);
  });
});
