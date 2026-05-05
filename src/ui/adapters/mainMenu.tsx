// src/ui/adapters/mainMenu.tsx
//
// Imperative adapter for the main menu overlay. Uses createSolidAdapter()
// per repo convention. Mount-once-on-bootstrap pattern.
//
// @see docs/specs/main-menu.md

import { Show } from "solid-js";
import { createSolidAdapter } from "./createSolidAdapter";
import { MainMenu } from "../mainMenu/MainMenu";
import {
  mainMenuState,
  isMainMenuOpen,
  dispatchMainMenu,
  closeMainMenu,
} from "../../lib/mainMenu/store";
import { resolveItems, type MainMenuItem } from "../mainMenu/menuItems";

// ---------------------------------------------------------------------------
// Selection handler
// ---------------------------------------------------------------------------

function handleSelect(item: MainMenuItem, _index: number): void {
  switch (item.type) {
    case "action":
      if (item.id === "resume") {
        closeMainMenu();
      }
      // Other actions are stubs for now — they close the menu.
      // Future: route to settings panels, help, etc.
      if (item.id !== "resume") {
        closeMainMenu();
      }
      break;

    case "submenu":
      dispatchMainMenu({ type: "pushSubmenu", submenuId: item.id });
      break;

    case "toggle":
      // Toggle items stay open — not yet implemented.
      break;
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

const adapter = createSolidAdapter({
  containerId: "main-menu-root",
  containerStyle: {
    position: "fixed",
    inset: "0",
    zIndex: "1200",
    pointerEvents: "none",
  },
  Component: () => (
    <Show when={isMainMenuOpen()}>
      <div style={{ "pointer-events": "auto" }}>
        <MainMenu
          state={mainMenuState()}
          onClose={() => closeMainMenu()}
          onSelect={handleSelect}
        />
      </div>
    </Show>
  ),
});

/**
 * Mount the main menu overlay. Safe to call multiple times; only mounts once.
 * In non-browser environments (e.g. Node.js tests), this is a no-op.
 */
export function mountMainMenu(): void {
  adapter.mount();
}
