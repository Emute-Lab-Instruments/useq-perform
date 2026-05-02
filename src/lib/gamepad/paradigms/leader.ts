// src/lib/gamepad/paradigms/leader.ts
//
// Leader (vim-style) paradigm: a small set of leader buttons opens
// transient layers whose first match fires and pops. See spec §6.2.

import { keyOf, tap, held } from "../gestures";
import type {
  AxisChannelName,
  Layer,
  LayerName,
} from "../types";

const ln = (n: string) => n as LayerName;
const ch = (n: string) => n as AxisChannelName;

const leaderBase: Layer = {
  name: ln("leader-base"),
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
    [keyOf(tap("A"))]: "nav.toggleMode",
    [keyOf(tap("Start"))]: "eval.now",
    [keyOf(tap("Back"))]: "edit.undo",
    [keyOf(tap("B"))]: "edit.delete",
  },
  leaders: {
    [keyOf(tap("Y"))]: ln("after-Y"),
    [keyOf(tap("X"))]: ln("after-X"),
  },
  axes: { right: ch("manual-control") },
};

const afterY: Layer = {
  name: ln("after-Y"),
  popOn: ["resolution", "timeout"],
  ttlMs: 800,
  onMiss: "pop-and-fall-through",
  gestures: {
    [keyOf(tap("A"))]: "edit.slurpFwd",
    [keyOf(tap("B"))]: "edit.barfFwd",
    [keyOf(tap("X"))]: "edit.slurpBack",
    [keyOf(tap("Y"))]: "edit.barfBack",
  },
};

const afterX: Layer = {
  name: ln("after-X"),
  popOn: ["resolution", "timeout"],
  ttlMs: 800,
  onMiss: "pop-and-fall-through",
  gestures: {
    [keyOf(tap("A"))]: "menu.openAfter",
    [keyOf(tap("B"))]: "menu.openBefore",
    [keyOf(tap("X"))]: "menu.radial",
    [keyOf(tap("Up"))]: "probe.toggle",
    [keyOf(tap("Down"))]: "probe.toggleRaw",
  },
};

export const leaderLayers: readonly Layer[] = [leaderBase];
export const leaderTransientLayers: readonly Layer[] = [afterY, afterX];
