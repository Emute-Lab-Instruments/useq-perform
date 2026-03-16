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

function setLocation(search = "") {
  const suffix = search ? `${search}` : "/";
  window.history.replaceState({}, "", suffix);
}

describe("appSettingsRepository persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    installMockStorage();
    setLocation();
  });

  it("stores editor code only in the canonical code key", async () => {
    const appSettings = await import("../config/appSettings.ts");
    const repo = await import("../../runtime/appSettingsRepository.ts");

    repo.replaceAppSettings(
      {
        ...appSettings.defaultUserSettings,
        editor: {
          ...appSettings.defaultUserSettings.editor,
          code: "(play)",
          fontSize: 24,
        },
      },
      { persist: true },
    );

    const storedSettings = JSON.parse(window.localStorage.getItem(appSettings.settingsStorageKey) ?? "{}");

    expect(storedSettings.editor.code).toBeUndefined();
    expect(window.localStorage.getItem(appSettings.codeStorageKey)).toBe("(play)");
  }, 10000);

  it("loads legacy JSON-encoded code values through the canonical bootstrap path", async () => {
    const appSettings = await import("../config/appSettings.ts");
    const repo = await import("../../runtime/appSettingsRepository.ts");
    window.localStorage.setItem(
      appSettings.settingsStorageKey,
      JSON.stringify({ editor: { fontSize: 18 } }),
    );
    window.localStorage.setItem(appSettings.codeStorageKey, JSON.stringify("(legacy-json-code)"));

    const loadedSettings = repo.loadAppSettings();

    expect(loadedSettings.editor.fontSize).toBe(18);
    expect(loadedSettings.editor.code).toBe("(legacy-json-code)");
  });

  it("does not write local storage when ?nosave is active", async () => {
    setLocation("/?nosave");
    const appSettings = await import("../config/appSettings.ts");
    const repo = await import("../../runtime/appSettingsRepository.ts");

    repo.replaceAppSettings(
      {
        ...appSettings.defaultUserSettings,
        editor: {
          ...appSettings.defaultUserSettings.editor,
          code: "(do-not-persist)",
        },
      },
      { persist: true },
    );

    expect(window.localStorage.getItem(appSettings.settingsStorageKey)).toBeNull();
    expect(window.localStorage.getItem(appSettings.codeStorageKey)).toBeNull();
  });

  it("persists canonical visualisation fields without reintroducing offsetSeconds", async () => {
    const appSettings = await import("../config/appSettings.ts");
    const repo = await import("../../runtime/appSettingsRepository.ts");

    repo.replaceAppSettings(
      {
        ...appSettings.defaultUserSettings,
        visualisation: {
          windowDuration: 6,
          sampleCount: 180,
        },
      },
      { persist: true },
    );

    const storedSettings = JSON.parse(
      window.localStorage.getItem(appSettings.settingsStorageKey) ?? "{}",
    );

    expect(storedSettings.visualisation.windowDuration).toBe(6);
    expect(storedSettings.visualisation.offsetSeconds).toBeUndefined();
  });
});
