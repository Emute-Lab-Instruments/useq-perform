// src/lib/gamepad/paradigms/radial.ts
//
// Radial-menu transient layer. Activates when the radial menu is open.
// Replaces the legacy picker layer (picker.ts).
// See docs/specs/radial-menu.md §11.3.

import { keyOf, tap } from "../gestures";
import type {
  AppStateSnapshot,
  AxisChannelName,
  Layer,
  LayerName,
} from "../types";
import { isMenuOpen } from "../../menu/store";

const ln = (n: string) => n as LayerName;
const ch = (n: string) => n as AxisChannelName;

export const radialLayer: Layer = {
  name: ln("radial-menu"),
  when: (_s: AppStateSnapshot) => isMenuOpen(),
  gestures: {
    [keyOf(tap("LB"))]: "menu.tab.cyclePrev",
    [keyOf(tap("RB"))]: "menu.tab.cycleNext",
    [keyOf(tap("A"))]: "menu.verb.insert",
    [keyOf(tap("X"))]: "menu.verb.replace",
    [keyOf(tap("Y"))]: "menu.verb.wrapWith",
    [keyOf(tap("B"))]: "menu.verb.call",
    [keyOf(tap("Back"))]: "menu.cancel",
  },
  axes: {
    left: ch("menu.left.angle"),
    right: ch("menu.right.angle"),
  },
  // The radial menu is a full-takeover surface (radial-menu.md §1.1 / §12.6):
  // while open, unbound gestures (e.g. D-pad) must NOT leak to the editor.
  // The layer is registered as a `when`-gated predicate layer (not a transient
  // push), so `onMiss` alone is inert — the resolver only honours `onMiss` for
  // transient layers. `mask: true` makes the resolver discard any gesture this
  // layer doesn't bind while it is active. `onMiss` is retained to specify the
  // discard policy explicitly.
  mask: true,
  onMiss: "pop-and-discard",
};
