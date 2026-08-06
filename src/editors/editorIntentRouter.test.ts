import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
// @ts-expect-error — clojure-mode has no type declarations
import { default_extensions } from "@nextjournal/clojure-mode";

vi.mock("../effects/editorEvaluation.ts", () => ({
  evaluate: vi.fn(() => true),
}));

import { evaluate } from "../effects/editorEvaluation.ts";
import {
  executeEditorCommand,
  type EditorCommandSource,
} from "./commands/editorCommandRouter.ts";
import { structuralCoreExtensions } from "./extensions/structure/adapter/extension.ts";
import { structField } from "./extensions/structure/adapter/stateField.ts";

const views: EditorView[] = [];

function createView(doc = "(foo bar)"): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [...default_extensions, ...structuralCoreExtensions()],
    }),
  });
  views.push(view);
  return view;
}

function focusedSource(view: EditorView): string {
  const value = view.state.field(structField);
  const cursor = value.state.cursors.primary;
  expect(cursor.kind).toBe("node");
  if (cursor.kind !== "node") return "";
  const range = value.idIndex.get(cursor.target);
  return range ? view.state.doc.sliceString(range.from, range.to) : "";
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("canonical editor intents", () => {
  it.each<EditorCommandSource>([
    "keyboard",
    "gamepad",
    "menu",
    "palette",
    "widget",
    "test",
  ])("gives %s the same structural transaction path", (source) => {
    const view = createView();

    expect(executeEditorCommand(view, {
      kind: "structural",
      action: "nav.in",
      source,
    })).toBe(true);

    expect(focusedSource(view)).toBe("(foo bar)");
  });

  it("restores editor focus only for indirect user surfaces", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);
    const view = createView();

    button.focus();
    executeEditorCommand(view, {
      kind: "structural",
      action: "nav.in",
      source: "keyboard",
    });
    expect(document.activeElement).toBe(button);

    executeEditorCommand(view, {
      kind: "structural",
      action: "nav.in",
      source: "gamepad",
    });
    expect(view.hasFocus).toBe(true);
  });

  it("routes evaluation through the same typed entry point", () => {
    const view = createView();

    expect(executeEditorCommand(view, {
      kind: "evaluate",
      strategy: "soft",
      source: "palette",
    })).toBe(true);
    expect(evaluate).toHaveBeenCalledWith(view, "soft");
    expect(view.hasFocus).toBe(true);
  });
});
