/**
 * Default Bindings — data-only module.
 *
 * Extracts every hardcoded binding from the legacy keymaps into a declarative
 * array that the binding resolver can consume.  No runtime imports — only types.
 */

import type { ActionId } from "./actions.ts";

// ---------------------------------------------------------------------------
// Binding types
// ---------------------------------------------------------------------------

export interface KeyBinding {
  action: ActionId;
  key: string; // CodeMirror key notation
  when?: string; // Context predicate expression
  preventDefault?: boolean; // Default true
}

export interface GamepadBinding {
  action: ActionId;
  combo: string[]; // Button names: ["LB", "A"], ["Start"]
  when?: string; // Same context predicates as keyboard
}

// ---------------------------------------------------------------------------
// Default keyboard bindings
// ---------------------------------------------------------------------------

export const defaultKeyBindings: KeyBinding[] = [
  // -- Evaluation (from useq_keymap) ----------------------------------------
  { action: "eval.now", key: "Mod-Enter" },
  { action: "eval.quantised", key: "Alt-Enter" },
  { action: "eval.soft", key: "Mod-Shift-Enter" },

  // -- Action palette ---------------------------------------------------------
  { action: "palette.open", key: "Mod-Shift-p" },

  // -- Panel toggles (from useq_keymap) -------------------------------------
  { action: "panel.help", key: "Alt-/", preventDefault: true },
  { action: "panel.vis", key: "Alt-g", preventDefault: true },

  // -- Documentation (from useq_keymap) -------------------------------------
  { action: "doc.symbol", key: "Alt-f", preventDefault: true },

  // -- Probe management (from useq_keymap) ----------------------------------
  { action: "probe.toggle", key: "Alt-p", preventDefault: true },
  { action: "probe.toggleRaw", key: "Alt-Shift-p", preventDefault: true },
  { action: "probe.expand", key: "Alt-h", preventDefault: true },
  { action: "probe.contract", key: "Alt-s", preventDefault: true },

  // -- Structural editing (clojure-mode remappings) -------------------------
  // Original clojure-mode binds Ctrl-Arrow; remapped to bracket keys to avoid
  // OS interception on macOS / Linux.
  { action: "edit.slurpFwd", key: "Ctrl-]" },
  { action: "edit.slurpBack", key: "Ctrl-[" },
  { action: "edit.barfFwd", key: "Ctrl-'" },
  { action: "edit.barfBack", key: "Ctrl-;" },

  // -- Clojure-mode passthrough (not remapped) ------------------------------
  { action: "edit.killToEndOfList", key: "Ctrl-k" },

  // -- History (from historyKeymap) -----------------------------------------
  { action: "edit.undo", key: "Mod-z" },
  { action: "edit.redo", key: "Shift-Mod-z" },

  // -- Navigation -----------------------------------------------------------
  { action: "nav.home", key: "Home" },
  { action: "nav.end", key: "End" },

  // -- Backspace gate -------------------------------------------------------
  // When bracket protection is disabled, normal backspace takes precedence
  // over clojure-mode's bracket-aware handler.
  {
    action: "edit.backspaceNormal",
    key: "Backspace",
    when: "!editor.bracketProtect",
  },

  // -- Picker menu (scoped to picker open) ----------------------------------
  { action: "picker.up", key: "ArrowUp", when: "picker.open" },
  { action: "picker.down", key: "ArrowDown", when: "picker.open" },
  { action: "picker.left", key: "ArrowLeft", when: "picker.open" },
  { action: "picker.right", key: "ArrowRight", when: "picker.open" },
  { action: "picker.select", key: "Enter", when: "picker.open" },
  { action: "picker.cancel", key: "Escape", when: "picker.open" },

  // -- Chord alternatives: structural editing (Alt-e namespace) ------------
  // These are alternatives to the direct Ctrl-bracket bindings above.
  // CodeMirror handles multi-stroke (space-separated) keys natively.
  { action: "edit.slurpFwd", key: "Alt-e ]" },
  { action: "edit.slurpBack", key: "Alt-e [" },
  { action: "edit.barfFwd", key: "Alt-e '" },
  { action: "edit.barfBack", key: "Alt-e ;" },

  // -- Chord alternatives: probe management (Alt-o namespace) -------------
  // "o" for "observe" — avoids conflict with direct Alt-p binding.
  { action: "probe.toggle", key: "Alt-o p" },
  { action: "probe.toggleRaw", key: "Alt-o r" },
  { action: "probe.expand", key: "Alt-o h" },
  { action: "probe.contract", key: "Alt-o s" },

  // -- Structural navigation ------------------------------------------------
  // Intentionally NO default binding.  Registered as actions so users can
  // bind them if desired.  The gamepad provides this via navigation mode.
  // "nav.structuralUp"    — unbound
  // "nav.structuralDown"  — unbound
  // "nav.structuralLeft"  — unbound
  // "nav.structuralRight" — unbound
];

// ---------------------------------------------------------------------------
// Default gamepad bindings
// ---------------------------------------------------------------------------

export const defaultGamepadBindings: GamepadBinding[] = [
  { action: "eval.now", combo: ["Start"] },
  { action: "nav.toggleMode", combo: ["Back"] },
  { action: "edit.delete", combo: ["Y"] },
  { action: "menu.openBefore", combo: ["LB", "A"] },
  { action: "menu.openAfter", combo: ["RB", "A"] },
  { action: "menu.radial", combo: ["X"] },
];
