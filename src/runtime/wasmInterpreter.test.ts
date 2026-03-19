import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./appSettingsRepository.ts", () => ({
  getAppSettings: () => ({ wasm: { enabled: true } }),
}));

type MockHandler = (...args: any[]) => any;

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

function createBaseModule(options: {
  missingSymbols?: string[];
  overrides?: Record<string, MockHandler>;
} = {}): MockModule {
  const { missingSymbols = [], overrides = {} } = options;
  const handlers: Record<string, MockHandler> = {
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
      if (missingSymbols.includes(symbol)) {
        throw new Error(`missing export: ${symbol}`);
      }

      const handler = handlers[symbol];
      if (!handler) {
        throw new Error(`missing export: ${symbol}`);
      }
      return handler;
    }),
    _malloc: vi.fn(() => Float64Array.BYTES_PER_ELEMENT),
    _free: vi.fn(),
    HEAPF64: new Float64Array(256),
  };
}

describe("useqWasmInterpreter", () => {
  beforeEach(() => {
    vi.resetModules();
    document.head.innerHTML = "";
    delete (window as typeof window & { createModule?: unknown }).createModule;
  });

  it("matches the pinned src-useq build's required export floor", () => {
    const buildScript = readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../src-useq/scripts/build_wasm.sh"
      ),
      "utf8"
    );

    expect(buildScript).toContain('\\"_useq_init\\"');
    expect(buildScript).toContain('\\"_useq_eval\\"');
    expect(buildScript).toContain('\\"_useq_update_time\\"');
    expect(buildScript).toContain('\\"_useq_eval_output\\"');
    expect(buildScript).toContain('\\"_free\\"');
    expect(buildScript).toContain('\\"_useq_eval_outputs_time_window\\"');
    expect(buildScript).toContain('\\"_useq_eval_outputs_time_window_into\\"');
    expect(buildScript).toContain('\\"_useq_last_error\\"');
  });

  it("uses typed batch helpers when the wasm bundle exports them", async () => {
    const module = createBaseModule();
    const typedEval = vi.fn(
      (
        outputsJson: string,
        _start: number,
        _end: number,
        sampleCount: number,
        pointer: number,
        totalEntries: number
      ) => {
        const outputs = JSON.parse(outputsJson) as string[];
        const start = pointer / Float64Array.BYTES_PER_ELEMENT;
        const view = module.HEAPF64.subarray(start, start + totalEntries);

        outputs.forEach((_, channelIndex) => {
          for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
            view[channelIndex * sampleCount + sampleIndex] =
              channelIndex * 10 + sampleIndex;
          }
        });

        return outputs.length;
      }
    );

    module.cwrap.mockImplementation((symbol: string) => {
      const handlers: Record<string, MockHandler> = {
        useq_init: vi.fn(),
        useq_eval: vi.fn((code: string) => code),
        useq_update_time: vi.fn(),
        useq_eval_output: vi.fn(() => {
          throw new Error("per-sample fallback should not run");
        }),
        useq_eval_outputs_time_window_into: typedEval,
        useq_last_error: vi.fn(() => ""),
      };
      const handler = handlers[symbol];
      if (!handler) {
        throw new Error(`missing export: ${symbol}`);
      }
      return handler;
    });

    installLoadedScriptTag();
    window.createModule = vi.fn(async () => module as never);

    const { evalOutputsInTimeWindow } = await import("./wasmInterpreter.ts");
    const samples = await evalOutputsInTimeWindow(["a1", "a2"], 0, 1, 3);

    expect(typedEval).toHaveBeenCalledTimes(1);
    expect(samples.get("a1")).toEqual([
      { time: 0, value: 0 },
      { time: 0.5, value: 1 },
      { time: 1, value: 2 },
    ]);
    expect(samples.get("a2")).toEqual([
      { time: 0, value: 10 },
      { time: 0.5, value: 11 },
      { time: 1, value: 12 },
    ]);
  });

  it("falls back to the legacy JSON bridge when typed batch helpers fail", async () => {
    const module = createBaseModule({
      overrides: {
        useq_eval_outputs_time_window_into: vi.fn(() => -1),
        useq_last_error: vi.fn(() => "typed batch failed"),
        useq_eval_outputs_time_window: vi.fn(() =>
          JSON.stringify({
            a1: [3, 4, 5],
          })
        ),
      },
    });

    installLoadedScriptTag();
    window.createModule = vi.fn(async () => module as never);

    const { evalOutputsInTimeWindow } = await import("./wasmInterpreter.ts");
    const samples = await evalOutputsInTimeWindow(["a1"], 0, 1, 3);

    expect(samples.get("a1")).toEqual([
      { time: 0, value: 3 },
      { time: 0.5, value: 4 },
      { time: 1, value: 5 },
    ]);
  });

  it("falls back to per-sample output evaluation when batch helpers are not exported", async () => {
    const module = createBaseModule();
    installLoadedScriptTag();
    window.createModule = vi.fn(async () => module as never);

    const { evalOutputsInTimeWindow } = await import("./wasmInterpreter.ts");
    const samples = await evalOutputsInTimeWindow(["a1"], 0, 1, 3);

    expect(window.createModule).toHaveBeenCalledTimes(1);
    expect(module.cwrap).toHaveBeenCalledWith(
      "useq_eval_outputs_time_window",
      "string",
      ["string", "number", "number", "number"]
    );
    expect(module.cwrap).toHaveBeenCalledWith(
      "useq_eval_outputs_time_window_into",
      "number",
      ["string", "number", "number", "number", "number", "number"]
    );
    expect(samples.get("a1")).toEqual([
      { time: 0, value: 0 },
      { time: 0.5, value: 1 },
      { time: 1, value: 2 },
    ]);
  });

  it("fails fast when the pinned required wasm exports are missing", async () => {
    const module = createBaseModule({
      missingSymbols: ["useq_update_time"],
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    installLoadedScriptTag();
    window.createModule = vi.fn(async () => module as never);

    const { ensureUseqWasmLoaded } = await import("./wasmInterpreter.ts");

    await expect(ensureUseqWasmLoaded()).rejects.toThrow(
      /useq_update_time/
    );
    consoleErrorSpy.mockRestore();
  });
});
