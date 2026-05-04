// src/lib/gamepad/paradigms/paradigms.test.ts
//
// Smoke tests: each paradigm's layers resolve gestures through the
// resolver without errors. Not exhaustive — validates the plumbing.

import { describe, expect, it } from "vitest";
import { chord, keyOf, tap, held } from "../gestures";
import {
  buildLayerMap,
  lintBindings,
  resolveGesture,
} from "../resolver";
import type { AppStateSnapshot, GamepadState, Layer, LayerName } from "../types";
import { pickerLayer } from "./picker";
import { modalShiftLayers } from "./modal-shift";
import { leaderLayers, leaderTransientLayers } from "./leader";
import { hydraLayers, hydraTransientLayers } from "./hydra";
import { chordHeavyLayers } from "./chord-heavy";

const ln = (n: string) => n as LayerName;

function mkState(overrides: Partial<GamepadState> = {}): AppStateSnapshot {
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
  };
}

describe("paradigm: picker", () => {
  it("passes binding lint", () => {
    expect(lintBindings([pickerLayer])).toEqual([]);
  });

  it("resolves tap(A) to picker.select when menu is open", () => {
    const layers = [pickerLayer];
    const map = buildLayerMap(layers);
    const state: AppStateSnapshot = { ...mkState(), menuOpen: true };
    const r = resolveGesture(tap("A"), state, layers, map);
    expect(r?.kind).toBe("action");
    if (r?.kind === "action") expect(r.action).toBe("picker.select");
  });

  it("inactive when menu is closed", () => {
    const layers = [pickerLayer];
    const map = buildLayerMap(layers);
    const r = resolveGesture(tap("A"), mkState(), layers, map);
    expect(r).toBeNull();
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
      { gesture: tap("X"), action: "edit.transposeBack", label: "tap(X) → edit.transposeBack" },
      { gesture: tap("Y"), action: "edit.transposeFwd", label: "tap(Y) → edit.transposeFwd" },
      // D-pad encloses
      { gesture: tap("Up"), action: "edit.wrapList", label: "tap(Up) → edit.wrapList" },
      { gesture: tap("Down"), action: "edit.wrapVector", label: "tap(Down) → edit.wrapVector" },
      { gesture: tap("Left"), action: "edit.wrapMap", label: "tap(Left) → edit.wrapMap" },
      { gesture: tap("Right"), action: "edit.wrapSet", label: "tap(Right) → edit.wrapSet" },
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
