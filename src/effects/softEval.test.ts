import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./noneModeGate.ts", () => ({
  evalRejectionForNoRuntime: () => null,
  WASM_RUNTIME_NOT_READY_WARNING:
    "WASM runtime not ready — eval was not delivered",
}));
vi.mock("../runtime/runtimeCompatibility.ts", () => ({
  shouldUseWasmShadow: () => true,
}));
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// ---------------------------------------------------------------------------
// Hoisted mocks (must be declared before any imports that reference them)
// ---------------------------------------------------------------------------

const mockEvalCode = vi.hoisted(() => vi.fn(() => Promise.resolve("42")));
const mockEvalCodeWithDiagnostics = vi.hoisted(() =>
  vi.fn((_code: string) => Promise.resolve({ result: "42", diagnostics: [] })),
);
const mockSendTouSEQ = vi.hoisted(() => vi.fn((_code: string) => Promise.resolve()));
const mockDispatchOverride = vi.hoisted(() => ({ next: null as unknown }));

vi.mock("../runtime/runtimeCodeEvaluation.ts", () => ({
  dispatchRuntimeCodeEvaluation: vi.fn(async ({ code, wasmCode, soft = false }) => {
    if (mockDispatchOverride.next) {
      const result = mockDispatchOverride.next;
      mockDispatchOverride.next = null;
      return result;
    }
    return {
      session: { transportMode: soft ? "wasm" : "both" },
      wasm: { status: "fulfilled", value: await mockEvalCodeWithDiagnostics(wasmCode ?? code) },
      hardware: soft ? null : {
        status: "fulfilled",
        value: await mockSendTouSEQ(code),
      },
      diagnosticAuthority: soft ? "wasm" : "hardware",
    };
  }),
}));
const mockDetectAndTrack = vi.hoisted(() => vi.fn());
const mockDispatchInlineResult = vi.hoisted(() => vi.fn());
const mockMarkOutputRunning = vi.hoisted(() => vi.fn());
const mockPost = vi.hoisted(() => vi.fn());
const mockReadLastDiagnostics = vi.hoisted(() => vi.fn(() => []));

vi.mock("@nextjournal/clojure-mode/extensions/eval-region", () => ({
  top_level_string: (_state: unknown) => "(a1 1)",
}));

vi.mock("../runtime/activeWasmRuntimePort.ts", () => ({
  getActiveWasmRuntimePort: () => ({
    evalCode: mockEvalCode,
    evalCodeWithDiagnostics: mockEvalCodeWithDiagnostics,
    readLastDiagnostics: mockReadLastDiagnostics,
  }),
}));

vi.mock("../transport/json-protocol.ts", () => ({
  sendTouSEQ: mockSendTouSEQ,
  initProtocol: vi.fn(),
}));

vi.mock("../editors/extensions/expressionEval.ts", () => ({
  detectAndTrackExpressionEvaluation: mockDetectAndTrack,
}));

vi.mock("../editors/extensions/inlineResults.ts", () => ({
  dispatchInlineResult: mockDispatchInlineResult,
}));

vi.mock("../utils/outputHealthStore.ts", () => ({
  markOutputRunning: mockMarkOutputRunning,
}));

vi.mock("../utils/consoleStore.ts", () => ({
  post: mockPost,
}));

vi.mock("../runtime/wasmInterpreter.ts", () => ({
  readLastDiagnostics: mockReadLastDiagnostics,
}));

vi.mock("../editors/extensions/diagnostics.ts", () => ({
  pushDiagnostics: vi.fn(),
  clearDiagnosticsForRange: vi.fn(),
}));

vi.mock("../lib/manualControlState.ts", () => ({
  rewriteCodeSliceForModule: (code: string) => code,
  getAllManualControlBindings: () => [],
  mapManualControlBindingsThroughChanges: vi.fn(),
}));

vi.mock("../runtime/startupContext.ts", () => ({
  getStartupFlagsSnapshot: () => ({
    debug: false,
    devmode: false,
    disableWebSerial: false,
    noModuleMode: false,
    nosave: false,
    params: {},
  }),
}));

// ---------------------------------------------------------------------------
// Import the module under test (after mocks are declared)
// ---------------------------------------------------------------------------

import { evaluate } from "./editorEvaluation.ts";
import { evalHighlightEffect, evalHighlightField } from "../editors/extensions/evalHighlight.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createView(doc = "(a1 1)"): EditorView {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [evalHighlightField],
    }),
  });
}

// ---------------------------------------------------------------------------
// Case A: routing — soft eval is WASM-only, no hardware port write
// ---------------------------------------------------------------------------

describe("soft eval routing in runtime mode 'both'", () => {
  let view: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    view = createView();
  });

  afterEach(() => {
    view.destroy();
    document.body.innerHTML = "";
  });

  it("dispatches to the WASM port", async () => {
    evaluate(view, "soft");
    await vi.waitFor(() => expect(mockEvalCodeWithDiagnostics).toHaveBeenCalledOnce());
    expect(mockEvalCodeWithDiagnostics).toHaveBeenCalledWith("(a1 1)");
  });

  it("sends ZERO bytes to the hardware port", async () => {
    evaluate(view, "soft");
    await vi.waitFor(() => expect(mockEvalCodeWithDiagnostics).toHaveBeenCalledOnce());
    expect(mockSendTouSEQ).not.toHaveBeenCalled();
  });

  it("hardware port receives nothing even when WASM resolves", async () => {
    mockEvalCodeWithDiagnostics.mockResolvedValueOnce({
      result: "preview-result",
      diagnostics: [],
    });
    evaluate(view, "soft");
    await vi.waitFor(() => expect(mockEvalCodeWithDiagnostics).toHaveBeenCalledOnce());
    expect(mockSendTouSEQ).not.toHaveBeenCalled();
  });

  it("shows failure feedback when WASM is unavailable", async () => {
    mockDispatchOverride.next = {
      session: { transportMode: "hardware" },
      wasm: null,
      hardware: null,
      diagnosticAuthority: null,
    };
    evaluate(view, "soft");
    await vi.waitFor(() => expect(mockDispatchInlineResult).toHaveBeenCalledOnce());
    expect(mockDispatchInlineResult.mock.calls[0][1]).toMatch(/Soft eval unavailable/);
    expect(mockDispatchInlineResult.mock.calls[0][3]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Case B: visual — preview decoration class
// (see also useq-perform-2e4.14 for full evalHighlight coverage)
// ---------------------------------------------------------------------------

describe("evalHighlight decoration class selection", () => {
  let view: EditorView;

  beforeEach(() => {
    view = createView();
  });

  afterEach(() => {
    view.destroy();
    document.body.innerHTML = "";
  });

  it("isPreview:true produces cm-evaluated-preview decoration", () => {
    view.dispatch({
      effects: evalHighlightEffect.of({ from: 0, to: 6, isPreview: true }),
    });

    const decos = view.state.field(evalHighlightField);
    let found = false;
    decos.between(0, 6, (_from, _to, deco) => {
      if (deco.spec.class?.includes("cm-evaluated-preview")) {
        found = true;
      }
    });
    expect(found).toBe(true);
  });

  it("isPreview:false (normal eval) does NOT produce cm-evaluated-preview", () => {
    view.dispatch({
      effects: evalHighlightEffect.of({ from: 0, to: 6, isPreview: false }),
    });

    const decos = view.state.field(evalHighlightField);
    let hasPreviewClass = false;
    decos.between(0, 6, (_from, _to, deco) => {
      if (deco.spec.class?.includes("cm-evaluated-preview")) {
        hasPreviewClass = true;
      }
    });
    expect(hasPreviewClass).toBe(false);
  });

  it("isPreview:false produces cm-evaluated-code decoration", () => {
    view.dispatch({
      effects: evalHighlightEffect.of({ from: 0, to: 6, isPreview: false }),
    });

    const decos = view.state.field(evalHighlightField);
    let found = false;
    decos.between(0, 6, (_from, _to, deco) => {
      if (deco.spec.class?.includes("cm-evaluated-code")) {
        found = true;
      }
    });
    expect(found).toBe(true);
  });
});
