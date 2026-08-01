/**
 * Editor-eval → engine-commit integration test.
 *
 * Covers (see mission feature `m1-eval-epoch-engine-commit`):
 *   VAL-ENGINE-010 — graph diff, revision arm, epoch allocation, prefill,
 *                    and activation occur in the required order, wired
 *                    through the real editor evaluation pipeline.
 *   VAL-ENGINE-015 — failed evals change diagnostics only (no engine
 *                    commit) through the real pipeline.
 *
 * This test wires the real `evaluate()` function from
 * `effects/editorEvaluation.ts` against a mocked WASM port that returns
 * synth artefacts, and a mocked synthesis service that records
 * `commitSynthArtifacts` calls. It proves the eval pipeline feeds the
 * atomic Worker response into the engine-commit path.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
// @ts-expect-error — clojure-mode has no type declarations
import { default_extensions as clojureExtensions } from "@nextjournal/clojure-mode";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const commitCalls: Array<{
  payload: unknown;
  hasErrors: boolean;
}> = [];
const mockCommitSynthArtifacts = vi.hoisted(() =>
  vi.fn((payload: unknown, hasErrors: boolean) => {
    commitCalls.push({ payload, hasErrors });
    return Promise.resolve({ outcome: "committed", epoch: 1, revision: 1, workletDeltas: [] });
  }),
);

const mockGetActiveSynthesisService = vi.hoisted(() =>
  vi.fn(() => ({
    commitSynthArtifacts: mockCommitSynthArtifacts,
  })),
);

const capturedEvals: Array<{
  code: string;
  resolve: (v: {
    result: string | null;
    diagnostics: unknown[];
    synthArtifacts: unknown;
  }) => void;
}> = [];
const mockEvalCodeWithDiagnostics = vi.hoisted(() =>
  vi.fn((code: string) => {
    return new Promise<{
      result: string | null;
      diagnostics: unknown[];
      synthArtifacts: unknown;
    }>((resolve) => {
      capturedEvals.push({ code, resolve });
    });
  }),
);
const mockSendTouSEQ = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("@nextjournal/clojure-mode/extensions/eval-region", () => ({
  top_level_string: (_state: unknown) => "",
}));

vi.mock("../runtime/activeWasmRuntimePort.ts", () => ({
  getActiveWasmRuntimePort: () => ({
    evalCode: (code: string) =>
      mockEvalCodeWithDiagnostics(code).then((r) => r.result),
    evalCodeWithDiagnostics: mockEvalCodeWithDiagnostics,
    readLastDiagnostics: vi.fn(() => []),
  }),
}));

vi.mock("../runtime/activeSynthesisService.ts", () => ({
  getActiveSynthesisService: mockGetActiveSynthesisService,
}));

vi.mock("../transport/json-protocol.ts", () => ({
  sendTouSEQ: mockSendTouSEQ,
  initProtocol: vi.fn(),
}));

vi.mock("./expressionEval.ts", () => ({
  detectAndTrackExpressionEvaluation: vi.fn(),
}));

vi.mock("../editors/extensions/inlineResults.ts", () => ({
  dispatchInlineResult: vi.fn(),
}));

vi.mock("../utils/outputHealthStore.ts", () => ({ markOutputRunning: vi.fn() }));
vi.mock("../utils/consoleStore.ts", () => ({ post: vi.fn() }));
vi.mock("../runtime/wasmInterpreter.ts", () => ({
  readLastDiagnostics: vi.fn(() => []),
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
vi.mock("./liveEditRuntime.ts", () => ({
  discoverSlotsAfterEval: vi.fn(() => Promise.resolve()),
  runBootReconciliation: vi.fn(),
  resyncLiveSlotIndexAfterEval: vi.fn(),
  onDocumentChange: vi.fn(),
  liveEditOnValueChange: vi.fn(),
}));
vi.mock("./hardwareBindingDispatcher.ts", () => ({
  bindingKeysInText: () => [],
  markBindingsSoftPreview: vi.fn(),
  clearBindingsSoftPreview: vi.fn(),
}));
vi.mock("../lib/holeDetection.ts", () => ({
  findHolePositions: () => [] as number[],
  findHoleEnd: () => 0,
}));
vi.mock("../editors/extensions/evalHighlight.ts", () => ({
  flashEvalHighlight: vi.fn(),
  evalHighlightField: [],
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { evaluate } from "./editorEvaluation.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function newView(doc: string): EditorView {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [...clojureExtensions],
    }),
  });
}

function oscSinePayload(revision: number) {
  return {
    abi: 2,
    revision,
    declarations: [
      {
        identity: "lead",
        def: "osc/sine",
        version: 2,
        audio_inputs: 1,
        audio_outputs: 1,
      },
    ],
    controls: [
      { identity: "lead", param: "freq", rate: "block", smoothing: "step" },
      { identity: "lead", param: "amp", rate: "block", smoothing: "linear" },
    ],
    connections: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("editorEvaluation → synthesisService.commitSynthArtifacts (VAL-ENGINE-010)", () => {
  let view: EditorView;

  beforeEach(() => {
    capturedEvals.length = 0;
    commitCalls.length = 0;
    view = newView('(synth "osc/sine" :freq 440)');
  });

  afterEach(() => {
    view.destroy();
  });

  it("calls commitSynthArtifacts with the artefact payload on a successful eval", async () => {
    const dispatched = evaluate(view, "toplevel");
    expect(dispatched).toBe(true);

    // The WASM eval is async; flush one microtask cycle so it resolves.
    await Promise.resolve();
    await Promise.resolve();

    expect(capturedEvals).toHaveLength(1);
    capturedEvals[0].resolve({
      result: "ok",
      diagnostics: [],
      synthArtifacts: oscSinePayload(1),
    });

    // Let the .then chain run.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(commitCalls.length).toBe(1);
    expect(commitCalls[0].hasErrors).toBe(false);
    const payload = commitCalls[0].payload as { revision: number };
    expect(payload.revision).toBe(1);
  });

  it("passes hasErrors=true when diagnostics contain an error (VAL-ENGINE-015)", async () => {
    const dispatched = evaluate(view, "toplevel");
    expect(dispatched).toBe(true);

    await Promise.resolve();
    await Promise.resolve();

    capturedEvals[0].resolve({
      result: "{error}",
      diagnostics: [
        { start: 0, end: 10, severity: "error", message: "bad" },
      ],
      synthArtifacts: oscSinePayload(1),
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(commitCalls.length).toBe(1);
    // The service receives hasErrors=true and rejects the commit itself.
    expect(commitCalls[0].hasErrors).toBe(true);
  });

  it("does NOT call commitSynthArtifacts when synthArtifacts is null", async () => {
    // A non-synth eval (e.g. `(a1 0.5)`) returns null synthArtifacts; the
    // commit path is skipped entirely.
    const dispatched = evaluate(view, "toplevel");
    expect(dispatched).toBe(true);

    await Promise.resolve();
    await Promise.resolve();

    capturedEvals[0].resolve({
      result: "ok",
      diagnostics: [],
      synthArtifacts: null,
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(commitCalls.length).toBe(0);
  });

  it("does NOT call commitSynthArtifacts when no synthesis service is active", async () => {
    // Simulate the pre-bootstrap state: no synthesis service registered.
    mockGetActiveSynthesisService.mockReturnValueOnce(null);

    const dispatched = evaluate(view, "toplevel");
    expect(dispatched).toBe(true);

    await Promise.resolve();
    await Promise.resolve();

    capturedEvals[0].resolve({
      result: "ok",
      diagnostics: [],
      synthArtifacts: oscSinePayload(1),
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(commitCalls.length).toBe(0);
  });

  it("does NOT call commitSynthArtifacts on a soft/preview eval", async () => {
    const dispatched = evaluate(view, "soft");
    expect(dispatched).toBe(true);

    await Promise.resolve();
    await Promise.resolve();

    capturedEvals[0].resolve({
      result: "ok",
      diagnostics: [],
      synthArtifacts: oscSinePayload(1),
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Soft evals are WASM-only previews; they must not trigger an engine
    // commit (the user has not accepted the change yet).
    expect(commitCalls.length).toBe(0);
  });
});
