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
  const bundleDir = path.dirname(bundlePath);
  // With SINGLE_FILE=0 the .wasm is a separate file — provide it as a
  // pre-loaded ArrayBuffer so Emscripten doesn't try to fetch() in Node.
  const wasmPath = path.resolve(bundleDir, "useq.wasm");
  let wasmBinary: ArrayBuffer | undefined;
  try {
    wasmBinary = readFileSync(wasmPath).buffer;
  } catch {
    // SINGLE_FILE=1 builds embed WASM in the JS — no separate file needed.
  }
  return createModule({
    ...(wasmBinary ? { wasmBinary } : {}),
    locateFile: (filePath: string) => path.resolve(bundleDir, filePath),
  });
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
    expect(evalCode("(a1 0.5)")).toBe("ok");

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

    expect(await evalInUseqWasm("(a1 0.5)")).toBe("ok");
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

  it("reuses sample objects across repeated typed batch reads for the same output", async () => {
    let callCount = 0;
    const typedEval = vi.fn(
      (
        outputsJson: string,
        _start: number,
        _end: number,
        sampleCount: number,
        pointer: number,
        totalEntries: number
      ) => {
        callCount += 1;
        const outputs = JSON.parse(outputsJson) as string[];
        const start = pointer / Float64Array.BYTES_PER_ELEMENT;
        const view = module.HEAPF64.subarray(start, start + totalEntries);

        outputs.forEach((_, channelIndex) => {
          for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
            view[channelIndex * sampleCount + sampleIndex] =
              callCount * 100 + channelIndex * 10 + sampleIndex;
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
    const first = (await evalOutputsInTimeWindow(["a1"], 0, 1, 3)).get("a1");
    const firstSample = first?.[0];
    const second = (await evalOutputsInTimeWindow(["a1"], 2, 3, 3)).get("a1");

    expect(first).toBeDefined();
    expect(second).toBe(first);
    expect(second?.[0]).toBe(firstSample);
    expect(second).toEqual([
      { time: 2, value: 200 },
      { time: 2.5, value: 201 },
      { time: 3, value: 202 },
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

  it("publishes diagnostic readers on globalThis.__useqWasmRuntime after init", async () => {
    const lastDiagnostics = vi.fn(() =>
      JSON.stringify([
        {
          severity: "error",
          message: "boom",
          range: { start: 0, end: 1 },
        },
      ]),
    );
    const activeDiagnostics = vi.fn(() => JSON.stringify([]));
    const module = createBaseModule({
      overrides: {
        useq_last_diagnostics: lastDiagnostics,
        useq_active_diagnostics: activeDiagnostics,
      },
    });

    installLoadedScriptTag();
    window.createModule = vi.fn(async () => module as never);

    const globalsBefore = globalThis as { __useqWasmRuntime?: unknown };
    delete globalsBefore.__useqWasmRuntime;

    const { ensureUseqWasmLoaded } = await import("./wasmInterpreter.ts");
    await ensureUseqWasmLoaded();

    const handle = (globalThis as {
      __useqWasmRuntime?: {
        useq_last_diagnostics?: () => string;
        useq_active_diagnostics?: () => string;
      };
    }).__useqWasmRuntime;

    expect(handle).toBeDefined();
    expect(typeof handle?.useq_last_diagnostics).toBe("function");
    expect(typeof handle?.useq_active_diagnostics).toBe("function");
    expect(handle?.useq_last_diagnostics?.()).toContain('"boom"');
    expect(handle?.useq_active_diagnostics?.()).toBe("[]");
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

  it("exposes a synth artefact snapshot from the generated bundle (VAL-COMP-009/012/016)", async () => {
    const module = (await loadGeneratedBundleModule(
      "../../public/wasm/useq.js"
    )) as Record<string, any>;

    expect(typeof module.cwrap).toBe("function");
    const init = module.cwrap("useq_init", null, []);
    const evalCode = module.cwrap("useq_eval", "string", ["string"]);

    // useq_synth_artifacts is an optional export — probe via cwrap. A stale
    // bundle would not expose it; we want the test to surface that drift.
    const synthArtifacts = module.cwrap("useq_synth_artifacts", "string", []);
    expect(typeof synthArtifacts).toBe("function");

    init();

    // Before any synth eval: empty graph, abi marker present.
    const before = JSON.parse(synthArtifacts());
    expect(before.abi).toBe(1);
    expect(before.revision).toBe(0);
    expect(before.declarations).toEqual([]);
    expect(before.controls).toEqual([]);

    // Minimum form: publishes one identity-keyed declaration + one control.
    expect(evalCode('(synth "osc/sine" :freq 440)')).toBe("ok");
    const after = JSON.parse(synthArtifacts());
    expect(after.revision).toBeGreaterThan(before.revision);
    expect(after.declarations).toHaveLength(1);
    expect(after.declarations[0].def).toBe("osc/sine");
    expect(after.declarations[0].version).toBe(1);
    expect(after.declarations[0].identity).toBeTruthy();
    expect(after.controls).toHaveLength(1);
    expect(after.controls[0].param).toBe("freq");
    expect(after.controls[0].rate).toBe("block");

    // Public schema never exposes internal GC-remapped node indices
    // (VAL-COMP-012).
    const snap = synthArtifacts();
    expect(snap).not.toContain("node_index");
    expect(snap).not.toContain("remapped");
  });

  it("rolls back synth artefacts on a failed eval (VAL-COMP-008/010)", async () => {
    const module = (await loadGeneratedBundleModule(
      "../../public/wasm/useq.js"
    )) as Record<string, any>;

    const init = module.cwrap("useq_init", null, []);
    const evalCode = module.cwrap("useq_eval", "string", ["string"]);
    const synthArtifacts = module.cwrap("useq_synth_artifacts", "string", []);
    init();

    // Establish a baseline successful synth declaration.
    expect(evalCode('(synth "osc/sine" :name "lead" :freq 440)')).toBe("ok");
    const baseline = JSON.parse(synthArtifacts());
    expect(baseline.declarations).toHaveLength(1);
    expect(baseline.declarations[0].identity).toBe("lead");

    // A subsequent failed eval must not advance the revision or change the
    // published artefact snapshot.
    expect(evalCode('(synth "osc/unknown" :freq 110)')).toMatch(/Error:/);
    const afterFail = JSON.parse(synthArtifacts());
    expect(afterFail.revision).toBe(baseline.revision);
    expect(afterFail.declarations).toEqual(baseline.declarations);
    expect(afterFail.controls).toEqual(baseline.controls);
  });

  it("hosts multiple declarations; update-in-place advances the revision (M2.2, VAL-COMP-019)", async () => {
    const module = (await loadGeneratedBundleModule(
      "../../public/wasm/useq.js"
    )) as Record<string, any>;

    const init = module.cwrap("useq_init", null, []);
    const evalCode = module.cwrap("useq_eval", "string", ["string"]);
    const synthArtifacts = module.cwrap("useq_synth_artifacts", "string", []);
    init();

    expect(evalCode('(synth "osc/sine" :name "lead" :freq 440)')).toBe("ok");
    const baseline = JSON.parse(synthArtifacts());

    // M2.2 lifts the M1 single-node cap: a second distinct identity
    // coexists (capacity is SYNTH_MAX_NODES, exercised natively in
    // src-useq test_synth_compiler.cpp).
    expect(evalCode('(synth "osc/sine" :name "bass" :freq 110)')).toBe("ok");
    const afterSecond = JSON.parse(synthArtifacts());
    expect(afterSecond.revision).toBeGreaterThan(baseline.revision);
    expect(afterSecond.declarations).toHaveLength(2);

    // Same identity update-in-place must still succeed, advance the
    // revision, and leave the sibling untouched.
    expect(evalCode('(synth "osc/sine" :name "lead" :freq 660)')).toBe("ok");
    const afterUpdate = JSON.parse(synthArtifacts());
    expect(afterUpdate.revision).toBeGreaterThan(afterSecond.revision);
    expect(afterUpdate.declarations).toHaveLength(2);
    const identities = afterUpdate.declarations
      .map((d: { identity: string }) => d.identity)
      .sort();
    expect(identities).toEqual(["bass", "lead"]);
  });

  it("publishes useq_synth_artifacts on __useqWasmRuntime (VAL-COMP-013)", async () => {
    // The atomic Worker response reads synth artefacts from the
    // __useqWasmRuntime global in the same handler that ran the eval. The
    // global must expose useq_synth_artifacts after init.
    installLoadedScriptTag();
    window.createModule = vi.fn(async () =>
      (await loadGeneratedBundleModule("../../public/wasm/useq.js")) as never,
    );

    const { ensureUseqWasmLoaded } = await import("./wasmInterpreter.ts");
    await ensureUseqWasmLoaded();

    const handle = (globalThis as {
      __useqWasmRuntime?: { useq_synth_artifacts?: () => string };
    }).__useqWasmRuntime;

    expect(handle).toBeDefined();
    expect(typeof handle?.useq_synth_artifacts).toBe("function");

    // The initial payload must declare the canonical ABI version.
    const initial = JSON.parse(handle!.useq_synth_artifacts!());
    expect(initial.abi).toBe(1);
    expect(initial.revision).toBe(0);
    expect(Array.isArray(initial.declarations)).toBe(true);
  });

  it("versioned synth artefact payload rejects incompatible consumers (VAL-COMP-015)", async () => {
    // The shipped bundle renders the synth artefact payload with an `abi`
    // marker. A consumer built against a different ABI version must refuse
    // to interpret the body bytes. Here we verify the bundle ALWAYS emits
    // the canonical abi=1 marker so a consumer can rely on it.
    const module = (await loadGeneratedBundleModule(
      "../../public/wasm/useq.js",
    )) as Record<string, any>;

    const init = module.cwrap("useq_init", null, []);
    const evalCode = module.cwrap("useq_eval", "string", ["string"]);
    const synthArtifacts = module.cwrap("useq_synth_artifacts", "string", []);
    init();

    // Empty graph: still carries the abi marker.
    const empty = JSON.parse(synthArtifacts());
    expect(empty.abi).toBe(1);

    // After a successful synth commit, the marker is unchanged.
    expect(evalCode('(synth "osc/sine" :name "lead" :freq 440)')).toBe("ok");
    const committed = JSON.parse(synthArtifacts());
    expect(committed.abi).toBe(1);
    expect(committed.declarations).toHaveLength(1);

    // A consumer that does not see abi===1 MUST refuse the payload. We
    // mirror the C++ synth_artifacts_supports_abi() contract here.
    const { synthArtifactsSupportsAbi, SYNTH_ARTIFACT_ABI_VERSION } = await import(
      "../contracts/runtimeTypes.ts"
    );
    expect(SYNTH_ARTIFACT_ABI_VERSION).toBe(1);
    expect(synthArtifactsSupportsAbi(committed.abi)).toBe(true);
    expect(synthArtifactsSupportsAbi(committed.abi + 1)).toBe(false);
  });

  it("evalCodeWithDiagnostics returns synth artefacts correlated to the exact eval (VAL-COMP-013/014)", async () => {
    // End-to-end through the in-process port: a successful eval response
    // carries diagnostics + synth artefacts at an advanced revision; a
    // failed eval response carries error diagnostics and the artefacts
    // retain the LAST successful revision (no engine commit).
    installLoadedScriptTag();
    window.createModule = vi.fn(async () =>
      (await loadGeneratedBundleModule("../../public/wasm/useq.js")) as never,
    );

    const portModule = await import("./wasmRuntimePort.ts");
    const port = portModule.wasmRuntimePort;
    await port.ensureLoaded();

    // Baseline: empty synth graph at revision 0.
    const baseline = await port.evalCodeWithDiagnostics("(+ 1 1)");
    expect(baseline.diagnostics).toEqual([]);
    expect(baseline.synthArtifacts).not.toBeNull();
    expect(baseline.synthArtifacts?.abi).toBe(1);
    expect(baseline.synthArtifacts?.revision).toBe(0);
    expect(baseline.synthArtifacts?.declarations).toEqual([]);

    // Successful synth commit: artefacts advance to revision > 0 with one
    // declaration. The response carries the artefacts of THIS eval (not a
    // later racing eval).
    const success = await port.evalCodeWithDiagnostics(
      '(synth "osc/sine" :name "lead" :freq 440)',
    );
    expect(success.diagnostics).toEqual([]);
    expect(success.synthArtifacts).not.toBeNull();
    expect(success.synthArtifacts?.revision).toBeGreaterThan(0);
    expect(success.synthArtifacts?.declarations).toHaveLength(1);
    expect(success.synthArtifacts?.declarations[0].identity).toBe("lead");
    const committedRevision = success.synthArtifacts!.revision;

    // Failed eval: diagnostics include the error, and the synth artefacts
    // retain the LAST successful revision (no engine commit).
    const failed = await port.evalCodeWithDiagnostics(
      '(synth "osc/unknown" :freq 110)',
    );
    expect(failed.diagnostics.length).toBeGreaterThan(0);
    expect(
      failed.diagnostics.some((d) => d.severity === "error"),
    ).toBe(true);
    expect(failed.synthArtifacts).not.toBeNull();
    expect(failed.synthArtifacts?.revision).toBe(committedRevision);
    expect(failed.synthArtifacts?.declarations).toEqual(
      success.synthArtifacts?.declarations,
    );
  });
});
