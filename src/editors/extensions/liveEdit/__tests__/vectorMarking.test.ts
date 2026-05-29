/**
 * Regression test for the vector-mark sub-mode visuals (live-edit §3.7).
 *
 * The §3.7.8 bottom hint is a BLOCK widget. CodeMirror forbids block
 * decorations from a ViewPlugin (`RangeError: Block decorations may not be
 * specified via plugins`). The hint must therefore be supplied from a
 * StateField. These tests mount a real EditorView and dispatch a session,
 * which is exactly the path that crashed before the fix.
 */
import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import {
  createVectorMarkingExtension,
  setVectorMarkSession,
  clearVectorMarkSession,
} from "../vectorMarking.ts";
import type { VectorMarkSession } from "../../../../contracts/liveEdit.ts";

const views: EditorView[] = [];

afterEach(() => {
  for (const v of views.splice(0)) v.destroy();
});

function mount(doc: string): EditorView {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: createVectorMarkingExtension(),
    }),
  });
  views.push(view);
  return view;
}

const fourElementSession: VectorMarkSession = {
  vectorRange: { from: 0, to: 11 },
  elements: [
    { range: { from: 2, to: 3 }, state: "selected" },
    { range: { from: 4, to: 5 }, state: "deselected" },
    { range: { from: 6, to: 7 }, state: "selected" },
    { range: { from: 8, to: 9 }, state: "selected" },
  ],
  focusIndex: 2,
};

describe("vector-marking extension — block hint does not crash", () => {
  it("mounts and seeds a session without throwing a RangeError", () => {
    const view = mount("[ 1 2 3 4 ]");
    expect(() => setVectorMarkSession(view, fourElementSession)).not.toThrow();
  });

  it("renders a single block hint widget at the vector's line end", () => {
    const view = mount("[ 1 2 3 4 ]");
    setVectorMarkSession(view, fourElementSession);
    const hints = view.contentDOM.querySelectorAll(".cm-vector-mark-hint");
    expect(hints.length).toBe(1);
  });

  it("clears the hint when the session is cleared", () => {
    const view = mount("[ 1 2 3 4 ]");
    setVectorMarkSession(view, fourElementSession);
    expect(view.contentDOM.querySelectorAll(".cm-vector-mark-hint").length).toBe(
      1,
    );
    clearVectorMarkSession(view);
    expect(view.contentDOM.querySelectorAll(".cm-vector-mark-hint").length).toBe(
      0,
    );
  });

  it("survives a doc edit while a session is active", () => {
    const view = mount("[ 1 2 3 4 ]");
    setVectorMarkSession(view, fourElementSession);
    expect(() =>
      view.dispatch({ changes: { from: 11, insert: " " } }),
    ).not.toThrow();
  });
});
