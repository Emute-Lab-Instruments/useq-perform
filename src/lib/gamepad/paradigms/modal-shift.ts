// src/lib/gamepad/paradigms/modal-shift.ts
//
// Modal-shift paradigm: LB and RB (held) act as modifier keys.
// See spec §6.1.

import { chord, keyOf, held, tap } from "../gestures";
import type {
  AppStateSnapshot,
  AxisChannelName,
  Layer,
  LayerName,
} from "../types";

const ln = (n: string) => n as LayerName;
const ch = (n: string) => n as AxisChannelName;

// Base layer:
//   D-pad = spatial nav (primary, per structural-editing.md §4.5 / §5.1-A),
//   Start = eval, Y = delete, X = radial menu,
//   LB = adjust(-1), RB = adjust(+1),
//   StickPress = toggle manual control
//
// Face-button verbs (A/B) are intentionally unbound here pending B6.
const baseLayer: Layer = {
  name: ln("modal-base"),
  when: () => true,
  gestures: {
    [keyOf(tap("Up"))]: "nav.up",
    [keyOf(held("Up"))]: "nav.up",
    [keyOf(tap("Down"))]: "nav.down",
    [keyOf(held("Down"))]: "nav.down",
    [keyOf(tap("Left"))]: "nav.left",
    [keyOf(held("Left"))]: "nav.left",
    [keyOf(tap("Right"))]: "nav.right",
    [keyOf(held("Right"))]: "nav.right",
    [keyOf(tap("Start"))]: "eval.now",
    [keyOf(tap("X"))]: "menu.radial",
    [keyOf(tap("Y"))]: "edit.delete",
    [keyOf(tap("LeftStickPress"))]: "control.toggleManualLeft",
    [keyOf(tap("RightStickPress"))]: "control.toggleManualRight",
    [keyOf(chord(["LB", "A"]))]: "menu.openBefore",
    [keyOf(chord(["RB", "A"]))]: "menu.openAfter",
  },
  axes: { right: ch("manual-control") },
};

const lbShiftedLayer: Layer = {
  name: ln("modal-lb"),
  when: (s: AppStateSnapshot) => s.gamepad.heldButtons.has("LB"),
  gestures: {
    [keyOf(tap("A"))]: "edit.slurpFwd",
    [keyOf(tap("B"))]: "edit.barfFwd",
    [keyOf(tap("X"))]: "edit.slurpBack",
    [keyOf(tap("Y"))]: "edit.barfBack",
    [keyOf(tap("Up"))]: "nav.home",
    [keyOf(tap("Down"))]: "nav.end",
    [keyOf(tap("Start"))]: "eval.quantised",
  },
};

const rbShiftedLayer: Layer = {
  name: ln("modal-rb"),
  when: (s: AppStateSnapshot) => s.gamepad.heldButtons.has("RB"),
  gestures: {
    [keyOf(tap("A"))]: "probe.toggle",
    [keyOf(tap("B"))]: "probe.toggleRaw",
    [keyOf(tap("X"))]: "probe.expand",
    [keyOf(tap("Y"))]: "probe.contract",
    [keyOf(tap("Start"))]: "eval.soft",
    [keyOf(tap("Back"))]: "edit.redo",
  },
};

export const modalShiftLayers: readonly Layer[] = [
  lbShiftedLayer,
  rbShiftedLayer,
  baseLayer,
];
