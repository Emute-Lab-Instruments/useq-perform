// src/lib/gamepad/paradigms/chord-heavy.ts
//
// Chord-heavy paradigm: most operations are 2-button chords.
// No layer-shifting, no leaders, no held-vs-hold ambiguity.
// Entirely flat resolution. See spec §6.4.

import { chord, keyOf, tap, held } from "../gestures";
import type {
  AxisChannelName,
  Layer,
  LayerName,
} from "../types";

const ln = (n: string) => n as LayerName;
const ch = (n: string) => n as AxisChannelName;

const chordLayer: Layer = {
  name: ln("chord"),
  when: () => true,
  gestures: {
    [keyOf(tap("Start"))]: "eval.now",
    [keyOf(tap("Back"))]: "edit.undo",
    [keyOf(tap("Up"))]: "nav.up",
    [keyOf(held("Up"))]: "nav.up",
    [keyOf(tap("Down"))]: "nav.down",
    [keyOf(held("Down"))]: "nav.down",
    [keyOf(tap("Left"))]: "nav.left",
    [keyOf(held("Left"))]: "nav.left",
    [keyOf(tap("Right"))]: "nav.right",
    [keyOf(held("Right"))]: "nav.right",
    [keyOf(chord(["LB", "A"]))]: "edit.slurpFwd",
    [keyOf(chord(["LB", "B"]))]: "edit.barfFwd",
    [keyOf(chord(["LB", "X"]))]: "edit.slurpBack",
    [keyOf(chord(["LB", "Y"]))]: "edit.barfBack",
    [keyOf(chord(["RB", "A"]))]: "probe.toggle",
    [keyOf(chord(["RB", "B"]))]: "probe.toggleRaw",
    [keyOf(chord(["LT", "A"]))]: "menu.openAfter",
    [keyOf(chord(["LT", "B"]))]: "menu.openBefore",
    [keyOf(tap("B"))]: "edit.delete",
  },
  axes: { right: ch("manual-control") },
};

export const chordHeavyLayers: readonly Layer[] = [chordLayer];
