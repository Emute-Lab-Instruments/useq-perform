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
  | "format"
  | "probe"
  | "navigation"
  | "ui"
  | "transport"
  | "gamepad"
  | "menu";

export interface ActionDef {
  description: string;
  category: ActionCategory;
  reversible: boolean;
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
    reversible: false,
    icon: "play",
    requiresEditor: true,
  },
  "eval.quantised": {
    description: "Evaluate expression (quantised)",
    category: "core",
    reversible: false,
    icon: "timer",
    requiresEditor: true,
  },
  "eval.soft": {
    description: "Evaluate expression (soft)",
    category: "core",
    reversible: false,
    icon: "zap",
    requiresEditor: true,
  },

  // -- UI -------------------------------------------------------------------

  "palette.open": {
    description: "Open action palette",
    category: "ui",
    reversible: false,
    icon: "command",
  },
  "panel.help": {
    description: "Toggle help panel",
    category: "ui",
    reversible: false,
    icon: "help-circle",
  },
  "panel.vis": {
    description: "Toggle visualisation panel",
    category: "ui",
    reversible: false,
    icon: "activity",
  },
  "vis.screenshot": {
    description: "Save visualisation screenshot to disk",
    category: "ui",
    reversible: false,
    icon: "camera",
  },

  // -- Editor ---------------------------------------------------------------

  "edit.pasteSample": {
    description: "Paste sample ModuLisp code",
    category: "editor",
    reversible: true,
    icon: "clipboard-paste",
    requiresEditor: true,
  },
  "doc.symbol": {
    description: "Show documentation for symbol at cursor",
    category: "editor",
    reversible: false,
    icon: "book-open",
    requiresEditor: true,
  },
  "edit.undo": {
    description: "Undo",
    category: "editor",
    reversible: false,
    icon: "undo-2",
    repeatable: true,
    requiresEditor: true,
  },
  "edit.redo": {
    description: "Redo",
    category: "editor",
    reversible: true,
    icon: "redo-2",
    repeatable: true,
    requiresEditor: true,
  },
  "edit.killToEndOfList": {
    description: "Kill to end of list",
    category: "editor",
    reversible: true,
    requiresEditor: true,
  },
  "edit.delete": {
    description: "Delete node at cursor",
    category: "editor",
    reversible: true,
    requiresEditor: true,
  },

  // -- Format ---------------------------------------------------------------

  "format.topLevel": {
    description: "Reformat the current top-level form",
    category: "format",
    reversible: true,
    requiresEditor: true,
  },
  "format.document": {
    description: "Reformat all top-level forms",
    category: "format",
    reversible: true,
    requiresEditor: true,
  },

  // -- Structure (clojure-mode remaps) --------------------------------------

  "edit.slurpFwd": {
    description: "Slurp forward",
    category: "structure",
    reversible: true,
    icon: "chevron-right",
    requiresEditor: true,
  },
  "edit.slurpBack": {
    description: "Slurp backward",
    category: "structure",
    reversible: true,
    icon: "chevron-left",
    requiresEditor: true,
  },
  "edit.barfFwd": {
    description: "Barf forward",
    category: "structure",
    reversible: true,
    requiresEditor: true,
  },
  "edit.barfBack": {
    description: "Barf backward",
    category: "structure",
    reversible: true,
    requiresEditor: true,
  },
  "edit.raise": {
    description: "Raise node (replace parent with focused node)",
    category: "structure",
    reversible: true,
    requiresEditor: true,
  },
  "edit.splice": {
    description: "Splice (dissolve container, keep children)",
    category: "structure",
    reversible: true,
    requiresEditor: true,
  },
  "edit.wrapList": {
    description: "Wrap in list (parentheses)",
    category: "structure",
    reversible: true,
    requiresEditor: true,
  },
  "edit.wrapVector": {
    description: "Wrap in vector (square brackets)",
    category: "structure",
    reversible: true,
    requiresEditor: true,
  },
  "edit.wrapMap": {
    description: "Wrap in map (curly braces)",
    category: "structure",
    reversible: true,
    requiresEditor: true,
  },
  "edit.wrapSet": {
    description: "Wrap in set (#{ ... })",
    category: "structure",
    reversible: true,
    requiresEditor: true,
  },
  "edit.transposeFwd": {
    description: "Transpose forward (swap with next sibling)",
    category: "structure",
    reversible: true,
    requiresEditor: true,
  },
  "edit.transposeBack": {
    description: "Transpose backward (swap with previous sibling)",
    category: "structure",
    reversible: true,
    requiresEditor: true,
  },

  // -- Probe ----------------------------------------------------------------

  "probe.toggle": {
    description: "Toggle probe on expression",
    category: "probe",
    reversible: false,
    icon: "eye",
    requiresEditor: true,
  },
  "probe.toggleRaw": {
    description: "Toggle raw probe on expression",
    category: "probe",
    reversible: false,
    icon: "eye-off",
    requiresEditor: true,
  },
  "probe.expand": {
    description: "Expand probe context",
    category: "probe",
    reversible: false,
    icon: "maximize-2",
    requiresEditor: true,
  },
  "probe.contract": {
    description: "Contract probe context",
    category: "probe",
    reversible: false,
    icon: "minimize-2",
    requiresEditor: true,
  },

  // -- Navigation -----------------------------------------------------------

  "nav.home": {
    description: "Move cursor to start of line",
    category: "navigation",
    reversible: false,
    requiresEditor: true,
  },
  "nav.end": {
    description: "Move cursor to end of line",
    category: "navigation",
    reversible: false,
    requiresEditor: true,
  },
  "nav.up": {
    description: "Spatial nav: move to nearest node on previous source line",
    category: "navigation",
    reversible: false,
    requiresEditor: true,
  },
  "nav.down": {
    description: "Spatial nav: move to nearest node on next source line",
    category: "navigation",
    reversible: false,
    requiresEditor: true,
  },
  "nav.left": {
    description: "Spatial nav: retreat through Euler-tour traversal",
    category: "navigation",
    reversible: false,
    requiresEditor: true,
  },
  "nav.right": {
    description: "Spatial nav: advance through Euler-tour traversal",
    category: "navigation",
    reversible: false,
    requiresEditor: true,
  },
  "nav.in": {
    description: "Tree nav: descend to first child",
    category: "navigation",
    reversible: false,
    requiresEditor: true,
  },
  "nav.out": {
    description: "Tree nav: ascend to parent",
    category: "navigation",
    reversible: false,
    requiresEditor: true,
  },
  "nav.next": {
    description: "Tree nav: move to next sibling",
    category: "navigation",
    reversible: false,
    requiresEditor: true,
  },
  "nav.prev": {
    description: "Tree nav: move to previous sibling",
    category: "navigation",
    reversible: false,
    requiresEditor: true,
  },

  // -- Gamepad --------------------------------------------------------------

  "nav.adjustNumber": {
    description: "Adjust number at cursor",
    category: "gamepad",
    reversible: true,
    requiresEditor: true,
  },
  "control.bindStick": {
    description: "Bind stick to number",
    category: "gamepad",
    reversible: false,
    analogOnly: true,
  },
  "control.stickAxis": {
    description: "Continuous stick input",
    category: "gamepad",
    reversible: false,
    analogOnly: true,
  },
  "control.toggleManualLeft": {
    description: "Toggle manual control for left stick",
    category: "gamepad",
    reversible: false,
  },
  "control.toggleManualRight": {
    description: "Toggle manual control for right stick",
    category: "gamepad",
    reversible: false,
  },

  // -- Menu -----------------------------------------------------------------

  "menu.openBefore": {
    description: "Open menu before cursor",
    category: "menu",
    reversible: false,
  },
  "menu.openAfter": {
    description: "Open menu after cursor",
    category: "menu",
    reversible: false,
  },
  "menu.radial": {
    description: "Open radial create menu",
    category: "menu",
    reversible: false,
  },
  "menu.tab.cyclePrev": {
    description: "Cycle menu tab backward",
    category: "menu",
    reversible: false,
  },
  "menu.tab.cycleNext": {
    description: "Cycle menu tab forward",
    category: "menu",
    reversible: false,
  },
  "menu.verb.insert": {
    description: "Menu: insert verb",
    category: "menu",
    reversible: true,
  },
  "menu.verb.replace": {
    description: "Menu: replace verb",
    category: "menu",
    reversible: true,
  },
  "menu.verb.wrapWith": {
    description: "Menu: wrap-with verb",
    category: "menu",
    reversible: true,
  },
  "menu.verb.call": {
    description: "Menu: call verb",
    category: "menu",
    reversible: true,
  },
  "menu.text.open": {
    description: "Open text entry sub-mode",
    category: "menu",
    reversible: false,
  },
  "menu.cancel": {
    description: "Dismiss menu",
    category: "menu",
    reversible: false,
  },

  // -- Picker ---------------------------------------------------------------

  "picker.up": {
    description: "Picker: move up",
    category: "menu",
    reversible: false,
    repeatable: true,
  },
  "picker.down": {
    description: "Picker: move down",
    category: "menu",
    reversible: false,
    repeatable: true,
  },
  "picker.left": {
    description: "Picker: move left",
    category: "menu",
    reversible: false,
    repeatable: true,
  },
  "picker.right": {
    description: "Picker: move right",
    category: "menu",
    reversible: false,
    repeatable: true,
  },
  "picker.select": {
    description: "Picker: select item",
    category: "menu",
    reversible: false,
  },
  "picker.cancel": {
    description: "Picker: dismiss",
    category: "menu",
    reversible: false,
  },

  // -- Insertion mode (character-level caret movement) ----------------------

  "insertion.left": {
    description: "Move character caret left (insertion mode)",
    category: "navigation",
    reversible: false,
    repeatable: true,
    requiresEditor: true,
  },
  "insertion.right": {
    description: "Move character caret right (insertion mode)",
    category: "navigation",
    reversible: false,
    repeatable: true,
    requiresEditor: true,
  },
  "insertion.up": {
    description: "Move character caret up (insertion mode)",
    category: "navigation",
    reversible: false,
    repeatable: true,
    requiresEditor: true,
  },
  "insertion.down": {
    description: "Move character caret down (insertion mode)",
    category: "navigation",
    reversible: false,
    repeatable: true,
    requiresEditor: true,
  },
  "edit.enterInsertion": {
    description: "Enter insertion mode at cursor",
    category: "editor",
    reversible: false,
    requiresEditor: true,
  },
  "edit.exitInsertion": {
    description: "Exit insertion mode, return to structural mode",
    category: "editor",
    reversible: false,
    requiresEditor: true,
  },

  // -- Live-Edit (vector-mark sub-mode) -------------------------------------

  "liveEdit.vectorConfirm": {
    description: "Confirm vector-mark selection and wrap marked elements",
    category: "editor",
    reversible: true,
    requiresEditor: true,
  },
  "liveEdit.vectorCancel": {
    description: "Cancel vector-mark sub-mode without changes",
    category: "editor",
    reversible: false,
    requiresEditor: true,
  },
} as const satisfies Record<string, ActionDef>;

// ---------------------------------------------------------------------------
// Derived types & helpers
// ---------------------------------------------------------------------------

export type ActionId = keyof typeof actions;

export type ReversibleActionId = {
  [K in ActionId]: (typeof actions)[K]["reversible"] extends true ? K : never;
}[ActionId];

export type NonReversibleActionId = {
  [K in ActionId]: (typeof actions)[K]["reversible"] extends true ? never : K;
}[ActionId];

export function getAction(id: ActionId): ActionDef {
  return actions[id];
}

export function isReversible(id: ActionId): id is ReversibleActionId {
  return actions[id].reversible;
}
