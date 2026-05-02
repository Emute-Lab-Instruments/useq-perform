// src/lib/gamepad/paradigms/picker.ts
//
// Always-present picker layer. Activates when a menu or radial picker
// is open; binds gestures to picker.* actions. Ships orthogonal to
// whichever paradigm (modal-shift, leader, etc.) the user selects.
// See spec §6.5.

import { keyOf, tap, held } from "../gestures";
import type {
  AppStateSnapshot,
  AxisChannelName,
  Layer,
  LayerName,
} from "../types";

const ln = (n: string) => n as LayerName;
const ch = (n: string) => n as AxisChannelName;

export const pickerLayer: Layer = {
  name: ln("picker"),
  when: (s: AppStateSnapshot) => !!(s as Record<string, unknown>).menuOpen,
  gestures: {
    [keyOf(tap("Up"))]: "picker.up",
    [keyOf(tap("Down"))]: "picker.down",
    [keyOf(tap("Left"))]: "picker.left",
    [keyOf(tap("Right"))]: "picker.right",
    [keyOf(held("Up"))]: "picker.up",
    [keyOf(held("Down"))]: "picker.down",
    [keyOf(held("Left"))]: "picker.left",
    [keyOf(held("Right"))]: "picker.right",
    [keyOf(tap("A"))]: "picker.select",
    [keyOf(tap("B"))]: "picker.cancel",
  },
  axes: { left: ch("picker.angle"), right: ch("picker.angle") },
  onMiss: "fall-through",
};
