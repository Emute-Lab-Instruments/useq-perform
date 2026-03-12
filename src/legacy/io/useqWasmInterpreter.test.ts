import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/persistentUserSettings.ts", () => ({
  activeUserSettings: { wasm: { enabled: true } },
}));

type MockModule = {
  cwrap: ReturnType<typeof vi.fn>;
  _malloc: ReturnType<typeof vi.fn>;
  _free: ReturnType<typeof vi.fn>;
  HEAPF64: Float64Array;
};

function installLoadedScriptTag(): void {
  const script = document.createElement("script");
  script.dataset.useqWasm = "true";
  script.dataset.loaded = "true";
  document.head.appendChild(script);
}

function createBaseModule(overrides: Record<string, (...args: any[]) => any> = {}): MockModule {
  const handlers: Record<string, (...args: any[]) => any> = {
    useq_init: vi.fn(),
    useq_eval: vi.fn((code: string) => code),
    useq_update_time: vi.fn(),
    useq_eval_output: vi.fn((name: string, time: number) => {
      if (name === "a1") {
        return time * 2;
      }
      return Number.NaN;
    }),
    ...overrides,
  };

  return {
    cwrap: vi.fn((symbol: string) => {
      const handler = handlers[symbol];
      if (!handler) {
        throw new Error(`missing export: ${symbol}`);
      }
      return handler;
    }),
    _malloc: vi.fn(),
    _free: vi.fn(),
    HEAPF64: new Float64Array(64),
  };
}

describe("useqWasmInterpreter", () => {
  beforeEach(() => {
    vi.resetModules();
    document.head.innerHTML = "";
    delete (window as typeof window & { createModule?: unknown }).createModule;
  });

  it("falls back to per-sample output evaluation when batch helpers are not exported", async () => {
    const module = createBaseModule();
    installLoadedScriptTag();
    window.createModule = vi.fn(async () => module as never);

    const { evalOutputsInTimeWindow } = await import("./useqWasmInterpreter.ts");
    const samples = await evalOutputsInTimeWindow(["a1"], 0, 1, 3);

    expect(window.createModule).toHaveBeenCalledTimes(1);
    expect(module.cwrap).toHaveBeenCalledWith("useq_eval_outputs_time_window", "string", ["string", "number", "number", "number"]);
    expect(module.cwrap).toHaveBeenCalledWith("useq_eval_outputs_time_window_into", "number", ["string", "number", "number", "number", "number", "number"]);
    expect(samples.get("a1")).toEqual([
      { time: 0, value: 0 },
      { time: 0.5, value: 1 },
      { time: 1, value: 2 },
    ]);
  });
});
