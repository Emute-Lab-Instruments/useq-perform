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
    [keyOf(tap("Up"))]: "nav.structuralUp",
    [keyOf(held("Up"))]: "nav.structuralUp",
    [keyOf(tap("Down"))]: "nav.structuralDown",
    [keyOf(held("Down"))]: "nav.structuralDown",
    [keyOf(tap("Left"))]: "nav.structuralLeft",
    [keyOf(held("Left"))]: "nav.structuralLeft",
    [keyOf(tap("Right"))]: "nav.structuralRight",
    [keyOf(held("Right"))]: "nav.structuralRight",
    [keyOf(chord(["LB", "A"]))]: "edit.slurpFwd",
    [keyOf(chord(["LB", "B"]))]: "edit.barfFwd",
    [keyOf(chord(["LB", "X"]))]: "edit.slurpBack",
    [keyOf(chord(["LB", "Y"]))]: "edit.barfBack",
    [keyOf(chord(["RB", "A"]))]: "probe.toggle",
    [keyOf(chord(["RB", "B"]))]: "probe.toggleRaw",
    [keyOf(chord(["LT", "A"]))]: "menu.openAfter",
    [keyOf(chord(["LT", "B"]))]: "menu.openBefore",
    [keyOf(chord(["RB", "Start"]))]: "nav.toggleMode",
    [keyOf(tap("A"))]: "nav.toggleMode",
    [keyOf(tap("B"))]: "edit.delete",
  },
  axes: { right: ch("manual-control") },
};

export const chordHeavyLayers: readonly Layer[] = [chordLayer];
