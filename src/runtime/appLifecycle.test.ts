import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveBootstrapPlan } from "./bootstrap.ts";

const {
  post,
  ensureUseqWasmLoaded,
  announceRuntimeSession,
  checkForSavedPortAndMaybeConnect,
  initializeMockControls,
  startInternalClockMock,
  registerVisualisation,
  startVisualisationShadow,
  stopVisualisationShadow,
  disposeVisualisationSession,
  showVisualisationPanel,
  workerPort,
  runtimeSnapshot,
  runtimeSubscribers,
} = vi.hoisted(() => ({
  post: vi.fn(),
  ensureUseqWasmLoaded: vi.fn(),
  announceRuntimeSession: vi.fn(),
  checkForSavedPortAndMaybeConnect: vi.fn(),
  initializeMockControls: vi.fn(),
  startInternalClockMock: vi.fn(),
  registerVisualisation: vi.fn(),
  startVisualisationShadow: vi.fn(),
  stopVisualisationShadow: vi.fn(),
  disposeVisualisationSession: vi.fn(),
  showVisualisationPanel: vi.fn(() => true),
  workerPort: {
    kind: "wasm-runtime" as const,
    capabilities: vi.fn(() => ({ available: true, enabled: true, loaded: true })),
    ensureLoaded: vi.fn(),
    sendTransportCommand: vi.fn(),
    setFailureMode: vi.fn(async () => true),
    evalCodeSilently: vi.fn(),
  },
  runtimeSnapshot: {
    connected: false,
    protocolMode: "json" as const,
    session: {
      hasHardwareConnection: false,
      noModuleMode: false,
      wasmEnabled: true,
      connectionMode: "browser" as const,
      transportMode: "wasm" as const,
    },
  },
  runtimeSubscribers: [] as Array<(state: any) => void>,
}));

vi.mock("../utils/consoleStore.ts", () => ({
  post,
  setMaxConsoleLines: vi.fn(),
}));

vi.mock("../transport/connector.ts", () => ({
  checkForSavedPortAndMaybeConnect,
}));

vi.mock("./runtimeCoordinator.ts", () => ({
  getActiveWasmRuntimePort: () => ({
    ...workerPort,
    ensureLoaded: ensureUseqWasmLoaded,
  }),
  hasActiveWasmRuntimePort: () => true,
}));

vi.mock("../ui/adapters/modal.tsx", () => ({
  showModal: vi.fn(),
  showConfirmModal: vi.fn(),
}));

vi.mock("../effects/mockControlInputs.ts", () => ({
  initializeMockControls,
}));

vi.mock("../effects/transportClock.ts", () => ({
  startInternalClock: startInternalClockMock,
}));

vi.mock("../effects/visualisationSession.ts", () => ({
  visualisationSession: {
    dispose: disposeVisualisationSession,
    expressions: { register: registerVisualisation },
    clock: { setLocal: vi.fn() },
    shadow: {
      start: startVisualisationShadow,
      stop: stopVisualisationShadow,
    },
  },
}));

vi.mock("../ui/adapters/visualisationPanel", () => ({
  showVisualisationPanel,
}));

vi.mock("./runtimeService.ts", () => ({
  announceRuntimeSession,
  getRuntimeServiceSnapshot: () => runtimeSnapshot,
  subscribeRuntimeService: (listener: (state: typeof runtimeSnapshot) => void) => {
    runtimeSubscribers.push(listener);
    return vi.fn();
  },
}));

describe("application no-module startup", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    runtimeSubscribers.length = 0;
    runtimeSnapshot.session.wasmEnabled = true;
    document.body.innerHTML = '<div id="panel-vis" style="display:block"></div>';
  });

  it("boots the browser-local runtime without touching hardware reconnect flow", async () => {
    const { createApp } = await import("./appLifecycle.ts");
    const environmentState = {
      areInBrowser: true,
      areInDesktopApp: false,
      isWebSerialAvailable: true,
      isInDevmode: false,
      startupFlags: {
        debug: false,
        devmode: false,
        disableWebSerial: false,
        noModuleMode: true,
        nosave: false,
        params: { noModuleMode: "true" },
      },
      userSettings: {
        name: "Test User",
        runtime: { startLocallyWithoutHardware: true },
        wasm: { enabled: true },
      },
      urlParams: { noModuleMode: "true" },
    };
    const plan = resolveBootstrapPlan({
      noModuleMode: true,
      isWebSerialAvailable: true,
      wasmEnabled: true,
      startLocallyWithoutHardware: true,
    });
    const app = createApp(null, environmentState, plan);

    await app.start();
    await vi.waitFor(() => expect(startInternalClockMock).toHaveBeenCalledTimes(1));

    expect(ensureUseqWasmLoaded).toHaveBeenCalledTimes(1);
    expect(announceRuntimeSession).toHaveBeenCalledTimes(1);
    expect(initializeMockControls).toHaveBeenCalledTimes(1);
    expect(startInternalClockMock).toHaveBeenCalledTimes(1);
    expect(showVisualisationPanel).toHaveBeenCalledTimes(1);
    expect(registerVisualisation).toHaveBeenNthCalledWith(1, "a1", "(a1 bar)");
    expect(registerVisualisation).toHaveBeenNthCalledWith(2, "a2", "(a2 (slow 2 bar))");
    expect(checkForSavedPortAndMaybeConnect).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(
      "No-module mode active: expressions will run on the in-browser interpreter."
    );
  });

  it("starts browser-local runtime first and still kicks off reconnect checks in normal mode", async () => {
    const { createApp } = await import("./appLifecycle.ts");
    const environmentState = {
      areInBrowser: true,
      areInDesktopApp: false,
      isWebSerialAvailable: true,
      isInDevmode: false,
      startupFlags: {
        debug: false,
        devmode: false,
        disableWebSerial: false,
        noModuleMode: false,
        nosave: false,
        params: {},
      },
      userSettings: {
        name: "Test User",
        runtime: { startLocallyWithoutHardware: true },
        wasm: { enabled: true },
      },
      urlParams: {},
    };
    const plan = resolveBootstrapPlan({
      noModuleMode: false,
      isWebSerialAvailable: true,
      wasmEnabled: true,
      startLocallyWithoutHardware: true,
    });
    const app = createApp(null, environmentState, plan);

    await app.start();
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith(
      "Browser-local uSEQ is ready. You can start editing and evaluating before hardware reconnect finishes."
    ));

    expect(ensureUseqWasmLoaded).toHaveBeenCalledTimes(1);
    expect(checkForSavedPortAndMaybeConnect).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      "Browser-local uSEQ is ready. You can start editing and evaluating before hardware reconnect finishes."
    );
  });

  it("starts hardware/UI lifecycle before Worker readiness and activates WASM later", async () => {
    runtimeSnapshot.session.wasmEnabled = false;
    const { createApp } = await import("./appLifecycle.ts");
    const environmentState = {
      areInBrowser: true,
      areInDesktopApp: false,
      isWebSerialAvailable: true,
      isInDevmode: false,
      startupFlags: {
        debug: false,
        devmode: false,
        disableWebSerial: false,
        noModuleMode: false,
        nosave: false,
        params: {},
      },
      userSettings: {
        name: "Test User",
        runtime: { startLocallyWithoutHardware: true },
        wasm: { enabled: true },
      },
      urlParams: {},
    };
    const plan = resolveBootstrapPlan({
      noModuleMode: false,
      isWebSerialAvailable: true,
      wasmEnabled: true,
      startLocallyWithoutHardware: true,
    });
    const app = createApp(null, environmentState, plan);

    await app.start();
    expect(checkForSavedPortAndMaybeConnect).toHaveBeenCalledTimes(1);
    expect(ensureUseqWasmLoaded).not.toHaveBeenCalled();

    runtimeSnapshot.session.wasmEnabled = true;
    runtimeSubscribers.forEach((listener) => listener(runtimeSnapshot));
    await vi.waitFor(() => expect(ensureUseqWasmLoaded).toHaveBeenCalledTimes(1));
  });

  it("releases the UI boundary when the application stops", async () => {
    const { createApp } = await import("./appLifecycle.ts");
    const dispose = vi.fn();
    const environmentState = {
      areInBrowser: true,
      areInDesktopApp: false,
      isWebSerialAvailable: true,
      isInDevmode: false,
      startupFlags: {
        debug: false,
        devmode: false,
        disableWebSerial: false,
        noModuleMode: false,
        nosave: false,
        params: {},
      },
      userSettings: {
        name: "Test User",
        runtime: { startLocallyWithoutHardware: false },
        wasm: { enabled: false },
      },
      urlParams: {},
    };
    const plan = resolveBootstrapPlan({
      noModuleMode: false,
      isWebSerialAvailable: true,
      wasmEnabled: false,
      startLocallyWithoutHardware: false,
    });

    const app = createApp({ dispose }, environmentState, plan);
    await app.stop();
    await app.stop();

    expect(disposeVisualisationSession).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
