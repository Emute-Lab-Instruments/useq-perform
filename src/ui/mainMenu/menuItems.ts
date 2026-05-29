// src/ui/mainMenu/menuItems.ts
//
// Static menu item definitions for the main menu overlay.
// @see docs/specs/main-menu.md §3

export type MenuItemType = "action" | "submenu" | "toggle";

export interface MainMenuItem {
  /** Unique identifier. */
  id: string;
  /** Display label. */
  label: string;
  /** Item type determines behaviour on select. */
  type: MenuItemType;
  /** For submenu items: the child items. */
  children?: MainMenuItem[];
  /** For action items: callback when selected. */
  onSelect?: () => void;
}

// ---------------------------------------------------------------------------
// Root menu items (spec §3.2)
// ---------------------------------------------------------------------------

// Order and contents follow main-menu.md §3.1 / §3.2:
//   Resume, Practice Zone, Save, Restore, Settings, Help, Connection, Transport
export const ROOT_MENU_ITEMS: MainMenuItem[] = [
  {
    id: "resume",
    label: "Resume",
    type: "action",
  },
  {
    id: "practiceZone",
    label: "Practice Zone",
    type: "action",
  },
  {
    // §3.3: save slots + export. Slot labels are static here; live "(empty)" /
    // patch-name annotations are rendered by the consumer from the persistence
    // service.
    id: "save",
    label: "Save",
    type: "submenu",
    children: [
      { id: "save.slot1", label: "Save to Slot 1", type: "action" },
      { id: "save.slot2", label: "Save to Slot 2", type: "action" },
      { id: "save.slot3", label: "Save to Slot 3", type: "action" },
      { id: "save.slot4", label: "Save to Slot 4", type: "action" },
      { id: "save.export", label: "Export to file", type: "action" },
    ],
  },
  {
    id: "restore",
    label: "Restore",
    type: "submenu",
    children: [
      { id: "restore.slot1", label: "Slot 1", type: "action" },
      { id: "restore.slot2", label: "Slot 2", type: "action" },
      { id: "restore.slot3", label: "Slot 3", type: "action" },
      { id: "restore.slot4", label: "Slot 4", type: "action" },
      { id: "restore.import", label: "Import from file", type: "action" },
      { id: "restore.defaults", label: "Restore defaults", type: "action" },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    type: "submenu",
    children: [
      { id: "settings.general", label: "General", type: "action" },
      { id: "settings.editor", label: "Editor", type: "action" },
      { id: "settings.gamepad", label: "Gamepad", type: "action" },
      { id: "settings.vis", label: "Visualisation", type: "action" },
      { id: "settings.audioTransport", label: "Audio / Transport", type: "action" },
    ],
  },
  {
    id: "help",
    label: "Help",
    type: "submenu",
    children: [
      { id: "help.keybindings", label: "Keybindings", type: "action" },
      { id: "help.language", label: "Language Reference", type: "action" },
      { id: "help.gamepad", label: "Gamepad Layout", type: "action" },
      { id: "help.about", label: "About", type: "action" },
    ],
  },
  {
    id: "connection",
    label: "Connection",
    type: "action",
  },
  {
    // §3.5: transport controls. Play/Pause/Stop/Rewind plus inline-adjustable
    // BPM and time signature (LB/RB adjust, per §4.1.3).
    id: "transport",
    label: "Transport",
    type: "submenu",
    children: [
      { id: "transport.play", label: "Play", type: "action" },
      { id: "transport.pause", label: "Pause", type: "action" },
      { id: "transport.stop", label: "Stop", type: "action" },
      { id: "transport.rewind", label: "Rewind", type: "action" },
      { id: "transport.bpm", label: "BPM", type: "action" },
      { id: "transport.timeSig", label: "Time Signature", type: "action" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the current visible items given a submenu stack.
 * Each entry in the stack is a menu item ID with type "submenu".
 */
export function resolveItems(
  stack: string[],
  root: MainMenuItem[] = ROOT_MENU_ITEMS,
): MainMenuItem[] {
  let items = root;
  for (const id of stack) {
    const found = items.find((item) => item.id === id);
    if (found?.children) {
      items = found.children;
    } else {
      break;
    }
  }
  return items;
}

/**
 * Get the label for the current submenu level (for the header).
 */
export function currentSubmenuLabel(
  stack: string[],
  root: MainMenuItem[] = ROOT_MENU_ITEMS,
): string | null {
  if (stack.length === 0) return null;
  let items = root;
  let label: string | null = null;
  for (const id of stack) {
    const found = items.find((item) => item.id === id);
    if (found) {
      label = found.label;
      if (found.children) items = found.children;
    }
  }
  return label;
}
