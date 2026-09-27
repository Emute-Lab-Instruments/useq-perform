/**
 * Regression tests for two editor-eval errata:
 *
 * 1. eval-r-legacy-success case 3 (code-evaluation.md §1.2.1) — a hardware
 *    leg that resolved with success:false (device rejection, or the
 *    not-connected envelope) is NOT delivery: it must not lift §4.4
 *    binding soft-preview state. Only a fulfilled success hardware reply
 *    lifts the preview.
 *
 * 2. eval-r-silent-noop (runtime-modes.md §1.10) — a normal eval whose
 *    outcome has NEITHER leg (e.g. wasm mode while the Worker runtime is
 *    still loading, so `capabilities().available` is false) must be
 *    surfaced with a user-visible warning, never silently dropped.
 *    Hardware-only evals (hardware leg carried the eval) stay silent.
 */

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
  dispatchRuntimeCodeEvaluation: vi.fn(async () => {
    if (mockDispatchOverride.next) {
      const result = mockDispatchOverride.next;
      mockDispatchOverride.next = null;
      return result;
    }
    return {
      session: { transportMode: "both" },
      wasm: { status: "fulfilled", value: await mockEvalCodeWithDiagnostics("(a1 1)") },
      hardware: { status: "fulfilled", value: await mockSendTouSEQ("@(a1 1)") },
      diagnosticAuthority: "hardware",
    };
  }),
}));
const mockDispatchInlineResult = vi.hoisted(() => vi.fn());
const mockPost = vi.hoisted(() => vi.fn());
const mockReadLastDiagnostics = vi.hoisted(() => vi.fn(() => []));

vi.mock("@nextjournal/clojure-mode/extensions/eval-region", () => ({
  // The toplevel payload falls back to this when the test view has no
  // clojure syntax tree, so it fully controls the visible slice under test.
  top_level_string: (_state: unknown) => "(on-press :sw1 (a1 1))",
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
  detectAndTrackExpressionEvaluation: vi.fn(),
}));

vi.mock("../editors/extensions/inlineResults.ts", () => ({
  dispatchInlineResult: mockDispatchInlineResult,
}));

vi.mock("../utils/outputHealthStore.ts", () => ({
  markOutputRunning: vi.fn(),
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
import {
  bindingKeysInText,
  markBindingsSoftPreview,
  clearBindingsSoftPreview,
  isBindingSoftPreview,
} from "./hardwareBindingDispatcher.ts";
import { evalHighlightField } from "../editors/extensions/evalHighlight.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createView(doc = "(on-press :sw1 (a1 1))"): EditorView {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [evalHighlightField],
    }),
  });
}

/** Drain the microtask queue so fire-and-forget outcome handlers settle. */
async function flushMicrotasks(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await Promise.resolve();
  }
}

const BINDING_TEXT = "(on-press :sw1 (a1 1))";
const keys = () => bindingKeysInText(BINDING_TEXT);

// ---------------------------------------------------------------------------
// 1. §1.2.1 — failed hardware delivery must not lift binding previews
// ---------------------------------------------------------------------------

describe("binding soft-preview lift on hardware delivery", () => {
  let view: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    view = createView();
    markBindingsSoftPreview(keys());
  });

  afterEach(() => {
    clearBindingsSoftPreview(keys());
    view.destroy();
    document.body.innerHTML = "";
  });

  it("does NOT lift the preview when the hardware leg replies success:false", async () => {
    mockDispatchOverride.next = {
      session: { transportMode: "both" },
      wasm: {
        status: "fulfilled",
        value: { result: "42", diagnostics: [], synthArtifacts: null },
      },
      hardware: {
        status: "fulfilled",
        value: { success: false, result: null, diagnostics: [], error: "uSEQ not connected" },
      },
      diagnosticAuthority: "hardware",
    };

    evaluate(view, "toplevel");
    await flushMicrotasks();

    expect(isBindingSoftPreview(keys()[0])).toBe(true);
  });

  it("lifts the preview when the hardware leg replies success:true", async () => {
    mockDispatchOverride.next = {
      session: { transportMode: "both" },
      wasm: {
        status: "fulfilled",
        value: { result: "42", diagnostics: [], synthArtifacts: null },
      },
      hardware: {
        status: "fulfilled",
        value: { success: true, result: "42", diagnostics: [] },
      },
      diagnosticAuthority: "hardware",
    };

    evaluate(view, "toplevel");
    await flushMicrotasks();

    expect(isBindingSoftPreview(keys()[0])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. §1.10 — an eval with neither leg must not be silently dropped
// ---------------------------------------------------------------------------

describe("leg-less eval feedback", () => {
  let view: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    view = createView();
  });

  afterEach(() => {
    view.destroy();
    document.body.innerHTML = "";
  });

  it("posts the not-ready warning when a normal eval has NEITHER leg", async () => {
    mockDispatchOverride.next = {
      // Wasm mode with the Worker not yet loaded: capabilities().available
      // is false, so the dispatcher resolves both legs null.
      session: { transportMode: "wasm" },
      wasm: null,
      hardware: null,
      diagnosticAuthority: null,
    };

    evaluate(view, "toplevel");
    await flushMicrotasks();

    expect(mockPost).toHaveBeenCalledWith(
      "WASM runtime not ready — eval was not delivered",
      "warn",
    );
  });

  it("stays silent for a hardware-only normal eval (hardware leg carried it)", async () => {
    mockDispatchOverride.next = {
      session: { transportMode: "hardware" },
      wasm: null,
      hardware: {
        status: "fulfilled",
        value: { success: true, result: "42", diagnostics: [] },
      },
      diagnosticAuthority: "hardware",
    };

    evaluate(view, "toplevel");
    await flushMicrotasks();

    expect(mockPost).not.toHaveBeenCalledWith(
      "WASM runtime not ready — eval was not delivered",
      "warn",
    );
  });
});
