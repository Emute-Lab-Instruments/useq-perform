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
import { buildZenHash } from "../../zen/routing";

// ---------------------------------------------------------------------------
// Selection handler
// ---------------------------------------------------------------------------

function handleSelect(item: MainMenuItem, _index: number): void {
  switch (item.type) {
    case "action":
      switch (item.id) {
        case "resume":
          // §3.2: close the menu and return to the editor.
          closeMainMenu();
          break;
        case "practiceZone":
          // §3.2: enter zen mode, then close the menu. Zen mode is route-driven
          // (the #/zen hash), so navigating the hash is the entry point.
          if (typeof window !== "undefined") {
            window.location.hash = buildZenHash(null);
          }
          closeMainMenu();
          break;
        default:
          // Save/Restore/Transport leaf actions, Connection, and Settings/Help
          // leaves are not yet wired to their backing systems (persistence
          // slots, transport machine, settings panels). For now they close the
          // menu, matching the existing stub behaviour. See the gamepad-menus
          // bug-hunt findings for the follow-up wiring work.
          closeMainMenu();
          break;
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
