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

describe("persistentUserSettings", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    installMockStorage();
    setLocation();
  });

  it("stores editor code only in the canonical code key", async () => {
    const settingsModule = await import("./persistentUserSettings.ts");

    settingsModule.replaceUserSettings(
      {
        ...settingsModule.defaultUserSettings,
        editor: {
          ...settingsModule.defaultUserSettings.editor,
          code: "(play)",
          fontSize: 24,
        },
      },
      { persist: true },
    );

    const storedSettings = JSON.parse(window.localStorage.getItem(settingsModule.settingsStorageKey) ?? "{}");

    expect(storedSettings.editor.code).toBeUndefined();
    expect(window.localStorage.getItem(settingsModule.codeStorageKey)).toBe("(play)");
  }, 10000);

  it("loads legacy JSON-encoded code values through the canonical bootstrap path", async () => {
    const settingsModule = await import("./persistentUserSettings.ts");
    window.localStorage.setItem(
      settingsModule.settingsStorageKey,
      JSON.stringify({ editor: { fontSize: 18 } }),
    );
    window.localStorage.setItem(settingsModule.codeStorageKey, JSON.stringify("(legacy-json-code)"));

    const loadedSettings = settingsModule.loadUserSettings();

    expect(loadedSettings.editor.fontSize).toBe(18);
    expect(loadedSettings.editor.code).toBe("(legacy-json-code)");
  });

  it("does not write local storage when ?nosave is active", async () => {
    setLocation("/?nosave");
    const settingsModule = await import("./persistentUserSettings.ts");

    settingsModule.replaceUserSettings(
      {
        ...settingsModule.defaultUserSettings,
        editor: {
          ...settingsModule.defaultUserSettings.editor,
          code: "(do-not-persist)",
        },
      },
      { persist: true },
    );

    expect(window.localStorage.getItem(settingsModule.settingsStorageKey)).toBeNull();
    expect(window.localStorage.getItem(settingsModule.codeStorageKey)).toBeNull();
  });
});
