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
    [keyOf(tap("Up"))]: "nav.up",
    [keyOf(held("Up"))]: "nav.up",
    [keyOf(tap("Down"))]: "nav.down",
    [keyOf(held("Down"))]: "nav.down",
    [keyOf(tap("Left"))]: "nav.left",
    [keyOf(held("Left"))]: "nav.left",
    [keyOf(tap("Right"))]: "nav.right",
    [keyOf(held("Right"))]: "nav.right",
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
