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
import { evalInUseqWasm } from "../runtime/wasmInterpreter.ts";
import { rewriteCodeSliceForModule } from "../lib/manualControlState.ts";
import { getStartupFlagsSnapshot } from "../runtime/startupContext.ts";
import { flashEvalHighlight } from "../editors/extensions/evalHighlight.ts";
import { detectAndTrackExpressionEvaluation } from "../editors/extensions/structure.ts";

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
  },
): void {
  const wasmCode = opts.isImmediate ? code.slice(1) : code;

  evalInUseqWasm(wasmCode)
    .then((result: unknown) => {
      if (opts.isPreview) {
        const output = typeof result === "string" ? result : String(result ?? "");
        const trimmed = output.trim();
        if (trimmed.length > 0) {
          post(`Preview: ${trimmed}`);
        } else {
          const snippet = wasmCode.trim().substring(0, 40);
          post(`Preview: ${snippet}${wasmCode.length > 40 ? "..." : ""}`);
        }
        return;
      }

      if (!opts.noModuleMode) return;

      if (opts.isImmediate) {
        const output = typeof result === "string" ? result : String(result ?? "");
        const trimmed = output.trim();
        if (trimmed.length > 0) {
          post(`uSEQ: ${trimmed}`);
        }
      } else {
        const echoed = wasmCode.trim();
        if (echoed.length > 0) {
          post(`uSEQ: ${echoed}`);
        }
      }
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (opts.isPreview) {
        post(`**Preview Error**: ${message.replace(/`/g, "\\`")}`);
      } else if (opts.noModuleMode) {
        post(`**Error**: ${message.replace(/`/g, "\\`")}`);
      } else {
        console.error("uSEQ WASM interpreter evaluation failed", error);
      }
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
  const { code: rawCode, moduleCode: rawModuleCode } = getToplevelCode(state);

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

  evalWasm(code, { isImmediate, noModuleMode, isPreview: false });

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

  evalWasm(code, { isImmediate, noModuleMode: true, isPreview: true });

  return true;
}
