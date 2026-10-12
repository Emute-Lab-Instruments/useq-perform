import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { default_extensions } from "@nextjournal/clojure-mode";

const vis = vi.hoisted(() => ({
  toggle: vi.fn(async () => {}),
  register: vi.fn(async () => {}),
  refresh: vi.fn(async () => {}),
  isVisualised: vi.fn(() => false),
  notifyEvaluated: vi.fn(),
}));
vi.mock("../../effects/visualisationSession.ts", () => ({
  visualisationSession: { expressions: vis },
}));
vi.mock("../../ui/adapters/visualisationPanel", () => ({
  showVisualisationPanel: vi.fn(),
}));

import { createExpressionGutter, type GutterConfig } from "./expressionHighlights.ts";
import { lastEvaluatedExpressionField } from "./expressionEvalState.ts";
import {
  detectAndTrackExpressionEvaluation,
  handlePlayExpression,
  handleToggleVisAtHalo,
  setEvalIntegrationConfig,
} from "./expressionEval.ts";

const views: EditorView[] = [];
function makeView(doc: string, override: Partial<GutterConfig> = {}) {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [
        ...default_extensions,
        lastEvaluatedExpressionField,
        ...createExpressionGutter({
          isGutterEnabled: () => true,
          isClearButtonEnabled: () => true,
          isLastTrackingEnabled: () => true,
          getExpressionColor: () => "#ff0000",
          isVisualised: vis.isVisualised,
          isFailing: () => false,
          reportColor: () => {},
          onPlayExpression: handlePlayExpression,
          onExternalChange: () => () => {},
          ...override,
        }),
      ],
    }),
  });
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  vi.clearAllMocks();
});

describe("editor visualization controls", () => {
  it("clicking a later variant previews that exact form without sending hardware code", () => {
    const sendCode = vi.fn(async () => {});
    setEvalIntegrationConfig({ sendCode, isConnected: () => true });
    const doc = "(a1 0.1)\n(a1\n  0.9)";
    const view = makeView(doc);
    const buttons = view.dom.querySelectorAll<HTMLElement>(".cm-expr-play-btn");
    expect(buttons).toHaveLength(2);
    buttons[1]!.click();
    expect(vis.toggle).toHaveBeenCalledWith("a1", "(a1\n  0.9)", { from: 9, to: doc.length });
    expect(sendCode).not.toHaveBeenCalled();
  });

  it("gutter and halo action compare the same source offsets", () => {
    const doc = "; intro\n(a1\n  0.5)";
    const view = makeView(doc);
    const position = { from: doc.indexOf("("), to: doc.length };
    expect(vis.isVisualised).toHaveBeenCalledWith("a1", position);
    view.dispatch({ selection: { anchor: doc.indexOf("0.5") } });
    expect(handleToggleVisAtHalo(view)).toBe(true);
    expect(vis.toggle).toHaveBeenCalledWith("a1", "(a1\n  0.5)", position);
  });

  it("evaluating the second variant registers its text and exact multiline range", () => {
    const doc = "(a1 0.1)\n(a1\n  0.9)";
    const view = makeView(doc);
    view.dispatch({ selection: { anchor: doc.indexOf("0.9") } });
    detectAndTrackExpressionEvaluation(view);
    expect(vis.register).toHaveBeenCalledWith("a1", "(a1\n  0.9)", { from: 9, to: doc.length });
  });

  it("tracks all outputs in a do block using the whole evaluated range", () => {
    const doc = "(do\n (a1 0.1)\n (a1 0.9)\n (d1 1))";
    const view = makeView(doc);
    view.dispatch({ selection: { anchor: doc.indexOf("0.9") } });
    detectAndTrackExpressionEvaluation(view);
    const position = { from: 0, to: doc.length };
    expect(vis.register).toHaveBeenCalledWith("a1", doc, position);
    expect(vis.register).toHaveBeenCalledWith("d1", doc, position);
    expect(vis.register).toHaveBeenCalledTimes(2);
  });

  it.each([
    "; (a1 0.5)",
    '"(a1 0.5)"',
    "(+ a1 1)",
    "(a1)",
    "(a1 0.5",
    "'(a1 0.5)",
    "(define foo (lambda [] (a1 0.5)))",
    "(a1 ($ value :number))",
  ])("does not offer a visualization button for non-assigning source: %s", (doc) => {
    const view = makeView(doc);
    expect(view.dom.querySelector(".cm-expr-play-btn")).toBeNull();
    view.dispatch({ selection: { anchor: Math.min(2, doc.length) } });
    detectAndTrackExpressionEvaluation(view);
    expect(vis.register).not.toHaveBeenCalled();
  });
});
