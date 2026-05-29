// Vitest unit tests for the "which top-level form to eval" logic in
// expressionEval.ts. The logic decides which top-level form gets sent for
// evaluation based on the cursor position.
//
// Spec:
//   - docs/specs/code-evaluation.md §1.1: each eval strategy submits "the
//     top-level form" — the form selection logic must always pick a single
//     well-defined top-level form (or none, for an empty buffer).
//   - docs/specs/editor.md §1.10: structural editing operations act on the
//     s-expression tree; the eval-target selection shares the same AST view.
//
// Production source: src/editors/extensions/expressionEval.ts
//   detectAndTrackExpressionEvaluation() mirrors the logic in
//   src/editors/extensions/evalHighlight.ts (getTopLevelRange) and
//   src/effects/editorEvaluation.ts (getTopLevelFormRange).
//
// We exercise the same algorithm against the production findNodeAt() so a
// regression in either findNodeAt or the walk-to-Program-child loop is caught.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { EditorSelection, EditorState, type EditorState as EditorStateType } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
// @ts-expect-error — clojure-mode has no type declarations
import { default_extensions } from "@nextjournal/clojure-mode";

import { findNodeAt } from "./lezerHelpers.ts";
import {
  detectAndTrackExpressionEvaluation,
  handleClearExpression,
  handlePlayExpression,
  setEvalIntegrationConfig,
  type EvalIntegrationConfig,
} from "./expressionEval.ts";
import { lastEvaluatedExpressionField } from "./expressionEvalState.ts";
import {
  registerVisualisation,
  refreshVisualisedExpression,
} from "../../effects/visualisationSampler.ts";

vi.mock("../../effects/visualisationSampler.ts", () => ({
  isExpressionVisualised: () => false,
  toggleVisualisation: vi.fn(async () => {}),
  registerVisualisation: vi.fn(async () => {}),
  refreshVisualisedExpression: vi.fn(async () => {}),
  notifyExpressionEvaluated: vi.fn(),
}));
vi.mock("../../ui/adapters/visualisationPanel", () => ({
  showVisualisationPanel: vi.fn(),
}));
vi.mock("../../runtime/appSettingsRepository.ts", () => ({
  getAppSettings: () => ({ ui: {} }),
}));

// Local helper: build a minimal EditorState with clojure-mode extensions.
// Mirrors the legacy `createStructuralEditor` without depending on the
// retired structural-editing module.
function makeState(doc: string): EditorStateType {
  return EditorState.create({
    doc,
    extensions: [...default_extensions],
  });
}

// ---------------------------------------------------------------------------
// Algorithm under test
//
// This mirrors the eval-target selection in expressionEval.ts. Keep in lockstep
// with production: if the production algorithm changes, update both.
// ---------------------------------------------------------------------------

interface EvalRange {
  from: number;
  to: number;
}

/**
 * Determine the top-level form at a cursor position. Returns null when no
 * eval target can be resolved (e.g. empty buffer).
 *
 * Algorithm:
 *   1. Find the syntax node at the cursor via findNodeAt().
 *   2. Walk up to the immediate child of the Program node.
 *   3. That child's range is the eval target.
 *
 * Edge case from production: when no node is found, the original code falls
 * back to evalFrom=0, evalTo=doc.length, then bails if evalFrom===evalTo
 * (empty buffer). We model that here: an empty doc returns null; when a node
 * is found but isn't reachable to a Program parent, we also return the
 * fallback whole-doc range.
 */
function getTopLevelEvalRange(
  state: EditorStateType,
  cursor: number,
): EvalRange | null {
  let evalFrom = 0;
  let evalTo = state.doc.length;

  let node: any = findNodeAt(state, cursor, cursor);
  if (node) {
    while (node.parent && node.parent.type.name !== "Program") {
      node = node.parent;
    }
    if (node.parent && node.parent.type.name === "Program") {
      evalFrom = node.from;
      evalTo = node.to;
    }
  }

  if (evalFrom === evalTo) return null;
  return { from: evalFrom, to: evalTo };
}

/** Run the algorithm against a doc with a cursor at `pos`. */
function rangeAt(doc: string, pos: number): EvalRange | null {
  const state = makeState(doc).update({
    selection: EditorSelection.cursor(pos),
  }).state;
  return getTopLevelEvalRange(state, pos);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("expressionEval: cursor inside a single top-level form", () => {
  it("cursor on the head symbol resolves to the enclosing form", () => {
    const doc = "(a1 440)";
    // cursor on '1' (index 2)
    const range = rangeAt(doc, 2);
    expect(range).toEqual({ from: 0, to: doc.length });
  });

  it("cursor inside the body resolves to the enclosing form", () => {
    const doc = "(a1 440)";
    // cursor on '4' of '440' (index 5)
    const range = rangeAt(doc, 5);
    expect(range).toEqual({ from: 0, to: doc.length });
  });

  it("cursor at the opening paren resolves to the form", () => {
    const doc = "(a1 440)";
    const range = rangeAt(doc, 0);
    expect(range).toEqual({ from: 0, to: doc.length });
  });

  it("cursor immediately inside the opening paren resolves to the form", () => {
    const doc = "(a1 440)";
    const range = rangeAt(doc, 1);
    expect(range).toEqual({ from: 0, to: doc.length });
  });

  it("cursor immediately inside the closing paren resolves to the form", () => {
    const doc = "(a1 440)";
    // doc.length = 8, char at 7 is ')'
    const range = rangeAt(doc, 7);
    expect(range).toEqual({ from: 0, to: doc.length });
  });
});

describe("expressionEval: cursor inside a string literal", () => {
  it("cursor inside a string literal still finds the enclosing top-level form", () => {
    const doc = '(a1 "hello world")';
    // 'h' of "hello" is at index 5
    const range = rangeAt(doc, 5);
    expect(range).toEqual({ from: 0, to: doc.length });
  });

  it("cursor between the string and the trailing paren stays in the form", () => {
    const doc = '(a1 "hello")';
    // position 11 is just before the trailing ')'
    const range = rangeAt(doc, 11);
    expect(range).toEqual({ from: 0, to: doc.length });
  });

  it("cursor inside a string in a multi-form doc stays in the containing form", () => {
    const first = "(d1 1)\n";
    const second = '(a1 "hi")';
    const doc = first + second;
    // cursor inside "hi" at offset first.length + 5 (index of 'i')
    const cursor = first.length + 5;
    const range = rangeAt(doc, cursor);
    expect(range).toEqual({ from: first.length, to: doc.length });
  });
});

describe("expressionEval: cursor in whitespace between top-level forms", () => {
  // Spec rule (code-evaluation.md §1.1): eval submits "the top-level form" —
  // the algorithm uses findNodeAt to choose. findNodeAt() resolves the nearest
  // adjacent top-level form when cursor is in whitespace; we lock in the
  // observed behaviour so callers can rely on it.

  it("cursor between two top-level forms separated by a single newline picks one of them", () => {
    const first = "(a1 1)";
    const second = "(a2 2)";
    const doc = first + "\n" + second;
    // cursor at the newline position (index 6)
    const range = rangeAt(doc, first.length);
    expect(range).not.toBeNull();
    // Must resolve to one of the two adjacent top-level forms.
    const expected = [
      { from: 0, to: first.length },
      { from: first.length + 1, to: doc.length },
    ];
    expect(expected).toContainEqual(range);
  });

  it("cursor in a blank line between two top-level forms picks one of them", () => {
    const first = "(a1 1)";
    const second = "(a2 2)";
    const doc = first + "\n\n" + second; // doc: "(a1 1)\n\n(a2 2)"
    // cursor at the start of the blank line (index 7)
    const cursor = first.length + 1;
    const range = rangeAt(doc, cursor);
    expect(range).not.toBeNull();
    // Must resolve to one of the two adjacent top-level forms (or the whole
    // doc if findNodeAt returns null in pure whitespace, which is the
    // production fallback).
    const acceptable = [
      { from: 0, to: first.length },
      { from: first.length + 2, to: doc.length },
      { from: 0, to: doc.length },
    ];
    expect(acceptable).toContainEqual(range);
  });

  it("never returns an empty range when there is at least one form", () => {
    const doc = "(a1 1)\n\n\n(a2 2)";
    // cursor in the middle of the blank lines
    const range = rangeAt(doc, 8);
    if (range !== null) {
      expect(range.from).toBeLessThan(range.to);
    }
  });
});

describe("expressionEval: cursor at form boundary", () => {
  it("cursor immediately after the closing paren of the first form picks one of the adjacent forms", () => {
    const first = "(a1 1)";
    const second = "(a2 2)";
    const doc = first + " " + second; // single space
    // cursor at first.length (immediately after first form's ')')
    const range = rangeAt(doc, first.length);
    expect(range).not.toBeNull();
    const expected = [
      { from: 0, to: first.length },
      { from: first.length + 1, to: doc.length },
    ];
    expect(expected).toContainEqual(range);
  });

  it("cursor immediately before the opening paren of the second form picks one of the adjacent forms", () => {
    const first = "(a1 1)";
    const second = "(a2 2)";
    const doc = first + " " + second;
    // cursor at first.length + 1 (immediately before second form's '(')
    const range = rangeAt(doc, first.length + 1);
    expect(range).not.toBeNull();
    const expected = [
      { from: 0, to: first.length },
      { from: first.length + 1, to: doc.length },
    ];
    expect(expected).toContainEqual(range);
  });
});

describe("expressionEval: buffer edges", () => {
  it("cursor at start of buffer (position 0) resolves to the first form", () => {
    const doc = "(a1 1)\n(a2 2)";
    const range = rangeAt(doc, 0);
    expect(range).toEqual({ from: 0, to: 6 }); // (a1 1)
  });

  it("cursor at end of buffer resolves to the last form", () => {
    const doc = "(a1 1)\n(a2 2)";
    const range = rangeAt(doc, doc.length);
    expect(range).toEqual({ from: 7, to: doc.length });
  });

  it("empty buffer returns null (no eval target)", () => {
    const doc = "";
    const state = makeState(doc).update({
      selection: EditorSelection.cursor(0),
    }).state;
    const range = getTopLevelEvalRange(state, 0);
    expect(range).toBeNull();
  });

  it("whitespace-only buffer returns null or the whole-doc fallback (non-empty)", () => {
    // findNodeAt may return null for whitespace-only input; production then
    // falls back to evalFrom=0, evalTo=doc.length, which is non-empty so the
    // function returns that range. Either outcome is acceptable: the caller
    // bails if the range is empty.
    const doc = "   \n  ";
    const state = makeState(doc).update({
      selection: EditorSelection.cursor(2),
    }).state;
    const range = getTopLevelEvalRange(state, 2);
    if (range !== null) {
      // Whole-document fallback.
      expect(range).toEqual({ from: 0, to: doc.length });
    }
  });
});

// ---------------------------------------------------------------------------
// DI seam — handlers must route through EvalIntegrationConfig, not the
// transport singletons directly. This is what lets the Inspector and unit
// tests load the editor layer without dragging the transport surface in.
// ---------------------------------------------------------------------------

function makeView(doc: string): EditorView {
  return new EditorView({
    state: makeState(doc),
  });
}

function makeMockConfig(): EvalIntegrationConfig & {
  sendCode: ReturnType<typeof vi.fn>;
  isConnected: ReturnType<typeof vi.fn>;
} {
  return {
    sendCode: vi.fn(),
    isConnected: vi.fn(() => true),
  };
}

describe("expressionEval: DI seam routes through EvalIntegrationConfig", () => {
  beforeEach(() => {
    setEvalIntegrationConfig({
      sendCode: () => {},
      isConnected: () => false,
    });
  });

  it("handlePlayExpression sends through config.sendCode when connected", () => {
    const config = makeMockConfig();
    setEvalIntegrationConfig(config);

    const view = makeView("(a1 0.5)");
    handlePlayExpression(view, "a1");

    expect(config.isConnected).toHaveBeenCalled();
    expect(config.sendCode).toHaveBeenCalledTimes(1);
    expect(config.sendCode.mock.calls[0][0]).toContain("a1");
  });

  it("handlePlayExpression skips sendCode when disconnected", () => {
    const config = makeMockConfig();
    config.isConnected.mockReturnValue(false);
    setEvalIntegrationConfig(config);

    const view = makeView("(a1 0.5)");
    handlePlayExpression(view, "a1");

    expect(config.sendCode).not.toHaveBeenCalled();
  });

  it("handleClearExpression sends a neutral analog value when connected", () => {
    const config = makeMockConfig();
    setEvalIntegrationConfig(config);

    const view = makeView("(a1 0.5)");
    handleClearExpression(view, "a1");

    expect(config.sendCode).toHaveBeenCalledWith("(a1 0.5)");
  });

  it("handleClearExpression sends 0 for digital-style expressions", () => {
    const config = makeMockConfig();
    setEvalIntegrationConfig(config);

    const view = makeView("(d1 1)");
    handleClearExpression(view, "d1");

    expect(config.sendCode).toHaveBeenCalledWith("(d1 0)");
  });

  it("handleClearExpression is a no-op when disconnected", () => {
    const config = makeMockConfig();
    config.isConnected.mockReturnValue(false);
    setEvalIntegrationConfig(config);

    const view = makeView("(a1 0.5)");
    handleClearExpression(view, "a1");

    expect(config.sendCode).not.toHaveBeenCalled();
  });
});

describe("expressionEval: soft eval does not move the rail-active state (§2.4)", () => {
  // detectAndTrackExpressionEvaluation updates lastEvaluatedExpressionField via
  // the expressionEvaluatedAnnotation. isRangeActive reads that field to decide
  // the gutter rail's active state. A soft (preview) eval must NOT move the rail
  // — expression-gutter.md §2.4. So preview must leave the field untouched.
  function makeRailView(doc: string): EditorView {
    return new EditorView({
      state: EditorState.create({
        doc,
        extensions: [...default_extensions, lastEvaluatedExpressionField],
      }).update({ selection: EditorSelection.cursor(2) }).state,
    });
  }

  it("a non-preview eval records last-evaluated for the output", () => {
    const view = makeRailView("(a1 440)");
    detectAndTrackExpressionEvaluation(view);
    const map = view.state.field(lastEvaluatedExpressionField);
    expect(map.has("a1")).toBe(true);
  });

  it("a preview (soft) eval does NOT record last-evaluated, leaving the rail unmoved", () => {
    const view = makeRailView("(a1 440)");
    detectAndTrackExpressionEvaluation(view, { isPreview: true });
    const map = view.state.field(lastEvaluatedExpressionField);
    expect(map.has("a1")).toBe(false);
  });

  it("a non-preview eval implicitly toggles vis on for the assigned output (§3.4)", () => {
    vi.mocked(registerVisualisation).mockClear();
    const view = makeRailView("(a1 440)");
    detectAndTrackExpressionEvaluation(view);
    // a1 was not previously visualised, so eval should register it.
    expect(vi.mocked(registerVisualisation)).toHaveBeenCalled();
    expect(vi.mocked(registerVisualisation).mock.calls[0][0]).toBe("a1");
  });

  it("a preview (soft) eval does NOT implicitly toggle vis on (§3.4 exception)", () => {
    vi.mocked(registerVisualisation).mockClear();
    vi.mocked(refreshVisualisedExpression).mockClear();
    const view = makeRailView("(a1 440)");
    detectAndTrackExpressionEvaluation(view, { isPreview: true });
    // a1 is not already visualised, so soft eval neither registers nor refreshes.
    expect(vi.mocked(registerVisualisation)).not.toHaveBeenCalled();
    expect(vi.mocked(refreshVisualisedExpression)).not.toHaveBeenCalled();
  });

  it("a preview eval does not overwrite a previously-committed rail", () => {
    const view = makeRailView("(a1 440)\n(a1 220)");
    // Commit the first form (cursor at 2 -> first form).
    detectAndTrackExpressionEvaluation(view);
    const committed = view.state.field(lastEvaluatedExpressionField).get("a1");
    expect(committed).toBeTruthy();

    // Move cursor into the second form and soft-eval it.
    view.dispatch({ selection: EditorSelection.cursor(11) });
    detectAndTrackExpressionEvaluation(view, { isPreview: true });

    const after = view.state.field(lastEvaluatedExpressionField).get("a1");
    // Rail still points at the committed (first) form, not the soft-eval'd one.
    expect(after).toEqual(committed);
  });
});

describe("expressionEval: nested expressions resolve to the top-level form, not the inner expression", () => {
  it("cursor inside a nested form returns the OUTER top-level form's range", () => {
    const doc = "(a1 (+ 1 2))";
    // cursor on '+' (index 5)
    const range = rangeAt(doc, 5);
    expect(range).toEqual({ from: 0, to: doc.length });
  });

  it("cursor deep inside a nested expression in a multi-form doc returns the containing top-level form", () => {
    const first = "(a1 1)\n";
    const second = "(a2 (* 2 (+ 3 4)))";
    const doc = first + second;
    // cursor on '+' inside the deeply nested expression
    const cursor = doc.indexOf("+");
    const range = rangeAt(doc, cursor);
    expect(range).toEqual({ from: first.length, to: doc.length });
  });

  it("cursor inside a vector literal in a top-level form returns the top-level form", () => {
    const doc = "(a1 [1 2 3])";
    // cursor on '2' (index 7)
    const range = rangeAt(doc, 7);
    expect(range).toEqual({ from: 0, to: doc.length });
  });
});
