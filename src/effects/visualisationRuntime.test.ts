/**
 * Spec test: visualisation panel survives runtime transitions.
 *
 * Source of truth:
 *   - docs/specs/visualisation.md §1.11 — "A hardware connect/disconnect
 *     must not blank the canvas or lose in-flight traces."
 *   - docs/specs/runtime-modes.md §1.7 — "Mode transitions are seamless.
 *     Connecting hardware while in `wasm` upgrades to `both` without losing
 *     editor state, console history, or vis state.  Disconnecting hardware
 *     while in `both` falls back to `wasm`.  The user's evaluations across
 *     the boundary must continue to produce visible feedback."
 *
 * The visualisation modules (`visualisationStore`, `visualisationSampler`,
 * `visualisationRuntime`) deliberately do **not** subscribe to runtime
 * mode changes — vis state is mode-agnostic.  These tests assert that
 * contract from the outside: drive `reportTransportConnectionChanged`
 * across the wasm↔both boundary and verify the vis state (registered
 * expressions, sample buffers, palette, sampler responsiveness) is
 * untouched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The legacy `wasmInterpreter` mock holds the canonical spy instances —
// existing tests grab spies from here. The active-port mock below
// delegates to these so production code (which now goes through the
// port) and the tests (which assert on the legacy spies) hit the same
// vi.fn instances.
const wasmInterpreterMocks = vi.hoisted(() => ({
  evalInUseqWasm: vi.fn().mockResolvedValue("0.5"),
  updateUseqWasmTime: vi.fn().mockResolvedValue(undefined),
  evalOutputAtTime: vi.fn().mockResolvedValue(0.5),
  evalOutputsInTimeWindow: vi.fn().mockImplementation(
    (exprTypes: string[], start: number, end: number, count: number) => {
      const result = new Map<string, Array<{ time: number; value: number }>>();
      const step = count > 1 ? (end - start) / (count - 1) : 0;
      for (const expr of exprTypes) {
        const samples: Array<{ time: number; value: number }> = [];
        for (let i = 0; i < count; i++) {
          samples.push({ time: start + step * i, value: 0.5 });
        }
        result.set(expr, samples);
      }
      return Promise.resolve(result);
    },
  ),
  readActiveDiagnostics: vi.fn().mockReturnValue([]),
}));

vi.mock("../runtime/wasmInterpreter.ts", () => wasmInterpreterMocks);

vi.mock("../runtime/activeWasmRuntimePort.ts", () => ({
  getActiveWasmRuntimePort: () => ({
    capabilities: () => ({
      enabled: true,
      supportsEval: true,
      supportsTimeWindow: true,
      supportsTickAndProject: false,
    }),
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    evalCode: wasmInterpreterMocks.evalInUseqWasm,
    evalCodeSilently: wasmInterpreterMocks.evalInUseqWasm,
    updateTime: wasmInterpreterMocks.updateUseqWasmTime,
    evalOutputAtTime: wasmInterpreterMocks.evalOutputAtTime,
    evalOutputsInTimeWindow: wasmInterpreterMocks.evalOutputsInTimeWindow,
    tickAndProject: vi.fn().mockResolvedValue(null),
    readActiveDiagnostics: vi.fn().mockResolvedValue([]),
    readLastDiagnostics: vi.fn().mockResolvedValue([]),
  }),
  setActiveWasmRuntimePort: vi.fn(),
  isUsingInProcessWasmRuntime: () => true,
}));

vi.mock("../runtime/appSettingsRepository.ts", () => ({
  getAppSettings: vi.fn().mockReturnValue({
    visualisation: {},
    wasm: { enabled: true },
  }),
  subscribeAppSettings: vi.fn().mockReturnValue(() => {}),
}));

vi.mock("../lib/visualisationUtils.ts", () => ({
  getSerialVisPalette: vi
    .fn()
    .mockReturnValue(["#ff0000", "#00ff00", "#0000ff"]),
  getSerialVisChannelColor: vi.fn().mockImplementation((expr: string) => {
    if (expr === "a1") return "#ff0000";
    if (expr === "a2") return "#00ff00";
    if (expr === "d1") return "#0000ff";
    return "#888888";
  }),
}));

vi.mock("../contracts/runtimeChannels", () => ({
  codeEvaluated: { subscribe: vi.fn() },
  // The session service publishes connectionChanged.  No subscriber is
  // wired up by visualisation modules, but we mock it so the import
  // graph resolves cleanly.
  connectionChanged: { publish: vi.fn(), subscribe: vi.fn() },
  settingsChanged: { publish: vi.fn(), subscribe: vi.fn() },
  protocolReady: { publish: vi.fn(), subscribe: vi.fn() },
  jsonMeta: { publish: vi.fn(), subscribe: vi.fn() },
  runtimeDiagnostics: { publish: vi.fn(), subscribe: vi.fn() },
  bootstrapFailure: { publish: vi.fn(), subscribe: vi.fn() },
  animateConnect: { publish: vi.fn(), subscribe: vi.fn() },
  devicePluggedIn: { publish: vi.fn(), subscribe: vi.fn() },
  liveEditValueChanged: { subscribe: vi.fn() },
}));

vi.mock("../contracts/visualisationChannels", () => ({
  serialVisPaletteChangedChannel: { subscribe: vi.fn() },
  visualisationSessionChannel: { publish: vi.fn(), subscribe: vi.fn() },
  serialVisAutoOpenChannel: { publish: vi.fn(), subscribe: vi.fn() },
}));

vi.mock("../utils/outputHealthStore.ts", () => ({
  refreshOutputHealth: vi.fn(),
}));

// ── Test helpers ─────────────────────────────────────────────────────

/**
 * Resolve the active runtime mode from the runtime session store —
 * mirrors how the rest of the app derives transportMode.
 */
async function getCurrentTransportMode(): Promise<string> {
  const { getRuntimeSessionState } = await import(
    "../runtime/runtimeSessionStore.ts"
  );
  return getRuntimeSessionState().session.transportMode;
}

/**
 * Drive a runtime mode change as if hardware connected (or disconnected).
 * Mirrors what `connector.ts` does when serial events fire.  The
 * visualisation pipeline must remain unaffected.
 */
async function setRuntimeMode(opts: {
  hasHardwareConnection: boolean;
  wasmEnabled?: boolean;
}): Promise<void> {
  const { updateRuntimeSessionState } = await import(
    "../runtime/runtimeSessionStore.ts"
  );
  updateRuntimeSessionState({
    hasHardwareConnection: opts.hasHardwareConnection,
    wasmEnabled: opts.wasmEnabled ?? true,
    noModuleMode: false,
    connected: opts.hasHardwareConnection,
    protocolMode: opts.hasHardwareConnection ? "json" : "legacy",
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe("vis renderer survives runtime transitions (spec: visualisation.md §1.11, runtime-modes.md §1.7)", () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  afterEach(async () => {
    const { resetRuntimeSessionState } = await import(
      "../runtime/runtimeSessionStore.ts"
    );
    resetRuntimeSessionState();
  });

  describe("wasm → both transition (hardware connect)", () => {
    it("preserves registered expressions across the transition", async () => {
      // Arrange: start in wasm mode, register expressions.
      await setRuntimeMode({ hasHardwareConnection: false });
      expect(await getCurrentTransportMode()).toBe("wasm");

      const sampler = await import("./visualisationSampler.ts");
      const { visStore } = await import("../utils/visualisationStore.ts");

      await sampler.registerVisualisation("a1", "(a1 (sin 1))", {
        from: 0,
        to: 10,
      });
      await sampler.registerVisualisation("a2", "(a2 (cos 2))", {
        from: 11,
        to: 20,
      });
      await sampler.registerVisualisation("d1", "(d1 (square 1))", {
        from: 21,
        to: 30,
      });

      const beforeKeys = Object.keys(visStore.expressions).sort();
      const beforeA1 = visStore.expressions.a1;
      expect(beforeKeys).toEqual(["a1", "a2", "d1"]);
      expect(beforeA1?.expressionText).toBe("(a1 (sin 1))");
      expect(beforeA1?.position).toEqual({ from: 0, to: 10 });

      // Act: hardware connects → mode upgrades to "both".
      await setRuntimeMode({ hasHardwareConnection: true });
      expect(await getCurrentTransportMode()).toBe("both");

      // Assert: expressions, text, positions, colours all survive.
      const afterKeys = Object.keys(visStore.expressions).sort();
      expect(afterKeys).toEqual(beforeKeys);
      expect(visStore.expressions.a1?.expressionText).toBe("(a1 (sin 1))");
      expect(visStore.expressions.a1?.position).toEqual({ from: 0, to: 10 });
      expect(visStore.expressions.a2?.expressionText).toBe("(a2 (cos 2))");
      expect(visStore.expressions.d1?.expressionText).toBe("(d1 (square 1))");

      // The expression object identity should be preserved — store is
      // not rebuilt by the mode change.
      expect(visStore.expressions.a1).toBe(beforeA1);
    });

    it("does not blank existing past buffers when mode changes", async () => {
      await setRuntimeMode({ hasHardwareConnection: false });

      const sampler = await import("./visualisationSampler.ts");
      const runtime = await import("./visualisationRuntime.ts");

      await sampler.registerVisualisation("a1", "(a1 (sin 1))");
      runtime.notifyExternalTimeUpdate(2.5);
      await runtime._drainForTests();

      const pastLenBefore = sampler.getRenderData("a1")?.pastBuffer.length ?? 0;
      expect(pastLenBefore).toBeGreaterThan(0);

      await setRuntimeMode({ hasHardwareConnection: true });

      const pastLenAfter = sampler.getRenderData("a1")?.pastBuffer.length ?? 0;
      expect(pastLenAfter).toBe(pastLenBefore);
    });

    it("sampler keeps producing samples after the transition", async () => {
      await setRuntimeMode({ hasHardwareConnection: false });

      const { evalOutputsInTimeWindow } = await import(
        "../runtime/wasmInterpreter.ts"
      );
      const sampler = await import("./visualisationSampler.ts");
      const runtime = await import("./visualisationRuntime.ts");
      const mockEval = vi.mocked(evalOutputsInTimeWindow);

      await sampler.registerVisualisation("a1", "(a1 (sin 1))");

      // Transition mid-stream.
      await setRuntimeMode({ hasHardwareConnection: true });
      mockEval.mockClear();

      // A new time pulse must still trigger a WASM batch sample.
      runtime.notifyExternalTimeUpdate(7.0);
      await runtime._drainForTests();

      expect(mockEval).toHaveBeenCalled();
      const args = mockEval.mock.calls[0];
      // Bar is folded into the same batch as user outputs.
      expect(args[0]).toEqual(["bar", "a1"]);
    });

    it("preserves time, bar, and palette across the transition", async () => {
      await setRuntimeMode({ hasHardwareConnection: false });

      const runtime = await import("./visualisationRuntime.ts");
      const {
        visStore,
        setVisPalette,
        updateBar,
      } = await import("../utils/visualisationStore.ts");

      // Drive a sample first (this also re-reads the bar value from
      // the WASM mock), then snapshot the values that should survive.
      const palette = ["#aaa", "#bbb", "#ccc"];
      setVisPalette(palette);
      runtime.notifyExternalTimeUpdate(3.14);
      await runtime._drainForTests();
      updateBar(0.42);

      const timeBefore = visStore.currentTime;
      const barBefore = visStore.bar;
      const paletteBefore = [...visStore.palette];
      expect(timeBefore).toBeCloseTo(3.14, 5);
      expect(barBefore).toBeCloseTo(0.42, 5);
      expect(paletteBefore).toEqual(palette);

      await setRuntimeMode({ hasHardwareConnection: true });

      expect(visStore.currentTime).toBe(timeBefore);
      expect(visStore.bar).toBe(barBefore);
      expect(visStore.palette).toEqual(paletteBefore);
    });
  });

  describe("both → wasm transition (hardware disconnect)", () => {
    it("preserves registered expressions across the transition", async () => {
      // Arrange: start in "both" mode.
      await setRuntimeMode({ hasHardwareConnection: true });
      expect(await getCurrentTransportMode()).toBe("both");

      const sampler = await import("./visualisationSampler.ts");
      const { visStore } = await import("../utils/visualisationStore.ts");

      await sampler.registerVisualisation("a1", "(a1 (sin 1))", {
        from: 0,
        to: 10,
      });
      await sampler.registerVisualisation("a2", "(a2 (cos 2))", {
        from: 11,
        to: 20,
      });

      const beforeKeys = Object.keys(visStore.expressions).sort();
      const beforeA1 = visStore.expressions.a1;
      expect(beforeKeys).toEqual(["a1", "a2"]);

      // Act: hardware disconnects → falls back to "wasm".
      await setRuntimeMode({ hasHardwareConnection: false });
      expect(await getCurrentTransportMode()).toBe("wasm");

      // Assert: expressions survive, including identity.
      const afterKeys = Object.keys(visStore.expressions).sort();
      expect(afterKeys).toEqual(beforeKeys);
      expect(visStore.expressions.a1).toBe(beforeA1);
      expect(visStore.expressions.a1?.expressionText).toBe("(a1 (sin 1))");
      expect(visStore.expressions.a2?.expressionText).toBe("(a2 (cos 2))");
    });

    it("WASM-sourced traces continue producing samples after disconnect", async () => {
      await setRuntimeMode({ hasHardwareConnection: true });

      const { evalOutputsInTimeWindow } = await import(
        "../runtime/wasmInterpreter.ts"
      );
      const sampler = await import("./visualisationSampler.ts");
      const runtime = await import("./visualisationRuntime.ts");
      const mockEval = vi.mocked(evalOutputsInTimeWindow);

      await sampler.registerVisualisation("a1", "(a1 (sin 1))");
      runtime.notifyExternalTimeUpdate(1.0);
      await runtime._drainForTests();

      const pastLenBefore = sampler.getRenderData("a1")?.pastBuffer.length ?? 0;
      expect(pastLenBefore).toBeGreaterThan(0);

      // Disconnect.
      await setRuntimeMode({ hasHardwareConnection: false });
      expect(await getCurrentTransportMode()).toBe("wasm");

      mockEval.mockClear();

      // The WASM sampler must keep working — the time pulse will now
      // come from local time rather than hardware, but the path is the
      // same as far as the sampler is concerned.
      runtime.notifyExternalTimeUpdate(11.0);
      await runtime._drainForTests();

      expect(mockEval).toHaveBeenCalled();
      const pastLenAfter = sampler.getRenderData("a1")?.pastBuffer.length ?? 0;
      expect(pastLenAfter).toBeGreaterThan(pastLenBefore);
    });

    it("does not clear time / bar / palette on disconnect", async () => {
      await setRuntimeMode({ hasHardwareConnection: true });

      const runtime = await import("./visualisationRuntime.ts");
      const {
        visStore,
        setVisPalette,
        updateBar,
      } = await import("../utils/visualisationStore.ts");

      // Drive a sample first, then write the values whose survival
      // matters for this assertion.
      setVisPalette(["#111", "#222"]);
      runtime.notifyExternalTimeUpdate(9.5);
      await runtime._drainForTests();
      updateBar(0.7);

      const timeBefore = visStore.currentTime;
      const barBefore = visStore.bar;
      const paletteBefore = [...visStore.palette];
      expect(timeBefore).toBeCloseTo(9.5, 5);
      expect(barBefore).toBeCloseTo(0.7, 5);

      await setRuntimeMode({ hasHardwareConnection: false });

      expect(visStore.currentTime).toBe(timeBefore);
      expect(visStore.bar).toBe(barBefore);
      expect(visStore.palette).toEqual(paletteBefore);
    });
  });

  describe("expression registrations persist across full transition cycle", () => {
    it("a wasm → both → wasm cycle does not lose, duplicate, or mutate expression entries", async () => {
      await setRuntimeMode({ hasHardwareConnection: false });

      const sampler = await import("./visualisationSampler.ts");
      const { visStore } = await import("../utils/visualisationStore.ts");

      await sampler.registerVisualisation("a1", "(a1 (sin 1))", {
        from: 0,
        to: 10,
      });
      await sampler.registerVisualisation("d1", "(d1 (square 1))", {
        from: 11,
        to: 20,
      });

      const initialA1 = visStore.expressions.a1;
      const initialD1 = visStore.expressions.d1;
      const initialKeys = Object.keys(visStore.expressions).sort();
      expect(initialKeys).toEqual(["a1", "d1"]);

      // wasm → both
      await setRuntimeMode({ hasHardwareConnection: true });
      expect(Object.keys(visStore.expressions).sort()).toEqual(initialKeys);
      expect(visStore.expressions.a1).toBe(initialA1);
      expect(visStore.expressions.d1).toBe(initialD1);

      // both → wasm
      await setRuntimeMode({ hasHardwareConnection: false });
      expect(Object.keys(visStore.expressions).sort()).toEqual(initialKeys);
      expect(visStore.expressions.a1).toBe(initialA1);
      expect(visStore.expressions.d1).toBe(initialD1);
    });

    it("reconnecting hardware does not duplicate or re-register existing expressions", async () => {
      await setRuntimeMode({ hasHardwareConnection: false });

      const sampler = await import("./visualisationSampler.ts");
      const { visStore } = await import("../utils/visualisationStore.ts");
      const { visualisationSessionChannel } = await import(
        "../contracts/visualisationChannels"
      );
      const mockPublish = vi.mocked(visualisationSessionChannel.publish);

      await sampler.registerVisualisation("a1", "(a1 (sin 1))");
      await sampler.registerVisualisation("a2", "(a2 (cos 2))");

      mockPublish.mockClear();

      // Connect, disconnect, reconnect.  Each transition is a no-op
      // for vis state.
      await setRuntimeMode({ hasHardwareConnection: true });
      await setRuntimeMode({ hasHardwareConnection: false });
      await setRuntimeMode({ hasHardwareConnection: true });

      // No "register" or "unregister" events should fire on transitions —
      // the visualisation modules don't subscribe to mode changes.
      const registerCalls = mockPublish.mock.calls.filter(
        ([detail]) => detail.kind === "register",
      );
      const unregisterCalls = mockPublish.mock.calls.filter(
        ([detail]) => detail.kind === "unregister",
      );
      expect(registerCalls).toEqual([]);
      expect(unregisterCalls).toEqual([]);

      // No duplication: still exactly two entries, keyed by exprType.
      const keys = Object.keys(visStore.expressions).sort();
      expect(keys).toEqual(["a1", "a2"]);
    });
  });

  describe("runtime cache invariants across transitions", () => {
    it("mode changes do not interfere with tick-and-project cycle", async () => {
      await setRuntimeMode({ hasHardwareConnection: false });

      const sampler = await import("./visualisationSampler.ts");
      const runtime = await import("./visualisationRuntime.ts");

      await sampler.registerVisualisation("a1", "(a1 (sin 1))");

      runtime.notifyExternalTimeUpdate(5.0);
      await runtime._drainForTests();

      // Mode transition followed by another tick — past buffer accumulates.
      await setRuntimeMode({ hasHardwareConnection: true });
      runtime.notifyExternalTimeUpdate(5.001);
      await runtime._drainForTests();

      const renderData = sampler.getRenderData("a1");
      expect(renderData).not.toBeNull();
      expect(renderData!.pastBuffer.length).toBe(2);
    });
  });
});
