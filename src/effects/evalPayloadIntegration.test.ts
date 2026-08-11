/**
 * Mocha-style integration tests for the unified eval payload builder,
 * expressed through Vitest because the project's eval-related integration
 * tests (evalSequenceGuard, softEval, hardwareEvalDiagnostics) all use
 * Vitest's module mocks for the WASM runtime port and transport. This
 * matches the project's established pattern and keeps the test runner
 * uniform (project root runs `npm run test:mocha` and `npm run test:unit`
 * separately; mixing Mocha+JSDOM imports of the full transport graph
 * requires a heavier harness than this assertion warrants).
 *
 * Spec: docs/specs/state-identity.md §7.4 (eval-time rewriting),
 * §7.5 (runtime diagnostics must map back), §8 (copy/paste semantics).
 *
 * Assertion IDs covered:
 *   VAL-ID-016  All eval entry points produce equivalent payloads and mappings
 *   VAL-ID-021  Worker requests preserve IDs and fork duplicated forms
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

const capturedEvals: Array<{ code: string; resolve: (v: { result: string | null; diagnostics: unknown[] }) => void }> = [];
const mockEvalCodeWithDiagnostics = vi.hoisted(() =>
  vi.fn((code: string) => {
    return new Promise<{ result: string | null; diagnostics: unknown[] }>((resolve) => {
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
    evalCode: (code: string) => mockEvalCodeWithDiagnostics(code).then((r) => r.result),
    evalCodeWithDiagnostics: mockEvalCodeWithDiagnostics,
    readLastDiagnostics: vi.fn(() => []),
  }),
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
vi.mock("../runtime/wasmInterpreter.ts", () => ({ readLastDiagnostics: vi.fn(() => []) }));
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
    debug: false, devmode: false, disableWebSerial: false,
    noModuleMode: false, nosave: false, params: {},
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

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { evaluate } from "./editorEvaluation.ts";
import { buildIdentityField } from "../editors/extensions/stateIdentity/identityField.ts";
import {
  defaultIdentityExtension,
  identityField,
  _resetIdentityFieldSingletonForTests,
} from "../editors/extensions/stateIdentity/identityFieldExport.ts";
import { defaultStatefulFormClassifier } from "../editors/extensions/stateIdentity/identityClassify.ts";
import { deterministicIdGenerator } from "../editors/extensions/stateIdentity/identityGenerator.ts";
import { makeContinuitySource, entriesOf } from "../editors/extensions/stateIdentity/identityMapState.ts";
import { readIdentityMap } from "../editors/extensions/stateIdentity/identityField.ts";
import { evalHighlightField } from "../editors/extensions/evalHighlight.ts";

// Override the singleton identity config with a deterministic one for
// tests, so the field instance installed in the view matches the
// instance editorEvaluation reads.
// We do this by building a custom field via buildIdentityField and then
// installing it through the singleton override. To keep the test simple,
// we install the singleton directly using identityExtensions wiring.

// Helper: build the singleton with the deterministic config and reset it.
function buildSingletonField() {
  _resetIdentityFieldSingletonForTests();
  // Force the singleton to use our deterministic config by importing the
  // factory. The singleton calls createDefaultIdentityConfig() on first
  // access. We need deterministic ids for assertions, so we install the
  // field directly via the export's defaultIdentityExtension which uses
  // the production config. The production config uses defaultIdGenerator
  // (opaque ids); tests just need ANY consistent id, not a specific one.
  return identityField();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function newView(doc: string, field: ReturnType<typeof buildIdentityField>): EditorView {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [...clojureExtensions, field, evalHighlightField],
    }),
  });
}

/**
 * Build a view with the SAME singleton field that editorEvaluation.ts
 * reads. This is the production pattern: extensions.ts installs the
 * singleton via defaultIdentityExtension, and editorEvaluation reads
 * the same instance.
 */
function newSingletonView(doc: string): EditorView {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [...clojureExtensions, ...defaultIdentityExtension(), evalHighlightField],
    }),
  });
}

function setSelection(view: EditorView, anchor: number, head?: number): void {
  view.dispatch({ selection: { anchor, head: head ?? anchor } });
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("VAL-ID-016: all eval entry points produce equivalent payloads", () => {
  let view: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedEvals.length = 0;
    buildSingletonField();
  });

  afterEach(() => {
    if (view) view.destroy();
    document.body.innerHTML = "";
  });

  it("produces the same runtime payload for the same synth form across strategies", async () => {
    const doc = '(synth "osc/sine" :freq 440)\n';
    view = newSingletonView(doc);

    const sidecarId = entriesOf(readIdentityMap(view.state, identityField())).map((e) => e.id)[0]!;
    expect(sidecarId).toMatch(/^id-/);

    // --- Toplevel ---
    capturedEvals.length = 0;
    setSelection(view, 5);
    evaluate(view, "toplevel");
    await flushMicrotasks();
    expect(capturedEvals.length).toBeGreaterThan(0);
    const toplevelCall = capturedEvals[0]!.code;

    // --- Expression (selection covers the whole form) ---
    capturedEvals.length = 0;
    setSelection(view, 0, '(synth "osc/sine" :freq 440)'.length);
    evaluate(view, "expression");
    await flushMicrotasks();
    expect(capturedEvals.length).toBeGreaterThan(0);
    const expressionCall = capturedEvals[0]!.code;

    // --- Soft ---
    capturedEvals.length = 0;
    setSelection(view, 5);
    evaluate(view, "soft");
    await flushMicrotasks();
    expect(capturedEvals.length).toBeGreaterThan(0);
    const softCall = capturedEvals[0]!.code;

    // Toplevel and soft share the same runtimeCode (both eval the same
    // form without an immediate prefix).
    expect(toplevelCall).toBe(softCall);

    // Expression carries an @ prefix (immediate eval); strip it before
    // comparing the underlying payload.
    const expressionPayload = expressionCall.startsWith("@")
      ? expressionCall.slice(1)
      : expressionCall;

    expect(toplevelCall).toBe(expressionPayload);

    // All three carry the hidden identity wrapper and id.
    for (const code of [toplevelCall, softCall, expressionPayload]) {
      expect(code).toContain("with-state-id");
      expect(code).toContain(`"${sidecarId}"`);
    }

    // VAL-ID-019: hidden IDs never leak to the visible editor text.
    const visibleDoc = view.state.doc.toString();
    expect(visibleDoc).not.toContain("with-state-id");
    expect(visibleDoc).not.toContain(sidecarId);
    expect(visibleDoc).toBe('(synth "osc/sine" :freq 440)\n');
  });
});

describe("VAL-ID-021: worker requests preserve IDs and fork duplicated forms", () => {
  let view: EditorView;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedEvals.length = 0;
    buildSingletonField();
  });

  afterEach(() => {
    if (view) view.destroy();
    document.body.innerHTML = "";
  });

  it("preserves the same hidden ID when an anonymous synth is edited then re-evaluated", async () => {
    const doc = '(synth "osc/sine" :freq 440)\n';
    view = newSingletonView(doc);

    // 1. First eval: capture the id sent to the worker.
    setSelection(view, 5);
    evaluate(view, "toplevel");
    await flushMicrotasks();
    expect(capturedEvals.length).toBeGreaterThan(0);
    const firstCode = capturedEvals[0]!.code;
    const idMatch = firstCode.match(/with-state-id "([^"]+)"/);
    expect(idMatch, "first eval should inject a hidden id").to.not.be.null;
    const firstId = idMatch![1];

    // 2. Edit the frequency value (preserve semantics — same logical form).
    const freqPos = view.state.doc.toString().indexOf("440");
    view.dispatch({ changes: { from: freqPos, to: freqPos + 3, insert: "880" } });

    // 3. Second eval: capture the id sent.
    capturedEvals.length = 0;
    setSelection(view, 5);
    evaluate(view, "toplevel");
    await flushMicrotasks();
    expect(capturedEvals.length).toBeGreaterThan(0);
    const secondCode = capturedEvals[0]!.code;
    const secondIdMatch = secondCode.match(/with-state-id "([^"]+)"/);
    expect(secondIdMatch, "second eval should still inject a hidden id").to.not.be.null;
    const secondId = secondIdMatch![1];

    // Identity is preserved: same id reaches the Worker both times.
    expect(secondId).toBe(firstId);

    // The visible source changed.
    expect(secondCode).toContain(":freq 880");
  });

  it("forks the hidden ID when an anonymous synth is duplicated", async () => {
    const doc = '(synth "osc/sine" :freq 440)\n';
    view = newSingletonView(doc);

    // First eval: capture id.
    setSelection(view, 5);
    evaluate(view, "toplevel");
    await flushMicrotasks();
    const firstCode = capturedEvals[0]!.code;
    const firstId = firstCode.match(/with-state-id "([^"]+)"/)![1];

    // Duplicate the form by appending an identical one below.
    view.dispatch({
      changes: {
        from: view.state.doc.length,
        insert: '(synth "osc/sine" :freq 440)\n',
      },
    });

    // Evaluate the SECOND form by placing the cursor inside it.
    const secondSynthStart = view.state.doc.toString().indexOf("(synth", 1);
    expect(secondSynthStart, "second synth form should exist").toBeGreaterThan(0);
    setSelection(view, secondSynthStart + 5);

    capturedEvals.length = 0;
    evaluate(view, "toplevel");
    await flushMicrotasks();
    expect(capturedEvals.length).toBeGreaterThan(0);
    const secondCode = capturedEvals[0]!.code;
    const secondId = secondCode.match(/with-state-id "([^"]+)"/)![1];

    // Identity is FORKED: distinct ids.
    expect(secondId).not.toBe(firstId);

    // Both ids are present in the sidecar.
    const ids = entriesOf(readIdentityMap(view.state, identityField())).map((e) => e.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain(firstId);
    expect(ids).toContain(secondId);
  });
});
