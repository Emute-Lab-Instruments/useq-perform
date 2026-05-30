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
import { discoverSlotsAfterEval, runBootReconciliation } from "./liveEditRuntime.ts";

// Editor eval and diagnostics readback are atomic on the active WASM
// runtime port: `evalCodeWithDiagnostics` returns the eval's own
// diagnostics, read inside the same worker handler. A separate
// `readLastDiagnostics` round-trip would race when two evals overlap,
// because the diagnostics slot is global and the second eval clobbers it
// before the first eval's read can see it — see
// `src/runtime/diagnosticReadRace.test.ts`.
const evalInUseqWasm = (
  code: string,
): Promise<{ result: string | null; diagnostics: UseqDiagnostic[] }> =>
  getActiveWasmRuntimePort().evalCodeWithDiagnostics(code);
import { pushDiagnostics, clearDiagnosticsForRange } from "../editors/extensions/diagnostics.ts";
import { rewriteCodeSliceForModule } from "../lib/manualControlState.ts";
import { getStartupFlagsSnapshot } from "../runtime/startupContext.ts";
import { flashEvalHighlight } from "../editors/extensions/evalHighlight.ts";
import { detectAndTrackExpressionEvaluation } from "../editors/extensions/expressionEval.ts";
import { markOutputRunning } from "../utils/outputHealthStore.ts";
import { dispatchInlineResult } from "../editors/extensions/inlineResults.ts";
import type { UseqDiagnostic } from "../runtime/wasmInterpreter.ts";
import { findHolePositions, findHoleEnd } from "../lib/holeDetection.ts";

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

function getToplevelCode(state: EditorState): {
  code: string;
  moduleCode: string;
  range: { from: number; to: number } | null;
} {
  const range = getTopLevelFormRange(state);
  const slice = range
    ? state.doc.sliceString(range.from, range.to)
    : (top_level_string(state) ?? "");
  const moduleSlice = range
    ? rewriteCodeSliceForModule(slice, range.from, range.to)
    : slice;
  return { code: slice, moduleCode: moduleSlice, range };
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
    .then(async ({ result, diagnostics }) => {
      // A newer eval has been dispatched on this view since we started.
      // Drop our result so we don't clobber the fresher eval's effects.
      // Empty `text` makes the outer `.then`'s `dispatchInlineResult` a
      // no-op, and we skip every editor-state mutation below.
      if (isStale()) {
        return { text: "", isError: false, pos: evalPos };
      }
      const output = typeof result === "string" ? result : String(result ?? "");
      const trimmed = output.trim();

      if (opts.view) {
        if (diagnostics.length > 0) {
          pushDiagnostics(opts.view, diagnostics, docOffset, rangeFrom, rangeTo);
        } else {
          // Only clear diagnostics for the range we just eval'd successfully
          clearDiagnosticsForRange(opts.view, rangeFrom, rangeTo);
        }
      }

      if (trimmed.length > 0) {
        console.log(`[modulisp] ${wasmCode.trim()}  →  ${trimmed}`);
      }

      // Check if diagnostics indicate an error
      const hasErrors = diagnostics.some(
        (d) => d.severity === "error",
      );

      // Show first error message inline instead of "{error}"
      const displayText =
        hasErrors && diagnostics.length > 0
          ? diagnostics[0].message
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
          // §7.3 trigger 3: boot-time reconciliation after first successful eval.
          runBootReconciliation(opts.view);
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

        const rewritten = rewriteCodeSliceForModule(sel.text, sel.from, sel.to);
        const code = "@" + rewritten;
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
        }).then((result) => {
          if (result.text) {
            dispatchInlineResult(view, result.text, sel.to, result.isError);
          }
        });

        sendTouSEQ(code);
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
  const { code: rawCode, moduleCode: rawModuleCode, range } = getToplevelCode(state);

  const code = prefix + rawCode;
  const moduleCode = prefix + rawModuleCode;
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
  }).then((result) => {
      if (hasView && result.text) {
        dispatchInlineResult(view, result.text, evalPos, result.isError);
      }
    });

  if (!noModuleMode) {
    sendTouSEQ(moduleCode);
  }

  return true;
}

function evaluateSoft(ctx: EvalContext): boolean {
  const { view, state } = ctx;
  const code = top_level_string(state) ?? "";

  if (!code || !code.trim()) return false;

  // Per-form eval gate: block forms containing holes even for soft eval
  const hasView = view && typeof view.dispatch === "function";
  if (hasView) {
    const holePositions = findHolePositions(code);
    if (holePositions.length > 0) {
      // For soft eval, get the range for proper diagnostic positioning
      const range = getTopLevelFormRange(state);
      if (range) {
        gateFormWithHoles(view, code, range.from, range);
      }
      return true;
    }
  }

  const isImmediate = code.startsWith("@");

  if (hasView) {
    // Soft eval must not move the rail-active state (expression-gutter.md §2.4):
    // refresh already-visualised expressions but leave last-evaluated untouched.
    detectAndTrackExpressionEvaluation(view, { isPreview: true });
    flashEvalHighlight(view, undefined, undefined, { isPreview: true });
  }

  const evalPos = state.selection.main.from;

  evalWasm(code, { isImmediate, noModuleMode: true, isPreview: true, view })
    .then((result) => {
      if (hasView && result.text) {
        dispatchInlineResult(view, result.text, evalPos, result.isError);
      }
    });

  return true;
}
