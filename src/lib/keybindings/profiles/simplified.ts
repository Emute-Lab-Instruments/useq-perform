/**
 * Simplified Binding Profile — accessibility-oriented keybinding set.
 *
 * Design principles:
 * - No three-key combos (no Ctrl-Shift-X or similar)
 * - Uses chords instead of simultaneous multi-modifier combos where possible
 * - Prioritises home-row-adjacent keys
 * - Ships as an alternative to the default bindings
 *
 * This is a data-only module. Use it by passing to `createResolver()`:
 *
 *   createResolver({ defaults: simplifiedBindings })
 */

import type { KeyBinding } from "../defaults.ts";

// ---------------------------------------------------------------------------
// Simplified keyboard bindings
// ---------------------------------------------------------------------------

export const simplifiedBindings: KeyBinding[] = [
  // -- Evaluation (2-key combos, same as default) ---------------------------
  { action: "eval.now", key: "Mod-Enter" },
  { action: "eval.quantised", key: "Alt-Enter" },
  // Soft eval: chord instead of Mod-Shift-Enter (3-key combo)
  { action: "eval.soft", key: "Alt-e Enter" },

  // -- Action palette -------------------------------------------------------
  // Simplified from Mod-Shift-p (3-key combo)
  // Note: Alt-p is used for probe.toggle in default profile, but in simplified
  // profile all probes use the Alt-o chord namespace, so Alt-p is free.
  { action: "palette.open", key: "Alt-p" },

  // -- Panel toggles (2-key combos, same as default) ------------------------
  { action: "panel.help", key: "Alt-/" },
  { action: "panel.vis", key: "Alt-g" },

  // -- Documentation --------------------------------------------------------
  { action: "doc.symbol", key: "Alt-f" },

  // -- Probe management (chord namespace: Alt-o) ----------------------------
  // "o" for "observe" — all probes behind a single leader key
  { action: "probe.toggle", key: "Alt-o p" },
  { action: "probe.toggleRaw", key: "Alt-o r" },
  { action: "probe.expand", key: "Alt-o h" },
  { action: "probe.contract", key: "Alt-o s" },

  // -- Structural editing (chord namespace: Alt-e) --------------------------
  // Chords instead of Ctrl-bracket (keeps simultaneous modifier count to 1)
  { action: "edit.slurpFwd", key: "Alt-e ]" },
  { action: "edit.slurpBack", key: "Alt-e [" },
  { action: "edit.barfFwd", key: "Alt-e '" },
  { action: "edit.barfBack", key: "Alt-e ;" },

  // -- Clojure-mode passthrough ---------------------------------------------
  { action: "edit.killToEndOfList", key: "Ctrl-k" },

  // -- History --------------------------------------------------------------
  { action: "edit.undo", key: "Mod-z" },
  // Simplified from Shift-Mod-z (3-key combo on some platforms)
  { action: "edit.redo", key: "Alt-z" },

  // -- Navigation -----------------------------------------------------------
  { action: "nav.home", key: "Home" },
  { action: "nav.end", key: "End" },

  // -- Backspace gate -------------------------------------------------------
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
];
