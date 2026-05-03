/**
 * Keymap generation — driven by the action registry's binding resolver.
 *
 * The resolver (from src/lib/keybindings/) owns all custom bindings (eval,
 * panel toggles, probes, structural editing remaps, undo/redo).
 * This module composes those with the remaining clojure-mode bindings that the
 * resolver does NOT manage, plus the CodeMirror history keymap.
 *
 * Policy-sensitive keys (Backspace, Delete, Enter, brackets) route through the
 * command router — see docs/specs/input-dispatch.md.
 */

import { complete_keymap as completeClojureKeymap } from "@nextjournal/clojure-mode";
import { keymap } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { historyKeymap } from "@codemirror/commands";
import { createResolver } from "../lib/keybindings/resolver.ts";
import { getAppSettings } from "../runtime/appSettingsRepository.ts";
import { executeEditorCommand } from "./commands/editorCommandRouter.ts";

// ---------------------------------------------------------------------------
// Resolver instance — exported so other modules can query/rebind
// ---------------------------------------------------------------------------

export const resolver = createResolver();

// ---------------------------------------------------------------------------
// Policy keys — routed through the command router (input-dispatch.md §3.3).
// These must not appear in remainingClojureBindings or any other keymap
// at default precedence — the router owns their policy enforcement.
// ---------------------------------------------------------------------------

const policyKeys = new Set([
  "Backspace",
  "Delete",
  "Enter",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "\"",
]);

// ---------------------------------------------------------------------------
// Clojure-mode passthrough
//
// The resolver already handles the 4 arrow→bracket remaps (slurp/barf)
// and kill-to-end-of-list.  Policy keys are handled by the command router.
// Filter both sets out, then pass the rest through (indentation, nav, etc.).
// ---------------------------------------------------------------------------

const remappedKeys = new Set([
  "Ctrl-ArrowRight",
  "Ctrl-ArrowLeft",
  "Ctrl-Alt-ArrowLeft",
  "Ctrl-Alt-ArrowRight",
  "Ctrl-k",
]);

const remainingClojureBindings = completeClojureKeymap
  .filter((b: any) => !remappedKeys.has(b.key) && !policyKeys.has(b.key));

// ---------------------------------------------------------------------------
// Policy key dispatcher — Prec.highest so it intercepts before any
// clojure-mode extension or third-party keymap.
// ---------------------------------------------------------------------------

function policyKeyBinding(key: string) {
  return {
    key,
    run: (view: EditorView) => {
      const prevent =
        getAppSettings().editor?.preventBracketUnbalancing ?? true;
      return executeEditorCommand(view, {
        kind: "key",
        key,
        allowBracketUnbalancing: !prevent,
        source: "keyboard",
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Composed keymap extensions
// ---------------------------------------------------------------------------

export let baseKeymap = [
  // Highest precedence: policy keys route through the command router.
  Prec.highest(
    keymap.of([...policyKeys].map(policyKeyBinding)),
  ),

  // Registry-generated bindings (our custom actions)
  ...resolver.toKeymapExtensions(),

  // Remaining clojure-mode bindings (not remapped, not policy keys)
  keymap.of(remainingClojureBindings),

  // History (platform-specific undo/redo variants beyond Mod-z / Shift-Mod-z)
  keymap.of(historyKeymap),
];

export let mainEditorKeymap = [baseKeymap];
