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
  { action: "vis.screenshot", key: "Alt-o g", preventDefault: true },

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

  // -- Picker menu (scoped to picker open) ----------------------------------
  { action: "picker.up", key: "ArrowUp", when: "picker.open" },
  { action: "picker.down", key: "ArrowDown", when: "picker.open" },
  { action: "picker.left", key: "ArrowLeft", when: "picker.open" },
  { action: "picker.right", key: "ArrowRight", when: "picker.open" },
  { action: "picker.select", key: "Enter", when: "picker.open" },
  { action: "picker.cancel", key: "Escape", when: "picker.open" },

  // -- Extended structural editing -------------------------------------------
  { action: "edit.raise", key: "Alt-r" },
  { action: "edit.splice", key: "Alt-Shift-s" },
  { action: "edit.wrapList", key: "Alt-(" },
  { action: "edit.wrapVector", key: "Alt-[" },
  { action: "edit.transposeFwd", key: "Alt-ArrowDown" },
  { action: "edit.transposeBack", key: "Alt-ArrowUp" },

  // -- Chord alternatives: structural editing (Alt-e namespace) ------------
  // These are alternatives to the direct Ctrl-bracket bindings above.
  // CodeMirror handles multi-stroke (space-separated) keys natively.
  { action: "edit.slurpFwd", key: "Alt-e ]" },
  { action: "edit.slurpBack", key: "Alt-e [" },
  { action: "edit.barfFwd", key: "Alt-e '" },
  { action: "edit.barfBack", key: "Alt-e ;" },
  { action: "edit.raise", key: "Alt-e r" },
  { action: "edit.splice", key: "Alt-e s" },
  { action: "edit.wrapList", key: "Alt-e w" },
  { action: "edit.wrapVector", key: "Alt-e v" },
  { action: "edit.transposeFwd", key: "Alt-e j" },
  { action: "edit.transposeBack", key: "Alt-e k" },
  { action: "edit.pasteSample", key: "Alt-e p" },

  // -- Chord alternatives: probe management (Alt-o namespace) -------------
  // "o" for "observe" — avoids conflict with direct Alt-p binding.
  { action: "probe.toggle", key: "Alt-o p" },
  { action: "probe.toggleRaw", key: "Alt-o r" },
  { action: "probe.expand", key: "Alt-o h" },
  { action: "probe.contract", key: "Alt-o s" },

  // -- Spatial navigation ---------------------------------------------------
  // Intentionally NO default keyboard binding.  Registered as actions so
  // users can bind them if desired.  The gamepad provides this via the D-pad
  // in every default paradigm (see structural-editing.md §4.5).
  // "nav.up"    — unbound
  // "nav.down"  — unbound
  // "nav.left"  — unbound
  // "nav.right" — unbound

  // -- Live-Edit vector-mark sub-mode (§3.7.3, §3.7.8) --------------------
  { action: "liveEdit.vectorConfirm", key: "Enter", when: "vectorMark.active" },
  { action: "liveEdit.vectorCancel", key: "Escape", when: "vectorMark.active" },
];

// ---------------------------------------------------------------------------
// Default gamepad bindings
// ---------------------------------------------------------------------------

export const defaultGamepadBindings: GamepadBinding[] = [
  { action: "eval.now", combo: ["Start"] },
  { action: "edit.delete", combo: ["Y"] },
  { action: "menu.openBefore", combo: ["LB", "A"] },
  { action: "menu.openAfter", combo: ["RB", "A"] },
  { action: "menu.radial", combo: ["X"] },
];
