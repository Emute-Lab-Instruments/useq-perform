// src/lib/keybindings/handlers.ts
//
// Handler registry — maps ActionIds to their implementation functions.
// This is the bridge between the pure-data action registry and the
// runtime modules that actually perform each action.
//
// Editor-invokable actions are registered here regardless of whether they are
// triggered by keyboard, gamepad, palette, or another input resolver. Menu UI
// actions and analog-only streams still use their own typed channels.

import type { EditorView } from "@codemirror/view";
import type { ActionId } from "./actions.ts";

// ---------------------------------------------------------------------------
// Handler types
// ---------------------------------------------------------------------------

/** Handler that receives the CodeMirror EditorView. */
export type EditorHandler = (view: EditorView) => boolean;

/** Handler that needs no editor context (panel toggles, etc.). */
export type VoidHandler = () => boolean;

/** Union of both handler shapes. */
export type ActionHandler = EditorHandler | VoidHandler;

// ---------------------------------------------------------------------------
// Imports from runtime modules
// ---------------------------------------------------------------------------

import { evaluate } from "../../effects/editorEvaluation.ts";
import {
  toggleHelp,
  toggleSerialVis,
  showDocumentationForSymbol,
} from "../../editors/editorKeyboard.ts";
import { requestVisScreenshot } from "../../ui/visualisation/serialVisGL.ts";
import {
  toggleCurrentProbe,
  expandCurrentProbeContext,
  contractCurrentProbeContext,
} from "../../editors/extensions/probes.ts";
import {
  cursorLineEnd,
  cursorLineStart,
} from "@codemirror/commands";
import { SAMPLE_CODE } from "./sampleCode.ts";
import { openPalette } from "../../ui/keybindings/ActionPalette.tsx";
import { executeEditorCommand } from "../../editors/commands/editorCommandRouter.ts";
import { complete_keymap as completeClojureKeymap } from "@nextjournal/clojure-mode";

// ---------------------------------------------------------------------------
// Clojure-mode handler extraction (legacy — retained only for killToEndOfList
// which has no functional-core equivalent yet)
// ---------------------------------------------------------------------------

function findClojureHandler(key: string): EditorHandler | undefined {
  const binding = completeClojureKeymap.find(
    (b: { key?: string }) => b.key === key,
  );
  return binding?.run as EditorHandler | undefined;
}

const killToEndOfList = findClojureHandler("Ctrl-k");

// ---------------------------------------------------------------------------
// Structural-editing handlers via the functional core adapter.
//
// Each edit.* action that the core supports is dispatched through the adapter's
// `dispatchAction`, which: reads the core State from the editor, runs the pure
// op, and applies the resulting tree change back as a CodeMirror transaction.
// ---------------------------------------------------------------------------

function structHandler(dispatchName: string): EditorHandler {
  return (view) =>
    executeEditorCommand(view, {
      kind: "structural",
      action: dispatchName,
      source: "keyboard",
    });
}

// ---------------------------------------------------------------------------
// Handler registry
// ---------------------------------------------------------------------------

const handlers: Partial<Record<ActionId, ActionHandler>> = {
  // -- Core (evaluation) ----------------------------------------------------
  "eval.now": (view: EditorView) => evaluate(view, "expression"),
  "eval.quantised": (view: EditorView) => evaluate(view, "toplevel"),
  "eval.soft": (view: EditorView) => evaluate(view, "soft"),

  // -- UI -------------------------------------------------------------------
  "palette.open": () => { openPalette(); return true; },
  "panel.help": toggleHelp,
  "panel.vis": toggleSerialVis,
  "vis.screenshot": () => { requestVisScreenshot(); return true; },

  // -- Editor ---------------------------------------------------------------
  "edit.pasteSample": (view: EditorView) =>
    executeEditorCommand(view, {
      kind: "replaceDocument",
      text: SAMPLE_CODE,
      source: "keyboard",
    }),
  "doc.symbol": showDocumentationForSymbol,
  "edit.undo": (view: EditorView) =>
    executeEditorCommand(view, { kind: "undo", source: "keyboard" }),
  "edit.redo": (view: EditorView) =>
    executeEditorCommand(view, { kind: "redo", source: "keyboard" }),
  "edit.delete": (view: EditorView) =>
    executeEditorCommand(view, { kind: "deleteNode", source: "keyboard" }),

  // -- Navigation (cursor movement) ------------------------------------------
  "nav.home": cursorLineStart,
  "nav.end": cursorLineEnd,

  // -- Structure (functional-core via adapter dispatcher) --------------------
  "edit.slurpFwd": structHandler("edit.slurpForward"),
  "edit.slurpBack": structHandler("edit.slurpBackward"),
  "edit.barfFwd": structHandler("edit.barfForward"),
  "edit.barfBack": structHandler("edit.barfBackward"),
  "edit.raise": structHandler("edit.raise"),
  "edit.splice": structHandler("edit.splice"),
  "edit.wrapList": structHandler("edit.encloseList"),
  "edit.wrapVector": structHandler("edit.encloseVector"),
  "edit.transposeFwd": structHandler("edit.transposeNext"),
  "edit.transposeBack": structHandler("edit.transposePrev"),

  // -- Gamepad editor actions ----------------------------------------------
  "nav.adjustNumber": (view: EditorView) =>
    executeEditorCommand(view, {
      kind: "adjustNumber",
      delta: 1,
      source: "gamepad",
    }),
  "control.toggleManualLeft": (view: EditorView) =>
    executeEditorCommand(view, {
      kind: "toggleManualControl",
      stick: "left",
      source: "gamepad",
    }),
  "control.toggleManualRight": (view: EditorView) =>
    executeEditorCommand(view, {
      kind: "toggleManualControl",
      stick: "right",
      source: "gamepad",
    }),

  // -- Structure (legacy — no core equivalent yet) --------------------------
  ...(killToEndOfList && { "edit.killToEndOfList": killToEndOfList }),

  // -- Probe ----------------------------------------------------------------
  "probe.toggle": (view: EditorView) => toggleCurrentProbe(view, "contextual"),
  "probe.toggleRaw": (view: EditorView) => toggleCurrentProbe(view, "raw"),
  "probe.expand": expandCurrentProbeContext,
  "probe.contract": contractCurrentProbeContext,
};

// ---------------------------------------------------------------------------
// Lookup helper
// ---------------------------------------------------------------------------

/**
 * Retrieve the handler for an action, or `undefined` if the action has no
 * editor handler (e.g. gamepad-only or picker actions).
 */
export function getHandler(id: ActionId): ActionHandler | undefined {
  return handlers[id];
}

// Re-export the registry for testing / introspection
export { handlers };
