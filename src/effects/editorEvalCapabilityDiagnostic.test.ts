/**
 * Editor-eval → capability informational diagnostic (VAL-HOST-008/009).
 *
 * Covers:
 *   VAL-HOST-008 — With audio capability unavailable, a valid `synth`
 *                  form still compiles and exactly one informational
 *                  diagnostic explains that browser playback is
 *                  unavailable.
 *   VAL-HOST-009 — Repeated synth evaluations while audio is unavailable
 *                  do not accumulate duplicate capability diagnostics.
 *
 * These tests wire the real `evaluate()` from `effects/editorEvaluation.ts`
 * against a mocked WASM port that returns successful synth artefacts, and
 * the REAL CodeMirror diagnostic field (not mocked) so the actual dedup
 * behaviour of `pushDiagnostics` is exercised. The synthesis service is
 * either absent (no audio capability) or reports `audioCapable === false`
 * via its telemetry snapshot.
 *
 * These tests were OBSERVED FAILING before the capability-info-diagnostic
 * injection landed in `editorEvaluation.ts`: the diagnostic count was
 * zero after a successful synth eval, and `info` severity was never
 * emitted.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

vi.mock("./noneModeGate.ts", () => ({
  evalRejectionForNoRuntime: () => null,
}));
vi.mock("../runtime/runtimeCompatibility.ts", () => ({
  shouldUseWasmShadow: () => true,
}));
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
// @ts-expect-error — clojure-mode has no type declarations
import { default_extensions as clojureExtensions } from "@nextjournal/clojure-mode";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockCommitSynthArtifacts = vi.hoisted(() =>
  vi.fn((_payload: unknown, _hasErrors: boolean) => Promise.resolve({
    outcome: "rejected-invalid-payload" as const,
    epoch: 0,
    revision: 0,
    workletDeltas: [],
  })),
);

/** A service stub whose telemetry reports audioCapable === false. */
const mockIncapableService = vi.hoisted(() => ({
  commitSynthArtifacts: mockCommitSynthArtifacts,
  // The state used by the eval pipeline to detect the incapable case.
  state: "off" as const,
  telemetry: {
    capabilities: {
      audioCapable: false,
      reasons: ["NOT_CROSS_ORIGIN_ISOLATED"],
    },
    engineState: "off",
  },
}));

const mockGetActiveSynthesisService = vi.hoisted(() =>
  vi.fn(() => mockIncapableService),
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

// IMPORTANT: we DO NOT mock `../editors/extensions/diagnostics.ts`. The
// real diagnostic field is installed on the test view below so dedup is
// exercised through the production code path.

vi.mock("../lib/manualControlState.ts", () => ({
  rewriteCodeSliceForModule: (code: string) => code,
  getAllManualControlBindings: () => [],
  mapManualControlBindingsThroughChanges: vi.fn(),
}));
/**
 * When bootstrap detects that audio is incapable, the synthesis service
 * is NEVER constructed (`bootstrap.ts` §2c gates construction on
 * `audioCapable === true`). The capability diagnostic must still appear
 * in that degraded profile (VAL-HOST-008). The eval pipeline falls back
 * to the bootstrap `getAudioCapabilitySnapshot()` when no service is
 * registered. These tests exercise that fallback path: the active
 * service is `null` AND the bootstrap probe reports incapable.
 */
const mockBootstrapCapabilitiesIncapable = vi.hoisted(() => ({
  schemaVersion: 1,
  crossOriginIsolated: false,
  sharedArrayBufferAvailable: false,
  audioWorkletAvailable: true,
  workerAvailable: true,
  sharedWebAssemblyMemoryAvailable: true,
  audioCapable: false,
  reasons: [
    "Cross-origin isolation is unavailable.",
    "SharedArrayBuffer is unavailable.",
  ],
  capturedAt: 0,
}));

const mockBootstrapCapabilitiesCapable = vi.hoisted(() => ({
  schemaVersion: 1,
  crossOriginIsolated: true,
  sharedArrayBufferAvailable: true,
  audioWorkletAvailable: true,
  workerAvailable: true,
  sharedWebAssemblyMemoryAvailable: true,
  audioCapable: true,
  reasons: [],
  capturedAt: 0,
}));

const mockGetAudioCapabilitySnapshot = vi.hoisted(() =>
  vi.fn((): typeof mockBootstrapCapabilitiesIncapable | null => null),
);

vi.mock("../runtime/startupContext.ts", () => ({
  getStartupFlagsSnapshot: () => ({
    debug: false,
    devmode: false,
    disableWebSerial: false,
    noModuleMode: false,
    nosave: false,
    params: {},
  }),
  getAudioCapabilitySnapshot: () => mockGetAudioCapabilitySnapshot(),
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
import { diagnosticField } from "../editors/extensions/diagnostics.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function newView(doc: string): EditorView {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      // Install the REAL diagnostic field so dedup is exercised.
      extensions: [...clojureExtensions, diagnosticField],
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

/** Resolve one pending eval. */
async function flushOneEval(payload: unknown): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  expect(capturedEvals.length).toBeGreaterThanOrEqual(1);
  capturedEvals[0].resolve({
    result: "ok",
    diagnostics: [],
    synthArtifacts: payload,
  });
  // Let the .then chain run.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("editorEvaluation → capability informational diagnostic (VAL-HOST-008/009)", () => {
  let view: EditorView;

  beforeEach(() => {
    capturedEvals.length = 0;
    mockCommitSynthArtifacts.mockClear();
    mockGetActiveSynthesisService.mockReturnValue(mockIncapableService);
    view = newView('(synth "osc/sine" :freq 440)');
  });

  afterEach(() => {
    view.destroy();
  });

  it("injects exactly one info diagnostic on a successful synth eval when audio is incapable (VAL-HOST-008)", async () => {
    const dispatched = evaluate(view, "toplevel");
    expect(dispatched).toBe(true);

    await flushOneEval(oscSinePayload(1));

    const diags = view.state.field(diagnosticField);
    expect(diags.length).toBe(1);
    expect(diags[0].severity).toBe("info");
    // The diagnostic message must explain browser playback is unavailable;
    // match the canonical phrasing used in the synthesis service surface.
    expect(diags[0].message.toLowerCase()).toMatch(
      /audio|playback|capability|browser/,
    );
    expect(diags[0].message.toLowerCase()).toMatch(/unavailable|disabled/);
  });

  it("does not inject the info diagnostic when audio is capable", async () => {
    // Flip the service into a capable state. The eval pipeline must not
    // add a capability-info diagnostic when audio is capable.
    mockGetActiveSynthesisService.mockReturnValue({
      commitSynthArtifacts: mockCommitSynthArtifacts,
      state: "off" as const,
      telemetry: {
        capabilities: { audioCapable: true, reasons: [] },
        engineState: "off",
      },
    });

    const dispatched = evaluate(view, "toplevel");
    expect(dispatched).toBe(true);

    await flushOneEval(oscSinePayload(1));

    const diags = view.state.field(diagnosticField);
    expect(diags.length).toBe(0);
  });

  it("does not inject the info diagnostic when no synth artefact is present", async () => {
    // A non-synth eval must NOT receive a capability-info diagnostic.
    const dispatched = evaluate(view, "toplevel");
    expect(dispatched).toBe(true);

    await flushOneEval(null);

    const diags = view.state.field(diagnosticField);
    expect(diags.length).toBe(0);
  });

  it("does not inject the info diagnostic when no synthesis service exists", async () => {
    // Pre-bootstrap state: no service registered. The eval must not
    // emit a capability diagnostic (the user has not enabled audio at
    // all; the editor surface is silent about it).
    mockGetActiveSynthesisService.mockReturnValue(null);

    const dispatched = evaluate(view, "toplevel");
    expect(dispatched).toBe(true);

    await flushOneEval(oscSinePayload(1));

    const diags = view.state.field(diagnosticField);
    expect(diags.length).toBe(0);
  });

  it("does not accumulate duplicate capability diagnostics on repeated successful synth evals (VAL-HOST-009)", async () => {
    // First eval: should produce exactly one capability-info diagnostic.
    evaluate(view, "toplevel");
    await flushOneEval(oscSinePayload(1));
    let diags = view.state.field(diagnosticField);
    expect(diags.length).toBe(1);
    expect(diags[0].severity).toBe("info");

    // Second eval on the same form: should NOT add a duplicate. The
    // existing single diagnostic should be the only one present.
    capturedEvals.length = 0;
    evaluate(view, "toplevel");
    await flushOneEval(oscSinePayload(2));
    diags = view.state.field(diagnosticField);
    expect(diags.length).toBe(1);
    expect(diags[0].severity).toBe("info");

    // Third eval on the same form: still exactly one.
    capturedEvals.length = 0;
    evaluate(view, "toplevel");
    await flushOneEval(oscSinePayload(3));
    diags = view.state.field(diagnosticField);
    expect(diags.length).toBe(1);

    // Fourth eval after editing the frequency: the diagnostic should
    // still be exactly one. It moves with the form (range-remap) but
    // never duplicates.
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: '(synth "osc/sine" :freq 660)' },
    });
    capturedEvals.length = 0;
    evaluate(view, "toplevel");
    await flushOneEval(oscSinePayload(4));
    diags = view.state.field(diagnosticField);
    expect(diags.length).toBe(1);
    expect(diags[0].severity).toBe("info");
  });

  it("clears the capability diagnostic when audio becomes capable on a subsequent eval", async () => {
    // First eval: incapable → one info diagnostic.
    evaluate(view, "toplevel");
    await flushOneEval(oscSinePayload(1));
    let diags = view.state.field(diagnosticField);
    expect(diags.length).toBe(1);
    expect(diags[0].severity).toBe("info");

    // Second eval: simulate the user having crossed into a capable
    // state (e.g. they navigated to a different hosting setup). The
    // capability diagnostic must be cleared, not retained.
    mockGetActiveSynthesisService.mockReturnValue({
      commitSynthArtifacts: mockCommitSynthArtifacts,
      state: "suspended" as const,
      telemetry: {
        capabilities: { audioCapable: true, reasons: [] },
        engineState: "suspended",
      },
    });
    capturedEvals.length = 0;
    evaluate(view, "toplevel");
    await flushOneEval(oscSinePayload(2));
    diags = view.state.field(diagnosticField);
    expect(diags.length).toBe(0);
  });

  // -------------------------------------------------------------------
  // Bootstrap-fallback path (no synthesis service constructed)
  // -------------------------------------------------------------------

  it("falls back to bootstrap capabilities and pushes the diagnostic when no service is registered (VAL-HOST-008 degraded profile)", async () => {
    // No synthesis service: this mirrors the real degraded-profile
    // bootstrap where audio is incapable so the service is never
    // constructed.
    mockGetActiveSynthesisService.mockReturnValue(null);
    // Bootstrap probe is present and reports incapable.
    mockGetAudioCapabilitySnapshot.mockReturnValue(
      mockBootstrapCapabilitiesIncapable,
    );

    evaluate(view, "toplevel");
    await flushOneEval(oscSinePayload(1));

    const diags = view.state.field(diagnosticField);
    expect(diags.length).toBe(1);
    expect(diags[0].severity).toBe("info");
    expect(diags[0].message.toLowerCase()).toMatch(
      /audio|playback|capability|browser/,
    );
    expect(diags[0].message.toLowerCase()).toMatch(/unavailable|disabled/);
  });

  it("does not duplicate the diagnostic across repeated evals in the degraded profile (VAL-HOST-009 bootstrap fallback)", async () => {
    mockGetActiveSynthesisService.mockReturnValue(null);
    mockGetAudioCapabilitySnapshot.mockReturnValue(
      mockBootstrapCapabilitiesIncapable,
    );

    evaluate(view, "toplevel");
    await flushOneEval(oscSinePayload(1));
    let diags = view.state.field(diagnosticField);
    expect(diags.length).toBe(1);

    capturedEvals.length = 0;
    evaluate(view, "toplevel");
    await flushOneEval(oscSinePayload(2));
    diags = view.state.field(diagnosticField);
    expect(diags.length).toBe(1);

    capturedEvals.length = 0;
    evaluate(view, "toplevel");
    await flushOneEval(oscSinePayload(3));
    diags = view.state.field(diagnosticField);
    expect(diags.length).toBe(1);
  });

  it("does not push the diagnostic when the bootstrap probe reports capable and no service exists", async () => {
    // No service, but bootstrap says capable. The diagnostic must not
    // appear (and any prior diagnostic must be cleared by the
    // clear-on-range behaviour of pushDiagnostics).
    mockGetActiveSynthesisService.mockReturnValue(null);
    mockGetAudioCapabilitySnapshot.mockReturnValue(
      mockBootstrapCapabilitiesCapable,
    );

    evaluate(view, "toplevel");
    await flushOneEval(oscSinePayload(1));

    const diags = view.state.field(diagnosticField);
    expect(diags.length).toBe(0);
  });

  it("does not push the diagnostic when neither service nor bootstrap probe is available", async () => {
    // No service AND no bootstrap probe: the eval pipeline cannot make
    // a reliable capability claim, so it must remain silent.
    mockGetActiveSynthesisService.mockReturnValue(null);
    mockGetAudioCapabilitySnapshot.mockReturnValue(null);

    evaluate(view, "toplevel");
    await flushOneEval(oscSinePayload(1));

    const diags = view.state.field(diagnosticField);
    expect(diags.length).toBe(0);
  });
});
