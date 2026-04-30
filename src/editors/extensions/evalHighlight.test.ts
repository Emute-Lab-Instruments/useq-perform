// Vitest unit tests for evalHighlight flash decoration extension.
// Spec: docs/specs/code-evaluation.md §1.5
//   "A flash decoration animates over the evaluated range on every eval.
//    Soft eval uses a visually distinct flash to signal preview, not committed."

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { evalHighlightField, evalHighlightEffect } from "./evalHighlight.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createView(doc: string): EditorView {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [evalHighlightField],
    }),
  });
}

/** Collect all decoration ranges from the evalHighlightField. */
interface DecoRange {
  from: number;
  to: number;
  class: string;
}

function getDecoRanges(view: EditorView): DecoRange[] {
  const decoSet = view.state.field(evalHighlightField);
  const collected: DecoRange[] = [];
  decoSet.between(0, view.state.doc.length, (from, to, deco) => {
    // Decoration spec has a `class` property
    const cls = (deco.spec as { class?: string }).class ?? "";
    collected.push({ from, to, class: cls });
  });
  return collected;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("evalHighlight: decoration appears on dispatched range", () => {
  it("dispatching evalHighlightEffect adds a decoration covering the given range", () => {
    const doc = "(a1 440)";
    const view = createView(doc);

    view.dispatch({
      effects: evalHighlightEffect.of({ from: 0, to: doc.length }),
    });

    const ranges = getDecoRanges(view);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.from).toBe(0);
    expect(ranges[0]!.to).toBe(doc.length);

    view.destroy();
  });

  it("normal eval decoration has cm-evaluated-code class", () => {
    const doc = "(a1 440)";
    const view = createView(doc);

    view.dispatch({
      effects: evalHighlightEffect.of({ from: 0, to: doc.length }),
    });

    const ranges = getDecoRanges(view);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.class).toContain("cm-evaluated-code");

    view.destroy();
  });

  it("normal eval decoration does not have cm-evaluated-preview class", () => {
    const doc = "(a1 440)";
    const view = createView(doc);

    view.dispatch({
      effects: evalHighlightEffect.of({ from: 0, to: doc.length }),
    });

    const ranges = getDecoRanges(view);
    expect(ranges[0]!.class).not.toContain("cm-evaluated-preview");

    view.destroy();
  });
});

describe("evalHighlight: soft-eval (isPreview) uses visually distinct class", () => {
  it("isPreview:true adds cm-evaluated-preview class", () => {
    const doc = "(a1 440)";
    const view = createView(doc);

    view.dispatch({
      effects: evalHighlightEffect.of({ from: 0, to: doc.length, isPreview: true }),
    });

    const ranges = getDecoRanges(view);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.class).toContain("cm-evaluated-preview");

    view.destroy();
  });

  it("isPreview:true decoration also carries cm-evaluated-code class", () => {
    const doc = "(a1 440)";
    const view = createView(doc);

    view.dispatch({
      effects: evalHighlightEffect.of({ from: 0, to: doc.length, isPreview: true }),
    });

    const ranges = getDecoRanges(view);
    expect(ranges[0]!.class).toContain("cm-evaluated-code");

    view.destroy();
  });

  it("preview decoration covers the dispatched range exactly", () => {
    const doc = "(a1 440)\n(d2 220)";
    const from = 9; // start of second form
    const to = doc.length;
    const view = createView(doc);

    view.dispatch({
      effects: evalHighlightEffect.of({ from, to, isPreview: true }),
    });

    const ranges = getDecoRanges(view);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]!.from).toBe(from);
    expect(ranges[0]!.to).toBe(to);

    view.destroy();
  });
});

describe("evalHighlight: decoration clears after animation duration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("decoration is present immediately after flashEvalHighlight dispatch", async () => {
    const doc = "(a1 440)";
    const view = createView(doc);

    // Manually dispatch the highlight effect as flashEvalHighlight does
    view.dispatch({
      effects: evalHighlightEffect.of({ from: 0, to: doc.length }),
    });

    expect(getDecoRanges(view)).toHaveLength(1);

    view.destroy();
  });

  it("decoration is gone after 1000ms (clear sentinel dispatched by setTimeout)", async () => {
    const doc = "(a1 440)";
    const view = createView(doc);

    // Simulate what flashEvalHighlight does: dispatch + schedule clear
    view.dispatch({
      effects: evalHighlightEffect.of({ from: 0, to: doc.length }),
    });

    // Schedule the clear exactly as the implementation does
    setTimeout(() => {
      view.dispatch({
        effects: evalHighlightEffect.of({ from: 0, to: 0 }),
      });
    }, 1000);

    expect(getDecoRanges(view)).toHaveLength(1);

    // Advance past the animation duration
    await vi.advanceTimersByTimeAsync(1000);

    expect(getDecoRanges(view)).toHaveLength(0);

    view.destroy();
  });

  it("clear sentinel {from:0, to:0} removes all decorations", async () => {
    const doc = "(a1 440)";
    const view = createView(doc);

    view.dispatch({
      effects: evalHighlightEffect.of({ from: 0, to: doc.length }),
    });

    expect(getDecoRanges(view)).toHaveLength(1);

    // Dispatch the clear sentinel directly
    view.dispatch({
      effects: evalHighlightEffect.of({ from: 0, to: 0 }),
    });

    expect(getDecoRanges(view)).toHaveLength(0);

    view.destroy();
  });

  it("preview decoration also clears after 1000ms", async () => {
    const doc = "(a1 440)";
    const view = createView(doc);

    view.dispatch({
      effects: evalHighlightEffect.of({ from: 0, to: doc.length, isPreview: true }),
    });

    setTimeout(() => {
      view.dispatch({
        effects: evalHighlightEffect.of({ from: 0, to: 0 }),
      });
    }, 1000);

    expect(getDecoRanges(view)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1000);

    expect(getDecoRanges(view)).toHaveLength(0);

    view.destroy();
  });
});
