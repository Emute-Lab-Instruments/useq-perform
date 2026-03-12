import { beforeEach, describe, expect, it, vi } from "vitest";

const replaceUserSettings = vi.fn();
const examineEnvironment = vi.fn();
const createAppUI = vi.fn();
const startApp = vi.fn();
const createApp = vi.fn(() => ({ start: startApp }));
const loadConfigurationWithMetadata = vi.fn();
const publishRuntimeDiagnostics = vi.fn();
const reportBootstrapFailure = vi.fn();

vi.mock("./utils/persistentUserSettings.ts", () => ({
  activeUserSettings: {
    runtime: { startLocallyWithoutHardware: true },
    wasm: { enabled: true },
  },
  replaceUserSettings,
}));

vi.mock("./app/environment.ts", () => ({
  examineEnvironment,
}));

vi.mock("./ui/ui.ts", () => ({
  createAppUI,
}));

vi.mock("./app/application.ts", () => ({
  createApp,
}));

vi.mock("./config/configLoader.ts", () => ({
  loadConfigurationWithMetadata,
}));

vi.mock("../runtime/runtimeDiagnostics.ts", () => ({
  publishRuntimeDiagnostics,
  reportBootstrapFailure,
  resolveStartupMode: vi.fn(() => "browser-local"),
}));

vi.mock("../runtime/runtimeSession.ts", () => ({
  createRuntimeSessionSnapshot: vi.fn(() => ({
    hasHardwareConnection: false,
    noModuleMode: false,
    wasmEnabled: true,
    connectionMode: "none",
    transportMode: "wasm",
  })),
}));

vi.mock("./urlParams.ts", () => ({
  noModuleMode: false,
}));

describe("startLegacyApp", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    loadConfigurationWithMetadata.mockResolvedValue({
      config: { editor: { code: "(play)" } },
      settingsSources: ["defaults", "local-storage"],
    });
    examineEnvironment.mockReturnValue({
      areInBrowser: true,
      areInDesktopApp: false,
      isWebSerialAvailable: true,
      isInDevmode: false,
      userSettings: { name: "Test User" },
      urlParams: {},
    });
    createAppUI.mockResolvedValue({ mainEditor: {} });
    startApp.mockResolvedValue(undefined);
  });

  it("loads configuration, publishes diagnostics, and starts the app", async () => {
    const { startLegacyApp } = await import("./main.ts");

    await startLegacyApp();

    expect(loadConfigurationWithMetadata).toHaveBeenCalledTimes(1);
    expect(replaceUserSettings).toHaveBeenCalledWith(
      { editor: { code: "(play)" } },
      { dispatch: true }
    );
    expect(createAppUI).toHaveBeenCalledWith(examineEnvironment.mock.results[0].value);
    expect(createApp).toHaveBeenCalled();
    expect(startApp).toHaveBeenCalledTimes(1);
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
