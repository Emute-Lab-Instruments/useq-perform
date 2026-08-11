import { beforeEach, describe, expect, it, vi } from "vitest";

const examineEnvironment = vi.fn();
const startApp = vi.fn();
const createApp = vi.fn(() => ({ start: startApp }));
const loadConfigurationWithMetadata = vi.fn();
const seedBootstrapDiagnostics = vi.fn();
const publishDiagnosticsSnapshot = vi.fn();
const reportBootstrapFailure = vi.fn();
const replaceSettings = vi.fn();
const getSettings = vi.fn(() => ({
  runtime: { startLocallyWithoutHardware: true },
  wasm: { enabled: true },
}));
const bootstrapRuntimeSession = vi.fn(() => ({
  connected: false,
  protocolMode: "legacy",
  session: {
    hasHardwareConnection: false,
    noModuleMode: false,
    wasmEnabled: true,
    connectionMode: "none",
    transportMode: "wasm",
  },
}));

// Mocks for createAppUI dependencies (now inlined in bootstrap.ts)
const initEditorPanel = vi.fn(() => ({ view: { id: "editor" } }));
const createGamepadPipeline = vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), dispose: vi.fn() }));
const bindGamepadNavigation = vi.fn(() => ({ dispose: vi.fn() }));
const createMenuDispatcher = vi.fn(() => ({
  bind: vi.fn(() => vi.fn()),
  handleAction: vi.fn(),
  handleAxis: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
}));
const setEditorSession = vi.fn();
const registerVisualisationPanel = vi.fn();
const disposeApplicationRoot = vi.fn();
const mountApplicationRoot = vi.fn(() => ({ dispose: disposeApplicationRoot }));
const ensureWorkerLoaded = vi.fn(async () => undefined);
const createWasmRuntimeWorkerPort = vi.fn(() => ({
  kind: "wasm-runtime",
  ensureLoaded: ensureWorkerLoaded,
  capabilities: () => ({ available: true }),
  dispose: vi.fn(),
}));

vi.mock("./runtime/appSettingsRepository.ts", () => ({
  loadConfigurationWithMetadata,
  getAppSettings: getSettings,
}));

vi.mock("./runtime/startupContext.ts", () => ({
  examineEnvironment,
  getStartupFlagsSnapshot: vi.fn(() => ({
    debug: false,
    devmode: false,
    disableWebSerial: false,
    noModuleMode: false,
    nosave: false,
    params: {},
  })),
  setStartupFlags: vi.fn((flags: any) => flags),
  setEnvironmentCapabilities: vi.fn(),
  applyStartupContext: vi.fn(),
  isLocalStorageBypassedInStartupContext: vi.fn(() => false),
  resetStartupContextForTests: vi.fn(),
}));

vi.mock("./runtime/appLifecycle.ts", () => ({
  createApp,
}));

vi.mock("./runtime/wasmRuntimeWorkerPort.ts", () => ({
  createWasmRuntimeWorkerPort,
}));

vi.mock("./runtime/runtimeDiagnostics.ts", () => ({
  seedBootstrapDiagnostics,
  publishDiagnosticsSnapshot,
  reportBootstrapFailure,
}));

vi.mock("./runtime/runtimeService.ts", () => ({
  bootstrapRuntimeSession,
  replaceSettings,
  getSettings,
}));

// Mock createAppUI's inlined dependencies
vi.mock("./lib/gamepad/index.ts", () => ({
  createGamepadPipeline,
}));

vi.mock("./editors/gamepadNavigation.ts", () => ({
  bindGamepadNavigation,
  hideSystemCursor: vi.fn(),
  readGamepadEditorContext: vi.fn(() => ({
    insertionMode: false,
    cursorOnLeafAtom: false,
    cursorNodeKind: null,
  })),
}));

vi.mock("./editors/commands/actionHandlers.ts", () => ({
  executeAction: vi.fn(),
}));

vi.mock("./lib/menu/dispatcher.ts", () => ({
  createMenuDispatcher,
}));

vi.mock("./lib/menu/store.ts", () => ({
  menuState: vi.fn(() => ({ phase: "closed" })),
  dispatchMenuInput: vi.fn(),
  isMenuOpen: vi.fn(() => false),
}));

vi.mock("./lib/menu/manifest.ts", () => ({
  getCachedManifest: vi.fn(() => null),
}));

vi.mock("./lib/mainMenu/store.ts", () => ({
  openMainMenu: vi.fn(),
  closeMainMenu: vi.fn(),
  isMainMenuOpen: vi.fn(() => false),
  dispatchMainMenu: vi.fn(),
  mainMenuState: vi.fn(() => ({ phase: "closed" })),
}));

vi.mock("./ui/mainMenu/menuItems.ts", () => ({
  resolveItems: vi.fn(() => []),
}));

vi.mock("./lib/editorStore.ts", () => ({
  setEditorSession,
  editorSession: { view: null },
}));

vi.mock("./editors/editorLifecycle.ts", () => ({
  initEditorPanel,
  disposeEditorLifecycle: vi.fn(),
}));

vi.mock("./ui/ApplicationRoot.tsx", () => ({ mountApplicationRoot }));

vi.mock("./ui/adapters/visualisationPanel", () => ({
  registerVisualisationPanel,
}));

vi.mock("./effects/liveEditRuntime.ts", () => ({
  liveEditStore: {},
  installPageLifecycleHandlers: vi.fn(() => vi.fn()),
}));

vi.mock("./editors/extensions/liveEdit/widgetStoreBridge.ts", () => ({
  attachLiveEditStoreBridge: vi.fn(),
  detachLiveEditStoreBridge: vi.fn(),
}));


describe("bootstrap (via startLegacyApp re-export)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("Worker", vi.fn());

    // Set up DOM elements that createAppUI expects
    document.body.innerHTML = `
      <div id="panel-main-editor"></div>
      <div id="panel-vis"></div>
      <div id="status-bar"></div>
    `;

    loadConfigurationWithMetadata.mockResolvedValue({
      config: { editor: { code: "(play)" } },
      settingsSources: ["defaults", "local-storage"],
    });
    examineEnvironment.mockResolvedValue({
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
      audioCapabilities: {
        schemaVersion: 1,
        crossOriginIsolated: false,
        sharedArrayBufferAvailable: false,
        audioWorkletAvailable: false,
        workerAvailable: false,
        sharedWebAssemblyMemoryAvailable: false,
        audioCapable: false,
        reasons: [],
        capturedAt: 0,
      },
    });
    startApp.mockResolvedValue(undefined);
  });

  it("loads configuration, publishes diagnostics, and starts the app", async () => {
    const { startLegacyApp } = await import("./main.ts");

    await startLegacyApp();

    expect(loadConfigurationWithMetadata).toHaveBeenCalledTimes(1);
    expect(replaceSettings).toHaveBeenCalledWith({ editor: { code: "(play)" } });
    expect(initEditorPanel).toHaveBeenCalledWith("#panel-main-editor");
    expect(ensureWorkerLoaded).toHaveBeenCalledTimes(1);
    expect(setEditorSession).toHaveBeenCalled();
    expect(mountApplicationRoot).toHaveBeenCalledWith({
      devmode: false,
      virtualGamepad: false,
    });
    expect(createApp).toHaveBeenCalled();
    expect(startApp).toHaveBeenCalledTimes(1);
    expect(bootstrapRuntimeSession).toHaveBeenCalledWith(
      {
        hasHardwareConnection: false,
        noModuleMode: false,
        wasmEnabled: true,
      },
      { connected: false }
    );
    expect(seedBootstrapDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        settingsSources: ["defaults", "local-storage"],
        startupMode: "browser-local",
      })
    );
    // Bootstrap publishes once, and the asynchronous Worker lifecycle may
    // publish additional truthful availability transitions.
    expect(publishDiagnosticsSnapshot).toHaveBeenCalled();
  });

  it("surfaces configuration bootstrap failures and still starts with examined environment", async () => {
    loadConfigurationWithMetadata.mockRejectedValue(new Error("bad config"));
    const { startLegacyApp } = await import("./main.ts");

    await startLegacyApp();

    expect(reportBootstrapFailure).toHaveBeenCalledWith(
      "config-loader",
      expect.any(Error)
    );
    expect(startApp).toHaveBeenCalledTimes(1);
  });

  it("continues hardware-only instead of falling back to main-thread WASM when Worker is absent", async () => {
    vi.stubGlobal("Worker", undefined);
    const { startLegacyApp } = await import("./main.ts");

    await startLegacyApp();

    expect(ensureWorkerLoaded).not.toHaveBeenCalled();
    expect(bootstrapRuntimeSession).toHaveBeenCalledWith(
      expect.objectContaining({ wasmEnabled: false }),
      { connected: false },
    );
    expect(createApp).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        startupMode: "hardware",
        startBrowserLocal: false,
      }),
      expect.objectContaining({
        browserWasmRuntime: expect.anything(),
      }),
    );
  });
});
