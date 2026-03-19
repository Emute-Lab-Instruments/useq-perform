// @ts-nocheck
// CODEMIRROR IMPORTS
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { deleteCharForward } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";

// NEXTJOURNAL (clojure-mode)
// @ts-expect-error - no type declarations available for clojure-mode
import { extension as eval_ext, cursor_node_string, top_level_string } from "@nextjournal/clojure-mode/extensions/eval-region";

// SERIAL COMMUNICATION
import { sendTouSEQ } from "../../transport/legacy-text-protocol.ts";
import { isConnectedToModule } from "../../transport/connector.ts";
import { post } from "../../utils/consoleStore.ts";
import { evalInUseqWasm } from "../io/useqWasmInterpreter.ts";
import { rewriteCodeSliceForModule } from "./manualControlState.ts";

import { getAppSettings } from "../../runtime/appSettingsRepository.ts";
import { applyEditorFontSize } from "../../lib/editorStore.ts";
import { referenceSearchChannel } from "../../ui/help/helpChannels.ts";

import { dbg } from "../../lib/debug.ts";
import { getStartupFlagsSnapshot } from "../../runtime/startupContext.ts";
import {
  getVisualisationPanelStyles,
  isVisualisationPanelVisible,
  toggleVisualisationPanel,
} from "../../ui/adapters/visualisationPanel";

import { flashEvalHighlight } from "./extensions/evalHighlight.ts";
import { detectAndTrackExpressionEvaluation } from "./extensions/structure.ts";

interface EvalOpts {
  state: EditorState;
  view?: EditorView;
}

interface CSSProperties {
  [key: string]: string;
}

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

function evalSelection(opts: EvalOpts, prefix: string = ""): boolean {
  const state = opts.state;
  if (!state?.selection) {
    return false;
  }

  const main = state.selection.main;
  if (!main || main.empty) {
    return false;
  }

  const slice = state.doc.sliceString(main.from, main.to);
  const rewritten = rewriteCodeSliceForModule(slice, main.from, main.to);
  const code = prefix + rewritten;
  if (!code.trim()) {
    return false;
  }

  if (opts.view && typeof opts.view.dispatch === 'function' && isConnectedToModule()) {
    flashEvalHighlight(opts.view, main.from, main.to);
  }

  sendTouSEQ(code);
  return true;
}

export function evalToplevel(opts: EvalOpts, prefix: string = ""): boolean {
  const state = opts.state;
  const startupFlags = getStartupFlagsSnapshot();
  const noModuleMode = startupFlags.noModuleMode;
  const range = getTopLevelFormRange(state);
  const slice = range
    ? state.doc.sliceString(range.from, range.to)
    : top_level_string(state);

  const code = prefix + slice;
  const moduleCode = range
    ? prefix + rewriteCodeSliceForModule(slice, range.from, range.to)
    : code;

  const isImmediate = code.startsWith("@");
  const wasmCode = isImmediate ? code.slice(1) : code;

  const hasView = opts.view && typeof opts.view.dispatch === 'function';
  if (hasView) {
    detectAndTrackExpressionEvaluation(opts.view!);
  }

  if (hasView && isConnectedToModule()) {
    const sel = state.selection.main;
    if (!sel.empty) {
      flashEvalHighlight(opts.view!, sel.from, sel.to);
    } else {
      flashEvalHighlight(opts.view!, undefined, undefined);
    }
  }

  evalInUseqWasm(wasmCode)
    .then((result: any) => {
      if (!noModuleMode) {
        return;
      }

      if (isImmediate) {
        const output = typeof result === 'string' ? result : String(result ?? '');
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
      if (noModuleMode) {
        post(`**Error**: ${message.replace(/`/g, '\\`')}`);
      } else {
        console.error('uSEQ WASM interpreter evaluation failed', error);
      }
    });

  if (!noModuleMode) {
    sendTouSEQ(moduleCode);
  }
  return true;
}

export function evalToplevelAsync(opts: EvalOpts): boolean {
  return evalToplevel(opts, "@");
}

export function evalNow(opts: EvalOpts): boolean {
  const state = opts.state;
  if (state?.selection) {
    const main = state.selection.main;
    if (main && !main.empty) {
      const evaluated = evalSelection(opts, "@");
      if (evaluated) {
        return true;
      }
    }
  }
  return evalToplevel(opts, "@");
}

export function evalQuantised(opts: EvalOpts): boolean {
  return evalToplevel(opts);
}

export function softEval(opts: EvalOpts): boolean {
  const state = opts.state;
  const code = top_level_string(state);

  if (!code || !code.trim()) {
    return false;
  }

  const isImmediate = code.startsWith("@");
  const wasmCode = isImmediate ? code.slice(1) : code;

  const hasView = opts.view && typeof opts.view.dispatch === 'function';
  if (hasView) {
    detectAndTrackExpressionEvaluation(opts.view!);
    flashEvalHighlight(opts.view!, undefined, undefined, { isPreview: true });
  }

  evalInUseqWasm(wasmCode)
    .then((result: any) => {
      const output = typeof result === 'string' ? result : String(result ?? '');
      const trimmed = output.trim();
      if (trimmed.length > 0) {
        post(`Preview: ${trimmed}`);
      } else {
        post(`Preview: ${wasmCode.trim().substring(0, 40)}${wasmCode.length > 40 ? '...' : ''}`);
      }
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      post(`**Preview Error**: ${message.replace(/`/g, '\\`')}`);
    });

  return true;
}

export function toggleHelp(): boolean {
  // Delegate to the Solid panels adapter signal system
  import("../../ui/adapters/panels.tsx")
    .then((m) => m.togglePanelVisibility("help"))
    .catch(() => {});
  return true;
}

export function toggleSerialVisInternal(): boolean {
  toggleVisualisationPanel();
  return true;
}

export function isPanelVisible(panel: HTMLElement | null): boolean {
  return isVisualisationPanelVisible(panel);
}

export function getPanelStyles(makeVisible: boolean): CSSProperties {
  return getVisualisationPanelStyles(makeVisible);
}

export function getCanvasDimensions(): { width: number; height: number } {
  return {
    width: window.innerWidth,
    height: window.innerHeight
  };
}

export function getCanvasStyles(): CSSProperties {
  return {
    "display": "block",
    "width": "100%",
    "height": "100%",
    "background-color": "transparent",
    "position": "absolute",
    "top": "0",
    "left": "0"
  };
}

export function toggleSerialVis(): boolean {
  dbg("Toggling serial visualization");
  return toggleVisualisationPanel();
}

export function setFontSize(editor: EditorView | null, size: number): void {
  if (!editor) return;
  applyEditorFontSize(editor, size);
}

const openingBracketChars = ["(", "[", "{"];
const closingBracketChars = [")", "]", "}"];
const bracketChars = openingBracketChars.concat(closingBracketChars);

export function areMatchingBracketChars(char1: string, char2: string): boolean {
  const idx1 = openingBracketChars.indexOf(char1);
  if (idx1 >= 0) {
    return char2 === closingBracketChars[idx1];
  }
  const idx2 = closingBracketChars.indexOf(char1);
  if (idx2 >= 0) {
    return char2 === openingBracketChars[idx2];
  }
  return false;
}

export function makeDeleteWrapper(originalRun: (view: EditorView) => boolean) {
  return (view: EditorView): boolean => {
    const userSettings = getAppSettings();
    const preventUnbalancing = userSettings.editor?.preventBracketUnbalancing ?? true;
    dbg("Delete wrapper - prevent unbalancing setting:", preventUnbalancing);

    if (!preventUnbalancing) {
      dbg("Bracket prevention DISABLED, using normal deletion");
      return originalRun(view);
    }

    dbg("Bracket prevention ENABLED, checking brackets");

    const { state } = view;
    const { from } = state.selection.main;

    const nextChar = state.doc.sliceString(from, from + 1);
    if (bracketChars.includes(nextChar)) {
      const prevChar = state.doc.sliceString(from - 1, from);
      if (areMatchingBracketChars(prevChar, nextChar)) {
        dbg("matching brackets");
        view.dispatch({
          changes: { from: from - 1, to: from, insert: "" },
        });
        deleteCharForward(view);
        return true;
      } else {
        return originalRun(view);
      }
    }
    return originalRun(view);
  };
}

export function showDocumentationForSymbol(view: EditorView): boolean {
  if (!view || !view.state) return false;

  const state = view.state;
  const { from, to } = state.selection.main;

  let symbol = "";
  if (from !== to) {
    symbol = state.doc.sliceString(from, to).trim();
  } else {
    const cursor = from;
    const line = state.doc.lineAt(cursor);
    const lineText = line.text;
    let start = cursor - line.from;
    let end = start;

    while (start > 0 && /[\w\-!?*+<>=]/.test(lineText.charAt(start - 1))) {
      start -= 1;
    }
    while (end < lineText.length && /[\w\-!?*+<>=]/.test(lineText.charAt(end))) {
      end += 1;
    }

    if (start < end) {
      symbol = lineText.substring(start, end);
    }
  }

  if (!symbol) return false;

  referenceSearchChannel.publish({ symbol });

  return true;
}
