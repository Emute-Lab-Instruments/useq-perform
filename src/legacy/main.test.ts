import { beforeEach, describe, expect, it, vi } from "vitest";

const examineEnvironment = vi.fn();
const startApp = vi.fn();
const createApp = vi.fn(() => ({ start: startApp }));
const loadConfigurationWithMetadata = vi.fn();
const publishRuntimeDiagnostics = vi.fn();
const reportBootstrapFailure = vi.fn();
const appSettingsRepository = {
  getSettings: vi.fn(() => ({
    runtime: { startLocallyWithoutHardware: true },
    wasm: { enabled: true },
  })),
  replaceSettings: vi.fn(),
};
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
const initEditorPanel = vi.fn(async () => ({ id: "editor" }));
const initGamepadControl = vi.fn();
const setEditor = vi.fn();
const mountModal = vi.fn();
const mountPickerMenu = vi.fn();
const mountDoubleRadialMenu = vi.fn();
const registerVisualisationPanel = vi.fn();
const mountTransportToolbar = vi.fn();
const mountMainToolbar = vi.fn();
const mountSettingsPanel = vi.fn();
const mountHelpPanel = vi.fn();
const mountDesignSelector = vi.fn();

vi.mock("../../runtime/appSettingsRepository.ts", () => ({
  appSettingsRepository,
  loadConfigurationWithMetadata,
}));

vi.mock("../../runtime/startupContext.ts", () => ({
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

vi.mock("../../runtime/appLifecycle.ts", () => ({
  createApp,
}));

vi.mock("../../runtime/runtimeDiagnostics.ts", () => ({
  publishRuntimeDiagnostics,
  reportBootstrapFailure,
}));

vi.mock("../../runtime/runtimeService.ts", () => ({
  bootstrapRuntimeSession,
}));

// Mock createAppUI's inlined dependencies
vi.mock("../editors/gamepadControl.ts", () => ({
  initGamepadControl,
}));

vi.mock("../../lib/editorStore.ts", () => ({
  setEditor,
  initEditorPanel,
}));

vi.mock("../../ui/adapters/modal.tsx", () => ({
  mountModal,
}));

vi.mock("../../ui/adapters/picker-menu.tsx", () => ({
  mountPickerMenu,
}));

vi.mock("../../ui/adapters/double-radial-menu.tsx", () => ({
  mountDoubleRadialMenu,
}));

vi.mock("../../ui/adapters/visualisationPanel", () => ({
  registerVisualisationPanel,
}));

vi.mock("../../ui/adapters/panels.tsx", () => ({
  mountSettingsPanel,
  mountHelpPanel,
  mountDesignSelector,
  hideAllPanels: vi.fn(),
}));

vi.mock("../../ui/adapters/toolbars.tsx", () => ({
  mountTransportToolbar,
  mountMainToolbar,
}));

vi.mock("../../runtime/bootstrapPlan.ts", () => ({
  resolveBootstrapPlan: vi.fn(() => ({
    startupMode: "browser-local",
  })),
}));

describe("bootstrap (via startLegacyApp re-export)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

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
    });
    startApp.mockResolvedValue(undefined);
  });

  it("loads configuration, publishes diagnostics, and starts the app", async () => {
    const { startLegacyApp } = await import("./main.ts");

    await startLegacyApp();

    expect(loadConfigurationWithMetadata).toHaveBeenCalledTimes(1);
    expect(appSettingsRepository.replaceSettings).toHaveBeenCalledWith(
      { editor: { code: "(play)" } },
      { dispatch: true }
    );
    expect(initEditorPanel).toHaveBeenCalledWith("#panel-main-editor");
    expect(setEditor).toHaveBeenCalled();
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
    expect(publishRuntimeDiagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        settingsSources: ["defaults", "local-storage"],
        activeEnvironment: expect.objectContaining({
          areInBrowser: true,
          isWebSerialAvailable: true,
        }),
        startupMode: "browser-local",
      })
    );
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
});
