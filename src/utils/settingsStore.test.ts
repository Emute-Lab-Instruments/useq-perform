import { beforeEach, describe, expect, it, vi } from "vitest";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function mergeSettings(current: any, values: any) {
  return {
    ...current,
    ...values,
    editor: values.editor ? { ...current.editor, ...values.editor } : current.editor,
    storage: values.storage ? { ...current.storage, ...values.storage } : current.storage,
    ui: values.ui ? { ...current.ui, ...values.ui } : current.ui,
    visualisation: values.visualisation
      ? { ...current.visualisation, ...values.visualisation }
      : current.visualisation,
    wasm: values.wasm ? { ...current.wasm, ...values.wasm } : current.wasm,
  };
}

async function loadSettingsStore(initialSettings: any) {
  const activeUserSettings = clone(initialSettings);
  const updateUserSettings = vi.fn((values: any) => {
    const next = mergeSettings(activeUserSettings, values);
    Object.assign(activeUserSettings, next);
    window.dispatchEvent(
      new CustomEvent("useq-settings-changed", {
        detail: activeUserSettings,
      }),
    );
  });

  vi.doMock("../legacy/utils/persistentUserSettings.ts", () => ({
    activeUserSettings,
    updateUserSettings,
  }));

  const module = await import("./settingsStore");
  return { ...module, activeUserSettings, updateUserSettings };
}

describe("settingsStore", () => {
  const baseSettings = {
    name: "Livecoder",
    editor: { theme: "useq-dark", fontSize: 16 },
    storage: { autoSaveEnabled: true },
    ui: { consoleLinesLimit: 1000, osFamily: "pc" },
    visualisation: { sampleCount: 100 },
    wasm: { enabled: true },
  };

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("initial state matches activeUserSettings", async () => {
    const initial = { ...baseSettings, name: "Tester" };
    const { settings } = await loadSettingsStore(initial);
    expect(settings).toEqual(initial);
  });

  it("updateSettingsStore delegates to updateUserSettings (persistence path)", async () => {
    const { settings, updateSettingsStore, updateUserSettings } = await loadSettingsStore(baseSettings);
    updateSettingsStore({ ui: { consoleLinesLimit: 256 } });

    expect(updateUserSettings).toHaveBeenCalledWith({ ui: { consoleLinesLimit: 256 } });
    expect(settings.ui.consoleLinesLimit).toBe(256);
  });

  it("useq-settings-changed event updates the store via reconcile", async () => {
    const { settings } = await loadSettingsStore(baseSettings);
    window.dispatchEvent(
      new CustomEvent("useq-settings-changed", {
        detail: {
          ...baseSettings,
          name: "FromEvent",
          ui: { ...baseSettings.ui, osFamily: "mac" },
        },
      }),
    );

    expect(settings.name).toBe("FromEvent");
    expect(settings.ui.osFamily).toBe("mac");
  });

  it("re-syncs from activeUserSettings on module load", async () => {
    const initial = { ...baseSettings, wasm: { enabled: false } };
    const { settings } = await loadSettingsStore(initial);
    expect(settings.wasm.enabled).toBe(false);
  });
});
