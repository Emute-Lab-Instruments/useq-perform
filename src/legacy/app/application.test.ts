import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn();
const ensureUseqWasmLoaded = vi.fn();
const announceRuntimeSession = vi.fn();
const checkForSavedPortAndMaybeConnect = vi.fn();
const initializeMockControls = vi.fn();
const startMockTimeGenerator = vi.fn();
const registerVisualisation = vi.fn();
const toggleSerialVis = vi.fn(() => true);
const { urlParamState } = vi.hoisted(() => ({
  urlParamState: { noModuleMode: true },
}));

vi.mock("../../utils/consoleStore.ts", () => ({
  post,
}));

vi.mock("../io/serialComms.ts", () => ({
  announceRuntimeSession,
  checkForSavedPortAndMaybeConnect,
}));

vi.mock("../io/useqWasmInterpreter.ts", () => ({
  ensureUseqWasmLoaded,
}));

vi.mock("../urlParams.ts", () => ({
  get noModuleMode() {
    return urlParamState.noModuleMode;
  },
}));

vi.mock("../io/websocketServer.ts", () => ({
  startWebSocketServer: vi.fn(),
  stopWebSocketServer: vi.fn(),
}));

vi.mock("../../ui/adapters/modal.tsx", () => ({
  showModal: vi.fn(),
}));

vi.mock("../io/mockControlInputs.ts", () => ({
  initializeMockControls,
}));

vi.mock("../io/mockTimeGenerator.ts", () => ({
  startMockTimeGenerator,
}));

vi.mock("../ui/serialVis/visualisationController.ts", () => ({
  registerVisualisation,
}));

vi.mock("../editors/editorConfig.ts", () => ({
  toggleSerialVis,
}));

describe("application no-module startup", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    urlParamState.noModuleMode = true;
    document.body.innerHTML = '<div id="panel-vis" style="display:block"></div><canvas id="serialcanvas"></canvas>';
  });

  it("boots the browser-local runtime without touching hardware reconnect flow", async () => {
    const { createApp } = await import("./application.ts");
    const app = createApp(null, {
      areInBrowser: true,
      areInDesktopApp: false,
      isWebSerialAvailable: true,
      isInDevmode: false,
      userSettings: {
        name: "Test User",
        runtime: { startLocallyWithoutHardware: true },
        wasm: { enabled: true },
      },
      urlParams: { noModuleMode: "true" },
    });

    await app.start();

    expect(ensureUseqWasmLoaded).toHaveBeenCalledTimes(1);
    expect(announceRuntimeSession).toHaveBeenCalledTimes(1);
    expect(initializeMockControls).toHaveBeenCalledTimes(1);
    expect(startMockTimeGenerator).toHaveBeenCalledTimes(1);
    expect(registerVisualisation).toHaveBeenNthCalledWith(1, "a1", "(a1 bar)");
    expect(registerVisualisation).toHaveBeenNthCalledWith(2, "a2", "(a2 (slow 2 bar))");
    expect(checkForSavedPortAndMaybeConnect).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(
      "No-module mode active: expressions will run on the in-browser interpreter."
    );
  });

  it("starts browser-local runtime first and still kicks off reconnect checks in normal mode", async () => {
    urlParamState.noModuleMode = false;

    const { createApp } = await import("./application.ts");
    const app = createApp(null, {
      areInBrowser: true,
      areInDesktopApp: false,
      isWebSerialAvailable: true,
      isInDevmode: false,
      userSettings: {
        name: "Test User",
        runtime: { startLocallyWithoutHardware: true },
        wasm: { enabled: true },
      },
      urlParams: {},
    });

    await app.start();

    expect(ensureUseqWasmLoaded).toHaveBeenCalledTimes(1);
    expect(checkForSavedPortAndMaybeConnect).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      "Browser-local uSEQ is ready. You can start editing and evaluating before hardware reconnect finishes."
    );
  });
});
