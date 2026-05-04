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
  onMiss: "pop-and-discard",
};
