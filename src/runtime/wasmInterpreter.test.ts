import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
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

async function loadGeneratedBundleModule(bundleRelativePath: string): Promise<{
  [key: string]: unknown;
}> {
  const bundlePath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    bundleRelativePath,
  );
  const code = readFileSync(bundlePath, "utf8");
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    TextDecoder,
    TextEncoder,
    URL,
    fetch,
    performance,
    WebAssembly,
    globalThis: {},
    document: { currentScript: { src: `http://localhost/${path.basename(bundlePath)}` } },
    exports: {},
    module: { exports: {} },
    define: undefined,
  });
  context.globalThis = context;
  vm.runInContext(code, context, { filename: path.basename(bundlePath) });
  const createModule = ((context.module as { exports?: unknown }).exports ||
    (context as { createModule?: unknown }).createModule) as
    | ((options?: Record<string, unknown>) => Promise<Record<string, unknown>>)
    | undefined;
  if (typeof createModule !== "function") {
    throw new Error(`Generated WASM bundle did not expose createModule(): ${bundlePath}`);
  }
  return createModule({});
}

function createBaseModule(options: {
  missingSymbols?: string[];
  missingRawSymbols?: string[];
  overrides?: Record<string, MockHandler>;
} = {}): MockModule {
  const { missingSymbols = [], missingRawSymbols = [], overrides = {} } = options;
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

  const module = {
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
  } as MockModule & Record<string, unknown>;

  for (const [symbol, handler] of Object.entries(handlers)) {
    if (!missingRawSymbols.includes(symbol)) {
      module[`_${symbol}`] = handler;
    }
  }

  return module;
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

  it("ships a generated bundle with callable raw batch exports", async () => {
    const module = await loadGeneratedBundleModule("../../public/wasm/useq.js");

    expect(typeof module._useq_eval_output).toBe("function");
    expect(typeof module._useq_eval_outputs_time_window).toBe("function");
    expect(typeof module._useq_eval_outputs_time_window_into).toBe("function");
    expect(typeof module._useq_last_error).toBe("function");
  });

  it("ships a generated bundle whose typed batch helper is readable through HEAPF64", async () => {
    const module = await loadGeneratedBundleModule("../../public/wasm/useq.js");
    const typedModule = module as Record<string, any>;

    expect(typeof typedModule.HEAPF64?.subarray).toBe("function");

    const init = typedModule.cwrap("useq_init", null, []);
    const evalCode = typedModule.cwrap("useq_eval", "string", ["string"]);
    const typedEval = typedModule.cwrap(
      "useq_eval_outputs_time_window_into",
      "number",
      ["string", "number", "number", "number", "number", "number"]
    );
    const lastError = typedModule.cwrap("useq_last_error", "string", []);

    init();
    expect(evalCode("(def a1 (bar))")).toBe("a1");

    const sampleCount = 5;
    const pointer = typedModule._malloc(sampleCount * Float64Array.BYTES_PER_ELEMENT);
    const start = pointer / Float64Array.BYTES_PER_ELEMENT;
    const view = typedModule.HEAPF64.subarray(start, start + sampleCount);

    try {
      const status = typedEval(JSON.stringify(["a1"]), 0, 1, sampleCount, pointer, sampleCount);
      expect(status).toBe(1);
      expect(lastError()).toBe("");
      expect(Array.from(view)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
    } finally {
      typedModule._free(pointer);
    }
  });

  it("uses the shipped bundle's typed batch path through the runtime bridge", async () => {
    installLoadedScriptTag();
    window.createModule = vi.fn(async () =>
      (await loadGeneratedBundleModule("../../public/wasm/useq.js")) as never
    );

    const { evalInUseqWasm, evalOutputsInTimeWindow } = await import("./wasmInterpreter.ts");

    expect(await evalInUseqWasm("(def a1 (bar))")).toBe("a1");
    const samples = await evalOutputsInTimeWindow(["a1"], 0, 1, 5);

    expect(samples.get("a1")).toEqual([
      { time: 0, value: 0.5 },
      { time: 0.25, value: 0.5 },
      { time: 0.5, value: 0.5 },
      { time: 0.75, value: 0.5 },
      { time: 1, value: 0.5 },
    ]);
  });

  it("does not publish codeEvaluated events for silent evals", async () => {
    installLoadedScriptTag();
    window.createModule = vi.fn(async () => createBaseModule() as never);

    const runtimeChannels = await import("../contracts/runtimeChannels.ts");
    const publishSpy = vi
      .spyOn(runtimeChannels.codeEvaluated, "publish")
      .mockImplementation(() => {});

    const { evalInUseqWasm, evalInUseqWasmSilently } = await import("./wasmInterpreter.ts");

    await evalInUseqWasmSilently("(+ 1 2)");
    expect(publishSpy).not.toHaveBeenCalled();

    await evalInUseqWasm("(+ 1 2)");
    expect(publishSpy).toHaveBeenCalledWith({ code: "(+ 1 2)" });
  });

  it("uses typed batch helpers when the wasm bundle exports them", async () => {
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
    const module = createBaseModule({
      missingRawSymbols: ["useq_eval_outputs_time_window"],
      overrides: {
        useq_eval_output: vi.fn(() => {
          throw new Error("per-sample fallback should not run");
        }),
        useq_eval_outputs_time_window_into: typedEval,
        useq_last_error: vi.fn(() => ""),
      },
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
    const module = createBaseModule({
      missingRawSymbols: [
        "useq_eval_outputs_time_window",
        "useq_eval_outputs_time_window_into",
        "useq_last_error",
      ],
      overrides: {
        useq_eval_outputs_time_window: vi.fn(() => {
          throw new TypeError("func is not a function");
        }),
        useq_eval_outputs_time_window_into: vi.fn(() => {
          throw new TypeError("func is not a function");
        }),
        useq_last_error: vi.fn(() => {
          throw new TypeError("func is not a function");
        }),
      },
    });
    installLoadedScriptTag();
    window.createModule = vi.fn(async () => module as never);

    const { evalOutputsInTimeWindow, wasmRuntimePort } = await import("./wasmInterpreter.ts");
    const samples = await evalOutputsInTimeWindow(["a1"], 0, 1, 3);

    expect(window.createModule).toHaveBeenCalledTimes(1);
    expect(
      module.cwrap.mock.calls.some(
        ([symbol]) => symbol === "useq_eval_outputs_time_window"
      )
    ).toBe(false);
    expect(
      module.cwrap.mock.calls.some(
        ([symbol]) => symbol === "useq_eval_outputs_time_window_into"
      )
    ).toBe(false);
    expect(wasmRuntimePort.capabilities().supportsTimeWindow).toBe(false);
    expect(samples.get("a1")).toEqual([
      { time: 0, value: 0 },
      { time: 0.5, value: 1 },
      { time: 1, value: 2 },
    ]);
  });

  it("disables legacy batch mode after the first broken optional export failure", async () => {
    const legacyBatch = vi
      .fn(() => {
        throw new TypeError("func is not a function");
      })
      .mockName("legacyBatch");
    const perSample = vi.fn((name: string, time: number) => {
      if (name === "a1") {
        return time * 2;
      }
      return Number.NaN;
    });

    const module = createBaseModule({
      overrides: {
        useq_eval_output: perSample,
        useq_eval_outputs_time_window: legacyBatch,
      },
    });
    installLoadedScriptTag();
    window.createModule = vi.fn(async () => module as never);

    const { evalOutputsInTimeWindow, wasmRuntimePort } = await import("./wasmInterpreter.ts");

    const first = await evalOutputsInTimeWindow(["a1"], 0, 1, 3);
    const second = await evalOutputsInTimeWindow(["a1"], 0, 1, 3);

    expect(first.get("a1")).toEqual([
      { time: 0, value: 0 },
      { time: 0.5, value: 1 },
      { time: 1, value: 2 },
    ]);
    expect(second.get("a1")).toEqual([
      { time: 0, value: 0 },
      { time: 0.5, value: 1 },
      { time: 1, value: 2 },
    ]);
    expect(legacyBatch).toHaveBeenCalledTimes(1);
    expect(wasmRuntimePort.capabilities().supportsTimeWindow).toBe(false);
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
