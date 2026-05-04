// src/ui/adapters/radialMenu.tsx
//
// Imperative adapter for the radial menu. Uses createSolidAdapter()
// per repo convention. Renders <RadialMenu> (G1) wired to G5's menuStore.
// Mount-once-on-bootstrap pattern.
//
// Replaces: double-radial-menu.tsx, picker-menu.tsx (deleted in H4).
// Per docs/specs/radial-menu.md §11.1.

import { Show } from "solid-js";
import { createSolidAdapter } from "./createSolidAdapter";
import { RadialMenu } from "../menu/RadialMenu";
import { menuState, isMenuOpen } from "../../lib/menu/store";
import { getCachedManifest } from "../../lib/menu/manifest";
import type { Manifest } from "../../lib/menu/types";

// -- Helpers --

function currentManifest(): Manifest | null {
  return getCachedManifest();
}

const adapter = createSolidAdapter({
  containerId: "radial-menu-root",
  containerStyle: {
    position: "fixed",
    inset: "0",
    zIndex: "1100",
    pointerEvents: "none",
  },
  Component: () => (
    <Show when={isMenuOpen() && currentManifest()}>
      {(manifest) => (
        <div style={{ "pointer-events": "auto" }}>
          <RadialMenu state={menuState()} manifest={manifest()} />
        </div>
      )}
    </Show>
  ),
});

/**
 * Mount the radial menu overlay. Safe to call multiple times; only mounts once.
 * In non-browser environments (e.g. Node.js tests), this is a no-op.
 */
export function mountRadialMenu(root?: HTMLElement): void {
  adapter.mount(root);
}
