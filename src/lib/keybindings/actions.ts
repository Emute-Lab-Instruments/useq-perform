// src/lib/keybindings/actions.ts
//
// Canonical action registry for the keybinding system.
// Pure data and types — no imports from runtime modules, no side effects.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActionCategory =
  | "core"
  | "editor"
  | "structure"
  | "probe"
  | "navigation"
  | "ui"
  | "transport"
  | "gamepad"
  | "menu";

export interface ActionDef {
  description: string;
  category: ActionCategory;
  icon?: string;
  repeatable?: boolean;
  requiresEditor?: boolean;
  analogOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Action Registry
// ---------------------------------------------------------------------------

export const actions = {
  // -- Core (evaluation) ----------------------------------------------------

  "eval.now": {
    description: "Evaluate top-level expression",
    category: "core",
    icon: "play",
    requiresEditor: true,
  },
  "eval.quantised": {
    description: "Evaluate expression (quantised)",
    category: "core",
    icon: "timer",
    requiresEditor: true,
  },
  "eval.soft": {
    description: "Evaluate expression (soft)",
    category: "core",
    icon: "zap",
    requiresEditor: true,
  },

  // -- UI -------------------------------------------------------------------

  "palette.open": {
    description: "Open action palette",
    category: "ui",
    icon: "command",
  },
  "panel.help": {
    description: "Toggle help panel",
    category: "ui",
    icon: "help-circle",
  },
  "panel.vis": {
    description: "Toggle visualisation panel",
    category: "ui",
    icon: "activity",
  },

  // -- Editor ---------------------------------------------------------------

  "doc.symbol": {
    description: "Show documentation for symbol at cursor",
    category: "editor",
    icon: "book-open",
    requiresEditor: true,
  },
  "edit.undo": {
    description: "Undo",
    category: "editor",
    icon: "undo-2",
    repeatable: true,
    requiresEditor: true,
  },
  "edit.redo": {
    description: "Redo",
    category: "editor",
    icon: "redo-2",
    repeatable: true,
    requiresEditor: true,
  },
  "edit.killToEndOfList": {
    description: "Kill to end of list",
    category: "editor",
    requiresEditor: true,
  },
  "edit.backspaceNormal": {
    description: "Backspace (bypass bracket protection)",
    category: "editor",
    repeatable: true,
    requiresEditor: true,
  },

  "edit.delete": {
    description: "Delete node at cursor",
    category: "editor",
    requiresEditor: true,
  },

  // -- Structure (clojure-mode remaps) --------------------------------------

  "edit.slurpFwd": {
    description: "Slurp forward",
    category: "structure",
    icon: "chevron-right",
    requiresEditor: true,
  },
  "edit.slurpBack": {
    description: "Slurp backward",
    category: "structure",
    icon: "chevron-left",
    requiresEditor: true,
  },
  "edit.barfFwd": {
    description: "Barf forward",
    category: "structure",
    requiresEditor: true,
  },
  "edit.barfBack": {
    description: "Barf backward",
    category: "structure",
    requiresEditor: true,
  },

  // -- Probe ----------------------------------------------------------------

  "probe.toggle": {
    description: "Toggle probe on expression",
    category: "probe",
    icon: "eye",
    requiresEditor: true,
  },
  "probe.toggleRaw": {
    description: "Toggle raw probe on expression",
    category: "probe",
    icon: "eye-off",
    requiresEditor: true,
  },
  "probe.expand": {
    description: "Expand probe context",
    category: "probe",
    icon: "maximize-2",
    requiresEditor: true,
  },
  "probe.contract": {
    description: "Contract probe context",
    category: "probe",
    icon: "minimize-2",
    requiresEditor: true,
  },

  // -- Navigation -----------------------------------------------------------

  "nav.home": {
    description: "Move cursor to start of line",
    category: "navigation",
    requiresEditor: true,
  },
  "nav.end": {
    description: "Move cursor to end of line",
    category: "navigation",
    requiresEditor: true,
  },
  "nav.toggleMode": {
    description: "Toggle navigation mode",
    category: "navigation",
  },
  "nav.structuralUp": {
    description: "Navigate out (structural)",
    category: "navigation",
    requiresEditor: true,
  },
  "nav.structuralDown": {
    description: "Navigate in (structural)",
    category: "navigation",
    requiresEditor: true,
  },
  "nav.structuralLeft": {
    description: "Navigate prev (structural)",
    category: "navigation",
    requiresEditor: true,
  },
  "nav.structuralRight": {
    description: "Navigate next (structural)",
    category: "navigation",
    requiresEditor: true,
  },

  // -- Gamepad --------------------------------------------------------------

  "nav.adjustNumber": {
    description: "Adjust number at cursor",
    category: "gamepad",
    requiresEditor: true,
  },
  "control.bindStick": {
    description: "Bind stick to number",
    category: "gamepad",
    analogOnly: true,
  },
  "control.stickAxis": {
    description: "Continuous stick input",
    category: "gamepad",
    analogOnly: true,
  },

  // -- Menu -----------------------------------------------------------------

  "menu.openBefore": {
    description: "Open menu before cursor",
    category: "menu",
  },
  "menu.openAfter": {
    description: "Open menu after cursor",
    category: "menu",
  },
  "menu.radial": {
    description: "Open radial create menu",
    category: "menu",
  },

  // -- Picker ---------------------------------------------------------------

  "picker.up": {
    description: "Picker: move up",
    category: "menu",
    repeatable: true,
  },
  "picker.down": {
    description: "Picker: move down",
    category: "menu",
    repeatable: true,
  },
  "picker.left": {
    description: "Picker: move left",
    category: "menu",
    repeatable: true,
  },
  "picker.right": {
    description: "Picker: move right",
    category: "menu",
    repeatable: true,
  },
  "picker.select": {
    description: "Picker: select item",
    category: "menu",
  },
  "picker.cancel": {
    description: "Picker: dismiss",
    category: "menu",
  },
} as const satisfies Record<string, ActionDef>;

// ---------------------------------------------------------------------------
// Derived types & helpers
// ---------------------------------------------------------------------------

export type ActionId = keyof typeof actions;

export function getAction(id: ActionId): ActionDef {
  return actions[id];
}
