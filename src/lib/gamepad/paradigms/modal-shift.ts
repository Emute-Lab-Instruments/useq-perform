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
//   D-pad = navigate, A = enter/drill-in, B = back/drill-out,
//   Start = eval, Y = delete, X = radial menu,
//   LB = adjust(-1), RB = adjust(+1),
//   StickPress = toggle manual control
const baseLayer: Layer = {
  name: ln("modal-base"),
  when: () => true,
  gestures: {
    [keyOf(tap("Up"))]: "nav.structuralUp",
    [keyOf(held("Up"))]: "nav.structuralUp",
    [keyOf(tap("Down"))]: "nav.structuralDown",
    [keyOf(held("Down"))]: "nav.structuralDown",
    [keyOf(tap("Left"))]: "nav.structuralLeft",
    [keyOf(held("Left"))]: "nav.structuralLeft",
    [keyOf(tap("Right"))]: "nav.structuralRight",
    [keyOf(held("Right"))]: "nav.structuralRight",
    [keyOf(tap("A"))]: "nav.enter",
    [keyOf(tap("B"))]: "nav.back",
    [keyOf(tap("Start"))]: "eval.now",
    [keyOf(tap("X"))]: "menu.radial",
    [keyOf(tap("Y"))]: "edit.delete",
    [keyOf(tap("Back"))]: "nav.toggleMode",
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
