import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VISUALISATION_SESSION_EVENT,
  addVisualisationEventListener,
} from "../../contracts/visualisationEvents";

type VisualisationOverrides = Partial<{
  windowDuration: number;
  sampleCount: number;
  futureLeadSeconds: number;
}>;

async function loadController(overrides: VisualisationOverrides = {}) {
  vi.resetModules();

  const activeUserSettings = {
    visualisation: {
      windowDuration: 10,
      sampleCount: 100,
      lineWidth: 1.5,
      futureDashed: true,
      futureMaskOpacity: 0.35,
      futureMaskWidth: 12,
      circularOffset: 0,
      futureLeadSeconds: 1,
      digitalLaneGap: 4,
      ...overrides,
    },
  };

  const evalInUseqWasm = vi.fn().mockResolvedValue(undefined);
  const updateUseqWasmTime = vi.fn().mockResolvedValue(undefined);
  const evalOutputAtTime = vi.fn().mockResolvedValue(0);
  const evalOutputsInTimeWindow = vi.fn(
    async (outputs: string[], start: number, end: number, sampleCount: number) => {
      const step = sampleCount > 1 ? (end - start) / (sampleCount - 1) : 0;
      const samples = Array.from({ length: sampleCount }, (_, index) => ({
        time: start + step * index,
        value: index,
      }));
      return new Map(outputs.map((output) => [output, samples]));
    },
  );

  // Capture subscribers registered via subscribeAppSettings so the test
  // can invoke them to simulate a settings change.
  const settingsSubscribers = new Set<(s: unknown) => void>();

  vi.doMock("../../runtime/appSettingsRepository.ts", () => ({
    getAppSettings: () => activeUserSettings,
    subscribeAppSettings: (listener: (s: unknown) => void) => {
      settingsSubscribers.add(listener);
      return () => { settingsSubscribers.delete(listener); };
    },
  }));

  vi.doMock("../../runtime/wasmInterpreter.ts", () => ({
    evalInUseqWasm,
    updateUseqWasmTime,
    evalOutputAtTime,
    evalOutputsInTimeWindow,
  }));

  vi.doMock("../../lib/visualisationUtils.ts", () => ({
    getSerialVisPalette: () => ["#0ff", "#f0f", "#ff0"],
    getSerialVisChannelColor: () => "#0ff",
  }));

  vi.doMock("../../lib/debug.ts", () => ({
    dbg: vi.fn(),
  }));

  const controller = await import("./visualisationController.ts");
  return {
    controller,
    activeUserSettings,
    evalOutputsInTimeWindow,
    /** Notify all settings subscribers (simulates a settings change). */
    notifySettingsChanged: () => {
      settingsSubscribers.forEach((fn) => fn(activeUserSettings));
    },
  };
}

function flushAsyncWork() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("visualisationController", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rebuilds expression samples when canonical visualisation settings change", async () => {
    const { controller, activeUserSettings, evalOutputsInTimeWindow, notifySettingsChanged } = await loadController();
    const visualisationEvents: Array<Record<string, unknown>> = [];
    const removeVisualisationListener = addVisualisationEventListener(
      VISUALISATION_SESSION_EVENT,
      (detail) => {
        visualisationEvents.push(detail as Record<string, unknown>);
      }
    );

    await controller.registerVisualisation("a1", "(ssin 0)");

    const initialState = controller.getVisualisationState();
    const initialSamples = initialState.expressions.get("a1")?.samples ?? [];
    expect(initialSamples).toHaveLength(110);

    activeUserSettings.visualisation = {
      ...activeUserSettings.visualisation,
      windowDuration: 4,
      sampleCount: 20,
      futureLeadSeconds: 2,
    };

    notifySettingsChanged();
    await flushAsyncWork();

    const updatedState = controller.getVisualisationState();
    const updatedSamples = updatedState.expressions.get("a1")?.samples ?? [];
    expect(updatedSamples).toHaveLength(30);
    expect(updatedSamples[1].time - updatedSamples[0].time).toBeCloseTo(4 / 19);
    expect(updatedSamples[updatedSamples.length - 1].time).toBeGreaterThan(4);
    expect(evalOutputsInTimeWindow).toHaveBeenCalledTimes(2);

    const lastEvent = visualisationEvents[visualisationEvents.length - 1];
    expect(lastEvent).toMatchObject({
      kind: "settings",
      settings: expect.objectContaining({
        windowDuration: 4,
        sampleCount: 20,
        futureLeadSeconds: 2,
      }),
    });
    expect(lastEvent.expressions).not.toBeInstanceOf(Map);
    expect(lastEvent.expressions).toMatchObject({
      a1: expect.objectContaining({
        exprType: "a1",
        expressionText: "(ssin 0)",
      }),
    });

    removeVisualisationListener();
  });
});
