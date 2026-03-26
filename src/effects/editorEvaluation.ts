/**
 * Unified editor evaluation — one function, multiple strategies.
 *
 * Replaces the four eval functions that previously lived in editorConfig.ts
 * (evalNow, evalToplevel, evalQuantised, softEval).
 */

import type { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
// @ts-expect-error - no type declarations available for clojure-mode
import { top_level_string } from "@nextjournal/clojure-mode/extensions/eval-region";

import { sendTouSEQ } from "../transport/json-protocol.ts";
import { post } from "../utils/consoleStore.ts";
import { evalInUseqWasm, readLastDiagnostics } from "../runtime/wasmInterpreter.ts";
import { pushDiagnostics, clearDiagnosticsForRange } from "../editors/extensions/diagnostics.ts";
import { rewriteCodeSliceForModule } from "../lib/manualControlState.ts";
import { getStartupFlagsSnapshot } from "../runtime/startupContext.ts";
import { flashEvalHighlight } from "../editors/extensions/evalHighlight.ts";
import { detectAndTrackExpressionEvaluation } from "../editors/extensions/structure.ts";
import { markOutputRunning } from "../utils/outputHealthStore.ts";
import { dispatchInlineResult } from "../editors/extensions/inlineResults.ts";

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
    : (top_level_string(state) as string);
  const moduleSlice = range
    ? rewriteCodeSliceForModule(slice, range.from, range.to)
    : slice;
  return { code: slice, moduleCode: moduleSlice, range };
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

  return evalInUseqWasm(wasmCode)
    .then((result: unknown) => {
      const output = typeof result === "string" ? result : String(result ?? "");
      const trimmed = output.trim();

      // Read diagnostics once
      const diagnostics = readLastDiagnostics();

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
            post(`${outputName} updated`, "log");
          }
        }
      }

      if (opts.isPreview) {
        if (displayText.length > 0) {
          post(`Preview: ${displayText}`);
        } else {
          const snippet = wasmCode.trim().substring(0, 40);
          post(`Preview: ${snippet}${wasmCode.length > 40 ? "..." : ""}`);
        }
        return { text: displayText, isError, pos: evalPos };
      }

      if (!opts.noModuleMode) {
        return { text: displayText, isError, pos: evalPos };
      }

      if (opts.isImmediate) {
        if (trimmed.length > 0) {
          post(`uSEQ: ${trimmed}`);
        }
      } else {
        const echoed = wasmCode.trim();
        if (echoed.length > 0) {
          post(`uSEQ: ${echoed}`);
        }
      }

      return { text: trimmed, isError: false, pos: evalPos };
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[modulisp] eval error: ${message}`);
      if (opts.isPreview) {
        post(`**Preview Error**: ${message.replace(/`/g, "\\`")}`);
      } else if (opts.noModuleMode) {
        post(`**Error**: ${message.replace(/`/g, "\\`")}`);
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
  const code = top_level_string(state) as string;

  if (!code || !code.trim()) return false;

  const isImmediate = code.startsWith("@");

  const hasView = view && typeof view.dispatch === "function";
  if (hasView) {
    detectAndTrackExpressionEvaluation(view);
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
