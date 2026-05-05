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

export const ROOT_MENU_ITEMS: MainMenuItem[] = [
  {
    id: "resume",
    label: "Resume",
    type: "action",
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
