// src/ui/adapters/radialMenu.tsx
//
// Application-owned radial menu wired to G5's menuStore.
//
// Replaces: double-radial-menu.tsx, picker-menu.tsx (deleted in H4).
// Per docs/specs/radial-menu.md §11.1.

import { Show } from "solid-js";
import { RadialMenu } from "../menu/RadialMenu";
import { menuState, isMenuOpen } from "../../lib/menu/store";
import { getCachedManifest } from "../../lib/menu/manifest";
import type { Manifest } from "../../lib/menu/types";

// -- Helpers --

function currentManifest(): Manifest | null {
  return getCachedManifest();
}

export function RadialMenuRoot() {
  return (
    <Show when={isMenuOpen() && currentManifest()}>
      {(manifest) => (
        <div style={{ "pointer-events": "auto" }}>
          <RadialMenu state={menuState()} manifest={manifest()} />
        </div>
      )}
    </Show>
  );
}
