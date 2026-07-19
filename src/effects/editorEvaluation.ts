/**
 * Unified editor evaluation — one function, multiple strategies.
 *
 * Replaces the four eval functions that previously lived in editorConfig.ts
 * (evalNow, evalToplevel, evalQuantised, softEval).
 */

import type { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { top_level_string } from "@nextjournal/clojure-mode/extensions/eval-region";

import { sendTouSEQ } from "../transport/json-protocol.ts";
import { post } from "../utils/consoleStore.ts";
import { getActiveWasmRuntimePort } from "../runtime/activeWasmRuntimePort.ts";
import {
  discoverSlotsAfterEval,
  runBootReconciliation,
  resyncLiveSlotIndexAfterEval,
} from "./liveEditRuntime.ts";

// Editor eval and diagnostics readback are atomic on the active WASM
// runtime port: `evalCodeWithDiagnostics` returns the eval's own
// diagnostics, read inside the same worker handler. A separate
// `readLastDiagnostics` round-trip would race when two evals overlap,
// because the diagnostics slot is global and the second eval clobbers it
// before the first eval's read can see it — see
// `src/runtime/diagnosticReadRace.test.ts`.
//
// The same atomic response carries the versioned synth artefact payload
// (VAL-COMP-013). The eval-to-engine commit pipeline consumes it after
// the editor-state mutations below so the worklet receives the graph
// delta and the Worker producer arms the new epoch (VAL-ENGINE-010).
const evalInUseqWasm = (
  code: string,
): Promise<{
  result: string | null;
  diagnostics: UseqDiagnostic[];
  synthArtifacts: SynthArtifactsPayload | null;
}> =>
  getActiveWasmRuntimePort().evalCodeWithDiagnostics(code);
import { pushDiagnostics, clearDiagnosticsForRange } from "../editors/extensions/diagnostics.ts";
import { rewriteCodeSliceForModule } from "../lib/manualControlState.ts";
import { getAllManualControlBindings } from "../lib/manualControlState.ts";
import { getStartupFlagsSnapshot } from "../runtime/startupContext.ts";
import { evalRejectionForNoRuntime } from "./noneModeGate.ts";
import { flashEvalHighlight } from "../editors/extensions/evalHighlight.ts";
import { detectAndTrackExpressionEvaluation } from "../editors/extensions/expressionEval.ts";
import { markOutputRunning } from "../utils/outputHealthStore.ts";
import { dispatchInlineResult } from "../editors/extensions/inlineResults.ts";
import type { UseqDiagnostic } from "../runtime/wasmInterpreter.ts";
import type { SynthArtifactsPayload } from "../contracts/runtimeTypes.ts";
import { getActiveSynthesisService } from "../runtime/activeSynthesisService.ts";
import { findHolePositions, findHoleEnd } from "../lib/holeDetection.ts";
import {
  bindingKeysInText,
  markBindingsSoftPreview,
  clearBindingsSoftPreview,
} from "./hardwareBindingDispatcher.ts";
import {
  buildEvalPayload,
  remapDiagnostics,
  type EvalPayload,
  type ManualControlBinding,
} from "../editors/extensions/stateIdentity/evalPayload.ts";
import { identityField } from "../editors/extensions/stateIdentity/identityFieldExport.ts";

// ---------------------------------------------------------------------------
// Output assignment detection
// ---------------------------------------------------------------------------

/**
 * Match output assignment forms like `(a1 ...)`, `(d3 ...)`, `(s2 ...)`.
 * Captures the output name (e.g. "a1", "d3") from the head of a list form.
 */
const OUTPUT_ASSIGNMENT_PATTERN = /\(\s*([ads][1-8])\b/g;

/** Extract all output names assigned in a code string. */
function detectOutputAssignments(code: string): string[] {
  const names: string[] = [];
  OUTPUT_ASSIGNMENT_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = OUTPUT_ASSIGNMENT_PATTERN.exec(code)) !== null) {
    const name = match[1];
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Strategy for code region selection:
 * - `toplevel`   – the top-level form at cursor (quantised eval, no @ prefix)
 * - `expression` – selection if non-empty, otherwise top-level form (@ prefix)
 * - `soft`       – top-level form, WASM-only preview (no module send)
 */
export type EvalStrategy = "toplevel" | "expression" | "soft";

interface EvalContext {
  view: EditorView;
  state: EditorState;
}

// ---------------------------------------------------------------------------
// Region extraction helpers
// ---------------------------------------------------------------------------

function getTopLevelFormRange(state: EditorState): { from: number; to: number } | null {
  if (!(state as any)?.selection) return null;
  const pos = state.selection.main.from;
  const tree = syntaxTree(state);

  let node = tree.resolveInner(pos, 0);
  if (node?.type?.name === "Program") {
    node = tree.resolveInner(pos, 1);
  }
  if (node?.type?.name === "Program") {
    node = tree.resolveInner(pos, -1);
  }

  while (node && node.parent && node.parent.type?.name !== "Program") {
    node = node.parent;
  }

  if (!node || node.type?.name === "Program") return null;
  return { from: node.from, to: node.to };
}

function getSelectionRange(
  state: EditorState,
): { from: number; to: number; text: string } | null {
  if (!state?.selection) return null;
  const main = state.selection.main;
  if (!main || main.empty) return null;
  return { from: main.from, to: main.to, text: state.doc.sliceString(main.from, main.to) };
}

function getToplevelPayload(
  state: EditorState,
  view: EditorView | undefined,
  source: EvalPayload["source"] = "toplevel",
): { payload: EvalPayload; range: { from: number; to: number } | null } {
  const range = getTopLevelFormRange(state);
  // Only trust the tree-derived range if it is non-empty; otherwise fall
  // back to top_level_string (the legacy behaviour).
  const effectiveRange = range && range.to > range.from ? range : null;
  const sliceFrom = effectiveRange?.from ?? 0;
  const slice = effectiveRange
    ? state.doc.sliceString(effectiveRange.from, effectiveRange.to)
    : (top_level_string(state) ?? "");
  const payload = buildPayloadFromState(state, view, slice, sliceFrom, source);
  return { payload, range: effectiveRange };
}

/**
 * Build a unified visible-to-runtime payload from a code slice using the
 * state-identity sidecar installed on the view. The payload's
 * `runtimeCode` carries composed hidden identity injection and
 * manual-control substitution; its `sourceMap` is consumed by
 * {@link evalWasm} and the hardware path to remap diagnostics back to
 * the visible source (VAL-ID-013..022).
 *
 * If the identity field is not installed on the view (e.g. read-only
 * snippet editors), the payload degenerates to the legacy
 * manual-control-only rewrite via {@link rewriteCodeSliceForModule}.
 */
function buildPayloadFromState(
  state: EditorState,
  view: EditorView | undefined,
  visibleSlice: string,
  sliceFrom: number,
  source: EvalPayload["source"],
): EvalPayload {
  // Read the live identity map from the state-identity sidecar, if it
  // is installed. The field reference comes from the production
  // singleton (extensions.ts installs the same instance).
  let identityMap = null;
  if (view) {
    try {
      identityMap = view.state.field(identityField()).map;
    } catch {
      identityMap = null;
    }
  }
  if (identityMap === null) {
    try {
      identityMap = state.field(identityField()).map;
    } catch {
      identityMap = null;
    }
  }

  if (identityMap === null) {
    // Identity sidecar not installed — degenerate to legacy behaviour.
    const runtimeCode = rewriteCodeSliceForModule(
      visibleSlice,
      sliceFrom,
      sliceFrom + visibleSlice.length,
    );
    return {
      visibleSlice,
      runtimeCode,
      sourceMap: [
        {
          visible: { from: 0, to: visibleSlice.length },
          runtime: { from: 0, to: runtimeCode.length },
          generated: runtimeCode !== visibleSlice,
        },
      ],
      sliceFrom,
      source,
    };
  }

  // Convert the global manual-control bindings to the payload-builder
  // shape (document coordinates).
  const manualBindings: ManualControlBinding[] = getAllManualControlBindings().map((b) => ({
    stick: b.stick,
    slot: b.slot,
    from: b.from,
    to: b.to,
    value: b.value,
    originalText: b.originalText,
    lastSentAt: b.lastSentAt,
    lastSentValue: b.lastSentValue,
  }));

  return buildEvalPayload({
    visibleSlice,
    sliceFrom,
    identityMap,
    state,
    manualBindings,
    source,
  });
}

// ---------------------------------------------------------------------------
// Per-view eval-sequence guard (spec §1.10: "one in-flight eval per editor;
// a slow eval cannot misattribute its output to a later eval")
// ---------------------------------------------------------------------------
//
// Each `evalWasm` call bumps a per-view counter and captures the resulting
// sequence number. When the eval resolves, if the captured number isn't
// still the latest the view has issued, the result is dropped — applying
// it would clobber a fresher eval's effects (diagnostics, inline result,
// output health) with stale state.
//
// Today both the worker and in-process transports happen to deliver
// responses in dispatch order, so the bug rarely manifests. This guard
// makes correctness independent of transport ordering, satisfying the
// spec contract regardless of future engine changes (parallel workers,
// cancellation, etc.).
const viewEvalSeq = new WeakMap<EditorView, number>();

function nextEvalSeq(view: EditorView): number {
  const next = (viewEvalSeq.get(view) ?? 0) + 1;
  viewEvalSeq.set(view, next);
  return next;
}

function isLatestEvalSeq(view: EditorView, seq: number): boolean {
  return viewEvalSeq.get(view) === seq;
}

// ---------------------------------------------------------------------------
// WASM evaluation helper
// ---------------------------------------------------------------------------

function evalWasm(
  code: string,
  opts: {
    isImmediate: boolean;
    noModuleMode: boolean;
    isPreview: boolean;
    view?: EditorView;
    /** Character offset in the document where this code starts */
    docOffset?: number;
    /** Range in the document that this eval covers */
    range?: { from: number; to: number };
    /**
     * Source map from the unified payload builder. When provided,
     * runtime-coordinate diagnostics are remapped back to visible-slice
     * coordinates before being pushed to the editor (state-identity.md
     * §7.5, §12.4; VAL-ID-017, VAL-ID-018, VAL-ID-019).
     */
    sourceMap?: EvalPayload["sourceMap"];
  },
): Promise<{ text: string; isError: boolean; pos: number }> {
  const wasmCode = opts.isImmediate ? code.slice(1) : code;
  const evalPos = opts.view ? opts.view.state.selection.main.from : 0;
  const docOffset = opts.docOffset ?? 0;
  const rangeFrom = opts.range?.from ?? 0;
  const rangeTo = opts.range?.to ?? (opts.view?.state.doc.length ?? 0);
  const view = opts.view;
  const seq = view ? nextEvalSeq(view) : 0;
  const isStale = () => view !== undefined && !isLatestEvalSeq(view, seq);

  return evalInUseqWasm(wasmCode)
    .then(async ({ result, diagnostics, synthArtifacts }) => {
      // A newer eval has been dispatched on this view since we started.
      // Drop our result so we don't clobber the fresher eval's effects.
      // Empty `text` makes the outer `.then`'s `dispatchInlineResult` a
      // no-op, and we skip every editor-state mutation below.
      if (isStale()) {
        return { text: "", isError: false, pos: evalPos };
      }
      const output = typeof result === "string" ? result : String(result ?? "");
      const trimmed = output.trim();

      // Remap runtime-coordinate diagnostics back to visible-slice
      // coordinates through the unified source map (state-identity.md
      // §7.5, §12.4). When no source map is supplied (legacy paths or
      // identity sidecar not installed), diagnostics pass through
      // unchanged at runtime offsets.
      const remappedDiagnostics: UseqDiagnostic[] = opts.sourceMap
        ? remapDiagnostics(diagnostics, opts.sourceMap, docOffset) as UseqDiagnostic[]
        : diagnostics;

      if (opts.view) {
        if (remappedDiagnostics.length > 0) {
          // `pushDiagnostics` adds `docOffset` to each diagnostic's
          // start/end. We already incorporated the offset via
          // `remapDiagnostics(..., docOffset)`, so pass 0 here.
          pushDiagnostics(opts.view, remappedDiagnostics, 0, rangeFrom, rangeTo);
        } else {
          // Only clear diagnostics for the range we just eval'd successfully
          clearDiagnosticsForRange(opts.view, rangeFrom, rangeTo);
        }
      }

      if (trimmed.length > 0 && import.meta.env.DEV) {
        console.log(`[modulisp] ${wasmCode.trim()}  →  ${trimmed}`);
      }

      // Check if diagnostics indicate an error
      const hasErrors = remappedDiagnostics.some(
        (d) => d.severity === "error",
      );

      // Show first error message inline instead of "{error}"
      const displayText =
        hasErrors && remappedDiagnostics.length > 0
          ? remappedDiagnostics[0].message
          : trimmed;
      const isError = hasErrors || trimmed === "{error}";

      if (!opts.isPreview) {
        const assignedOutputs = detectOutputAssignments(wasmCode);
        for (const outputName of assignedOutputs) {
          if (!hasErrors) {
            markOutputRunning(outputName);
          }
        }

        // After successful eval, discover live-edit slots allocated by WASM.
        // Fire-and-forget: slot discovery is non-blocking and non-critical.
        if (!hasErrors && opts.view) {
          discoverSlotsAfterEval(opts.view).catch(() => {});
          // wire-protocol.md §6.5/§11.1: eval re-allocates the device live-slot
          // table, so invalidate the §6.5 binary INPUT_SET id→index map and
          // re-sync it from a fresh get-state. Without this, manual-control
          // scrubs would silently write to a STALE slot on the hardware.
          resyncLiveSlotIndexAfterEval();
          // §7.3 trigger 3: boot-time reconciliation after first successful eval.
          runBootReconciliation(opts.view);
        }

        // VAL-ENGINE-010: feed the atomic synth artefact payload into the
        // engine commit pipeline. The synthesis service diffs the
        // declarations by stable identity, allocates a fresh program
        // epoch, posts the ordered worklet delta messages, and arms the
        // Worker producer. Soft/preview evals never reach this path.
        // Failed evals (VAL-ENGINE-015) and superseded responses
        // (VAL-ENGINE-013) are rejected inside the service before any
        // engine mutation, so this call is always safe.
        if (synthArtifacts) {
          const synthService = getActiveSynthesisService();
          if (synthService) {
            try {
              synthService.commitSynthArtifacts(synthArtifacts, hasErrors);
            } catch {
              // The service throws on fatal ABI/NodeDef mismatch; these
              // surface through devmode telemetry rather than crashing
              // the editor. The diagnostic is already visible from the
              // eval response.
            }
          }
        }
      }

      if (opts.isPreview) {
        return { text: displayText, isError, pos: evalPos };
      }

      if (!opts.noModuleMode) {
        return { text: displayText, isError, pos: evalPos };
      }

      return { text: trimmed, isError: false, pos: evalPos };
    })
    .catch((error: unknown) => {
      // A stale failed eval should not surface its error to the user —
      // the newer eval owns the editor state now.
      if (isStale()) {
        return { text: "", isError: false, pos: evalPos };
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[modulisp] eval error: ${message}`);
      if (opts.isPreview) {
        post(message, "error");
      } else if (opts.noModuleMode) {
        post(message, "error");
      } else {
        console.error("uSEQ WASM interpreter evaluation failed", error);
      }
      return { text: message, isError: true, pos: evalPos };
    });
}

// ---------------------------------------------------------------------------
// Hardware diagnostics readback
// ---------------------------------------------------------------------------
//
// diagnostics.md §5.3: the diagnostic data model is identical on both targets.
// The hardware eval path (`sendTouSEQ` → `sendJsonEval`) returns a `JsonResponse`
// carrying a §5.7 `diagnostics` array. Thread it into the editor with the SAME
// offsets the WASM path uses so hardware-produced diagnostics (or diagnostics
// when WASM is disabled) also drive inline lint. `pushDiagnostics` /
// `addDiagnosticsEffect` dedupe per-range, so pushing on top of the WASM
// shadow's diagnostics is safe; in `both` mode the hardware response arrives
// authoritative and wins for its range.
function applyHardwareDiagnostics(
  view: EditorView | undefined,
  response: unknown,
  docOffset: number,
  rangeFrom: number,
  rangeTo: number,
  sourceMap?: EvalPayload["sourceMap"],
): void {
  if (!view) return;
  const diagnostics = (response as { diagnostics?: UseqDiagnostic[] } | null)
    ?.diagnostics;
  if (Array.isArray(diagnostics) && diagnostics.length > 0) {
    // Remap hardware diagnostics through the same source map the WASM
    // path uses so both targets anchor to visible ranges
    // (state-identity.md §7.5; VAL-ID-017, VAL-ID-018).
    const remapped: UseqDiagnostic[] = sourceMap
      ? remapDiagnostics(diagnostics, sourceMap, docOffset) as UseqDiagnostic[]
      : diagnostics;
    pushDiagnostics(view, remapped, 0, rangeFrom, rangeTo);
  }
}

// ---------------------------------------------------------------------------
// Main evaluate function
// ---------------------------------------------------------------------------

/**
 * Evaluate code from the editor using the given strategy.
 *
 * - `"toplevel"` — evaluate top-level form at cursor (no @ prefix, quantised)
 * - `"expression"` — selection if present, otherwise top-level form (@ prefix, immediate)
 * - `"soft"` — preview in WASM only, no send to module
 */
export function evaluate(view: EditorView, strategy: EvalStrategy): boolean {
  const state = view.state;

  // runtime-modes.md §1.10: in `none` mode there is no runtime to evaluate
  // against. The editor still accepts input, but eval is rejected with a
  // user-visible warning — the app must never silently drop the eval.
  const noRuntimeWarning = evalRejectionForNoRuntime();
  if (noRuntimeWarning) {
    post(noRuntimeWarning, "warn");
    return false;
  }

  switch (strategy) {
    case "expression": {
      // Try selection first
      const sel = getSelectionRange(state);
      if (sel) {
        // Per-form eval gate: block selections containing holes
        const holePositions = findHolePositions(sel.text);
        if (holePositions.length > 0) {
          gateFormWithHoles(view, sel.text, sel.from, { from: sel.from, to: sel.to });
          flashEvalHighlight(view, sel.from, sel.to);
          return true;
        }

        // Unified payload builder: composes identity injection + manual
        // control substitution through one source map (VAL-ID-013,
        // VAL-ID-015, VAL-ID-016). The same runtimeCode reaches WASM
        // and hardware; diagnostics are remapped through sourceMap.
        const payload = buildPayloadFromState(
          state,
          view,
          sel.text,
          sel.from,
          "expression",
        );
        const code = "@" + payload.runtimeCode;
        if (!code.trim()) return false;

        flashEvalHighlight(view, sel.from, sel.to);

        // Also eval in WASM to get an inline result
        evalWasm(code, {
          isImmediate: true,
          noModuleMode: getStartupFlagsSnapshot().noModuleMode,
          isPreview: false,
          view,
          docOffset: sel.from,
          range: { from: sel.from, to: sel.to },
          sourceMap: payload.sourceMap,
        }).then((result) => {
          if (result.text) {
            dispatchInlineResult(view, result.text, sel.to, result.isError);
          }
        });

        sendTouSEQ(code).then((response) => {
          applyHardwareDiagnostics(
            view,
            response,
            sel.from,
            sel.from,
            sel.to,
            payload.sourceMap,
          );
        });
        return true;
      }
      // Fall through to toplevel with @ prefix
      return evaluateToplevel({ view, state }, "@");
    }

    case "toplevel":
      return evaluateToplevel({ view, state }, "");

    case "soft":
      return evaluateSoft({ view, state });

    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Hole detection (per-form eval gate)
// ---------------------------------------------------------------------------

/**
 * Check a form for holes and emit diagnostics if any are found.
 * Returns true if holes were found (eval should be skipped).
 */
function gateFormWithHoles(
  view: EditorView,
  formCode: string,
  docOffset: number,
  range: { from: number; to: number },
): boolean {
  const holePositions = findHolePositions(formCode);
  if (holePositions.length === 0) return false;

  // Build diagnostics for each hole position
  const diagnostics: UseqDiagnostic[] = holePositions.map((pos) => {
    const end = findHoleEnd(formCode, pos);
    return {
      start: pos,
      end: end,
      severity: "warning" as const,
      message: "fill this hole first",
    };
  });

  // Push diagnostics to the editor at the correct document offsets
  pushDiagnostics(view, diagnostics, docOffset, range.from, range.to);

  return true;
}

// ---------------------------------------------------------------------------
// Internal strategy implementations
// ---------------------------------------------------------------------------

function evaluateToplevel(ctx: EvalContext, prefix: string): boolean {
  const { view, state } = ctx;
  const startupFlags = getStartupFlagsSnapshot();
  const noModuleMode = startupFlags.noModuleMode;
  // Unified payload: composes identity injection + manual control through
  // one source map (VAL-ID-013, VAL-ID-015). The same runtimeCode feeds
  // both WASM and hardware paths; diagnostics are remapped through
  // payload.sourceMap so visible, generated, and overlapping ranges
  // anchor meaningfully (VAL-ID-017, VAL-ID-018).
  const { payload, range } = getToplevelPayload(state, view, "toplevel");
  const rawCode = payload.visibleSlice;
  const rawRuntimeCode = payload.runtimeCode;

  const code = prefix + rawRuntimeCode;
  const isImmediate = code.startsWith("@");

  const hasView = view && typeof view.dispatch === "function";
  if (hasView) {
    detectAndTrackExpressionEvaluation(view);
  }

  // --- Per-form eval gate: block forms containing holes ---
  if (hasView && range) {
    const gated = gateFormWithHoles(view, rawCode, range.from, range);
    if (gated) {
      // Flash highlight to give feedback that eval was attempted
      const sel = state.selection.main;
      if (!sel.empty) {
        flashEvalHighlight(view, sel.from, sel.to);
      } else {
        flashEvalHighlight(view, undefined, undefined);
      }
      // Do NOT send to WASM or module — fall back to LKG
      return true;
    }
  }

  if (hasView) {
    const sel = state.selection.main;
    if (!sel.empty) {
      flashEvalHighlight(view, sel.from, sel.to);
    } else {
      flashEvalHighlight(view, undefined, undefined);
    }
  }

  const evalPos = range ? range.to : state.selection.main.from;

  evalWasm(code, {
    isImmediate,
    noModuleMode,
    isPreview: false,
    view,
    docOffset: range?.from ?? 0,
    range: range ?? undefined,
    sourceMap: payload.sourceMap,
  }).then((result) => {
      if (hasView && result.text) {
        dispatchInlineResult(view, result.text, evalPos, result.isError);
      }
    });

  // §4.4 binding wasm-preview lifecycle: a normal (non-soft) eval that reaches
  // the module lifts any bindings in the form out of preview; in no-module
  // mode the form stays WASM-only, so those bindings remain previews.
  const bindingKeys = bindingKeysInText(rawCode);
  if (bindingKeys.length > 0) {
    if (noModuleMode) {
      markBindingsSoftPreview(bindingKeys);
    } else {
      clearBindingsSoftPreview(bindingKeys);
    }
  }

  if (!noModuleMode) {
    sendTouSEQ(code).then((response) => {
      applyHardwareDiagnostics(
        hasView ? view : undefined,
        response,
        range?.from ?? 0,
        range?.from ?? 0,
        range?.to ?? state.doc.length,
        payload.sourceMap,
      );
    });
  }

  return true;
}

function evaluateSoft(ctx: EvalContext): boolean {
  const { view, state } = ctx;
  // Soft eval uses the top-level form at cursor (or top_level_string
  // fallback) and reuses the unified payload so the same identity
  // injection + manual-control composition applies (VAL-ID-016:
  // every entry point produces equivalent payloads).
  const range = getTopLevelFormRange(state);
  const visibleSlice = range && range.to > range.from
    ? state.doc.sliceString(range.from, range.to)
    : (top_level_string(state) ?? "");

  if (!visibleSlice || !visibleSlice.trim()) return false;

  // Per-form eval gate: block forms containing holes even for soft eval
  const hasView = view && typeof view.dispatch === "function";
  if (hasView) {
    const holePositions = findHolePositions(visibleSlice);
    if (holePositions.length > 0) {
      // For soft eval, get the range for proper diagnostic positioning
      const holeRange = range ?? { from: 0, to: visibleSlice.length };
      if (range) {
        gateFormWithHoles(view, visibleSlice, range.from, holeRange);
      }
      return true;
    }
  }

  const sliceFrom = range?.from ?? 0;
  const payload = buildPayloadFromState(state, view, visibleSlice, sliceFrom, "soft");

  const isImmediate = visibleSlice.startsWith("@");

  // §4.4: a soft eval registers bindings on WASM only — mark them as previews.
  const bindingKeys = bindingKeysInText(visibleSlice);
  if (bindingKeys.length > 0) {
    markBindingsSoftPreview(bindingKeys);
  }

  if (hasView) {
    // Soft eval must not move the rail-active state (expression-gutter.md §2.4):
    // refresh already-visualised expressions but leave last-evaluated untouched.
    detectAndTrackExpressionEvaluation(view, { isPreview: true });
    flashEvalHighlight(view, undefined, undefined, { isPreview: true });
  }

  const evalPos = state.selection.main.from;

  evalWasm(payload.runtimeCode, {
    isImmediate,
    noModuleMode: true,
    isPreview: true,
    view,
    docOffset: sliceFrom,
    range: range ?? undefined,
    sourceMap: payload.sourceMap,
  })
    .then((result) => {
      if (hasView && result.text) {
        dispatchInlineResult(view, result.text, evalPos, result.isError);
      }
    });

  return true;
}
