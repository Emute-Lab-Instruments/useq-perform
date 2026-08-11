/**
 * Public visualisation session seam.
 *
 * Hardware remains authoritative for outputs in `both` mode. The WASM side is
 * a best-effort shadow used for visualisation and probes; shadow work never
 * backpressures hardware transport. Internal clock, sampler, buffers, store,
 * and drift-resync modules are deliberately hidden behind these four facets.
 */
import type { WebSerialHostPort, WasmRuntimePort } from "../contracts/runtimePorts.ts";
import { visStore } from "../utils/visualisationStore.ts";
import {
  getLocalTime,
  isLocalTimeActive,
  notifyExternalTimeUpdate,
  pauseVisualisationRender,
  registerVisualisationRenderHook,
  requestVisualisationRender,
  resetLocalTime,
  setLocalTimeMode,
  setVisualisationNowSource,
  startVisualisationRuntime,
  stopVisualisationRuntime,
  _drainForTests,
  beginVisualisationRuntimeLifecycle,
  type VisualisationNowSource,
  type VisualisationRenderHook,
} from "./visualisationRuntime.ts";
import {
  getPastBufferSampleRate,
  getRenderData,
  isExpressionVisualised,
  notifyExpressionEvaluated,
  refreshVisualisedExpression,
  registerVisualisation,
  reportExpressionColor,
  setPastBufferSampleRate,
  toggleVisualisation,
  unregisterVisualisation,
  invalidateFutureProjections,
} from "./visualisationSampler.ts";
import {
  getStateSyncCount,
  initStateSyncOrchestrator,
  isStateSyncInProgress,
  teardownStateSyncOrchestrator,
} from "./stateSyncOrchestrator.ts";
import {
  getActiveWasmRuntimePort,
  getRuntimeSessionState,
  hasActiveWasmRuntimePort,
} from "../runtime/runtimeCoordinator.ts";
import { shouldUseWasmShadow } from "../runtime/runtimeCompatibility.ts";

export type {
  VisExpression,
  VisSample,
  VisSettings,
  VisualisationState,
} from "../utils/visualisationStore.ts";
export type { OutputRenderData } from "./visualisationBuffers.ts";
export { DIGITAL_CHANNELS, SERIAL_VIS_CHANNELS } from "../utils/visualisationStore.ts";

let disposed = false;
let probeGeneration = 0;

function probePort(): WasmRuntimePort | null {
  if (disposed || !getRuntimeSessionState().session.wasmEnabled) return null;
  if (!hasActiveWasmRuntimePort() || !shouldUseWasmShadow()) return null;
  const port = getActiveWasmRuntimePort();
  return port.capabilities().available ? port : null;
}

export const visualisationSession = Object.freeze({
  begin(): void {
    disposed = false;
    beginVisualisationRuntimeLifecycle();
  },

  dispose(): void {
    if (disposed) return;
    disposed = true;
    probeGeneration += 1;
    teardownStateSyncOrchestrator();
    stopVisualisationRuntime();
    setLocalTimeMode(false);
    pauseVisualisationRender();
    registerVisualisationRenderHook(null);
  },

  state: visStore,

  clock: Object.freeze({
    startRuntime: startVisualisationRuntime,
    stopRuntime: stopVisualisationRuntime,
    setLocal: setLocalTimeMode,
    reset: resetLocalTime,
    isLocal: isLocalTimeActive,
    localTime: getLocalTime,
    acceptHardwareTime: notifyExternalTimeUpdate,
    setNowSource: setVisualisationNowSource,
    drainForTests: _drainForTests,
  }),

  expressions: Object.freeze({
    register: registerVisualisation,
    unregister: unregisterVisualisation,
    toggle: toggleVisualisation,
    isVisualised: isExpressionVisualised,
    refresh: refreshVisualisedExpression,
    notifyEvaluated: notifyExpressionEvaluated,
    reportColor: reportExpressionColor,
  }),

  view: Object.freeze({
    attach(hook: VisualisationRenderHook | null): void {
      registerVisualisationRenderHook(hook);
    },
    request: requestVisualisationRender,
    pause: pauseVisualisationRender,
    readOutput: getRenderData,
    getPastSampleRate: getPastBufferSampleRate,
    setPastSampleRate: setPastBufferSampleRate,
  }),

  probes: Object.freeze({
    available(): boolean {
      return probePort() !== null;
    },
    async evaluate(code: string): Promise<string | null> {
      const port = probePort();
      return port ? port.evalCodeSilently(code) : null;
    },
    async evaluateOutput(name: string, time: number): Promise<number> {
      const port = probePort();
      return port ? port.evalOutputAtTime(name, time) : Number.NaN;
    },
    async set(slot: number, code: string): Promise<number> {
      const port = probePort();
      return port ? port.probeSet(slot, code) : -1;
    },
    async sample(
      slot: number,
      start: number,
      end: number,
      count: number,
    ): Promise<Float64Array | null> {
      const port = probePort();
      if (!port) return null;
      const generation = probeGeneration;
      const samples = await port.probeSample(slot, start, end, count);
      return disposed || generation !== probeGeneration ? null : samples;
    },
    async free(slot: number): Promise<void> {
      const port = probePort();
      if (port) await port.probeFree(slot);
    },
  }),

  shadow: Object.freeze({
    start(hardwarePort: WebSerialHostPort, wasmPort: WasmRuntimePort): void {
      teardownStateSyncOrchestrator();
      initStateSyncOrchestrator(hardwarePort, wasmPort);
    },
    stop: teardownStateSyncOrchestrator,
    invalidate: invalidateFutureProjections,
    isSyncing: isStateSyncInProgress,
    syncCount: getStateSyncCount,
  }),
});

export type { VisualisationNowSource, VisualisationRenderHook };
