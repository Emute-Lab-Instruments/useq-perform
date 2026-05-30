import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { validateExercise } from "./validation";
import type { Exercise } from "./exercises";

function makeView(doc: string, anchor: number, head = anchor): EditorView {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor, head },
    }),
  });
}

function makeExercise(over: Partial<Exercise>): Exercise {
  return {
    id: "test",
    title: "test",
    category: "navigation",
    startCode: "(+ 1 2)",
    startCursorText: "1",
    targetCode: "(+ 1 2)",
    targetCursorText: "1",
    promptMode: "spotlight",
    actions: ["nav.right"],
    ...over,
  };
}

describe("validateExercise", () => {
  it("matches code ignoring whitespace differences (mutation exercise)", () => {
    const ex = makeExercise({
      startCode: "(+ 1 2) 3",
      targetCode: "(+ 1 2 3)",
      startCursorText: "(+ 1 2)",
      targetCursorText: "(+ 1 2 3)",
    });
    // Same tokens, different whitespace — should still match.
    const view = makeView("(+  1  2  3)", 0);
    const result = validateExercise(view, ex);
    expect(result.codeMatch).toBe(true);
    expect(result.complete).toBe(true);
    view.destroy();
  });

  it("does not complete when code differs", () => {
    const ex = makeExercise({
      startCode: "(+ 1 2) 3",
      targetCode: "(+ 1 2 3)",
    });
    const view = makeView("(+ 1 2) 3", 0);
    const result = validateExercise(view, ex);
    expect(result.codeMatch).toBe(false);
    expect(result.complete).toBe(false);
    view.destroy();
  });

  it("navigation exercise requires the cursor on the target text", () => {
    // Code unchanged; completion gated on cursor landing on "2".
    const ex = makeExercise({
      startCode: "(+ 1 2 3)",
      targetCode: "(+ 1 2 3)",
      startCursorText: "1",
      targetCursorText: "2",
    });
    const wrong = makeView("(+ 1 2 3)", 3, 4); // selects "1"
    expect(validateExercise(wrong, ex).complete).toBe(false);
    wrong.destroy();

    const right = makeView("(+ 1 2 3)", 5, 6); // selects "2"
    const result = validateExercise(right, ex);
    expect(result.cursorMatch).toBe(true);
    expect(result.complete).toBe(true);
    right.destroy();
  });
});
