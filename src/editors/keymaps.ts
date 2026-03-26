/**
 * Keymap generation — driven by the action registry's binding resolver.
 *
 * The resolver (from src/lib/keybindings/) owns all custom bindings (eval,
 * panel toggles, probes, structural editing remaps, undo/redo, backspace gate).
 * This module composes those with the remaining clojure-mode bindings that the
 * resolver does NOT manage, plus the CodeMirror history keymap.
 */

import { complete_keymap as completeClojureKeymap } from "@nextjournal/clojure-mode";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { historyKeymap, deleteCharBackward } from "@codemirror/commands";
import { createResolver } from "../lib/keybindings/resolver.ts";
import { getAppSettings } from "../runtime/appSettingsRepository.ts";
import { makeDeleteWrapper } from "./editorKeyboard.ts";

// ---------------------------------------------------------------------------
// Resolver instance — exported so other modules can query/rebind
// ---------------------------------------------------------------------------

export const resolver = createResolver();

// ---------------------------------------------------------------------------
// Clojure-mode passthrough
//
// The resolver already handles the 4 arrow→bracket remaps (slurp/barf),
// kill-to-end-of-list, and the Backspace gate.  Filter those out so they
// don't double-fire, then pass the rest through (bracket closing, indentation,
// etc.).  The Delete binding gets the bracket-protection wrapper.
// ---------------------------------------------------------------------------

const remappedKeys = new Set([
  "Ctrl-ArrowRight",
  "Ctrl-ArrowLeft",
  "Ctrl-Alt-ArrowLeft",
  "Ctrl-Alt-ArrowRight",
  "Ctrl-k",
]);

const remainingClojureBindings = completeClojureKeymap
  .filter((b: any) => !remappedKeys.has(b.key))
  .map((b: any) => {
    if (b.key === "Delete") {
      return { ...b, run: makeDeleteWrapper(b.run) };
    }
    return b;
  });

// ---------------------------------------------------------------------------
// Composed keymap extensions
// ---------------------------------------------------------------------------

export let baseKeymap = [
  // Highest precedence: Backspace gate (settings-dependent).
  // When bracket protection is disabled, normal backspace takes precedence
  // over clojure-mode's bracket-aware handler.
  Prec.highest(
    keymap.of([
      {
        key: "Backspace",
        run: (view) => {
          const prevent =
            getAppSettings().editor?.preventBracketUnbalancing ?? true;
          if (!prevent) {
            return deleteCharBackward(view);
          }
          // Feature enabled: let lower keymaps (clojure-mode) handle it
          return false;
        },
      },
    ]),
  ),

  // Registry-generated bindings (our custom actions)
  ...resolver.toKeymapExtensions(),

  // Remaining clojure-mode bindings (not remapped by us)
  keymap.of(remainingClojureBindings),

  // History (platform-specific undo/redo variants beyond Mod-z / Shift-Mod-z)
  keymap.of(historyKeymap),
];

export let mainEditorKeymap = [baseKeymap];
