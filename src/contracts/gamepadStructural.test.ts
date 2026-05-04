/**
 * End-to-end contract test (bd useq-perform-4zt.69.7, B3):
 *
 *   gamepad button press → document mutation
 *
 * Drives the real `createGamepadPipeline` (with modal-shift layers) against
 * a real CodeMirror EditorView mounted with the structural-editing extension.
 * Verifies the full chain: fake snapshot → diff → recognizer → resolver →
 * dispatcher → action runner → keybinding handler → structHandler →
 * executeEditorCommand → dispatchAction → core mutator → CodeMirror txn.
 *
 * Heavy runtime dependencies that handlers.ts pulls in (transport, console,
 * probes, diagnostics, evaluation, panels) are mocked so the test stays a
 * pure integration test of the gamepad → editor path.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks for handlers.ts transitive deps
// (mirrors src/lib/keybindings/keybindings.test.ts — same rationale)
// ---------------------------------------------------------------------------

vi.mock("../effects/editorEvaluation.ts", () => ({
  evaluate: vi.fn(() => true),
}));
vi.mock("../editors/editorKeyboard.ts", () => ({
  toggleHelp: vi.fn(() => true),
  toggleSerialVis: vi.fn(() => true),
  showDocumentationForSymbol: vi.fn(() => true),
}));
vi.mock("../editors/extensions/probes.ts", () => ({
  toggleCurrentProbe: vi.fn(() => true),
  expandCurrentProbeContext: vi.fn(() => true),
  contractCurrentProbeContext: vi.fn(() => true),
}));
vi.mock("../ui/visualisation/serialVisGL.ts", () => ({
  requestVisScreenshot: vi.fn(() => true),
}));
vi.mock("../ui/keybindings/ActionPalette.tsx", () => ({
  openPalette: vi.fn(() => true),
}));

// ---------------------------------------------------------------------------
// Real imports (after mocks)
// ---------------------------------------------------------------------------

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
// @ts-expect-error — clojure-mode has no type declarations
import { default_extensions } from "@nextjournal/clojure-mode";

import { structuralCoreExtensions } from "../editors/extensions/structure/adapter/extension.ts";
import { dispatchAction } from "../editors/extensions/structure/adapter/dispatcher.ts";
import { structField } from "../editors/extensions/structure/adapter/stateField.ts";
import { createGamepadPipeline, type GamepadPipeline } from "../lib/gamepad/index.ts";
import { createGamepadManager } from "../lib/gamepad/gamepadManager.ts";
import { BUTTON_ORDER, type ButtonName } from "../lib/gamepad/types.ts";

// ---------------------------------------------------------------------------
// Helpers — fake gamepad snapshot stream
// ---------------------------------------------------------------------------

/**
 * Canonical button index per BUTTON_MAP in gamepadManager.ts.
 * gamepad.buttons[i] is read by the manager and matched against this layout.
 */
const BUTTON_INDEX: Record<ButtonName, number> = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  Back: 8,
  Start: 9,
  LeftStickPress: 10,
  RightStickPress: 11,
  Up: 12,
  Down: 13,
  Left: 14,
  Right: 15,
};

interface FakePadState {
  pressed: Set<ButtonName>;
  axes: [number, number, number, number]; // LX, LY, RX, RY
}

/** Build a single fake `Gamepad` reading the current pressed-set. */
function makeFakePad(state: FakePadState): Gamepad {
  const buttons = new Array(16).fill(null).map((_, i) => {
    const name = BUTTON_ORDER.find((n) => BUTTON_INDEX[n] === i);
    const pressed = name !== undefined && state.pressed.has(name);
    return {
      pressed,
      touched: pressed,
      value: pressed ? 1 : 0,
    };
  });
  return {
    id: "fake-pad",
    index: 0,
    connected: true,
    timestamp: 0,
    mapping: "standard" as GamepadMappingType,
    buttons: buttons as unknown as readonly GamepadButton[],
    axes: state.axes,
    vibrationActuator: null as unknown as GamepadHapticActuator,
    hapticActuators: [] as unknown as readonly GamepadHapticActuator[],
  } as unknown as Gamepad;
}

/**
 * Test rig: spins up an EditorView + real gamepad pipeline driven by a
 * mutable fake-pad state. Each `tick(updates)` mutates the pad state and
 * advances the polling timer once so the pipeline observes the change.
 */
interface Rig {
  view: EditorView;
  pipeline: GamepadPipeline;
  /** Update the pad state (mutates pressed set / axes), then advance one poll. */
  tick: (mut?: (s: FakePadState) => void) => void;
  dispose: () => void;
}

const POLL_MS = 50;

function createRig(doc: string): Rig {
  // Spatial vertical nav reads source positions from the live view, so we
  // do need a real DOM — jsdom is configured project-wide.
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [...default_extensions, ...structuralCoreExtensions()],
    }),
  });

  const padState: FakePadState = {
    pressed: new Set(),
    axes: [0, 0, 0, 0],
  };

  // Deterministic clock: each tick advances now() by POLL_MS. We bump it
  // BEFORE calling tick so chord-grace / tap timing is stable, but still
  // monotonic.
  let nowMs = 1000;

  const manager = createGamepadManager({
    getGamepads: () => [makeFakePad(padState)],
    addListener: () => {},
    removeListener: () => {},
    now: () => nowMs,
  });

  const pipeline = createGamepadPipeline({
    editor: view,
    gamepadManager: manager,
    pollIntervalMs: POLL_MS,
    now: () => nowMs,
  });

  pipeline.start();
  // start() calls tick() once immediately, which initialises prevSnapshot.
  // We need at least one further tick before any observable input lands.

  function tick(mut?: (s: FakePadState) => void): void {
    if (mut) mut(padState);
    nowMs += POLL_MS;
    vi.advanceTimersByTime(POLL_MS);
  }

  return {
    view,
    pipeline,
    tick,
    dispose: () => {
      pipeline.dispose();
      view.destroy();
    },
  };
}

/** Hold a button for one tick (press → release in two adjacent polls). */
function tap(rig: Rig, btn: ButtonName): void {
  rig.tick((s) => s.pressed.add(btn));
  rig.tick((s) => s.pressed.delete(btn));
}

/**
 * Press `mod`, hold it across a tap of `btn`, then release `mod`.
 * Spaces the mod-press far enough from the btn-press that they DON'T form
 * a chord — modal-shift's predicate-based layers match plain tap(btn) while
 * mod is in heldButtons.
 */
function holdTap(rig: Rig, mods: ButtonName[], btn: ButtonName): void {
  rig.tick((s) => mods.forEach((m) => s.pressed.add(m))); // press mods
  rig.tick(); // empty tick to push mods past chord-grace (30ms < 50ms)
  rig.tick((s) => s.pressed.add(btn)); // press btn while mods held
  rig.tick((s) => s.pressed.delete(btn)); // release btn
  rig.tick((s) => mods.forEach((m) => s.pressed.delete(m))); // release mods
}

/** Zero-sized DOMRect shim for jsdom's missing Range layout. */
function makeRect(): DOMRect {
  return {
    x: 0, y: 0, width: 0, height: 0,
    top: 0, right: 0, bottom: 0, left: 0,
    toJSON() { return this; },
  } as DOMRect;
}

/** Read the text of the currently-focused structural node. */
function focusedText(view: EditorView): string {
  const value = view.state.field(structField);
  const c = value.state.cursors.primary;
  const id = c.kind === "node" ? c.target : c.start;
  const range = value.idIndex.get(id);
  if (!range) return "<no-range>";
  return view.state.doc.sliceString(range.from, range.to);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("gamepad → structural mutation (end-to-end)", () => {
  // jsdom's Range doesn't implement getClientRects. CodeMirror schedules
  // measurement callbacks via requestAnimationFrame whenever the doc
  // changes; if those rAFs fire (during teardown or after the test) they
  // crash the test runner. Stub a no-op shim once.
  let savedRects: typeof Range.prototype.getClientRects | undefined;
  let savedBounding: typeof Range.prototype.getBoundingClientRect | undefined;
  beforeEach(() => {
    if (typeof Range !== "undefined") {
      savedRects = Range.prototype.getClientRects;
      savedBounding = Range.prototype.getBoundingClientRect;
      Range.prototype.getClientRects = (() =>
        [] as unknown as DOMRectList) as typeof Range.prototype.getClientRects;
      Range.prototype.getBoundingClientRect = (() =>
        makeRect()) as unknown as typeof Range.prototype.getBoundingClientRect;
    }
    // Only fake setInterval/clearInterval — leaving rAF / queueMicrotask /
    // setTimeout real so CodeMirror's DOM measurement scheduling still
    // works in jsdom.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (savedRects) Range.prototype.getClientRects = savedRects;
    if (savedBounding) Range.prototype.getBoundingClientRect = savedBounding;
  });

  describe("D-pad spatial nav", () => {
    it("D-pad Right advances the structural cursor (§5.1.1)", () => {
      const rig = createRig("(a b)");
      // From document root: nav.in → (a b), nav.in → a.
      dispatchAction(rig.view, "nav.in");
      dispatchAction(rig.view, "nav.in");
      expect(focusedText(rig.view)).toBe("a");

      tap(rig, "Right");
      // nav.right advances Euler-tour from `a` to `b`.
      expect(focusedText(rig.view)).toBe("b");
      rig.dispose();
    });

    it("D-pad Down moves to the next non-empty source line (§5.1.2)", () => {
      const rig = createRig("(foo)\n(bar)");
      dispatchAction(rig.view, "nav.in"); // cursor on (foo)
      expect(focusedText(rig.view)).toBe("(foo)");

      tap(rig, "Down");
      expect(focusedText(rig.view)).toBe("(bar)");
      rig.dispose();
    });

    it("D-pad Up moves to the previous non-empty source line (§5.1.2)", () => {
      const rig = createRig("(foo)\n(bar)");
      dispatchAction(rig.view, "nav.in"); // cursor on (foo)
      dispatchAction(rig.view, "nav.next"); // cursor on (bar)
      expect(focusedText(rig.view)).toBe("(bar)");

      tap(rig, "Up");
      expect(focusedText(rig.view)).toBe("(foo)");
      rig.dispose();
    });
  });

  describe("LB-shifted face-button structural verbs", () => {
    it("LB + A → edit.slurpForward pulls next sibling into focused compound", () => {
      const rig = createRig("(a) b");
      dispatchAction(rig.view, "nav.in"); // cursor on (a)
      expect(rig.view.state.doc.toString()).toBe("(a) b");

      holdTap(rig, ["LB"], "A");

      expect(rig.view.state.doc.toString()).toContain("(a b)");
      rig.dispose();
    });

    it("LB + B → edit.barfForward ejects the last child of focused compound", () => {
      const rig = createRig("(a b)");
      dispatchAction(rig.view, "nav.in"); // cursor on (a b)
      expect(focusedText(rig.view)).toBe("(a b)");

      holdTap(rig, ["LB"], "B");

      const text = rig.view.state.doc.toString();
      // Result contains "(a)" with `b` ejected after it; whitespace varies.
      expect(text).toContain("(a)");
      expect(text).toMatch(/\(a\)\s*b/);
      expect(text).not.toBe("(a b)");
      rig.dispose();
    });
  });

  describe("LB+RB-shifted structural shape verbs (B6)", () => {
    it("LB + RB + A → edit.raise replaces the parent with the focused node", () => {
      const rig = createRig("(a (b c))");
      dispatchAction(rig.view, "nav.in"); // cursor on (a (b c))
      dispatchAction(rig.view, "nav.in"); // cursor on `a`
      dispatchAction(rig.view, "nav.next"); // cursor on (b c)
      dispatchAction(rig.view, "nav.in"); // cursor on `b`
      expect(focusedText(rig.view)).toBe("b");

      holdTap(rig, ["LB", "RB"], "A");

      // (b c) replaced by b → document becomes (a b)
      expect(rig.view.state.doc.toString()).toContain("(a b)");
      rig.dispose();
    });

    it("LB + RB + Up → edit.encloseList wraps the focused node in parens", () => {
      const rig = createRig("(a b c)");
      dispatchAction(rig.view, "nav.in"); // cursor on (a b c)
      dispatchAction(rig.view, "nav.in"); // cursor on `a`
      dispatchAction(rig.view, "nav.next"); // cursor on `b`
      expect(focusedText(rig.view)).toBe("b");

      holdTap(rig, ["LB", "RB"], "Up");

      expect(rig.view.state.doc.toString()).toContain("(a (b) c)");
      rig.dispose();
    });
  });
});
