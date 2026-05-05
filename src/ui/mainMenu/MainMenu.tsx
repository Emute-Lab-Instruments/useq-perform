// src/ui/mainMenu/MainMenu.tsx
//
// Pure presentational component for the main menu overlay.
// Props-based, no runtime imports. Follows the same adapter pattern
// as RadialMenu.tsx.
//
// @see docs/specs/main-menu.md §5

import { For, Show, type JSX } from "solid-js";
import type { MainMenuState } from "../../lib/mainMenu/store";
import {
  resolveItems,
  currentSubmenuLabel,
  type MainMenuItem,
} from "./menuItems";
import "./mainMenu.css";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MainMenuProps {
  state: MainMenuState;
  onClose?: () => void;
  onSelect?: (item: MainMenuItem, index: number) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MainMenu(props: MainMenuProps): JSX.Element {
  const items = () => resolveItems(props.state.submenuStack);
  const submenuLabel = () => currentSubmenuLabel(props.state.submenuStack);
  const isInSubmenu = () => props.state.submenuStack.length > 0;

  return (
    <div class="main-menu-backdrop" onClick={() => props.onClose?.()}>
      <div
        class="main-menu-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div class="main-menu-header">
          <Show when={isInSubmenu()} fallback={<span>uSEQ Perform</span>}>
            <span class="main-menu-back-label">
              {"< "}{submenuLabel()}
            </span>
          </Show>
        </div>

        {/* Divider */}
        <div class="main-menu-divider" />

        {/* Item list */}
        <div class="main-menu-items">
          <For each={items()}>
            {(item, index) => {
              const isFocused = () => index() === props.state.focusIndex;
              return (
                <div
                  class="main-menu-item"
                  classList={{ "main-menu-item--focused": isFocused() }}
                  onClick={() => props.onSelect?.(item, index())}
                >
                  <span class="main-menu-item-indicator">
                    {isFocused() ? "▸" : " "}
                  </span>
                  <span class="main-menu-item-label">{item.label}</span>
                  <Show when={item.type === "submenu"}>
                    <span class="main-menu-item-chevron">{"▶"}</span>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
}
