/**
 * Regression test for [CF2]: hardware/'both'-mode eval diagnostics must drive
 * inline lint.
 *
 * diagnostics.md §5.3: the diagnostic data model is IDENTICAL on both targets.
 * The hardware eval path (`sendTouSEQ` → `sendJsonEval`) returns a `JsonResponse`
 * carrying a §5.7 `diagnostics` array. Before the fix, that array was discarded
 * — `sendTouSEQ` was called fire-and-forget — so a diagnostic that only hardware
 * produces (or any diagnostic when the WASM shadow is disabled) never reached
 * the editor's inline annotations.
 *
 * These tests pin the contract: when the module response carries diagnostics,
 * they are pushed to the editor with the SAME document offsets the WASM path
 * uses.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { UseqDiagnostic } from "../runtime/wasmInterpreter.ts";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

// WASM shadow produces no diagnostics — only the hardware path does, so any
// pushed diagnostic in these tests must have come from the module response.
const mockEvalCodeWithDiagnostics = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ result: "ok", diagnostics: [] as unknown[] })),
);

// The module-send response the test crafts. `sendTouSEQ` resolves with it.
const sendResponseRef = vi.hoisted(() => ({
  current: { success: true } as { success: boolean; diagnostics?: unknown[] },
}));
const mockSendTouSEQ = vi.hoisted(() =>
  vi.fn(() => Promise.resolve(sendResponseRefInner.current)),
);
const sendResponseRefInner = sendResponseRef;

const mockPushDiagnostics = vi.hoisted(() => vi.fn());
const mockClearDiagnosticsForRange = vi.hoisted(() => vi.fn());

vi.mock("@nextjournal/clojure-mode/extensions/eval-region", () => ({
  top_level_string: () => "(a1 bad)",
}));

vi.mock("../runtime/activeWasmRuntimePort.ts", () => ({
  getActiveWasmRuntimePort: () => ({
    evalCode: vi.fn(() => Promise.resolve("ok")),
    evalCodeWithDiagnostics: mockEvalCodeWithDiagnostics,
    readLastDiagnostics: vi.fn(() => []),
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
  dispatchInlineResult: vi.fn(),
}));

vi.mock("../utils/outputHealthStore.ts", () => ({
  markOutputRunning: vi.fn(),
}));

vi.mock("../utils/consoleStore.ts", () => ({
  post: vi.fn(),
}));

vi.mock("../editors/extensions/diagnostics.ts", () => ({
  pushDiagnostics: mockPushDiagnostics,
  clearDiagnosticsForRange: mockClearDiagnosticsForRange,
  diagnosticField: { create: () => [] },
}));

vi.mock("../lib/manualControlState.ts", () => ({
  rewriteCodeSliceForModule: (code: string) => code,
  getAllManualControlBindings: () => [],
  mapManualControlBindingsThroughChanges: vi.fn(),
}));

vi.mock("../editors/extensions/evalHighlight.ts", () => ({
  flashEvalHighlight: vi.fn(),
}));

vi.mock("./liveEditRuntime.ts", () => ({
  discoverSlotsAfterEval: vi.fn(() => Promise.resolve()),
  runBootReconciliation: vi.fn(),
}));

// noModuleMode: false ⇒ a real (hardware/'both') eval reaches the module.
vi.mock("../runtime/startupContext.ts", () => ({
  getStartupFlagsSnapshot: () => ({ noModuleMode: false, devmode: false }),
}));

vi.mock("../lib/holeDetection.ts", () => ({
  findHolePositions: () => [],
  findHoleEnd: () => 0,
}));

vi.mock("./hardwareBindingDispatcher.ts", () => ({
  bindingKeysInText: () => [],
  markBindingsSoftPreview: vi.fn(),
  clearBindingsSoftPreview: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports of code under test (after mocks)
// ---------------------------------------------------------------------------

const { evaluate } = await import("./editorEvaluation.ts");

function createView(doc: string): EditorView {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({ doc }),
  });
}

async function flushMicrotasks(): Promise<void> {
  // Both the WASM-eval chain (which calls clearDiagnosticsForRange) and the
  // module-send chain (which calls applyHardwareDiagnostics) settle across
  // several microtask turns; drain a few macrotasks to let all settle.
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("[CF2] hardware eval diagnostics drive inline lint", () => {
  let view: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    sendResponseRef.current = { success: true };
  });

  afterEach(() => {
    view?.destroy();
    document.body.innerHTML = "";
  });

  it("pushes diagnostics carried by the module eval response to the editor", async () => {
    const doc = "(a1 bad)";
    view = createView(doc);
    // cursor inside the single top-level form
    view.dispatch({ selection: { anchor: 1 } });

    const hwDiag: UseqDiagnostic = {
      start: 4,
      end: 7,
      severity: "error",
      message: "hardware: unknown symbol",
    };
    sendResponseRef.current = { success: true, diagnostics: [hwDiag] };

    const handled = evaluate(view, "toplevel");
    expect(handled).toBe(true);

    await flushMicrotasks();

    // The hardware diagnostics must have reached pushDiagnostics. With the
    // unified payload builder installed, diagnostics are remapped through
    // the source map (state-identity.md §7.5) so they carry the same
    // visible offsets but are a fresh array (not the raw module response).
    // Match by message content rather than by reference.
    const hwCall = mockPushDiagnostics.mock.calls.find(
      (c) =>
        Array.isArray(c[1]) &&
        c[1].some(
          (d: unknown) =>
            (d as { message?: string }).message === "hardware: unknown symbol",
        ),
    );
    expect(hwCall, "hardware diagnostics never reached pushDiagnostics").toBeTruthy();

    // The remapped diagnostic should carry the SAME visible offsets the
    // WASM path uses (rangeFrom, rangeTo). Because this test has no
    // stateful forms, the source map degenerates to an identity map and
    // runtime offsets equal visible offsets plus sliceFrom (=0).
    const hwDiags: UseqDiagnostic[] = hwCall![1] as UseqDiagnostic[];
    expect(hwDiags).toHaveLength(1);
    expect(hwDiags[0]!.start).toBe(4);
    expect(hwDiags[0]!.end).toBe(7);

    // The WASM shadow returned [] this eval, so it called
    // clearDiagnosticsForRange(view, from, to) with the canonical
    // (rangeFrom, rangeTo). Assert the hardware push used exactly those
    // same (rangeFrom, rangeTo) bounds. This is the §5.3 "identical on
    // both targets" contract.
    expect(mockClearDiagnosticsForRange).toHaveBeenCalled();
    const [, wasmFrom, wasmTo] = mockClearDiagnosticsForRange.mock.calls[0];
    // args: (view, diagnostics, docOffset=0 [already remapped], rangeFrom, rangeTo)
    expect(hwCall![2]).toBe(0); // docOffset: remap already incorporated sliceFrom
    expect(hwCall![3]).toBe(wasmFrom); // rangeFrom matches WASM
    expect(hwCall![4]).toBe(wasmTo); // rangeTo matches WASM
  });

  it("does not push when the module response carries no diagnostics", async () => {
    const doc = "(a1 1)";
    view = createView(doc);
    view.dispatch({ selection: { anchor: 1 } });

    sendResponseRef.current = { success: true, diagnostics: [] };

    evaluate(view, "toplevel");
    await flushMicrotasks();

    // WASM shadow returned [] and module returned [] — pushDiagnostics for the
    // hardware path must not fire with a non-empty array.
    const pushedNonEmpty = mockPushDiagnostics.mock.calls.some(
      (c) => Array.isArray(c[1]) && c[1].length > 0,
    );
    expect(pushedNonEmpty).toBe(false);
  });

  it("tolerates a missing diagnostics field on the response", async () => {
    const doc = "(a1 1)";
    view = createView(doc);
    view.dispatch({ selection: { anchor: 1 } });

    sendResponseRef.current = { success: true }; // no diagnostics key

    expect(() => evaluate(view, "toplevel")).not.toThrow();
    await flushMicrotasks();

    const pushedNonEmpty = mockPushDiagnostics.mock.calls.some(
      (c) => Array.isArray(c[1]) && c[1].length > 0,
    );
    expect(pushedNonEmpty).toBe(false);
  });
});
