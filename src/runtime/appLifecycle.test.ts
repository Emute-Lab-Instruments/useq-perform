import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveBootstrapPlan } from "./bootstrapPlan.ts";

const post = vi.fn();
const ensureUseqWasmLoaded = vi.fn();
const announceRuntimeSession = vi.fn();
const checkForSavedPortAndMaybeConnect = vi.fn();
const initializeMockControls = vi.fn();
const startMockTimeGenerator = vi.fn();
const registerVisualisation = vi.fn();
const showVisualisationPanel = vi.fn(() => true);

vi.mock("../utils/consoleStore.ts", () => ({
  post,
}));

vi.mock("../transport/connector.ts", () => ({
  checkForSavedPortAndMaybeConnect,
}));

vi.mock("./wasmInterpreter.ts", () => ({
  ensureUseqWasmLoaded,
}));

vi.mock("../effects/devmodeWebSocketServer.ts", () => ({
  startWebSocketServer: vi.fn(),
  stopWebSocketServer: vi.fn(),
}));

vi.mock("../ui/adapters/modal.tsx", () => ({
  showModal: vi.fn(),
}));

vi.mock("../effects/mockControlInputs.ts", () => ({
  initializeMockControls,
}));

vi.mock("../effects/localClock.ts", () => ({
  startLocalClock: startMockTimeGenerator,
}));

vi.mock("../effects/visualisationSampler.ts", () => ({
  registerVisualisation,
}));

vi.mock("../ui/adapters/visualisationPanel", () => ({
  showVisualisationPanel,
}));

vi.mock("./runtimeService.ts", () => ({
  announceRuntimeSession,
}));

describe("application no-module startup", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="panel-vis" style="display:block"></div><canvas id="serialcanvas"></canvas>';
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

    expect(ensureUseqWasmLoaded).toHaveBeenCalledTimes(1);
    expect(announceRuntimeSession).toHaveBeenCalledTimes(1);
    expect(initializeMockControls).toHaveBeenCalledTimes(1);
    expect(startMockTimeGenerator).toHaveBeenCalledTimes(1);
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

    expect(ensureUseqWasmLoaded).toHaveBeenCalledTimes(1);
    expect(checkForSavedPortAndMaybeConnect).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      "Browser-local uSEQ is ready. You can start editing and evaluating before hardware reconnect finishes."
    );
  });
});
