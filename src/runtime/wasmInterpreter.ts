import { dbg } from "../lib/debug.ts";
import { getAppSettings } from "./appSettingsRepository.ts";
import { TRANSPORT_STATE_TO_COMMAND } from "../contracts/useqRuntimeContract";
import { codeEvaluated as codeEvaluatedChannel } from "../contracts/runtimeChannels";
import {
  assertWasmAbi,
  REQUIRED_WASM_EXPORTS,
  OPTIONAL_WASM_EXPORTS,
  type WasmAbiValidation,
} from "../contracts/wasmAbi";
import type { ProjectionMode } from "../contracts/runtimePorts";
import {
  bindOptionalCwrap,
  createWasmBatchEvaluator,
  createWasmLiveInputController,
  createWasmProbeController,
  type EmscriptenModule,
} from "./wasmInterpreterCore";

export type { EmscriptenModule } from "./wasmInterpreterCore";

/** Time-series sample point */
export interface TimeSample {
  time: number;
  value: number;
}

/** Map of channel name to sample series */
export type SampleSeriesMap = Map<string, TimeSample[]>;

/** Result shape for the combined tick + project ABI (`useq_tick_and_project`). */
export interface TickAndProjectResult {
  /** Map of channel name → tick value at `tickTime`. NaN for inactive outputs. */
  tickValues: Map<string, number>;
  /** Map of channel name → projection samples between `tickTime` and `projectEnd`. */
  projectionSamples: SampleSeriesMap;
}

/** Transport states the WASM interpreter understands */
export type TransportState = 'playing' | 'paused' | 'stopped';

/**
 * Shape of the `globalThis.__useqWasmRuntime` handle exposed to diagnostic
 * readers and live-edit slot access. Set by the WASM init paths (main-thread
 * and worker) so helpers can pull structured data without holding a direct
 * module reference.
 */
export interface UseqWasmRuntimeGlobal {
  useq_last_diagnostics?: () => string;
  useq_active_diagnostics?: () => string;
  useq_set_live_inputs?: (json: string) => number;
  useq_get_live_slots?: () => string;
  useq_apply_state_snapshot?: (json: string) => number;
  useq_set_input_value?: (channel: number, value: number) => void;
  useq_set_failure_mode?: (mode: number) => number;
  useq_get_failure_mode?: () => number;
  /**
   * Versioned synth artefact snapshot (synth-nodes.md §7.2 /
   * VAL-COMP-009/012/015). Mirrors the `useq_synth_artifacts` WASM export.
   * Returns a JSON object shaped
   *   {"abi":N,"revision":R,"declarations":[...],"controls":[...]}
   * that is stable until the next eval commits a new synth graph.
   */
  useq_synth_artifacts?: () => string;
}

/** Runtime interface for the instantiated WASM interpreter */
interface UseqRuntime {
  module: EmscriptenModule;
  evaluate: (code: string) => string;
  updateTime: (seconds: number) => void;
  evaluateOutputAtTime: (name: string, timeSeconds: number) => number;
  evaluateOutputsTimeWindow: (outputs: string[], startTime: number, endTime: number, numSamples: number) => SampleSeriesMap;
  tickAndProjectOutputs: (
    outputs: string[],
    tickTime: number,
    projectionMode: ProjectionMode,
    projectEnd: number,
    numFutureSamples: number,
    projectionOrigin: number,
  ) => TickAndProjectResult | null;
  supportsTimeWindow: boolean;
  supportsTickAndProject: boolean;
  probeSet: (slot: number, code: string) => number;
  probeSample: (slot: number, start: number, end: number, count: number) => Float64Array | null;
  probeFree: (slot: number) => void;
  supportsProbeSlots: boolean;
  release: () => void;
}

// Extend Window to include the createModule factory
declare global {
  interface Window {
    createModule?: () => Promise<EmscriptenModule>;
  }
}

const WASM_SCRIPT_URL = "wasm/useq.js";
let scriptLoadPromise: Promise<void> | null = null;
let runtimePromise: Promise<UseqRuntime> | null = null;
let lastKnownTimeWindowSupport = false;
let lastKnownTickAndProjectSupport = false;
let lastKnownLiveInputsSupport = false;
let classificationsFnStored: (() => string) | null = null;
let dependenciesFnStored: ((idx: number) => number) | null = null;
function isUseqWasmEnabled(): boolean {
  try {
    return getAppSettings()?.wasm?.enabled ?? true;
  } catch (_e) {
    return true;
  }
}

function loadWasmScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Window is not available"));
  }

  if (scriptLoadPromise) {
    return scriptLoadPromise;
  }

  const existing = document.querySelector<HTMLScriptElement>("script[data-useq-wasm]");
  if (existing) {
    scriptLoadPromise = existing.dataset.loaded === "true"
      ? Promise.resolve()
      : new Promise<void>((resolve, reject) => {
          existing.addEventListener("load", () => resolve(), { once: true });
          existing.addEventListener("error", (event) => reject((event as any)?.error ?? new Error("Failed to load uSEQ WASM")), { once: true });
        });
    return scriptLoadPromise;
  }

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL(WASM_SCRIPT_URL, window.location.href).toString();
    script.async = true;
    script.dataset.useqWasm = "true";

    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      dbg("uSEQ WASM bundle loaded");
      resolve();
    }, { once: true });

    script.addEventListener("error", () => {
      scriptLoadPromise = null;
      reject(new Error("Failed to load uSEQ WASM bundle"));
    }, { once: true });

    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

async function instantiateInterpreter(): Promise<UseqRuntime> {
  await loadWasmScript();

  const factory = window.createModule;
  if (typeof factory !== "function") {
    throw new Error("uSEQ WASM bundle did not expose createModule()");
  }

  const module = await factory();

  // Validate ABI before using the module — fail fast on drift
  const abiResult: WasmAbiValidation = assertWasmAbi(module);

  if (abiResult.missingOptional.length > 0) {
    dbg(`useqWasmInterpreter: optional ABI exports not present: ${abiResult.missingOptional.join(", ")}`);
  }
  if (abiResult.presentOptional.length > 0) {
    dbg(`useqWasmInterpreter: optional ABI exports detected: ${abiResult.presentOptional.join(", ")}`);
  }

  // Bind required exports using contract descriptors
  const initDesc = REQUIRED_WASM_EXPORTS.useq_init;
  const useq_init = module.cwrap(initDesc.symbol, initDesc.returnType, initDesc.argTypes as unknown as string[]) as () => void;

  const evalDesc = REQUIRED_WASM_EXPORTS.useq_eval;
  const useq_eval = module.cwrap(evalDesc.symbol, evalDesc.returnType, evalDesc.argTypes as unknown as string[]) as (code: string) => string;

  const timeDesc = REQUIRED_WASM_EXPORTS.useq_update_time;
  const useq_update_time = module.cwrap(timeDesc.symbol, timeDesc.returnType, timeDesc.argTypes as unknown as string[]) as (t: number) => void;

  const outputDesc = REQUIRED_WASM_EXPORTS.useq_eval_output;
  const useq_eval_output = module.cwrap(outputDesc.symbol, outputDesc.returnType, outputDesc.argTypes as unknown as string[]) as (name: string, t: number) => number;
  const evaluateOutputAtTime = (name: string, timeSeconds: number): number => {
    const value = useq_eval_output(name, Number(timeSeconds) || 0);
    return Number.isNaN(value) ? NaN : value;
  };
  const coreLog = (message: string): void => dbg(`useqWasmInterpreter: ${message}`);
  const batchEvaluator = createWasmBatchEvaluator(
    module,
    evaluateOutputAtTime,
    coreLog,
  );

  // Bind the raw diagnostic export fns and stash them on the
  // `__useqWasmRuntime` global. The in-process port (`wasmRuntimePort.ts`,
  // readLastDiagnosticsSync / readActiveDiagnosticsSync) reads them back from
  // the global to pull structured diagnostics for inline editor squiggles.
  // wasmInterpreter.ts intentionally exposes no reader functions of its own;
  // the global is the sync seam shared by all optional WASM consumers below.
  const lastDiagsFn = bindOptionalCwrap(module, OPTIONAL_WASM_EXPORTS.useq_last_diagnostics) as (() => string) | null;
  const activeDiagsFn = bindOptionalCwrap(module, OPTIONAL_WASM_EXPORTS.useq_active_diagnostics) as (() => string) | null;

  const liveInputs = createWasmLiveInputController(module, coreLog);

  // Bind output classification ABI exports (visualisation.md §7.3–7.4)
  const classificationsFn = bindOptionalCwrap(module, OPTIONAL_WASM_EXPORTS.useq_output_classifications) as (() => string) | null;
  const dependenciesFn = bindOptionalCwrap(module, OPTIONAL_WASM_EXPORTS.useq_output_dependencies) as ((idx: number) => number) | null;

  // Bind synth artefact ABI export (synth-nodes.md §7.2 / VAL-COMP-015).
  // The versioned payload is returned atomically from the exact-eval
  // Worker response through the in-process port.
  const synthArtifactsFn = bindOptionalCwrap(module, OPTIONAL_WASM_EXPORTS.useq_synth_artifacts) as (() => string) | null;

  const probes = createWasmProbeController(module, coreLog);

  // Bind non-finite failure-mode ABI exports (failure-model.md §3.2)
  const setFailureModeFn = bindOptionalCwrap(module, OPTIONAL_WASM_EXPORTS.useq_set_failure_mode) as ((mode: number) => number) | null;
  const getFailureModeFn = bindOptionalCwrap(module, OPTIONAL_WASM_EXPORTS.useq_get_failure_mode) as (() => number) | null;

  (globalThis as { __useqWasmRuntime?: UseqWasmRuntimeGlobal }).__useqWasmRuntime = {
    useq_last_diagnostics: lastDiagsFn ?? undefined,
    useq_active_diagnostics: activeDiagsFn ?? undefined,
    useq_set_live_inputs: liveInputs.supported
      ? (json) => liveInputs.set(JSON.parse(json) as Record<string, number>)
      : undefined,
    useq_get_live_slots: liveInputs.supported
      ? () => JSON.stringify(liveInputs.getSlots())
      : undefined,
    useq_apply_state_snapshot: (json) => liveInputs.applyStateSnapshot(json) ? 0 : -1,
    useq_set_input_value: liveInputs.setHardwareInput,
    useq_set_failure_mode: setFailureModeFn ?? undefined,
    useq_get_failure_mode: getFailureModeFn ?? undefined,
    useq_synth_artifacts: synthArtifactsFn ?? undefined,
  };

  useq_init();

  // Apply the user's configured non-finite failure policy at init so the
  // fresh engine matches the setting (the engine boots in "lkg" by default;
  // the setting may select the legacy zero-squash mode).
  if (setFailureModeFn) {
    const configuredMode = getAppSettings()?.runtime?.failureMode;
    setFailureModeFn(configuredMode === "zero" ? 1 : 0);
  }
  dbg("uSEQ WASM interpreter initialised");
  lastKnownTimeWindowSupport = batchEvaluator.supportsTimeWindow();
  lastKnownTickAndProjectSupport = batchEvaluator.supportsTickAndProject();
  lastKnownLiveInputsSupport = liveInputs.supported;
  classificationsFnStored = classificationsFn;
  dependenciesFnStored = dependenciesFn;

  return {
    module,
    evaluate: (code: string): string => {
      try {
        return useq_eval(code);
      } catch (error) {
        throw new Error(`uSEQ WASM evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    updateTime: (seconds: number): void => {
      try {
        useq_update_time(Number(seconds) || 0);
      } catch (error) {
        throw new Error(`uSEQ WASM time update failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    evaluateOutputAtTime: (name: string, timeSeconds: number): number => {
      try {
        return evaluateOutputAtTime(name, timeSeconds);
      } catch (error) {
        throw new Error(`uSEQ WASM output evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    evaluateOutputsTimeWindow: (outputs: string[], startTime: number, endTime: number, numSamples: number): SampleSeriesMap => {
      try {
        const result = batchEvaluator.evaluate(outputs, startTime, endTime, numSamples);
        lastKnownTimeWindowSupport = batchEvaluator.supportsTimeWindow();
        return result;
      } catch (error) {
        lastKnownTimeWindowSupport = batchEvaluator.supportsTimeWindow();
        throw new Error(`uSEQ WASM batch evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    tickAndProjectOutputs: (
      outputs: string[],
      tickTime: number,
      projectionMode: ProjectionMode,
      projectEnd: number,
      numFutureSamples: number,
      projectionOrigin: number,
    ): TickAndProjectResult | null => {
      try {
        const result = batchEvaluator.tickAndProject(outputs, tickTime, projectionMode, projectEnd, numFutureSamples, projectionOrigin);
        lastKnownTickAndProjectSupport = batchEvaluator.supportsTickAndProject();
        return result;
      } catch (error) {
        lastKnownTickAndProjectSupport = batchEvaluator.supportsTickAndProject();
        throw new Error(`uSEQ WASM tick_and_project failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    supportsTimeWindow: batchEvaluator.supportsTimeWindow(),
    supportsTickAndProject: batchEvaluator.supportsTickAndProject(),
    supportsProbeSlots: probes.supported,
    probeSet: probes.set,
    probeSample: probes.sample,
    probeFree: probes.free,
    release: (): void => {
      batchEvaluator.release();
      probes.release();
    }
  };
}

/**
 * Instantiate a **fresh, unregistered** WASM module.
 *
 * Every call runs `createModule()` again, so the returned module has its own
 * linear memory and its own `SignalEngine`. It is deliberately not memoised,
 * not stored in `runtimePromise`, and never published to
 * `globalThis.__useqWasmRuntime` — nothing the live session reads can observe
 * it. This is the isolation seam the conformance-witness runner requires
 * (`docs/specs/witnesses.md` §2.3); the live engine must never evaluate
 * witness code, even with cleanup afterwards.
 *
 * The caller owns the module: it must call `useq_init()` before use and drop
 * the reference when finished.
 */
export async function createIsolatedWasmModule(): Promise<EmscriptenModule> {
  await loadWasmScript();

  const factory = window.createModule;
  if (typeof factory !== "function") {
    throw new Error("uSEQ WASM bundle did not expose createModule()");
  }

  const module = await factory();
  assertWasmAbi(module);
  return module;
}

export function ensureUseqWasmLoaded(): Promise<UseqRuntime> {
  if (!runtimePromise) {
    runtimePromise = instantiateInterpreter().catch((error) => {
      scriptLoadPromise = null;
      runtimePromise = null;
      lastKnownTimeWindowSupport = false;
      lastKnownTickAndProjectSupport = false;
      console.error("Failed to load uSEQ WASM interpreter", error);
      throw error;
    });
  }
  return runtimePromise;
}

async function evalCodeInUseqWasm(
  code: string,
  options?: { publish?: boolean },
): Promise<string | null> {
  if (!isUseqWasmEnabled()) {
    return null;
  }

  const runtime = await ensureUseqWasmLoaded();
  const result = runtime.evaluate(code);

  if (options?.publish !== false) {
    try {
      codeEvaluatedChannel.publish({ code });
    } catch (error) {
      dbg(`useqWasmInterpreter: failed to publish codeEvaluated event: ${error}`);
    }
  }

  return result;
}

export async function evalInUseqWasm(code: string): Promise<string | null> {
  return evalCodeInUseqWasm(code, { publish: true });
}

export async function evalInUseqWasmSilently(
  code: string,
): Promise<string | null> {
  return evalCodeInUseqWasm(code, { publish: false });
}

export async function syncWasmTransportState(state: TransportState): Promise<string | null> {
  const command = TRANSPORT_STATE_TO_COMMAND[state];
  if (!command) {
    return null;
  }
  return evalInUseqWasm(command);
}

export async function updateUseqWasmTime(timeSeconds: number): Promise<void> {
  if (!isUseqWasmEnabled()) {
    return;
  }
  const runtime = await ensureUseqWasmLoaded();
  runtime.updateTime(timeSeconds);
}

export async function evalOutputAtTime(name: string, timeSeconds: number): Promise<number> {
  if (!isUseqWasmEnabled()) {
    return Number.NaN;
  }
  const runtime = await ensureUseqWasmLoaded();
  return runtime.evaluateOutputAtTime(name, timeSeconds);
}

/**
 * Evaluate multiple outputs across a time window
 */
export async function evalOutputsInTimeWindow(
  outputs: string[],
  startTime: number,
  endTime: number,
  numSamples: number
): Promise<SampleSeriesMap> {
  if (!isUseqWasmEnabled()) {
    return new Map();
  }

  const runtime = await ensureUseqWasmLoaded();
  const sampleMap = runtime.evaluateOutputsTimeWindow(outputs, startTime, endTime, numSamples);
  if (!(sampleMap instanceof Map)) {
    throw new Error("uSEQ WASM batch evaluation returned unexpected data");
  }
  return sampleMap;
}

/**
 * Combined tick + future projection in a single WASM boundary crossing.
 *
 * Phase 1 (state-advancing tick at `tickTime`) is identical to a
 * `evalOutputsInTimeWindow([...outputs], tickTime, tickTime, 1)` call,
 * except that it doesn't allocate a JSON intermediate or a fresh sample
 * map. Phase 2 (projection) runs with save/restore around it so live
 * state isn't corrupted.
 *
 * Returns `null` when the optional `useq_tick_and_project` export isn't
 * available — callers should fall back to the legacy 3-call path.
 *
 * See `docs/specs/visualisation.md` §5.2 / §7.2.
 */
export async function tickAndProjectOutputs(
  outputs: string[],
  tickTime: number,
  projectionMode: ProjectionMode,
  projectEnd: number,
  numFutureSamples: number,
  projectionOrigin: number,
): Promise<TickAndProjectResult | null> {
  if (!isUseqWasmEnabled()) {
    return null;
  }

  const runtime = await ensureUseqWasmLoaded();
  return runtime.tickAndProjectOutputs(outputs, tickTime, projectionMode, projectEnd, numFutureSamples, projectionOrigin);
}

export async function probeSet(slot: number, code: string): Promise<number> {
  if (!isUseqWasmEnabled()) return -1;
  const runtime = await ensureUseqWasmLoaded();
  return runtime.probeSet(slot, code);
}

export async function probeSample(
  slot: number,
  startTime: number,
  endTime: number,
  count: number,
): Promise<Float64Array | null> {
  if (!isUseqWasmEnabled()) return null;
  const runtime = await ensureUseqWasmLoaded();
  return runtime.probeSample(slot, startTime, endTime, count);
}

export async function probeFree(slot: number): Promise<void> {
  if (!isUseqWasmEnabled()) return;
  const runtime = await ensureUseqWasmLoaded();
  runtime.probeFree(slot);
}

/**
 * Capability report for a WasmRuntimePort instance.
 *
 * Allows callers to discover which operations are actually available before
 * attempting them, without relying on try/catch at call sites.
 */
export interface WasmCapabilities {
  /** Whether the WASM runtime is enabled in user settings. */
  readonly enabled: boolean;
  /** Whether eval operations are available. */
  readonly supportsEval: boolean;
  /** Whether time-window batch evaluation is available. */
  readonly supportsTimeWindow: boolean;
  /** Whether the combined tick + project export is available. */
  readonly supportsTickAndProject: boolean;
}

/**
 * Typed boundary for the uSEQ WASM interpreter capabilities.
 *
 * Consumers should depend on this interface rather than importing individual
 * functions directly, so the concrete implementation can be replaced or mocked.
 */
export interface WasmRuntimePort {
  /** Report what this port can actually do at runtime. */
  capabilities(): WasmCapabilities;
  /** Evaluate uSEQ Lisp code and return the result string, or null if WASM is disabled. */
  eval(code: string): Promise<string | null>;
  /** Sync the hardware transport state to the WASM interpreter. */
  syncTransportState(state: TransportState): Promise<string | null>;
  /** Advance the WASM interpreter's internal clock. */
  updateTime(timeSeconds: number): Promise<void>;
  /** Evaluate a single named output at a given time. */
  evalOutputAtTime(name: string, timeSeconds: number): Promise<number>;
  /** Evaluate multiple outputs across a time window. */
  evalOutputsInTimeWindow(
    outputs: string[],
    startTime: number,
    endTime: number,
    numSamples: number
  ): Promise<SampleSeriesMap>;

  /**
   * Combined tick + future projection in a single boundary crossing.
   *
   * Returns `null` when the export isn't available — callers must fall
   * back to the legacy `evalOutputAtTime` + `evalOutputsInTimeWindow`
   * path. See `docs/specs/visualisation.md` §5.2 / §7.2.
   */
  tickAndProject(
    outputs: string[],
    tickTime: number,
    projectionMode: ProjectionMode,
    projectEnd: number,
    numFutureSamples: number,
    projectionOrigin: number,
  ): Promise<TickAndProjectResult | null>;
}

/** Concrete WasmRuntimePort backed by the embedded WASM interpreter. */
export const wasmRuntimePort: WasmRuntimePort = {
  capabilities(): WasmCapabilities {
    const enabled = isUseqWasmEnabled();
    return {
      enabled,
      supportsEval: enabled,
      supportsTimeWindow: enabled && lastKnownTimeWindowSupport,
      supportsTickAndProject: enabled && lastKnownTickAndProjectSupport,
    };
  },
  eval: evalInUseqWasm,
  syncTransportState: syncWasmTransportState,
  updateTime: updateUseqWasmTime,
  evalOutputAtTime,
  evalOutputsInTimeWindow,
  tickAndProject: tickAndProjectOutputs,
};

// ---------------------------------------------------------------------------
// Live-edit slot ABI bindings
// ---------------------------------------------------------------------------

/**
 * Inject live-edit slot values into the WASM interpreter.
 *
 * @param values - Record of slot id → numeric value.
 * @returns Count of successfully applied writes (0 if unavailable).
 */
export async function setLiveInputs(values: Record<string, number>): Promise<number> {
  if (!isUseqWasmEnabled()) return 0;

  // Ensure WASM is loaded (this sets up __useqWasmRuntime)
  await ensureUseqWasmLoaded();
  const global = (globalThis as { __useqWasmRuntime?: UseqWasmRuntimeGlobal }).__useqWasmRuntime;
  if (!global?.useq_set_live_inputs) return 0;

  try {
    const json = JSON.stringify(values);
    const applied = global.useq_set_live_inputs(json);
    lastKnownLiveInputsSupport = true;
    return applied;
  } catch {
    lastKnownLiveInputsSupport = false;
    return 0;
  }
}

/**
 * Forward a single analog hardware input value to the WASM interpreter
 * via `useq_set_input_value(channel, value)`.
 *
 * Silently no-ops when the runtime is disabled, the export is missing,
 * or the underlying call throws.
 */
export async function setHwInputValue(index: number, value: number): Promise<void> {
  if (!isUseqWasmEnabled()) return;
  await ensureUseqWasmLoaded();
  const global = (globalThis as { __useqWasmRuntime?: UseqWasmRuntimeGlobal }).__useqWasmRuntime;
  if (!global?.useq_set_input_value) return;
  try {
    global.useq_set_input_value(Number(index) | 0, Number(value) || 0);
  } catch {
    // Best-effort forward — input updates are not critical to correctness.
  }
}

/** Metadata for a live-edit slot returned from the WASM runtime. */
export interface LiveSlotMetadata {
  id: string;
  value: number;
  min: number;
  max: number;
  seed: number;
}

/**
 * Query all allocated live-edit slots from the WASM interpreter.
 *
 * @returns Array of slot metadata, or empty if unavailable.
 */
export async function getLiveSlots(): Promise<LiveSlotMetadata[]> {
  if (!isUseqWasmEnabled()) return [];

  // Ensure WASM is loaded (this sets up __useqWasmRuntime)
  await ensureUseqWasmLoaded();
  const global = (globalThis as { __useqWasmRuntime?: UseqWasmRuntimeGlobal }).__useqWasmRuntime;
  if (!global?.useq_get_live_slots) return [];

  try {
    const json = global.useq_get_live_slots();
    if (!json) return [];
    return JSON.parse(json) as LiveSlotMetadata[];
  } catch {
    return [];
  }
}

/** Whether the live-inputs ABI is available. */
export function supportsLiveInputs(): boolean {
  return lastKnownLiveInputsSupport;
}

// ---------------------------------------------------------------------------
// Output Classification (visualisation.md §7.3–7.4)
// ---------------------------------------------------------------------------

import type { OutputClassification } from "../contracts/runtimePorts";
import { OutputClass } from "../contracts/runtimePorts";

export async function readOutputClassifications(): Promise<OutputClassification | null> {
  if (!isUseqWasmEnabled()) return null;
  await ensureUseqWasmLoaded();
  if (!classificationsFnStored) return null;

  try {
    const json = classificationsFnStored();
    if (!json) return null;
    const raw = JSON.parse(json) as number[];
    if (!Array.isArray(raw)) return null;

    const classes: OutputClass[] = raw.map((v) => {
      if (v === 1) return OutputClass.Pure;
      if (v === 2) return OutputClass.InputDep;
      if (v === 3) return OutputClass.Stateful;
      return OutputClass.Inactive;
    });

    const inputMasks: number[] = [];
    if (dependenciesFnStored) {
      for (let i = 0; i < raw.length; i++) {
        inputMasks.push(dependenciesFnStored(i));
      }
    } else {
      for (let i = 0; i < raw.length; i++) {
        inputMasks.push(0);
      }
    }

    return { classes, inputMasks };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Diagnostic type — re-exported from canonical location
// ---------------------------------------------------------------------------
// The canonical definition lives in `src/contracts/runtimeTypes.ts`.
// Re-exported here for backward compatibility with existing consumers.

export type { UseqDiagnostic } from "../contracts/runtimeTypes";
