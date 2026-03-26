// src/lib/keybindings/handlers.ts
//
// Handler registry — maps ActionIds to their implementation functions.
// This is the bridge between the pure-data action registry and the
// runtime modules that actually perform each action.
//
// Only editor-invokable actions are registered here. Gamepad-only,
// picker, menu, and analog-only actions are dispatched through their
// respective channel subscribers and do NOT appear in this registry.

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
import {
  toggleCurrentProbe,
  expandCurrentProbeContext,
  contractCurrentProbeContext,
} from "../../editors/extensions/probes.ts";
import {
  deleteCharBackward,
  undo,
  redo,
} from "@codemirror/commands";
import { openPalette } from "../../ui/keybindings/ActionPalette.tsx";
import { complete_keymap as completeClojureKeymap } from "@nextjournal/clojure-mode";

// ---------------------------------------------------------------------------
// Clojure-mode handler extraction
//
// The clojure-mode `complete_keymap` is an array of {key, run, ...} objects.
// We extract `run` functions by their original key strings — the same ones
// that keymaps.ts remaps to bracket keys.
// ---------------------------------------------------------------------------

function findClojureHandler(key: string): EditorHandler | undefined {
  const binding = completeClojureKeymap.find(
    (b: { key?: string }) => b.key === key,
  );
  return binding?.run as EditorHandler | undefined;
}

// Original clojure-mode keys → our remapped keys:
//   Ctrl-ArrowRight    → Ctrl-]  (slurp forward)
//   Ctrl-ArrowLeft     → Ctrl-[  (slurp backward)
//   Ctrl-Alt-ArrowRight → Ctrl-' (barf forward)
//   Ctrl-Alt-ArrowLeft  → Ctrl-; (barf backward)
const slurpForward = findClojureHandler("Ctrl-ArrowRight");
const slurpBackward = findClojureHandler("Ctrl-ArrowLeft");
const barfForward = findClojureHandler("Ctrl-Alt-ArrowRight");
const barfBackward = findClojureHandler("Ctrl-Alt-ArrowLeft");
const killToEndOfList = findClojureHandler("Ctrl-k");

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

  // -- Editor ---------------------------------------------------------------
  "doc.symbol": showDocumentationForSymbol,
  "edit.undo": undo,
  "edit.redo": redo,
  "edit.backspaceNormal": deleteCharBackward,

  // -- Structure (clojure-mode remapped handlers) ---------------------------
  ...(slurpForward && { "edit.slurpFwd": slurpForward }),
  ...(slurpBackward && { "edit.slurpBack": slurpBackward }),
  ...(barfForward && { "edit.barfFwd": barfForward }),
  ...(barfBackward && { "edit.barfBack": barfBackward }),
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
