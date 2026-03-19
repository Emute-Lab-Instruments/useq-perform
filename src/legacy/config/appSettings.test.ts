import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("appSettings", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    installMockStorage();
    window.history.replaceState({}, "", "/");
  });

  it("ignores legacy visual offset settings outside the one-time migration path", async () => {
    const settingsModule = await import("../../lib/appSettings.ts");

    const normalized = settingsModule.normalizeUserSettings({
      visualisation: {
        offsetSeconds: 1.5,
        sampleCount: 240,
      },
    });

    expect(normalized.visualisation.windowDuration).toBe(
      settingsModule.defaultUserSettings.visualisation.windowDuration,
    );
    expect(normalized.visualisation.futureLeadSeconds).toBe(1);
    expect("offsetSeconds" in normalized.visualisation).toBe(false);
  });

  it("migrates legacy storage keys into canonical local storage once", async () => {
    const settingsModule = await import("../../lib/appSettings.ts");
    window.localStorage.setItem(
      "editorConfig",
      JSON.stringify({ currentTheme: 0, fontSize: 21 }),
    );
    window.localStorage.setItem(
      "useqConfig",
      JSON.stringify({ storage: { savelocal: false } }),
    );
    window.localStorage.setItem("useqcode", JSON.stringify("(legacy)"));

    const loaded = settingsModule.readPersistedUserSettings();

    const stored = JSON.parse(
      window.localStorage.getItem(settingsModule.settingsStorageKey) ?? "{}",
    );

    expect(loaded?.editor.code).toBe("(legacy)");
    expect(loaded?.storage.saveCodeLocally).toBe(false);
    expect(stored.editor.fontSize).toBe(21);
    expect(window.localStorage.getItem("editorConfig")).toBeNull();
    expect(window.localStorage.getItem("useqConfig")).toBeNull();
    expect(window.localStorage.getItem("useqcode")).toBeNull();
  });

  it("round-trips runtime, wasm, and canonical visualisation fields through configuration documents", async () => {
    const settingsModule = await import("../../lib/appSettings.ts");

    const document = settingsModule.createConfigurationDocument(
      settingsModule.mergeUserSettings(settingsModule.createDefaultUserSettings(), {
        runtime: {
          autoReconnect: false,
          startLocallyWithoutHardware: false,
        },
        wasm: {
          enabled: false,
        },
        visualisation: {
          windowDuration: 12,
          futureLeadSeconds: 2.5,
        },
      }),
      { includeCode: true },
    );

    const patch = settingsModule.settingsPatchFromConfiguration(document);
    const roundTripped = settingsModule.mergeUserSettings(
      settingsModule.createDefaultUserSettings(),
      patch,
    );

    expect(document.user.runtime).toEqual({
      autoReconnect: false,
      startLocallyWithoutHardware: false,
    });
    expect(document.user.wasm).toEqual({ enabled: false });
    expect(document.user.visualisation).toMatchObject({
      windowDuration: 12,
      futureLeadSeconds: 2.5,
    });
    expect((document.user.visualisation as Record<string, unknown>).offsetSeconds).toBeUndefined();
    expect(roundTripped.runtime).toEqual({
      autoReconnect: false,
      startLocallyWithoutHardware: false,
    });
    expect(roundTripped.wasm).toEqual({ enabled: false });
    expect(roundTripped.visualisation.windowDuration).toBe(12);
    expect(roundTripped.visualisation.futureLeadSeconds).toBe(2.5);
  });
});
