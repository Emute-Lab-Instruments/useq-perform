// src/ui/adapters/mainMenu.tsx
//
// Application-owned main menu overlay.
//
// @see docs/specs/main-menu.md

import { Show } from "solid-js";
import { MainMenu } from "../mainMenu/MainMenu";
import {
  mainMenuState,
  isMainMenuOpen,
  dispatchMainMenu,
  closeMainMenu,
} from "../../lib/mainMenu/store";
import type { MainMenuItem } from "../mainMenu/menuItems";
import { selectMainMenuAction } from "../../zen/mainMenuAction";

// ---------------------------------------------------------------------------
// Selection handler
// ---------------------------------------------------------------------------

function handleSelect(item: MainMenuItem, _index: number): void {
  switch (item.type) {
    case "action":
      selectMainMenuAction(item.id);
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
// Application-owned component
// ---------------------------------------------------------------------------

export function MainMenuRoot() {
  return (
    <Show when={isMainMenuOpen()}>
      <div style={{ "pointer-events": "auto" }}>
        <MainMenu
          state={mainMenuState()}
          onClose={() => closeMainMenu()}
          onSelect={handleSelect}
        />
      </div>
    </Show>
  );
}
