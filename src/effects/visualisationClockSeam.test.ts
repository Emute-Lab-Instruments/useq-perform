/**
 * Spec test: deterministic clock seam (e2e axe item A1).
 *
 * Source of truth:
 *   - docs/specs/transport.md §1.4–1.5 — the internal clock is rAF-driven
 *     `performance.now`; Stop resets it to zero, Pause freezes, Play
 *     resumes from the frozen position.
 *   - `src/effects/visualisationRuntime.ts` — every ModuLisp local-time
 *     read goes through ONE injectable time source
 *     (`setVisualisationNowSource`); the default is `performance.now`.
 *
 * These tests drive the seam exactly the way the devmode browser-eval
 * clock hooks do: install a frozen source, advance it, and verify the
 * *production* rAF tick path (updateTime → requestLocalSamplesThrough →
 * sampling queue) processes the stepped time — then restore the real
 * source and verify local time re-anchors without a jump.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  getSerialVisPalette: vi.fn().mockReturnValue(["#f00", "#0f0", "#00f"]),
  getSerialVisChannelColor: vi.fn().mockReturnValue("#888888"),
}));

vi.mock("../contracts/runtimeChannels", () => ({
  codeEvaluated: { subscribe: vi.fn() },
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

describe("deterministic clock seam (A1: transport.md §1.4–1.5)", () => {
  let rafCallbacks: FrameRequestCallback[];
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let cancelSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    rafCallbacks = [];
    rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      });
    cancelSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});
  });

  afterEach(async () => {
    const runtime = await import("./visualisationRuntime.ts");
    runtime._resetForTests();
    rafSpy.mockRestore();
    cancelSpy.mockRestore();
  });

  /** Fire the next queued production rAF tick. */
  function fireTick(): void {
    const cb = rafCallbacks.shift();
    expect(cb).toBeDefined();
    cb!(performance.now());
  }

  it("frozen source holds local time while ticks keep running; stepping drives the production tick path", async () => {
    const runtime = await import("./visualisationRuntime.ts");
    const { visStore } = await import("../utils/visualisationStore.ts");

    let frozen = 1000;
    runtime.setVisualisationNowSource(() => frozen);
    runtime.startVisualisationRuntime();
    runtime.setLocalTimeMode(true);

    // Ticks fire but the frozen source holds local time at 0.
    fireTick();
    fireTick();
    await runtime._drainForTests();
    expect(runtime.getLocalTime()).toBe(0);
    expect(visStore.currentTime).toBe(0);

    // Step 500ms: the next *production* tick observes the new time and
    // syncs the interpreter through the normal sampling path.
    wasmInterpreterMocks.updateUseqWasmTime.mockClear();
    frozen += 500;
    fireTick();
    await runtime._drainForTests();
    expect(runtime.getLocalTime()).toBeCloseTo(0.5, 9);
    expect(visStore.currentTime).toBeCloseTo(0.5, 9);
    expect(wasmInterpreterMocks.updateUseqWasmTime).toHaveBeenCalled();
    const syncedTimes = wasmInterpreterMocks.updateUseqWasmTime.mock.calls.map(
      (call) => call[0] as number,
    );
    expect(Math.max(...syncedTimes)).toBeCloseTo(0.5, 9);
  });

  it("resetLocalTime under a frozen clock re-pins t=0 (transport §1.5 Stop)", async () => {
    const runtime = await import("./visualisationRuntime.ts");
    const { visStore } = await import("../utils/visualisationStore.ts");

    let frozen = 5000;
    runtime.setVisualisationNowSource(() => frozen);
    runtime.startVisualisationRuntime();
    runtime.setLocalTimeMode(true);
    frozen += 2000;
    fireTick();
    await runtime._drainForTests();
    expect(runtime.getLocalTime()).toBeCloseTo(2, 9);

    runtime.resetLocalTime();
    expect(visStore.currentTime).toBe(0);
    fireTick();
    await runtime._drainForTests();
    expect(runtime.getLocalTime()).toBe(0);

    frozen += 250;
    fireTick();
    await runtime._drainForTests();
    expect(runtime.getLocalTime()).toBeCloseTo(0.25, 9);
  });

  it("restoring the real source re-anchors — no jump from wall time spent frozen", async () => {
    const runtime = await import("./visualisationRuntime.ts");

    // Freeze far in the (fake) past relative to the real performance.now
    // so an anchoring bug would show up as a jump of many seconds.
    let frozen = 1000;
    runtime.setVisualisationNowSource(() => frozen);
    runtime.startVisualisationRuntime();
    runtime.setLocalTimeMode(true);
    frozen += 1500;
    fireTick();
    await runtime._drainForTests();
    expect(runtime.getLocalTime()).toBeCloseTo(1.5, 9);

    // Back to real time: elapsed must continue from 1.5s, not leap to
    // wherever performance.now() is.
    runtime.setVisualisationNowSource(null);
    fireTick();
    await runtime._drainForTests();
    expect(runtime.getLocalTime()).toBeGreaterThanOrEqual(1.5);
    expect(runtime.getLocalTime()).toBeLessThan(1.75);
  });

  it("default source is performance.now (production path untouched)", async () => {
    const runtime = await import("./visualisationRuntime.ts");

    const before = performance.now();
    runtime.startVisualisationRuntime();
    runtime.setLocalTimeMode(true);
    fireTick();
    await runtime._drainForTests();
    const after = performance.now();

    // Elapsed local time is bounded by the real wall clock.
    expect(runtime.getLocalTime()).toBeGreaterThanOrEqual(0);
    expect(runtime.getLocalTime()).toBeLessThanOrEqual((after - before) / 1000 + 0.001);
  });
});
