// src/lib/gamepad/paradigms/paradigms.test.ts
//
// Smoke tests: each paradigm's layers resolve gestures through the
// resolver without errors. Not exhaustive — validates the plumbing.

import { describe, expect, it, vi } from "vitest";
import { chord, keyOf, tap, held } from "../gestures";
import {
  buildLayerMap,
  lintBindings,
  resolveGesture,
} from "../resolver";
import type { AppStateSnapshot, GamepadState, Layer, LayerName } from "../types";
import { radialLayer } from "./radial";
import { modalShiftLayers } from "./modal-shift";
import { leaderLayers, leaderTransientLayers } from "./leader";
import { hydraLayers, hydraTransientLayers } from "./hydra";
import { chordHeavyLayers } from "./chord-heavy";

vi.mock("../../menu/store", () => ({
  isMenuOpen: vi.fn(() => false),
}));

vi.mock("../../mainMenu/store", () => ({
  isMainMenuOpen: vi.fn(() => false),
}));

import { isMenuOpen } from "../../menu/store";
const mockedIsMenuOpen = vi.mocked(isMenuOpen);

const ln = (n: string) => n as LayerName;

function mkState(overrides: Partial<GamepadState> = {}, extra: Record<string, unknown> = {}): AppStateSnapshot {
  return {
    gamepad: {
      heldButtons: new Set(),
      transientLayers: [],
      lastInputAt: 0,
      stickPositions: {
        LeftStick: { x: 0, y: 0 },
        RightStick: { x: 0, y: 0 },
      },
      ...overrides,
    },
    ...extra,
  };
}

describe("paradigm: radial-menu layer", () => {
  const layers = [radialLayer];
  const map = buildLayerMap(layers);

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes binding lint", () => {
    expect(lintBindings(layers)).toEqual([]);
  });

  it("layer activates when isMenuOpen() returns true", () => {
    mockedIsMenuOpen.mockReturnValue(true);
    const r = resolveGesture(tap("A"), mkState(), layers, map);
    expect(r?.kind).toBe("action");
    if (r?.kind === "action") expect(r.action).toBe("menu.verb.insert");
  });

  it("layer does NOT activate when menu is closed", () => {
    mockedIsMenuOpen.mockReturnValue(false);
    const r = resolveGesture(tap("A"), mkState(), layers, map);
    expect(r).toBeNull();
  });

  it("maps all 7 gestures to the correct ActionIds", () => {
    mockedIsMenuOpen.mockReturnValue(true);

    const gestureCases: Array<{
      gesture: ReturnType<typeof tap>;
      action: string;
      label: string;
    }> = [
      { gesture: tap("LB"), action: "menu.tab.cyclePrev", label: "tap(LB) → menu.tab.cyclePrev" },
      { gesture: tap("RB"), action: "menu.tab.cycleNext", label: "tap(RB) → menu.tab.cycleNext" },
      { gesture: tap("A"), action: "menu.verb.insert", label: "tap(A) → menu.verb.insert" },
      { gesture: tap("X"), action: "menu.verb.replace", label: "tap(X) → menu.verb.replace" },
      { gesture: tap("Y"), action: "menu.verb.wrapWith", label: "tap(Y) → menu.verb.wrapWith" },
      { gesture: tap("B"), action: "menu.verb.call", label: "tap(B) → menu.verb.call" },
      { gesture: tap("Back"), action: "menu.cancel", label: "tap(Back) → menu.cancel" },
    ];

    for (const { gesture, action, label } of gestureCases) {
      const r = resolveGesture(gesture, mkState(), layers, map);
      expect(r?.kind, `${label}: expected action resolution`).toBe("action");
      if (r?.kind === "action") {
        expect(r.action, `${label}`).toBe(action);
      }
    }
  });

  it("declares both axes with correct channel names", () => {
    expect(radialLayer.axes).toBeDefined();
    expect(radialLayer.axes!.left).toBe("menu.left.angle");
    expect(radialLayer.axes!.right).toBe("menu.right.angle");
  });

  it("onMiss is pop-and-discard", () => {
    expect(radialLayer.onMiss).toBe("pop-and-discard");
  });
});

describe("paradigm: modal-shift", () => {
  it("passes binding lint", () => {
    expect(lintBindings([...modalShiftLayers])).toEqual([]);
  });

  it("base layer resolves tap(Start) to eval.now", () => {
    const map = buildLayerMap([...modalShiftLayers]);
    const r = resolveGesture(tap("Start"), mkState(), [...modalShiftLayers], map);
    expect(r?.kind).toBe("action");
    if (r?.kind === "action") expect(r.action).toBe("eval.now");
  });

  it("LB-shifted layer shadows base for tap(A)", () => {
    const map = buildLayerMap([...modalShiftLayers]);
    const state = mkState({ heldButtons: new Set(["LB"]) });
    const r = resolveGesture(tap("A"), state, [...modalShiftLayers], map);
    expect(r?.kind).toBe("action");
    if (r?.kind === "action") expect(r.action).toBe("edit.slurpFwd");
  });

  it("RB-shifted layer provides probe.toggle on tap(A)", () => {
    const map = buildLayerMap([...modalShiftLayers]);
    const state = mkState({ heldButtons: new Set(["RB"]) });
    const r = resolveGesture(tap("A"), state, [...modalShiftLayers], map);
    expect(r?.kind).toBe("action");
    if (r?.kind === "action") expect(r.action).toBe("probe.toggle");
  });

  // ─── LB+RB shift layer (B6: face-button structural verbs) ─────────────────
  // Face buttons: raise / splice / transpose pair
  // D-pad:        enclose family (list / vector / map / set)
  describe("LB+RB shifted layer: structural shape verbs (B6)", () => {
    const lbrbState = () => mkState({ heldButtons: new Set(["LB", "RB"]) });

    const cases: Array<{
      gesture: ReturnType<typeof tap>;
      action: string;
      label: string;
    }> = [
      // Face buttons
      { gesture: tap("A"), action: "edit.raise", label: "tap(A) → edit.raise" },
      { gesture: tap("B"), action: "edit.splice", label: "tap(B) → edit.splice" },
      // D-pad: transpose pair + enclose
      { gesture: tap("Left"), action: "edit.transposeBack", label: "tap(Left) → edit.transposeBack" },
      { gesture: tap("Right"), action: "edit.transposeFwd", label: "tap(Right) → edit.transposeFwd" },
      { gesture: tap("Up"), action: "edit.wrapList", label: "tap(Up) → edit.wrapList" },
      { gesture: tap("Down"), action: "edit.wrapVector", label: "tap(Down) → edit.wrapVector" },
    ];

    for (const { gesture, action, label } of cases) {
      it(`when LB+RB held: ${label}`, () => {
        const map = buildLayerMap([...modalShiftLayers]);
        const r = resolveGesture(gesture, lbrbState(), [...modalShiftLayers], map);
        expect(r?.kind).toBe("action");
        if (r?.kind === "action") expect(r.action).toBe(action);
      });
    }

    it("LB+RB layer shadows the single-shift LB layer for tap(A)", () => {
      // With only LB held → slurpFwd; with both LB+RB held → raise.
      const map = buildLayerMap([...modalShiftLayers]);
      const lbOnly = mkState({ heldButtons: new Set(["LB"]) });
      const both = mkState({ heldButtons: new Set(["LB", "RB"]) });
      const lbRes = resolveGesture(tap("A"), lbOnly, [...modalShiftLayers], map);
      const bothRes = resolveGesture(tap("A"), both, [...modalShiftLayers], map);
      expect(lbRes?.kind).toBe("action");
      if (lbRes?.kind === "action") expect(lbRes.action).toBe("edit.slurpFwd");
      expect(bothRes?.kind).toBe("action");
      if (bothRes?.kind === "action") expect(bothRes.action).toBe("edit.raise");
    });

    it("every action bound on the modal-shift paradigm exists in the action registry", async () => {
      // Note: we deliberately don't import handlers.ts here — that pulls in
      // the editor/transport runtime stack, which can't initialise in this
      // pure-unit context. Existence in the action registry is the contract
      // the keybinding system uses for ID validity; handler wiring is covered
      // by keybindings.test.ts's "X has a registered handler" suite.
      const { actions } = await import("../../keybindings/actions");

      const allBoundActions = new Set<string>();
      for (const layer of modalShiftLayers) {
        if (!layer.gestures) continue;
        for (const v of Object.values(layer.gestures)) {
          if (typeof v === "string") allBoundActions.add(v);
        }
      }

      for (const id of allBoundActions) {
        expect(
          Object.prototype.hasOwnProperty.call(actions, id),
          `action ${id} not in registry`,
        ).toBe(true);
      }
    });
  });

  // ─── Insertion-mode layer (B7: D-pad drives character caret) ──────────────
  describe("insertion-mode layer", () => {
    const insertionState = () => mkState({}, { insertionMode: true });

    it("insertion layer passes binding lint", () => {
      expect(lintBindings([...modalShiftLayers])).toEqual([]);
    });

    const dpadCases: Array<{
      gesture: ReturnType<typeof tap>;
      action: string;
      label: string;
    }> = [
      { gesture: tap("Up"), action: "insertion.up", label: "tap(Up) → insertion.up" },
      { gesture: tap("Down"), action: "insertion.down", label: "tap(Down) → insertion.down" },
      { gesture: tap("Left"), action: "insertion.left", label: "tap(Left) → insertion.left" },
      { gesture: tap("Right"), action: "insertion.right", label: "tap(Right) → insertion.right" },
    ];

    for (const { gesture, action, label } of dpadCases) {
      it(`when insertionMode: D-pad ${label}`, () => {
        const map = buildLayerMap([...modalShiftLayers]);
        const r = resolveGesture(gesture, insertionState(), [...modalShiftLayers], map);
        expect(r?.kind).toBe("action");
        if (r?.kind === "action") expect(r.action).toBe(action);
      });
    }

    it("when insertionMode: held(Up) resolves to insertion.up (repeating)", () => {
      const map = buildLayerMap([...modalShiftLayers]);
      const r = resolveGesture(held("Up"), insertionState(), [...modalShiftLayers], map);
      expect(r?.kind).toBe("action");
      if (r?.kind === "action") expect(r.action).toBe("insertion.up");
    });

    it("when insertionMode: tap(B) exits insertion mode", () => {
      const map = buildLayerMap([...modalShiftLayers]);
      const r = resolveGesture(tap("B"), insertionState(), [...modalShiftLayers], map);
      expect(r?.kind).toBe("action");
      if (r?.kind === "action") expect(r.action).toBe("edit.exitInsertion");
    });

    it("when insertionMode: tap(Start) still evaluates", () => {
      const map = buildLayerMap([...modalShiftLayers]);
      const r = resolveGesture(tap("Start"), insertionState(), [...modalShiftLayers], map);
      expect(r?.kind).toBe("action");
      if (r?.kind === "action") expect(r.action).toBe("eval.now");
    });

    it("when NOT insertionMode: D-pad falls through to base layer (nav.*)", () => {
      const map = buildLayerMap([...modalShiftLayers]);
      const normalState = mkState();
      const r = resolveGesture(tap("Up"), normalState, [...modalShiftLayers], map);
      expect(r?.kind).toBe("action");
      if (r?.kind === "action") expect(r.action).toBe("nav.up");
    });

    it("insertion layer does NOT activate when insertionMode is false", () => {
      const map = buildLayerMap([...modalShiftLayers]);
      const state = mkState({}, { insertionMode: false });
      const r = resolveGesture(tap("Left"), state, [...modalShiftLayers], map);
      expect(r?.kind).toBe("action");
      if (r?.kind === "action") expect(r.action).toBe("nav.left");
    });
  });
});

describe("paradigm: leader", () => {
  const allLayers = [...leaderLayers, ...leaderTransientLayers];

  it("passes binding lint", () => {
    expect(lintBindings(allLayers)).toEqual([]);
  });

  it("tap(Y) on base resolves to leader push", () => {
    const map = buildLayerMap(allLayers);
    const r = resolveGesture(tap("Y"), mkState(), [...leaderLayers], map);
    expect(r?.kind).toBe("leader");
    if (r?.kind === "leader") expect(r.layerName).toBe(ln("after-Y"));
  });

  it("after-Y layer resolves tap(A) to edit.slurpFwd", () => {
    const map = buildLayerMap(allLayers);
    const state = mkState({
      transientLayers: [{ name: ln("after-Y"), pushedAt: 0, expiresAt: 800 }],
    });
    const r = resolveGesture(tap("A"), state, [...leaderLayers], map);
    expect(r?.kind).toBe("action");
    if (r?.kind === "action") expect(r.action).toBe("edit.slurpFwd");
  });
});

describe("paradigm: hydra", () => {
  const allLayers = [...hydraLayers, ...hydraTransientLayers];

  it("passes binding lint", () => {
    expect(lintBindings(allLayers)).toEqual([]);
  });

  it("LeftStickPress on base opens hydra-slurp leader", () => {
    const map = buildLayerMap(allLayers);
    const r = resolveGesture(tap("LeftStickPress"), mkState(), [...hydraLayers], map);
    expect(r?.kind).toBe("leader");
    if (r?.kind === "leader") expect(r.layerName).toBe(ln("hydra-slurp"));
  });
});

describe("paradigm: chord-heavy", () => {
  it("passes binding lint", () => {
    expect(lintBindings([...chordHeavyLayers])).toEqual([]);
  });

  it("chord(LB,A) resolves to edit.slurpFwd", () => {
    const map = buildLayerMap([...chordHeavyLayers]);
    const r = resolveGesture(chord(["LB", "A"]), mkState(), [...chordHeavyLayers], map);
    expect(r?.kind).toBe("action");
    if (r?.kind === "action") expect(r.action).toBe("edit.slurpFwd");
  });
});
