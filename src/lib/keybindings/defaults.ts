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

  // -- Zen mode -------------------------------------------------------------
  { action: "view.zenMode", key: "Mod-Shift-z", preventDefault: true },

  // -- Panel toggles (from useq_keymap) -------------------------------------
  { action: "panel.help", key: "Alt-/", preventDefault: true },
  { action: "panel.vis", key: "Alt-g", preventDefault: true },
  // live-edit.md §5.1.5 — panel toggle keybinding (L for Live edits).
  { action: "liveEdit.panel.toggle", key: "Alt-l", preventDefault: true },
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
  { action: "edit.barfFwd", key: "Ctrl-Shift-]" },
  { action: "edit.barfBack", key: "Ctrl-Shift-[" },

  // -- Clojure-mode passthrough (not remapped) ------------------------------
  { action: "edit.killToEndOfList", key: "Ctrl-k" },

  // -- History (from historyKeymap) -----------------------------------------
  { action: "edit.undo", key: "Mod-z" },
  { action: "edit.redo", key: "Shift-Mod-z" },

  // -- Navigation -----------------------------------------------------------
  { action: "nav.home", key: "Home" },
  { action: "nav.end", key: "End" },

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
  { action: "edit.barfFwd", key: "Alt-e Shift-]" },
  { action: "edit.barfBack", key: "Alt-e Shift-[" },
  { action: "edit.raise", key: "Alt-e r" },
  { action: "edit.splice", key: "Alt-e s" },
  { action: "edit.wrapList", key: "Alt-e w" },
  { action: "edit.wrapVector", key: "Alt-e v" },
  { action: "edit.transposeFwd", key: "Alt-e j" },
  { action: "edit.transposeBack", key: "Alt-e k" },
  { action: "edit.pasteSample", key: "Alt-e p" },
  { action: "namespace.pick", key: "Alt-e n" },

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

  // -- Main menu (main-menu.md §2.1.2) --------------------------------------
  // Escape opens the system/pause menu, but only when no sub-mode owns Escape:
  // vectorCancel's when-clause ("vectorMark.active") is its exact negation, so
  // the two Escape bindings are provably non-overlapping — exactly one is ever
  // active — which both `evaluateWhen` (fire-time) and
  // `whenExpressionsOverlap` (conflict check) honour.
  // (The legacy picker.cancel gate was removed with the picker layer —
  // radial-menu.md §11.3: the radial layer replaces the picker layer. The
  // main menu must also open while the radial menu is open per
  // main-menu.md §1.4, so no radial gate here.)
  // Ctrl+Shift+P is NOT used — it is already palette.open (see above); §2.1.2
  // lists it as a non-binding "secondary" suggestion, so Escape is the opener.
  {
    action: "mainMenu.open",
    key: "Escape",
    when: "!vectorMark.active",
    preventDefault: false,
  },
];
