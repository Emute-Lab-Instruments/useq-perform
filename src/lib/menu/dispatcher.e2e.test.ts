/**
 * End-to-end integration test (bd useq-perform-4zt.69.37, H5):
 *
 *   gamepad button press → menu open → verb → document mutation
 *
 * Drives the real gamepad pipeline + menu dispatcher + menu state store +
 * structural editor against a real CodeMirror EditorView. Verifies the
 * full chain: fake gamepad snapshot → diff → recognizer → resolver →
 * dispatcher → menu reducer → verb application → editor transaction.
 *
 * Uses the same fake-getGamepads harness from B3
 * (`contracts/gamepadStructural.test.ts`).
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks for handlers.ts transitive deps
// (mirrors contracts/gamepadStructural.test.ts — same rationale)
// ---------------------------------------------------------------------------

vi.mock("../../effects/editorEvaluation.ts", () => ({
  evaluate: vi.fn(() => true),
}));
vi.mock("../../editors/editorKeyboard.ts", () => ({
  toggleHelp: vi.fn(() => true),
  toggleSerialVis: vi.fn(() => true),
  showDocumentationForSymbol: vi.fn(() => true),
}));
vi.mock("../../editors/extensions/probes.ts", () => ({
  toggleCurrentProbe: vi.fn(() => true),
  expandCurrentProbeContext: vi.fn(() => true),
  contractCurrentProbeContext: vi.fn(() => true),
}));
vi.mock("../../ui/visualisation/serialVisGL.ts", () => ({
  requestVisScreenshot: vi.fn(() => true),
}));
vi.mock("../../ui/keybindings/ActionPalette.tsx", () => ({
  openPalette: vi.fn(() => true),
}));

// ---------------------------------------------------------------------------
// Real imports (after mocks)
// ---------------------------------------------------------------------------

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
// @ts-expect-error — clojure-mode has no type declarations
import { default_extensions } from "@nextjournal/clojure-mode";

import { structuralCoreExtensions } from "../../editors/extensions/structure/adapter/extension.ts";
import { dispatchAction } from "../../editors/extensions/structure/adapter/dispatcher.ts";
import { structField } from "../../editors/extensions/structure/adapter/stateField.ts";
import { createGamepadPipeline, type GamepadPipeline } from "../gamepad/index.ts";
import { createGamepadManager } from "../gamepad/gamepadManager.ts";
import { BUTTON_ORDER, type ButtonName } from "../gamepad/types.ts";
import { createMenuDispatcher, type MenuDispatcher } from "./dispatcher.ts";
import { menuState, dispatchMenuInput, isMenuOpen } from "./store.ts";
import {
  getCachedManifest,
  setCachedManifest,
  clearCachedManifest,
} from "./manifest.ts";
import type { Manifest } from "./types.ts";

// ---------------------------------------------------------------------------
// Helpers — fake gamepad snapshot stream (from B3)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Test manifest — function with a number hole for auto-chain, plus a symbol
// ---------------------------------------------------------------------------

function makeTestManifest(): Manifest {
  return {
    version: 1,
    tabs: [
      {
        id: "functions" as any,
        label: "Functions",
        categories: [
          {
            id: "oscillators" as any,
            label: "Oscillators",
            items: [
              {
                kind: "function",
                id: "fn.saw" as any,
                label: "saw",
                head: "saw",
                signature: [{ name: "freq", type: "number" }],
              },
              {
                kind: "symbol",
                id: "sym.t" as any,
                label: "t",
                text: "t",
              },
            ],
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Rig — full e2e test harness
// ---------------------------------------------------------------------------

const POLL_MS = 50;

interface Rig {
  view: EditorView;
  pipeline: GamepadPipeline;
  menuDispatcher: MenuDispatcher;
  tick: (mut?: (s: FakePadState) => void) => void;
  dispose: () => void;
}

function createRig(doc: string): Rig {
  // Real CodeMirror EditorView with structural extensions.
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [...default_extensions, ...structuralCoreExtensions()],
    }),
  });

  // Seed the manifest cache before creating the dispatcher.
  const manifest = makeTestManifest();
  setCachedManifest(manifest);

  // Menu dispatcher wired to the real menu store + editor.
  const menuDispatcher = createMenuDispatcher({
    getMenuState: menuState,
    dispatchInput: dispatchMenuInput,
    getManifest: () => getCachedManifest(),
    getEditorView: () => view,
  });

  // Bind the dispatcher so it receives menu.* actions.
  const menuCleanup = menuDispatcher.bind(view);

  const padState: FakePadState = {
    pressed: new Set(),
    axes: [0, 0, 0, 0],
  };

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
    menuDispatcher,
  });

  pipeline.start();

  function tick(mut?: (s: FakePadState) => void): void {
    if (mut) mut(padState);
    nowMs += POLL_MS;
    vi.advanceTimersByTime(POLL_MS);
  }

  return {
    view,
    pipeline,
    menuDispatcher,
    tick,
    dispose: () => {
      pipeline.dispose();
      menuCleanup();
      view.destroy();
      clearCachedManifest();
    },
  };
}

/** Hold a button for one tick (press → release in two adjacent polls). */
function tap(rig: Rig, btn: ButtonName): void {
  rig.tick((s) => s.pressed.add(btn));
  rig.tick((s) => s.pressed.delete(btn));
}

/**
 * Press a shoulder, hold it, tap a face button, then release the shoulder.
 * This simulates a freeze sequence: shoulder press → hover via stick →
 * face button commit.
 */
function holdTap(rig: Rig, shoulder: ButtonName, face: ButtonName): void {
  rig.tick((s) => s.pressed.add(shoulder)); // press shoulder
  rig.tick(); // empty tick to push shoulder past chord-grace
  rig.tick((s) => s.pressed.add(face)); // press face
  rig.tick((s) => s.pressed.delete(face)); // release face
  rig.tick((s) => s.pressed.delete(shoulder)); // release shoulder
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

describe("gamepad → radial menu → verb → document mutation (e2e)", () => {
  let savedRects: typeof Range.prototype.getClientRects | undefined;
  let savedBounding: typeof Range.prototype.getBoundingClientRect | undefined;

  beforeEach(() => {
    // Reset the menu store to closed state before each test.
    dispatchMenuInput({ kind: "cancel" });

    if (typeof Range !== "undefined") {
      savedRects = Range.prototype.getClientRects;
      savedBounding = Range.prototype.getBoundingClientRect;
      Range.prototype.getClientRects = (() =>
        [] as unknown as DOMRectList) as typeof Range.prototype.getClientRects;
      Range.prototype.getBoundingClientRect = (() =>
        makeRect()) as unknown as typeof Range.prototype.getBoundingClientRect;
    }
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (savedRects) Range.prototype.getClientRects = savedRects;
    if (savedBounding) Range.prototype.getBoundingClientRect = savedBounding;
  });

  // -----------------------------------------------------------------------
  // Test 1: Open/close cycle
  // -----------------------------------------------------------------------

  describe("open/close cycle", () => {
    it("tap(X) opens the menu, tap(Back) closes it", () => {
      const rig = createRig("(a b)");
      // Navigate to a node so the dispatcher can find an apply target.
      dispatchAction(rig.view, "nav.in"); // cursor on (a b)

      expect(isMenuOpen()).toBe(false);

      // tap(X) in base layer → resolves to "menu.radial" → dispatcher opens menu.
      tap(rig, "X");

      expect(isMenuOpen()).toBe(true);

      // tap(Back) in radial layer → resolves to "menu.cancel" → dispatcher closes.
      tap(rig, "Back");

      expect(isMenuOpen()).toBe(false);

      rig.dispose();
    });

    it("opening menu when already open is idempotent", () => {
      const rig = createRig("(a b)");
      dispatchAction(rig.view, "nav.in");

      tap(rig, "X");
      expect(isMenuOpen()).toBe(true);

      // Open again while open — should not error.
      tap(rig, "X");
      expect(isMenuOpen()).toBe(true);

      tap(rig, "Back");
      expect(isMenuOpen()).toBe(false);

      rig.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Test 2: Verb commit applies document mutation
  // -----------------------------------------------------------------------

  describe("verb commit mutates the document", () => {
    it("gamepad opens menu → freeze → tap(A) → insert → document mutated", () => {
      const rig = createRig("(a1 (sqr t))");
      // Navigate to the `sqr` symbol so we have a target.
      dispatchAction(rig.view, "nav.in"); // cursor on (a1 (sqr t))
      dispatchAction(rig.view, "nav.in"); // cursor on a1
      dispatchAction(rig.view, "nav.next"); // cursor on (sqr t)
      dispatchAction(rig.view, "nav.in"); // cursor on sqr
      const before = rig.view.state.doc.toString();

      // Open the menu: tap(X) → "menu.radial" → dispatcher opens.
      tap(rig, "X");
      expect(isMenuOpen()).toBe(true);

      // Set hovers via dispatcher (simulates stick input).
      rig.menuDispatcher.handleAxis("left", 0); // oscillators category
      rig.menuDispatcher.handleAxis("right", 1); // symbol "t"

      // Freeze: the gamepad pipeline doesn't generate shoulderEdge inputs
      // (shoulder tracking is a separate concern). Dispatch directly.
      dispatchMenuInput({
        kind: "shoulderEdge",
        side: "right",
        transition: "press",
        ts: Date.now(),
      });

      // Now tap(A) in radial layer → resolves to "menu.verb.insert".
      tap(rig, "A");

      // After verb commit, menu should close (no holes in a symbol item).
      expect(isMenuOpen()).toBe(false);

      // Document should have been mutated — the symbol "t" was inserted.
      const after = rig.view.state.doc.toString();
      expect(after).not.toBe(before);

      rig.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Test 2b: Freeze via real raw-shoulder pipeline (no direct injection)
  //
  // Regression for the bug where the gamepad pipeline never produced
  // shoulderEdge inputs, so the freeze mechanic (and therefore all four verbs)
  // was unreachable from a real controller. The pipeline now forwards raw
  // LB/RB press/release edges to the dispatcher while the menu is open
  // (radial-menu.md §3.3.2, §6.1, §11.4).
  // -----------------------------------------------------------------------

  describe("freeze via raw shoulder pipeline", () => {
    it("hold RB → tap(A) commits the verb without injecting shoulderEdge", () => {
      const rig = createRig("(a1 (sqr t))");
      dispatchAction(rig.view, "nav.in");
      dispatchAction(rig.view, "nav.in");
      dispatchAction(rig.view, "nav.next");
      dispatchAction(rig.view, "nav.in"); // cursor on sqr
      const before = rig.view.state.doc.toString();

      // Open the menu.
      tap(rig, "X");
      expect(isMenuOpen()).toBe(true);

      // Hover a category + item (picking sub-phase).
      rig.menuDispatcher.handleAxis("left", 0);
      rig.menuDispatcher.handleAxis("right", 1);

      // Hold RB across ticks (raw press → freeze latch) then tap A to commit.
      // No direct shoulderEdge dispatch — the pipeline must generate it.
      holdTap(rig, "RB", "A");

      // Symbol item has no holes → menu closes after commit.
      expect(isMenuOpen()).toBe(false);
      expect(rig.view.state.doc.toString()).not.toBe(before);

      rig.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Test 3: Auto-chain on hole
  // -----------------------------------------------------------------------

  describe("auto-chain on hole", () => {
    it("insert function with signature reopens menu on typed hole", () => {
      const rig = createRig("(a1 (sqr t))");
      // Navigate to the `sqr` symbol.
      dispatchAction(rig.view, "nav.in");
      dispatchAction(rig.view, "nav.in");
      dispatchAction(rig.view, "nav.next");
      dispatchAction(rig.view, "nav.in");
      expect(focusedText(rig.view)).toBe("sqr");

      // Open the menu.
      tap(rig, "X");
      expect(isMenuOpen()).toBe(true);

      // Pick category oscillators (index 0) and item fn.saw (index 0).
      rig.menuDispatcher.handleAxis("left", 0);
      rig.menuDispatcher.handleAxis("right", 0);

      // Freeze via direct shoulder dispatch.
      dispatchMenuInput({
        kind: "shoulderEdge",
        side: "right",
        transition: "press",
        ts: Date.now(),
      });

      // tap(A) in radial layer → "menu.verb.insert" → verb applies.
      tap(rig, "A");

      // The "saw" function has a "number" hole → auto-chain should reopen.
      expect(isMenuOpen()).toBe(true);

      // Document should have been mutated — "saw" inserted.
      const docText = rig.view.state.doc.toString();
      expect(docText).toContain("saw");

      // Close the auto-chained menu.
      tap(rig, "Back");
      expect(isMenuOpen()).toBe(false);

      rig.dispose();
    });

    it("insert symbol does not auto-chain (no holes)", () => {
      const rig = createRig("(a1 (sqr t))");
      dispatchAction(rig.view, "nav.in");
      dispatchAction(rig.view, "nav.in");
      dispatchAction(rig.view, "nav.next");
      dispatchAction(rig.view, "nav.in");
      expect(focusedText(rig.view)).toBe("sqr");

      tap(rig, "X");
      expect(isMenuOpen()).toBe(true);

      // Pick category oscillators (0) and symbol "t" (1).
      rig.menuDispatcher.handleAxis("left", 0);
      rig.menuDispatcher.handleAxis("right", 1);

      // Freeze via direct shoulder dispatch.
      dispatchMenuInput({
        kind: "shoulderEdge",
        side: "right",
        transition: "press",
        ts: Date.now(),
      });

      // tap(A) → "menu.verb.insert" → symbol has no holes.
      tap(rig, "A");

      // Symbol "t" has no holes → menu should close, no auto-chain.
      expect(isMenuOpen()).toBe(false);

      rig.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Test 4: Dispatcher directly — open → verb → mutation
  // -----------------------------------------------------------------------

  describe("dispatcher direct action routing", () => {
    it("handleAction(menu.radial) opens menu with struct cursor", () => {
      const rig = createRig("(foo)");
      dispatchAction(rig.view, "nav.in");

      // Directly call handleAction instead of going through the gamepad.
      rig.menuDispatcher.handleAction("menu.radial");

      expect(isMenuOpen()).toBe(true);

      rig.menuDispatcher.handleAction("menu.cancel");
      expect(isMenuOpen()).toBe(false);

      rig.dispose();
    });

    it("handleAction(menu.verb.insert) with frozen state applies verb", () => {
      const rig = createRig("(foo)");
      dispatchAction(rig.view, "nav.in");

      // Open menu.
      rig.menuDispatcher.handleAction("menu.radial");
      expect(isMenuOpen()).toBe(true);

      // Set hovers to pick a category and item.
      rig.menuDispatcher.handleAxis("left", 0);
      rig.menuDispatcher.handleAxis("right", 1); // symbol "t"

      // Freeze: hold RB → snapshot captured.
      // We need to get into frozen state. The reducer handles shoulderEdge
      // input, but the dispatcher doesn't route gamepad shoulders directly
      // through handleAction. Instead we manually drive the store state.
      //
      // Alternative: directly set the state to frozen via dispatchInput.
      // The dispatcher reads the menu state to check subPhase.
      dispatchMenuInput({
        kind: "shoulderEdge",
        side: "right",
        transition: "press",
        ts: Date.now(),
      });

      // Verify we're in frozen state.
      const state = menuState();
      expect(state.phase).toBe("open");
      if (state.phase === "open") {
        // frozen should be set now (both hovers were non-null when shoulder pressed).
        expect(state.frozen).not.toBeNull();
      }

      // Now fire the insert verb via handleAction.
      const before = rig.view.state.doc.toString();
      rig.menuDispatcher.handleAction("menu.verb.insert");

      // Symbol "t" has no holes → menu closes.
      expect(isMenuOpen()).toBe(false);

      // Document should have been mutated.
      const after = rig.view.state.doc.toString();
      expect(after).not.toBe(before);

      rig.dispose();
    });
  });
});
