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
//                  Face buttons (raise/splice):
//                    A → edit.raise
//                    B → edit.splice
//                  D-pad (transpose pair + enclose family):
//                    Left  → edit.transposeBack
//                    Right → edit.transposeFwd
//                    Up    → edit.wrapList    (parens)
//                    Down  → edit.wrapVector  (square brackets)
//                  NOTE: wrapMap and wrapSet unbound — D-pad Left/Right
//                  reassigned to transpose during playtesting. These verbs
//                  need a new home (radial menu or secondary chord).
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
import { isMainMenuOpen } from "../../mainMenu/store";

const ln = (n: string) => n as LayerName;
const ch = (n: string) => n as AxisChannelName;

// Base layer:
//   D-pad = spatial nav (primary, per structural-editing.md §4.5 / §5.1-A),
//   Start = eval, Back = undo, Y = delete, X = radial menu,
//   A = act-on leader (gamepad.md §6.6), B = nav.out,
//   LT+A = quick-replace, RT+A = grab mode,
//   LB+A / RB+A = menu.openBefore/After,
//   L3+R3 = main menu,
//   StickPress = toggle manual control (when not on number)
//
// The previous nav.in binding on A is removed — D-pad spatial nav already
// covers tree descent. A is now prime real-estate for the act-on verb-select
// leader pattern (see gamepad.md §6.6).
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
    [keyOf(tap("A"))]: "actOn.open",
    [keyOf(tap("B"))]: "nav.out",
    [keyOf(tap("Start"))]: "eval.now",
    [keyOf(tap("Back"))]: "edit.undo",
    [keyOf(tap("X"))]: "menu.radial",
    [keyOf(tap("Y"))]: "edit.delete",
    [keyOf(tap("LeftStickPress"))]: "control.toggleManualLeft",
    [keyOf(tap("RightStickPress"))]: "control.toggleManualRight",
    [keyOf(chord(["LB", "A"]))]: "menu.openBefore",
    [keyOf(chord(["RB", "A"]))]: "menu.openAfter",
    [keyOf(chord(["LT", "A"]))]: "actOn.quickReplace",
    [keyOf(chord(["RT", "A"]))]: "actOn.grab",
    [keyOf(chord(["LeftStickPress", "RightStickPress"]))]: "mainMenu.open",
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
    // Face buttons: raise / splice
    [keyOf(tap("A"))]: "edit.raise",
    [keyOf(tap("B"))]: "edit.splice",
    // D-pad: transpose pair + enclose (wrapMap/wrapSet unbound)
    [keyOf(tap("Left"))]: "edit.transposeBack",
    [keyOf(tap("Right"))]: "edit.transposeFwd",
    [keyOf(tap("Up"))]: "edit.wrapList",
    [keyOf(tap("Down"))]: "edit.wrapVector",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Atom-edit layer (§2.4 / §5.4): LB/RB tap adjusts the leaf atom under the
// cursor. LeftStickPress flips polarity on numbers.
//
// Active when:
//   - the cursor is on a leaf atom (number, symbol, keyword, string, hole)
//   - NOT in insertion mode
//   - neither LB nor RB is held as a modifier (so held-shift layers shadow)
//
// Per spec §2.4: "When the cursor is on a compound node, LB/RB tap has no
// atom-adjust binding — the tap falls through." This is achieved by the
// predicate only activating on leaves.
//
// Per spec §5.4: LeftStickPress polarity flip only makes sense on numbers,
// but we bind it here and let the handler return false for non-numbers (the
// resolver falls through to the base layer's control.toggleManualLeft on
// no-op). Actually, since the atom layer shadows base, we just accept that
// L3 on non-numbers is a no-op at the handler level.
// ─────────────────────────────────────────────────────────────────────────────
const atomEditLayer: Layer = {
  name: ln("atom-edit"),
  when: (s: AppStateSnapshot) =>
    s.cursorOnLeafAtom === true &&
    s.insertionMode !== true &&
    !s.gamepad.heldButtons.has("LB") &&
    !s.gamepad.heldButtons.has("RB"),
  gestures: {
    [keyOf(tap("LB"))]: "atom.adjustDown",
    [keyOf(tap("RB"))]: "atom.adjustUp",
    [keyOf(tap("LeftStickPress"))]: "atom.flipPolarity",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Insertion-mode layer (B7): D-pad and stick drive the character caret per
// structural-editing.md §4.5.
//
// When the editor is in insertion mode (free-form text editing), the D-pad
// remaps from spatial navigation (nav.up/down/left/right) to character-level
// caret movement (insertion.up/down/left/right). The layer sits above the
// base layer so it shadows D-pad bindings when active.
//
// B (Back) exits insertion mode, returning to structural mode.
// ─────────────────────────────────────────────────────────────────────────────
const insertionLayer: Layer = {
  name: ln("insertion-mode"),
  when: (s: AppStateSnapshot) => s.insertionMode === true,
  gestures: {
    [keyOf(tap("Up"))]: "insertion.up",
    [keyOf(held("Up"))]: "insertion.up",
    [keyOf(tap("Down"))]: "insertion.down",
    [keyOf(held("Down"))]: "insertion.down",
    [keyOf(tap("Left"))]: "insertion.left",
    [keyOf(held("Left"))]: "insertion.left",
    [keyOf(tap("Right"))]: "insertion.right",
    [keyOf(held("Right"))]: "insertion.right",
    [keyOf(tap("B"))]: "edit.exitInsertion",
    [keyOf(tap("Start"))]: "eval.now",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Main menu layer (main-menu.md §4.1): masks all other gamepad input when the
// main menu is open. D-pad navigates the menu; face buttons select/back/close.
// L3+R3 chord toggles (closes) the menu.
// ─────────────────────────────────────────────────────────────────────────────
const mainMenuLayer: Layer = {
  name: ln("main-menu"),
  when: () => isMainMenuOpen(),
  gestures: {
    [keyOf(tap("Up"))]: "mainMenu.prev",
    [keyOf(held("Up"))]: "mainMenu.prev",
    [keyOf(tap("Down"))]: "mainMenu.next",
    [keyOf(held("Down"))]: "mainMenu.next",
    [keyOf(tap("A"))]: "mainMenu.select",
    [keyOf(tap("Start"))]: "mainMenu.select",
    [keyOf(tap("B"))]: "mainMenu.back",
    [keyOf(tap("Back"))]: "mainMenu.close",
    [keyOf(tap("LB"))]: "mainMenu.adjustDown",
    [keyOf(tap("RB"))]: "mainMenu.adjustUp",
    [keyOf(held("LB"))]: "mainMenu.adjustDown",
    [keyOf(held("RB"))]: "mainMenu.adjustUp",
    [keyOf(chord(["LeftStickPress", "RightStickPress"]))]: "mainMenu.close",
  },
};

export const modalShiftLayers: readonly Layer[] = [
  mainMenuLayer,
  lbRbShiftedLayer,
  lbShiftedLayer,
  rbShiftedLayer,
  insertionLayer,
  atomEditLayer,
  baseLayer,
];
