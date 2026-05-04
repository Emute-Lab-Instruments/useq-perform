// src/lib/gamepad/paradigms/hydra.ts
//
// Hydra (Emacs-style) paradigm: leader opens a "sticky" layer.
// Bound gestures keep firing; only unbound gesture, cancel, or timeout
// pops the layer. See spec §6.3.

import { keyOf, tap, held } from "../gestures";
import type {
  AxisChannelName,
  Layer,
  LayerName,
} from "../types";

const ln = (n: string) => n as LayerName;
const ch = (n: string) => n as AxisChannelName;

const hydraBase: Layer = {
  name: ln("hydra-base"),
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
    [keyOf(tap("LeftStickPress"))]: ln("hydra-slurp"),
  },
  axes: { right: ch("manual-control") },
};

const hydraSlurp: Layer = {
  name: ln("hydra-slurp"),
  popOn: ["miss-or-cancel", "timeout"],
  ttlMs: 2000,
  onMiss: "pop-and-discard",
  gestures: {
    [keyOf(tap("Right"))]: "edit.slurpFwd",
    [keyOf(tap("Left"))]: "edit.slurpBack",
    [keyOf(tap("Up"))]: "edit.barfBack",
    [keyOf(tap("Down"))]: "edit.barfFwd",
    [keyOf(tap("B"))]: "picker.cancel",
  },
};

export const hydraLayers: readonly Layer[] = [hydraBase];
export const hydraTransientLayers: readonly Layer[] = [hydraSlurp];
