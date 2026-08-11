/**
 * Regression test for the per-view eval-sequence guard.
 *
 * Spec: code-evaluation.md §1.10 — "one in-flight eval per editor; a
 * slow eval cannot misattribute its output to a later eval."
 *
 * Scenario this guards against: two evals dispatched on the same view in
 * quick succession. If the first eval's response arrives AFTER the second
 * eval's response (a "slow A, fast B" race), the first eval's `.then`
 * would otherwise apply A's stale diagnostics / inline result over B's
 * fresh ones. The guard drops A's effects when B is already known to be
 * the latest dispatched eval.
 *
 * Today's worker/in-process transports happen to be FIFO so the race
 * doesn't surface — but this guard makes correctness independent of
 * transport ordering, in line with the spec.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./noneModeGate.ts", () => ({
  evalRejectionForNoRuntime: () => null,
}));
vi.mock("../runtime/runtimeCompatibility.ts", () => ({
  shouldUseWasmShadow: () => true,
}));
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

interface PendingEval {
  code: string;
  resolve: (value: { result: string | null; diagnostics: unknown[] }) => void;
}

const pending: PendingEval[] = [];

const mockEvalCodeWithDiagnostics = vi.hoisted(() => {
  // Each call captures the eval's resolver into a shared queue so the
  // test can drain them in arbitrary order.
  return vi.fn((code: string) => {
    return new Promise<{ result: string | null; diagnostics: unknown[] }>(
      (resolve) => {
        pendingRef.current.push({ code, resolve });
      },
    );
  });
});

// Indirection so `pending` is shared between hoisted mock and test.
const pendingRef = vi.hoisted(() => ({ current: [] as PendingEval[] }));
// expose the hoisted ref under our local name above
// (vi.hoisted ensures the closure capture is set up correctly before module
// imports evaluate)
Object.defineProperty(globalThis, "__evalSeqPending", {
  value: pendingRef,
  configurable: true,
});

const mockEvalCode = vi.hoisted(() => vi.fn(() => Promise.resolve("42")));
const mockSendTouSEQ = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const mockPushDiagnostics = vi.hoisted(() => vi.fn());
const mockClearDiagnosticsForRange = vi.hoisted(() => vi.fn());
const mockDispatchInlineResult = vi.hoisted(() => vi.fn());
const mockMarkOutputRunning = vi.hoisted(() => vi.fn());

vi.mock("@nextjournal/clojure-mode/extensions/eval-region", () => ({
  top_level_string: () => "(a1 1)",
}));

vi.mock("../runtime/activeWasmRuntimePort.ts", () => ({
  getActiveWasmRuntimePort: () => ({
    evalCode: mockEvalCode,
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
  dispatchInlineResult: mockDispatchInlineResult,
}));

vi.mock("../utils/outputHealthStore.ts", () => ({
  markOutputRunning: mockMarkOutputRunning,
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

vi.mock("../runtime/startupContext.ts", () => ({
  getStartupFlagsSnapshot: () => ({ noModuleMode: true, devmode: false }),
}));

vi.mock("../lib/holeDetection.ts", () => ({
  findHolePositions: () => [],
  findHoleEnd: () => 0,
}));

// ---------------------------------------------------------------------------
// Imports of code under test (after mocks)
// ---------------------------------------------------------------------------

const { evaluate } = await import("./editorEvaluation.ts");

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createView(): EditorView {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({ doc: "(a1 1)" }),
  });
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("per-view eval-sequence guard", () => {
  let view: EditorView;

  beforeEach(() => {
    pendingRef.current.length = 0;
    vi.clearAllMocks();
    view = createView();
  });

  afterEach(() => {
    view.destroy();
    document.body.innerHTML = "";
  });

  it("drops a stale eval's results when a later eval is in flight", async () => {
    const aDiag = {
      start: 0,
      end: 6,
      severity: "error" as const,
      message: "A error (stale)",
    };
    const bDiag = {
      start: 0,
      end: 6,
      severity: "warning" as const,
      message: "B warning (fresh)",
    };

    // Dispatch A, then B. Both go through evaluateSoft -> evalWasm.
    evaluate(view, "soft");
    await flushMicrotasks(); // let A reach the await
    evaluate(view, "soft");
    await flushMicrotasks(); // let B reach the await

    expect(pendingRef.current).toHaveLength(2);

    // Resolve B FIRST (out of dispatch order). A is still pending.
    pendingRef.current[1].resolve({ result: "B-result", diagnostics: [bDiag] });
    await flushMicrotasks();

    // Now resolve A — its .then should detect that the view's seq has
    // advanced past it and skip every editor-state mutation.
    pendingRef.current[0].resolve({ result: "A-result", diagnostics: [aDiag] });
    await flushMicrotasks();

    // Verify: only B's diagnostics ever reached pushDiagnostics.
    const pushCalls = mockPushDiagnostics.mock.calls;
    expect(pushCalls.length).toBeGreaterThanOrEqual(1);
    const pushedDiags = pushCalls.flatMap((call) => call[1] as unknown[]);
    expect(pushedDiags).toContainEqual(bDiag);
    expect(pushedDiags).not.toContainEqual(aDiag);

    // Verify: the inline-result dispatch did not show A's stale text.
    const inlineCalls = mockDispatchInlineResult.mock.calls;
    const inlineTexts = inlineCalls.map((call) => call[1]);
    expect(inlineTexts).not.toContain("A-result");
  });

  it("a single eval still applies its results normally (guard does not over-fire)", async () => {
    const diag = {
      start: 0,
      end: 6,
      severity: "warning" as const,
      message: "lone warning",
    };

    evaluate(view, "soft");
    await flushMicrotasks();
    expect(pendingRef.current).toHaveLength(1);

    pendingRef.current[0].resolve({ result: "lone-result", diagnostics: [diag] });
    await flushMicrotasks();

    const pushedDiags = mockPushDiagnostics.mock.calls.flatMap(
      (call) => call[1] as unknown[],
    );
    expect(pushedDiags).toContainEqual(diag);
  });

  it("the latest eval always wins regardless of resolution order (in-order)", async () => {
    const aDiag = { start: 0, end: 6, severity: "error" as const, message: "A" };
    const bDiag = { start: 0, end: 6, severity: "error" as const, message: "B" };

    evaluate(view, "soft");
    await flushMicrotasks();
    evaluate(view, "soft");
    await flushMicrotasks();

    // Resolve in dispatch order: A first, then B.
    pendingRef.current[0].resolve({ result: "A", diagnostics: [aDiag] });
    await flushMicrotasks();
    pendingRef.current[1].resolve({ result: "B", diagnostics: [bDiag] });
    await flushMicrotasks();

    // A is stale (B was dispatched after) — even though A resolved first,
    // its application is dropped because the seq counter saw B's dispatch.
    const pushedDiags = mockPushDiagnostics.mock.calls.flatMap(
      (call) => call[1] as unknown[],
    );
    expect(pushedDiags).toContainEqual(bDiag);
    expect(pushedDiags).not.toContainEqual(aDiag);
  });
});
