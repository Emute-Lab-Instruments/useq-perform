import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";

import { openNamespacePicker } from "./operatorNamespaces.ts";
import { setReferenceStore } from "../../utils/referenceStore.ts";
import { _resetForTesting, _stackDepth } from "../../ui/overlayManager.ts";

describe("namespace picker adapter", () => {
  beforeEach(() => {
    setReferenceStore("namespaces", [
      { name: "u", longName: "uni", semantics: "unipolar output" },
      { name: "b", longName: "bi", semantics: "bipolar output" },
    ]);
    setReferenceStore("data", [{
      name: "sin",
      description: "sine",
      aliases: [],
      tags: [],
      parameters: [],
      examples: [],
      bareIdentity: "n/sin",
      namespaceApplicability: [
        { namespace: "u", spelling: "u/sin", identity: "u/sin" },
        { namespace: "b", spelling: "b/sin", identity: "b/sin" },
      ],
      meta: { introduced: null, changed: null },
    }]);
  });

  afterEach(() => {
    document.querySelectorAll(".cm-namespace-picker").forEach((node) => node.remove());
    _resetForTesting();
    setReferenceStore("data", []);
    setReferenceStore("namespaces", []);
  });

  it("rewrites one symbol in one undoable transaction and preserves long style", () => {
    const view = new EditorView({
      state: EditorState.create({ doc: "(a1 uni/sin)", extensions: [history()] }),
      parent: document.body,
    });

    expect(openNamespacePicker(view, 6, { x: 10, y: 10 })).toBe(true);
    expect(_stackDepth()).toBe(1);
    const bipolar = [...document.querySelectorAll<HTMLButtonElement>(".cm-namespace-picker button")]
      .find((button) => button.textContent?.includes("bi/"));
    expect(bipolar).toBeDefined();
    bipolar?.click();

    expect(view.state.doc.toString()).toBe("(a1 bi/sin)");
    expect(_stackDepth()).toBe(0);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("(a1 uni/sin)");
    view.destroy();
  });
});
