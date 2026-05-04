// src/lib/menu/dispatcher.test.ts
//
// Tests for the menu dispatcher — the single impure module that wires gamepad
// input to the state machine, applies verb mutations, and handles auto-chain.
//
// Uses fakes for the editor view, structural state field, and input channels.
// No real CodeMirror or Solid runtime is needed — the dispatcher reads/writes
// through injected dependencies that we control.
//
// Bead: useq-perform-4zt.69.33 (H1).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createMenuDispatcher, type MenuDispatcher, type MenuDispatcherDeps, numpadCharAt, t9GroupAt, t9CharAt, T9_POSITION_COUNT, textModeForHoleType } from "./dispatcher";
import { INITIAL_STATE, reduce } from "./state";
import type {
  ActionId,
  ApplyTarget,
  Manifest,
  MenuInput,
  MenuState,
  MenuStateOpen,
  MenuItem,
  CategoryId,
  ItemId,
  TabId,
} from "./types";
import {
  __resetIdCounterForTests,
  defaultIdGen,
  nodeCursor,
  singleCursor,
  type IdGen,
  type NodeId,
  type State,
  type Tree,
} from "../../editors/extensions/structure/core/types";
import {
  doc,
  sym,
  hole,
} from "../../editors/extensions/structure/core/__tests__/builders";

// ---------------------------------------------------------------------------
// Test manifest fixture
// ---------------------------------------------------------------------------

function makeManifest(items?: MenuItem[]): Manifest {
  return {
    version: 1,
    tabs: [
      {
        id: "functions" as TabId,
        label: "Functions",
        categories: [
          {
            id: "math" as CategoryId,
            label: "Math",
            items: items ?? [
              {
                kind: "symbol",
                id: "item-x" as ItemId,
                label: "x",
                text: "x",
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Function item with a number hole for auto-chain testing. */
function fnWithHole(): MenuItem {
  return {
    kind: "function",
    id: "item-osc" as ItemId,
    label: "osc",
    head: "osc",
    signature: [{ name: "freq", type: "number" }],
  };
}

// ---------------------------------------------------------------------------
// Fake struct field value
// ---------------------------------------------------------------------------

interface FakeStructValue {
  state: State;
  idIndex: Map<NodeId, { from: number; to: number }>;
}

/**
 * Build a fake struct field value for a given tree, with source positions
 * assigned sequentially from rendered text.
 */
function fakeStructValue(tree: Tree): FakeStructValue {
  const idIndex = new Map<NodeId, { from: number; to: number }>();
  const text = tree.root.children.map(printFakeNode).join("\n");

  let pos = 0;
  for (const child of tree.root.children) {
    const rendered = printFakeNode(child);
    idIndex.set(child.id, { from: pos, to: pos + rendered.length });
    pos += rendered.length + 1; // +1 for newline
  }

  return {
    state: { tree, cursors: singleCursor(nodeCursor(tree.root.id)) },
    idIndex,
  };
}

/**
 * Like fakeStructValue but positions the primary cursor on a specific child
 * node instead of the document root. Used for text.open routing tests where
 * the dispatcher reads the node at the cursor position.
 */
function fakeStructValueOnNode(tree: Tree, targetId: NodeId): FakeStructValue {
  const sv = fakeStructValue(tree);
  sv.state = { tree, cursors: singleCursor(nodeCursor(targetId)) };
  return sv;
}

/** Minimal node printer matching the real printNode output. */
function printFakeNode(n: import("../../editors/extensions/structure/core/types").Node): string {
  switch (n.kind) {
    case "document":
      return n.children.map(printFakeNode).join("\n");
    case "symbol":
      return n.text;
    case "number":
      return n.text;
    case "keyword":
      return n.text;
    case "string":
      return n.text;
    case "hole":
      return `($ ${n.name} :${n.holeType})`;
    case "list":
      return `(${n.children.map(printFakeNode).join(" ")})`;
    case "vector":
      return `[${n.children.map(printFakeNode).join(" ")}]`;
    case "map":
      return `{${n.children.map(printFakeNode).join(" ")}}`;
    case "set":
      return `#{${n.children.map(printFakeNode).join(" ")}}`;
  }
}

// ---------------------------------------------------------------------------
// Fake editor view
//
// The dispatcher calls executeEditorCommand, which calls view.dispatch.
// We need a realistic enough fake to survive that call chain.
// ---------------------------------------------------------------------------

function createFakeEditorView(structValue: FakeStructValue): any {
  const docText = structValue.state.tree.root.children
    .map((n) => printFakeNode(n))
    .join("\n");

  return {
    state: {
      field: (_field: any, _strict?: boolean) => structValue,
      selection: { main: { head: 0, from: 0, to: 0 } },
      doc: {
        length: docText.length,
        sliceString: (_from: number, _to: number) => docText.slice(_from, _to),
        toString: () => docText,
      },
    },
    dispatch: vi.fn(() => {
      // No-op — just record the call.
    }),
    dom: { ownerDocument: { defaultView: { KeyboardEvent } } },
  };
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface LogEntry {
  kind: "dispatchInput" | "handleAction" | "handleAxis";
  detail: unknown;
}

/**
 * Options for creating a test harness. `nullManifest` creates a harness
 * whose getManifest returns null (simulating manifest load failure).
 */
interface HarnessOptions {
  manifest?: Manifest;
  nullManifest?: boolean;
}

function createHarness(opts?: HarnessOptions) {
  const manifest = opts?.nullManifest ? null : (opts?.manifest ?? makeManifest());

  let menuState: MenuState = INITIAL_STATE;
  const log: LogEntry[] = [];

  let actionHandler: ((action: ActionId) => void) | null = null;
  let axisHandler: ((stick: "left" | "right", hover: number | null) => void) | null = null;

  const deps: MenuDispatcherDeps = {
    getMenuState: () => menuState,
    dispatchInput: (input: MenuInput) => {
      log.push({ kind: "dispatchInput", detail: input });
      menuState = reduce(menuState, input);
    },
    getManifest: () => manifest,
    getEditorView: () => undefined as any,
    onActions: (_actions, handler) => {
      actionHandler = handler;
      return () => { actionHandler = null; };
    },
    onAxis: (handler) => {
      axisHandler = handler;
      return () => { axisHandler = null; };
    },
  };

  const dispatcher = createMenuDispatcher(deps);

  return {
    dispatcher,
    deps,
    log,
    getMenuState: () => menuState,
    setMenuState: (s: MenuState) => { menuState = s; },
    fireAction: (action: ActionId) => {
      if (actionHandler) {
        actionHandler(action);
      } else {
        dispatcher.handleAction(action);
      }
    },
    fireAxis: (stick: "left" | "right", hover: number | null) => {
      if (axisHandler) {
        axisHandler(stick, hover);
      } else {
        dispatcher.handleAxis(stick, hover);
      }
    },
    setEditorView: (view: any) => {
      (deps as any).getEditorView = () => view;
    },
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  __resetIdCounterForTests();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MenuDispatcher", () => {
  // ---- Creation and bind -------------------------------------------------

  describe("creation and bind", () => {
    it("creates a dispatcher without errors", () => {
      const { dispatcher } = createHarness();
      expect(dispatcher).toBeDefined();
    });

    it("bind returns an unsubscribe function", () => {
      const { dispatcher } = createHarness();
      const ids = defaultIdGen();
      const tree = { root: doc(ids) };
      const sv = fakeStructValue(tree);
      const fakeView = createFakeEditorView(sv);

      const unsub = dispatcher.bind(fakeView);
      expect(typeof unsub).toBe("function");
      unsub();
    });

    it("bind registers action and axis handlers", () => {
      const { dispatcher, fireAction, getMenuState } = createHarness();
      const ids = defaultIdGen();
      const tree = { root: doc(ids, sym("x", ids)) };
      const sv = fakeStructValue(tree);
      const fakeView = createFakeEditorView(sv);

      const unsub = dispatcher.bind(fakeView);

      // Fire cancel through the registered handler.
      fireAction("menu.cancel");
      expect(getMenuState().phase).toBe("closed");

      unsub();
    });
  });

  // ---- Open / Close ------------------------------------------------------

  describe("open and close", () => {
    it("opens the menu with a valid manifest", () => {
      const { dispatcher, getMenuState } = createHarness();
      const target = { __brand: "ApplyTarget" } as unknown as ApplyTarget;

      dispatcher.open(target);

      expect(getMenuState().phase).toBe("open");
    });

    it("open is no-op when manifest is null", () => {
      const { dispatcher, getMenuState } = createHarness({ nullManifest: true });
      const target = { __brand: "ApplyTarget" } as unknown as ApplyTarget;

      dispatcher.open(target);

      expect(getMenuState().phase).toBe("closed");
    });

    it("close dispatches cancel", () => {
      const { dispatcher, getMenuState, log } = createHarness();
      const target = { __brand: "ApplyTarget" } as unknown as ApplyTarget;

      dispatcher.open(target);
      expect(getMenuState().phase).toBe("open");

      dispatcher.close();
      expect(getMenuState().phase).toBe("closed");

      const lastInput = log
        .filter((e) => e.kind === "dispatchInput")
        .map((e) => e.detail as MenuInput)
        .pop();
      expect(lastInput?.kind).toBe("cancel");
    });
  });

  // ---- Axis routing -------------------------------------------------------

  describe("axis routing", () => {
    it("dispatches axisLeft for left stick", () => {
      const { dispatcher, getMenuState, fireAxis } = createHarness();
      const target = { __brand: "ApplyTarget" } as unknown as ApplyTarget;
      dispatcher.open(target);

      fireAxis("left", 2);

      const state = getMenuState();
      expect(state.phase).toBe("open");
      if (state.phase === "open") {
        expect(state.leftHover).toBe(2);
      }
    });

    it("dispatches axisRight for right stick", () => {
      const { dispatcher, getMenuState, fireAxis } = createHarness();
      const target = { __brand: "ApplyTarget" } as unknown as ApplyTarget;
      dispatcher.open(target);

      fireAxis("left", 0);
      fireAxis("right", 1);

      const state = getMenuState();
      expect(state.phase).toBe("open");
      if (state.phase === "open") {
        expect(state.rightHover).toBe(1);
      }
    });

    it("ignores axis when menu is closed", () => {
      const { fireAxis, log } = createHarness();

      const beforeLen = log.length;
      fireAxis("left", 3);
      expect(log.length).toBe(beforeLen);
    });
  });

  // ---- Tab cycling --------------------------------------------------------

  describe("tab cycling", () => {
    it("menu.tab.cyclePrev dispatches tabCycle left -1", () => {
      const { dispatcher, fireAction, log } = createHarness();
      const target = { __brand: "ApplyTarget" } as unknown as ApplyTarget;
      dispatcher.open(target);

      fireAction("menu.tab.cyclePrev");

      const inputs = log
        .filter((e) => e.kind === "dispatchInput")
        .map((e) => e.detail as MenuInput);
      const tabInput = inputs.find(
        (i) => i.kind === "tabCycle" && i.side === "left" && i.dir === -1,
      );
      expect(tabInput).toBeDefined();
    });

    it("menu.tab.cycleNext dispatches tabCycle left 1", () => {
      const { dispatcher, fireAction, log } = createHarness();
      const target = { __brand: "ApplyTarget" } as unknown as ApplyTarget;
      dispatcher.open(target);

      fireAction("menu.tab.cycleNext");

      const inputs = log
        .filter((e) => e.kind === "dispatchInput")
        .map((e) => e.detail as MenuInput);
      const tabInput = inputs.find(
        (i) => i.kind === "tabCycle" && i.side === "left" && i.dir === 1,
      );
      expect(tabInput).toBeDefined();
    });

    it("tab cycling is no-op when menu is closed", () => {
      const { fireAction, log } = createHarness();

      const beforeLen = log.length;
      fireAction("menu.tab.cyclePrev");
      expect(log.length).toBe(beforeLen);
    });
  });

  // ---- Cancel -------------------------------------------------------------

  describe("cancel", () => {
    it("menu.cancel dispatches cancel input", () => {
      const { dispatcher, getMenuState, fireAction } = createHarness();
      const target = { __brand: "ApplyTarget" } as unknown as ApplyTarget;
      dispatcher.open(target);

      fireAction("menu.cancel");

      expect(getMenuState().phase).toBe("closed");
    });
  });

  // ---- menu.radial (open trigger) -----------------------------------------

  describe("menu.radial open trigger", () => {
    it("opens the menu when editor has struct state", () => {
      const ids = defaultIdGen();
      const tree = { root: doc(ids, sym("x", ids)) };
      const sv = fakeStructValue(tree);
      const fakeView = createFakeEditorView(sv);

      const { dispatcher, getMenuState, setEditorView, fireAction } = createHarness();
      setEditorView(fakeView);
      dispatcher.bind(fakeView);

      fireAction("menu.radial");

      expect(getMenuState().phase).toBe("open");
    });

    it("is no-op without editor view", () => {
      const { getMenuState, fireAction } = createHarness();

      fireAction("menu.radial");

      expect(getMenuState().phase).toBe("closed");
    });
  });

  // ---- Verb dispatch ------------------------------------------------------

  describe("verb dispatch", () => {
    it("ignores verb actions when menu is closed", () => {
      const { fireAction, log } = createHarness();
      const beforeLen = log.length;

      fireAction("menu.verb.insert");

      expect(log.length).toBe(beforeLen);
    });

    it("ignores verb actions when not in frozen sub-phase", () => {
      const { dispatcher, fireAction, log } = createHarness();
      const target = { __brand: "ApplyTarget" } as unknown as ApplyTarget;
      dispatcher.open(target);

      const beforeLen = log.length;
      fireAction("menu.verb.insert");

      // Not frozen — no verb dispatch, no cancel.
      expect(log.length).toBe(beforeLen);
    });

    it("dispatches verb when in frozen state and applies mutation", () => {
      const ids = defaultIdGen();
      const xNode = sym("x", ids);
      const rootNode = doc(ids, xNode);
      const tree: Tree = { root: rootNode };

      const sv = fakeStructValue(tree);
      const fakeView = createFakeEditorView(sv);

      const symItem: MenuItem = {
        kind: "symbol",
        id: "item-y" as ItemId,
        label: "y",
        text: "y",
      };
      const manifest = makeManifest([symItem]);

      const harness = createHarness({ manifest });
      const {
        dispatcher: d,
        setMenuState,
        setEditorView,
        fireAction,
        getMenuState,
        log,
      } = harness;

      setEditorView(fakeView);
      d.bind(fakeView);

      const target = { __brand: "ApplyTarget", nodeId: xNode.id } as unknown as ApplyTarget;

      // Set to frozen state with the y symbol selected.
      setMenuState({
        phase: "open",
        leftTabIdx: 0,
        rightTabIdx: 0,
        leftHover: 0,
        rightHover: 0,
        shoulderHeld: "right",
        frozen: {
          leftTabIdx: 0,
          leftPicked: "math" as CategoryId,
          rightTabIdx: 0,
          rightPicked: "item-y" as ItemId,
        },
        target,
        manifest,
      });

      // Fire insert verb.
      fireAction("menu.verb.insert");

      // After verb commit, state should be closed (cancel dispatched).
      // No auto-chain because the inserted symbol has no holes.
      expect(getMenuState().phase).toBe("closed");

      // Verify a cancel was dispatched.
      const inputs = log
        .filter((e) => e.kind === "dispatchInput")
        .map((e) => e.detail as MenuInput);
      expect(inputs.some((i) => i.kind === "cancel")).toBe(true);

      // The fake editor view should have received a dispatch call.
      expect(fakeView.dispatch).toHaveBeenCalled();
    });

    it("insert verb with function item triggers auto-chain on hole", () => {
      const ids = defaultIdGen();
      const xNode = sym("x", ids);
      const rootNode = doc(ids, xNode);
      const tree: Tree = { root: rootNode };

      const sv = fakeStructValue(tree);
      const fakeView = createFakeEditorView(sv);

      const oscItem = fnWithHole();
      const manifest = makeManifest([oscItem]);

      const harness = createHarness({ manifest });
      const {
        dispatcher: d,
        setMenuState,
        setEditorView,
        fireAction,
        getMenuState,
        log,
      } = harness;

      setEditorView(fakeView);
      d.bind(fakeView);

      const target = { __brand: "ApplyTarget", nodeId: xNode.id } as unknown as ApplyTarget;

      // Set to frozen state with the osc function selected.
      setMenuState({
        phase: "open",
        leftTabIdx: 0,
        rightTabIdx: 0,
        leftHover: 0,
        rightHover: 0,
        shoulderHeld: "right",
        frozen: {
          leftTabIdx: 0,
          leftPicked: "math" as CategoryId,
          rightTabIdx: 0,
          rightPicked: "item-osc" as ItemId,
        },
        target,
        manifest,
      });

      fireAction("menu.verb.insert");

      // After verb with auto-chain, state should be open (reopened on hole).
      expect(getMenuState().phase).toBe("open");

      // Verify the auto-chain reopen.
      const inputs = log
        .filter((e) => e.kind === "dispatchInput")
        .map((e) => e.detail as MenuInput);
      expect(inputs.some((i) => i.kind === "cancel")).toBe(true);
      expect(inputs.some((i) => i.kind === "open")).toBe(true);
    });
  });

  // ---- Auto-chain ---------------------------------------------------------

  describe("auto-chain", () => {
    it("reopens menu on typed hole after verb commit", () => {
      const ids = defaultIdGen();
      const xNode = sym("x", ids);
      const rootNode = doc(ids, xNode);
      const tree: Tree = { root: rootNode };

      const sv = fakeStructValue(tree);
      const fakeView = createFakeEditorView(sv);

      const oscItem = fnWithHole();
      const manifest = makeManifest([oscItem]);

      const harness = createHarness({ manifest });
      const {
        dispatcher: d,
        setMenuState,
        setEditorView,
        fireAction,
        getMenuState,
      } = harness;

      setEditorView(fakeView);
      d.bind(fakeView);

      const target = { __brand: "ApplyTarget", nodeId: xNode.id } as unknown as ApplyTarget;
      setMenuState({
        phase: "open",
        leftTabIdx: 0,
        rightTabIdx: 0,
        leftHover: 0,
        rightHover: 0,
        shoulderHeld: "right",
        frozen: {
          leftTabIdx: 0,
          leftPicked: "math" as CategoryId,
          rightTabIdx: 0,
          rightPicked: "item-osc" as ItemId,
        },
        target,
        manifest,
      });

      fireAction("menu.verb.insert");

      // The menu should have reopened (auto-chain on the number hole).
      expect(getMenuState().phase).toBe("open");
    });

    it("does not reopen when verb lands on non-hole node", () => {
      const ids = defaultIdGen();
      const xNode = sym("x", ids);
      const rootNode = doc(ids, xNode);
      const tree: Tree = { root: rootNode };

      const sv = fakeStructValue(tree);
      const fakeView = createFakeEditorView(sv);

      const symItem: MenuItem = {
        kind: "symbol",
        id: "item-y" as ItemId,
        label: "y",
        text: "y",
      };
      const manifest = makeManifest([symItem]);

      const harness = createHarness({ manifest });
      const {
        dispatcher: d,
        setMenuState,
        setEditorView,
        fireAction,
        getMenuState,
      } = harness;

      setEditorView(fakeView);
      d.bind(fakeView);

      const target = { __brand: "ApplyTarget", nodeId: xNode.id } as unknown as ApplyTarget;
      setMenuState({
        phase: "open",
        leftTabIdx: 0,
        rightTabIdx: 0,
        leftHover: 0,
        rightHover: 0,
        shoulderHeld: "right",
        frozen: {
          leftTabIdx: 0,
          leftPicked: "math" as CategoryId,
          rightTabIdx: 0,
          rightPicked: "item-y" as ItemId,
        },
        target,
        manifest,
      });

      fireAction("menu.verb.insert");

      // Menu should be closed — no hole to chain on.
      expect(getMenuState().phase).toBe("closed");
    });

    it("verb rejected with unsupported combination closes menu", () => {
      const ids = defaultIdGen();
      const xNode = sym("x", ids);
      const rootNode = doc(ids, xNode);
      const tree: Tree = { root: rootNode };

      const sv = fakeStructValue(tree);
      const fakeView = createFakeEditorView(sv);

      const symItem: MenuItem = {
        kind: "symbol",
        id: "item-y" as ItemId,
        label: "y",
        text: "y",
      };
      const manifest = makeManifest([symItem]);

      const harness = createHarness({ manifest });
      const {
        dispatcher: d,
        setMenuState,
        setEditorView,
        fireAction,
        getMenuState,
      } = harness;

      setEditorView(fakeView);
      d.bind(fakeView);

      const target = { __brand: "ApplyTarget", nodeId: xNode.id } as unknown as ApplyTarget;
      setMenuState({
        phase: "open",
        leftTabIdx: 0,
        rightTabIdx: 0,
        leftHover: 0,
        rightHover: 0,
        shoulderHeld: "both", // "both" is rejected by all verbs in v1
        frozen: {
          leftTabIdx: 0,
          leftPicked: "math" as CategoryId,
          rightTabIdx: 0,
          rightPicked: "item-y" as ItemId,
        },
        target,
        manifest,
      });

      fireAction("menu.verb.insert");

      // Menu should be closed — verb rejected the "both" handedness.
      expect(getMenuState().phase).toBe("closed");
    });
  });

  // ---- Cleanup ------------------------------------------------------------

  describe("cleanup", () => {
    it("unbind clears action and axis subscriptions", () => {
      const ids = defaultIdGen();
      const tree = { root: doc(ids, sym("x", ids)) };
      const sv = fakeStructValue(tree);
      const fakeView = createFakeEditorView(sv);

      const { dispatcher, fireAction, log } = createHarness();
      const unsub = dispatcher.bind(fakeView);

      // Fire an action — should be routed through the subscription.
      fireAction("menu.cancel");
      const dispatchedCount = log.length;
      expect(dispatchedCount).toBeGreaterThan(0);

      log.length = 0;

      // Unbind — clears the subscriptions.
      unsub();

      // After unbind, actionHandler is null so fireAction falls through
      // to handleAction directly, which still works (no subscription needed).
      // This verifies unbind doesn't throw.
      expect(() => fireAction("menu.cancel")).not.toThrow();
    });
  });

  // ---- T9 sub-mode helpers (pure function tests) -------------------------

  describe("T9 character lookup", () => {
    it("t9GroupAt returns correct group for key 1 (abc)", () => {
      const group = t9GroupAt(1); // digit 2 position: abc
      expect(group).toEqual(["a", "b", "c", "2"]);
    });

    it("t9GroupAt returns correct group for key 6 (pqrs)", () => {
      const group = t9GroupAt(6); // digit 7 position: pqrs
      expect(group).toEqual(["p", "q", "r", "s"]);
    });

    it("t9GroupAt returns null for out-of-range index", () => {
      expect(t9GroupAt(-1)).toBeNull();
      expect(t9GroupAt(T9_POSITION_COUNT)).toBeNull();
    });

    it("t9CharAt returns first character with tapCount 0", () => {
      expect(t9CharAt(1, 0)).toBe("a"); // key 1, tap 0 → 'a'
    });

    it("t9CharAt cycles through group with tapCount", () => {
      expect(t9CharAt(1, 0)).toBe("a");
      expect(t9CharAt(1, 1)).toBe("b");
      expect(t9CharAt(1, 2)).toBe("c");
      expect(t9CharAt(1, 3)).toBe("2");
      expect(t9CharAt(1, 4)).toBe("a"); // wraps
    });

    it("t9CharAt with upper=true returns uppercase", () => {
      expect(t9CharAt(1, 0, true)).toBe("A");
      expect(t9CharAt(1, 2, true)).toBe("C");
    });

    it("t9CharAt returns null for invalid key index", () => {
      expect(t9CharAt(-1, 0)).toBeNull();
      expect(t9CharAt(99, 0)).toBeNull();
    });

    it("all 9 T9 key positions are accessible", () => {
      for (let i = 0; i < T9_POSITION_COUNT; i++) {
        expect(t9GroupAt(i)).not.toBeNull();
        expect(t9CharAt(i, 0)).not.toBeNull();
      }
    });
  });

  // ---- T9 face-button routing --------------------------------------------

  describe("T9 face-button routing", () => {
    it("face A (menu.verb.insert) in T9 phase dispatches subModeT9Cycle + subModeAppend", () => {
      const { fireAction, fireAxis, setMenuState, log } = createHarness();
      const target = { __brand: "ApplyTarget" } as unknown as ApplyTarget;

      // Set T9 state.
      setMenuState({
        phase: "t9",
        buffer: "",
        lastKey: null,
        lastKeyAt: 0,
        caseMode: "lower",
        target,
        returnTo: "closed",
        activeVerb: { kind: "insert", hand: "left" },
      });

      // Move stick to key position 1 (digit 2 = abc).
      fireAxis("left", 1);

      // Press face A to cycle character.
      fireAction("menu.verb.insert");

      const inputs = log
        .filter((e) => e.kind === "dispatchInput")
        .map((e) => e.detail as MenuInput);

      // Should have dispatched subModeAppend('a') and subModeT9Cycle.
      const append = inputs.find((i) => i.kind === "subModeAppend");
      expect(append).toBeDefined();
      if (append?.kind === "subModeAppend") {
        expect(append.char).toBe("a");
      }

      const cycle = inputs.find((i) => i.kind === "subModeT9Cycle");
      expect(cycle).toBeDefined();
    });

    it("face X (menu.verb.replace) in T9 dispatches subModeCommitAndContinue", () => {
      const { fireAction, setMenuState, log } = createHarness();

      setMenuState({
        phase: "t9",
        buffer: "ab",
        lastKey: null,
        lastKeyAt: 0,
        caseMode: "lower",
        target: {} as ApplyTarget,
        returnTo: "closed",
        activeVerb: { kind: "insert", hand: "left" },
      });

      fireAction("menu.verb.replace");

      const inputs = log
        .filter((e) => e.kind === "dispatchInput")
        .map((e) => e.detail as MenuInput);
      expect(inputs.some((i) => i.kind === "subModeCommitAndContinue")).toBe(true);
    });

    it("face Y (menu.verb.wrapWith) in T9 dispatches subModeBackspace", () => {
      const { fireAction, setMenuState, log } = createHarness();

      setMenuState({
        phase: "t9",
        buffer: "abc",
        lastKey: null,
        lastKeyAt: 0,
        caseMode: "lower",
        target: {} as ApplyTarget,
        returnTo: "closed",
        activeVerb: { kind: "insert", hand: "left" },
      });

      fireAction("menu.verb.wrapWith");

      const inputs = log
        .filter((e) => e.kind === "dispatchInput")
        .map((e) => e.detail as MenuInput);
      expect(inputs.some((i) => i.kind === "subModeBackspace")).toBe(true);
    });

    it("face B (menu.verb.call) in T9 dispatches subModeCommitAndExit", () => {
      const { fireAction, setMenuState, log } = createHarness();

      setMenuState({
        phase: "t9",
        buffer: "test",
        lastKey: null,
        lastKeyAt: 0,
        caseMode: "lower",
        target: {} as ApplyTarget,
        returnTo: "closed",
        activeVerb: { kind: "insert", hand: "left" },
      });

      fireAction("menu.verb.call");

      const inputs = log
        .filter((e) => e.kind === "dispatchInput")
        .map((e) => e.detail as MenuInput);
      expect(inputs.some((i) => i.kind === "subModeCommitAndExit")).toBe(true);
    });

    it("multi-tap cycling: pressing A twice on same key cycles to next char", () => {
      const { fireAction, fireAxis, setMenuState, log } = createHarness();

      setMenuState({
        phase: "t9",
        buffer: "",
        lastKey: null,
        lastKeyAt: 0,
        caseMode: "lower",
        target: {} as ApplyTarget,
        returnTo: "closed",
        activeVerb: { kind: "insert", hand: "left" },
      });

      fireAxis("left", 1); // key 1 = abc

      // First tap → 'a'
      fireAction("menu.verb.insert");

      // Second tap on same key → backspace 'a' + append 'b'
      fireAction("menu.verb.insert");

      const inputs = log
        .filter((e) => e.kind === "dispatchInput")
        .map((e) => e.detail as MenuInput);

      const appends = inputs.filter((i) => i.kind === "subModeAppend");
      const backspaces = inputs.filter((i) => i.kind === "subModeBackspace");

      // First tap: append 'a'. Second tap: backspace + append 'b'.
      expect(appends.length).toBeGreaterThanOrEqual(2);
      if (appends[0]?.kind === "subModeAppend") expect(appends[0].char).toBe("a");
      if (appends[1]?.kind === "subModeAppend") expect(appends[1].char).toBe("b");
      expect(backspaces.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---- T9 axis tracking --------------------------------------------------

  describe("T9 axis tracking", () => {
    it("left stick position is tracked for T9 key lookup", () => {
      const { fireAxis, setMenuState, fireAction, log } = createHarness();

      setMenuState({
        phase: "t9",
        buffer: "",
        lastKey: null,
        lastKeyAt: 0,
        caseMode: "lower",
        target: {} as ApplyTarget,
        returnTo: "closed",
        activeVerb: { kind: "insert", hand: "left" },
      });

      // Move to key 2 (digit 3 = def)
      fireAxis("left", 2);
      fireAction("menu.verb.insert");

      const inputs = log
        .filter((e) => e.kind === "dispatchInput")
        .map((e) => e.detail as MenuInput);
      const append = inputs.find((i) => i.kind === "subModeAppend");
      expect(append).toBeDefined();
      if (append?.kind === "subModeAppend") {
        expect(append.char).toBe("d"); // key 2, first char
      }
    });

    it("null hover (stick centred) produces no character on face A", () => {
      const { fireAxis, setMenuState, fireAction, log } = createHarness();

      setMenuState({
        phase: "t9",
        buffer: "",
        lastKey: null,
        lastKeyAt: 0,
        caseMode: "lower",
        target: {} as ApplyTarget,
        returnTo: "closed",
        activeVerb: { kind: "insert", hand: "left" },
      });

      // Stick centred — no key position
      fireAxis("left", null);
      fireAction("menu.verb.insert");

      const inputs = log
        .filter((e) => e.kind === "dispatchInput")
        .map((e) => e.detail as MenuInput);
      expect(inputs.some((i) => i.kind === "subModeAppend")).toBe(false);
    });
  });

  // ---- menu.text.open routing (§14.1.2 / §14.1.3) ----------------------

  describe("menu.text.open routing", () => {
    // ---- Pure function tests for textModeForHoleType --------------------

    describe("textModeForHoleType (pure)", () => {
      it("returns numpad for :number", () => {
        expect(textModeForHoleType("number")).toBe("numpad");
      });

      it("returns t9 for :string", () => {
        expect(textModeForHoleType("string")).toBe("t9");
      });

      it("returns t9 for :symbol", () => {
        expect(textModeForHoleType("symbol")).toBe("t9");
      });

      it("returns null for :keyword", () => {
        expect(textModeForHoleType("keyword")).toBeNull();
      });

      it("returns null for :expr", () => {
        expect(textModeForHoleType("expr")).toBeNull();
      });

      it("returns null for null (no active hole)", () => {
        expect(textModeForHoleType(null)).toBeNull();
      });
    });

    // ---- Integration tests for menu.text.open action --------------------

    describe("action routing", () => {
      it("routes :number hole to numpad sub-mode", () => {
        const ids = defaultIdGen();
        const holeNode = hole("freq", "number", ids);
        const rootNode = doc(ids, holeNode);
        const tree: Tree = { root: rootNode };

        const sv = fakeStructValueOnNode(tree, holeNode.id);
        const fakeView = createFakeEditorView(sv);

        const { dispatcher, setEditorView, setMenuState, fireAction, getMenuState } = createHarness();
        setEditorView(fakeView);
        dispatcher.bind(fakeView);

        // Put the menu in open state.
        const target = { __brand: "ApplyTarget", nodeId: holeNode.id } as unknown as ApplyTarget;
        const manifest = makeManifest();
        setMenuState({
          phase: "open",
          leftTabIdx: 0,
          rightTabIdx: 0,
          leftHover: null,
          rightHover: null,
          shoulderHeld: "none",
          frozen: null,
          target,
          manifest,
        });

        fireAction("menu.text.open");

        const state = getMenuState();
        expect(state.phase).toBe("numpad");
        if (state.phase === "numpad") {
          expect(state.buffer).toBe("");
          expect(state.returnTo).toBe("open");
        }
      });

      it("routes :string hole to T9 sub-mode", () => {
        const ids = defaultIdGen();
        const holeNode = hole("label", "string", ids);
        const rootNode = doc(ids, holeNode);
        const tree: Tree = { root: rootNode };

        const sv = fakeStructValueOnNode(tree, holeNode.id);
        const fakeView = createFakeEditorView(sv);

        const { dispatcher, setEditorView, setMenuState, fireAction, getMenuState } = createHarness();
        setEditorView(fakeView);
        dispatcher.bind(fakeView);

        const target = { __brand: "ApplyTarget", nodeId: holeNode.id } as unknown as ApplyTarget;
        const manifest = makeManifest();
        setMenuState({
          phase: "open",
          leftTabIdx: 0,
          rightTabIdx: 0,
          leftHover: null,
          rightHover: null,
          shoulderHeld: "none",
          frozen: null,
          target,
          manifest,
        });

        fireAction("menu.text.open");

        const state = getMenuState();
        expect(state.phase).toBe("t9");
        if (state.phase === "t9") {
          expect(state.buffer).toBe("");
          expect(state.caseMode).toBe("lower");
          expect(state.returnTo).toBe("open");
        }
      });

      it("routes :symbol hole to T9 sub-mode", () => {
        const ids = defaultIdGen();
        const holeNode = hole("name", "symbol", ids);
        const rootNode = doc(ids, holeNode);
        const tree: Tree = { root: rootNode };

        const sv = fakeStructValueOnNode(tree, holeNode.id);
        const fakeView = createFakeEditorView(sv);

        const { dispatcher, setEditorView, setMenuState, fireAction, getMenuState } = createHarness();
        setEditorView(fakeView);
        dispatcher.bind(fakeView);

        const target = { __brand: "ApplyTarget", nodeId: holeNode.id } as unknown as ApplyTarget;
        const manifest = makeManifest();
        setMenuState({
          phase: "open",
          leftTabIdx: 0,
          rightTabIdx: 0,
          leftHover: null,
          rightHover: null,
          shoulderHeld: "none",
          frozen: null,
          target,
          manifest,
        });

        fireAction("menu.text.open");

        const state = getMenuState();
        expect(state.phase).toBe("t9");
      });

      it(":keyword hole is a no-op (menu stays open)", () => {
        const ids = defaultIdGen();
        const holeNode = hole("kw", "keyword", ids);
        const rootNode = doc(ids, holeNode);
        const tree: Tree = { root: rootNode };

        const sv = fakeStructValueOnNode(tree, holeNode.id);
        const fakeView = createFakeEditorView(sv);

        const { dispatcher, setEditorView, setMenuState, fireAction, getMenuState } = createHarness();
        setEditorView(fakeView);
        dispatcher.bind(fakeView);

        const target = { __brand: "ApplyTarget", nodeId: holeNode.id } as unknown as ApplyTarget;
        const manifest = makeManifest();
        setMenuState({
          phase: "open",
          leftTabIdx: 0,
          rightTabIdx: 0,
          leftHover: null,
          rightHover: null,
          shoulderHeld: "none",
          frozen: null,
          target,
          manifest,
        });

        fireAction("menu.text.open");

        // Should stay in open state (no-op).
        expect(getMenuState().phase).toBe("open");
      });

      it(":expr hole is a no-op (menu stays open)", () => {
        const ids = defaultIdGen();
        const holeNode = hole("body", "expr", ids);
        const rootNode = doc(ids, holeNode);
        const tree: Tree = { root: rootNode };

        const sv = fakeStructValueOnNode(tree, holeNode.id);
        const fakeView = createFakeEditorView(sv);

        const { dispatcher, setEditorView, setMenuState, fireAction, getMenuState } = createHarness();
        setEditorView(fakeView);
        dispatcher.bind(fakeView);

        const target = { __brand: "ApplyTarget", nodeId: holeNode.id } as unknown as ApplyTarget;
        const manifest = makeManifest();
        setMenuState({
          phase: "open",
          leftTabIdx: 0,
          rightTabIdx: 0,
          leftHover: null,
          rightHover: null,
          shoulderHeld: "none",
          frozen: null,
          target,
          manifest,
        });

        fireAction("menu.text.open");

        // Should stay in open state (no-op).
        expect(getMenuState().phase).toBe("open");
      });

      it("no active hole (cursor on symbol) is a no-op", () => {
        const ids = defaultIdGen();
        const xNode = sym("x", ids);
        const rootNode = doc(ids, xNode);
        const tree: Tree = { root: rootNode };

        const sv = fakeStructValue(tree);
        const fakeView = createFakeEditorView(sv);

        const { dispatcher, setEditorView, setMenuState, fireAction, getMenuState } = createHarness();
        setEditorView(fakeView);
        dispatcher.bind(fakeView);

        const target = { __brand: "ApplyTarget", nodeId: xNode.id } as unknown as ApplyTarget;
        const manifest = makeManifest();
        setMenuState({
          phase: "open",
          leftTabIdx: 0,
          rightTabIdx: 0,
          leftHover: null,
          rightHover: null,
          shoulderHeld: "none",
          frozen: null,
          target,
          manifest,
        });

        fireAction("menu.text.open");

        // Should stay in open state (no-op — no hole at cursor).
        expect(getMenuState().phase).toBe("open");
      });

      it("is no-op when menu is in numpad phase", () => {
        const ids = defaultIdGen();
        const holeNode = hole("freq", "number", ids);
        const rootNode = doc(ids, holeNode);
        const tree: Tree = { root: rootNode };

        const sv = fakeStructValue(tree);
        const fakeView = createFakeEditorView(sv);

        const { dispatcher, setEditorView, setMenuState, fireAction, getMenuState } = createHarness();
        setEditorView(fakeView);
        dispatcher.bind(fakeView);

        const target = { __brand: "ApplyTarget", nodeId: holeNode.id } as unknown as ApplyTarget;
        setMenuState({
          phase: "numpad",
          buffer: "42",
          target,
          returnTo: "open",
          activeVerb: { kind: "insert", hand: "left" },
        });

        fireAction("menu.text.open");

        // Should stay in numpad state (no-op).
        expect(getMenuState().phase).toBe("numpad");
        if (getMenuState().phase === "numpad") {
          expect((getMenuState() as any).buffer).toBe("42");
        }
      });

      it("is no-op when menu is in T9 phase", () => {
        const ids = defaultIdGen();
        const holeNode = hole("label", "string", ids);
        const rootNode = doc(ids, holeNode);
        const tree: Tree = { root: rootNode };

        const sv = fakeStructValue(tree);
        const fakeView = createFakeEditorView(sv);

        const { dispatcher, setEditorView, setMenuState, fireAction, getMenuState } = createHarness();
        setEditorView(fakeView);
        dispatcher.bind(fakeView);

        const target = { __brand: "ApplyTarget", nodeId: holeNode.id } as unknown as ApplyTarget;
        setMenuState({
          phase: "t9",
          buffer: "ab",
          lastKey: null,
          lastKeyAt: 0,
          caseMode: "lower",
          target,
          returnTo: "open",
          activeVerb: { kind: "insert", hand: "left" },
        });

        fireAction("menu.text.open");

        // Should stay in t9 state (no-op).
        expect(getMenuState().phase).toBe("t9");
        if (getMenuState().phase === "t9") {
          expect((getMenuState() as any).buffer).toBe("ab");
        }
      });

      it("derives active verb hand from frozen shoulder held", () => {
        const ids = defaultIdGen();
        const holeNode = hole("freq", "number", ids);
        const rootNode = doc(ids, holeNode);
        const tree: Tree = { root: rootNode };

        const sv = fakeStructValueOnNode(tree, holeNode.id);
        const fakeView = createFakeEditorView(sv);

        const { dispatcher, setEditorView, setMenuState, fireAction, getMenuState, log } = createHarness();
        setEditorView(fakeView);
        dispatcher.bind(fakeView);

        const target = { __brand: "ApplyTarget", nodeId: holeNode.id } as unknown as ApplyTarget;
        const manifest = makeManifest();
        setMenuState({
          phase: "open",
          leftTabIdx: 0,
          rightTabIdx: 0,
          leftHover: 0,
          rightHover: 0,
          shoulderHeld: "right",
          frozen: {
            leftTabIdx: 0,
            leftPicked: "math" as CategoryId,
            rightTabIdx: 0,
            rightPicked: "item-x" as ItemId,
          },
          target,
          manifest,
        });

        fireAction("menu.text.open");

        const state = getMenuState();
        expect(state.phase).toBe("numpad");
        if (state.phase === "numpad") {
          expect(state.activeVerb.hand).toBe("right");
        }
      });
    });
  });
});
