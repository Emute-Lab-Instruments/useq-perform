// src/lib/gamepad/paradigms/modal-shift.ts
//
// Modal-shift paradigm: LB and RB (held) act as modifier keys.
// See spec §6.1.
//
// ─────────────────────────────────────────────────────────────────────────────
// Face-button structural verb scheme (bd useq-perform-4zt.69.16, B6)
// ─────────────────────────────────────────────────────────────────────────────
// Goal: every structural mutator in adapter/dispatcher.ts is reachable from a
// gamepad face button without a keyboard. Per `radial-menu.md §1.2`, structural
// verbs stay on direct gamepad bindings; the radial menu is for content insertion.
//
// Layer assignments:
//
//   base       — D-pad spatial nav, Start=eval, Y=delete, X=radial menu,
//                LB+A/RB+A chord-press → menu.openBefore/After
//
//   LB held    — slurp/barf family (mirrors handedness: A/B fwd, X/Y back),
//                Up/Down → home/end, Start → eval.quantised
//
//   RB held    — probe family (toggle/raw/expand/contract), Start → eval.soft,
//                Back → redo
//
//   LB+RB held — structural shape verbs (the verbs added in B6):
//                  Face buttons (raise/splice/transpose):
//                    A → edit.raise
//                    B → edit.splice
//                    X → edit.transposeBack
//                    Y → edit.transposeFwd
//                  D-pad (enclose family — directions are mnemonics, not literal):
//                    Up    → edit.wrapList    (parens)
//                    Down  → edit.wrapVector  (square brackets)
//                    Left  → edit.wrapMap     (curly braces)
//                    Right → edit.wrapSet     (#{...})
//
// Why this scheme:
//   - Preserves existing LB (slurp/barf) and RB (probes) layers — both already
//     fully populated, so we don't displace anything that works.
//   - All 8 missing verbs collected on a single shift state (LB+RB) keeps
//     them mentally adjacent and avoids spreading them across the tree.
//   - Two-handed sustain: thumb stays free for face buttons / D-pad while
//     both shoulder modifiers are held by index fingers.
//   - The lb-rb layer must sit ABOVE both the lb and rb single-shift layers
//     in the layer array, so that with both modifiers held it shadows them
//     (otherwise tap(A) while LB+RB held would resolve to edit.slurpFwd from
//     the lb layer first).
// ─────────────────────────────────────────────────────────────────────────────

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
  when: (s: AppStateSnapshot) =>
    s.gamepad.heldButtons.has("LB") && !s.gamepad.heldButtons.has("RB"),
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
  when: (s: AppStateSnapshot) =>
    s.gamepad.heldButtons.has("RB") && !s.gamepad.heldButtons.has("LB"),
  gestures: {
    [keyOf(tap("A"))]: "probe.toggle",
    [keyOf(tap("B"))]: "probe.toggleRaw",
    [keyOf(tap("X"))]: "probe.expand",
    [keyOf(tap("Y"))]: "probe.contract",
    [keyOf(tap("Start"))]: "eval.soft",
    [keyOf(tap("Back"))]: "edit.redo",
  },
};

// LB+RB held: structural shape verbs (raise / splice / transpose / enclose*).
// See header comment for rationale. This layer must precede the single-shift
// layers in the export so it shadows them when both modifiers are held.
const lbRbShiftedLayer: Layer = {
  name: ln("modal-lb-rb"),
  when: (s: AppStateSnapshot) =>
    s.gamepad.heldButtons.has("LB") && s.gamepad.heldButtons.has("RB"),
  gestures: {
    // Face buttons: raise / splice / transpose pair
    [keyOf(tap("A"))]: "edit.raise",
    [keyOf(tap("B"))]: "edit.splice",
    [keyOf(tap("X"))]: "edit.transposeBack",
    [keyOf(tap("Y"))]: "edit.transposeFwd",
    // D-pad: enclose family (4 bracket variants on 4 cardinals)
    [keyOf(tap("Up"))]: "edit.wrapList",
    [keyOf(tap("Down"))]: "edit.wrapVector",
    [keyOf(tap("Left"))]: "edit.wrapMap",
    [keyOf(tap("Right"))]: "edit.wrapSet",
  },
};

export const modalShiftLayers: readonly Layer[] = [
  lbRbShiftedLayer,
  lbShiftedLayer,
  rbShiftedLayer,
  baseLayer,
];
