import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultMainEditorStartingCode } from "../editors/defaults.ts";

function installMockStorage() {
  const store: Record<string, string> = {};
  const storage = {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) {
        delete store[key];
      }
    },
  };

  Object.defineProperty(window, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
}

function setLocation(search = "") {
  const suffix = search ? `${search}` : "/";
  window.history.replaceState({}, "", suffix);
}

describe("configLoader", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    installMockStorage();
    setLocation();
  });

  it("preserves hardcoded editor defaults when default-config omits nested fields", async () => {
    const { loadConfiguration } = await import("./configLoader.ts");

    const config = await loadConfiguration();

    expect(config.editor.code).toBe(defaultMainEditorStartingCode);
    expect(config.editor.fontSize).toBe(31);
  });

  it("merges local storage settings and the canonical code key into bootstrap config", async () => {
    const settingsModule = await import("../config/appSettings.ts");
    window.localStorage.setItem(
      settingsModule.settingsStorageKey,
      JSON.stringify({
        editor: { fontSize: 18 },
        storage: { autoSaveEnabled: false },
      }),
    );
    window.localStorage.setItem(settingsModule.codeStorageKey, "(saved-from-local-storage)");

    const { loadConfiguration } = await import("./configLoader.ts");
    const config = await loadConfiguration();

    expect(config.editor.fontSize).toBe(18);
    expect(config.storage.autoSaveEnabled).toBe(false);
    expect(config.editor.code).toBe("(saved-from-local-storage)");
  });

  it("reports the settings sources used for bootstrap diagnostics", async () => {
    const settingsModule = await import("../config/appSettings.ts");
    window.localStorage.setItem(
      settingsModule.settingsStorageKey,
      JSON.stringify({ editor: { fontSize: 18 } }),
    );
    setLocation("/?nosave&txt=https://example.com/code.txt");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => "(from-url)",
      }),
    );

    const { loadConfigurationWithMetadata } = await import("./configLoader.ts");
    const result = await loadConfigurationWithMetadata();

    expect(result.settingsSources).toEqual([
      "defaults",
      "url-code",
      "nosave",
    ]);
  });

  it("skips local storage and disables persistence when ?nosave is present", async () => {
    const settingsModule = await import("../config/appSettings.ts");
    window.localStorage.setItem(
      settingsModule.settingsStorageKey,
      JSON.stringify({ editor: { fontSize: 12 } }),
    );
    window.localStorage.setItem(settingsModule.codeStorageKey, "(local-only)");
    setLocation("/?nosave");

    const { loadConfiguration } = await import("./configLoader.ts");
    const config = await loadConfiguration();

    expect(config.editor.fontSize).toBe(31);
    expect(config.editor.code).toBe(defaultMainEditorStartingCode);
    expect(config.storage.saveCodeLocally).toBe(false);
  });

  it("loads txt URL overrides without relying on jQuery or a global editor", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "(from-text-url)",
    });
    vi.stubGlobal("fetch", fetchMock);
    setLocation("/?txt=https://example.com/code.txt");

    const { loadConfiguration } = await import("./configLoader.ts");
    const config = await loadConfiguration();

    expect(fetchMock).toHaveBeenCalledWith("https://example.com/code.txt");
    expect(config.editor.code).toBe("(from-text-url)");
  });

  it("merges canonical runtime and wasm settings from URL config overrides", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        version: "1.0.0",
        user: {
          editor: {
            theme: "uSEQ Dark",
            fontSize: 31,
            preventBracketUnbalancing: true,
          },
          storage: {
            saveCodeLocally: true,
            autoSaveEnabled: true,
            autoSaveInterval: 5000,
          },
          ui: {
            consoleLinesLimit: 1000,
            customThemes: [],
            osFamily: "pc",
            expressionGutterEnabled: true,
            expressionLastTrackingEnabled: true,
            expressionClearButtonEnabled: true,
            gamepadPickerStyle: "radial",
          },
          runtime: {
            autoReconnect: false,
            startLocallyWithoutHardware: false,
          },
          wasm: {
            enabled: false,
          },
          visualisation: {
            windowDuration: 14,
            futureLeadSeconds: 2,
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    setLocation("/?config=https://example.com/useq-config.json");

    const { loadConfiguration } = await import("./configLoader.ts");
    const config = await loadConfiguration();

    expect(config.runtime).toEqual({
      autoReconnect: false,
      startLocallyWithoutHardware: false,
    });
    expect(config.wasm).toEqual({ enabled: false });
    expect(config.visualisation.windowDuration).toBe(14);
    expect(config.visualisation.futureLeadSeconds).toBe(2);
  });
});
