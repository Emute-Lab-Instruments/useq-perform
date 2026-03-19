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
    runtime: values.runtime ? { ...current.runtime, ...values.runtime } : current.runtime,
    wasm: values.wasm ? { ...current.wasm, ...values.wasm } : current.wasm,
  };
}

async function loadSettingsStore(initialSettings: any) {
  const activeUserSettings = clone(initialSettings);
  const channelSubscribers = new Set<(settings: any) => void>();
  const updateSettings = vi.fn((values: any) => {
    const next = mergeSettings(activeUserSettings, values);
    Object.assign(activeUserSettings, next);
    // Simulate runtimeService publishing on the settingsChanged channel
    channelSubscribers.forEach((listener) => listener(clone(activeUserSettings)));
  });

  vi.doMock("../runtime/appSettingsRepository.ts", () => ({
    getAppSettings: () => clone(activeUserSettings),
  }));

  vi.doMock("../contracts/runtimeChannels.ts", () => ({
    settingsChanged: {
      subscribe: (listener: (settings: any) => void) => {
        channelSubscribers.add(listener);
        return () => channelSubscribers.delete(listener);
      },
      publish: (value: any) => {
        channelSubscribers.forEach((fn) => fn(value));
      },
    },
  }));

  vi.doMock("../runtime/runtimeService.ts", () => ({
    updateSettings,
  }));

  const module = await import("./settingsStore");
  return { ...module, activeUserSettings, updateSettings, channelSubscribers };
}

describe("settingsStore", () => {
  const baseSettings = {
    name: "Livecoder",
    editor: { theme: "uSEQ Dark", fontSize: 16, code: "(play)", preventBracketUnbalancing: true },
    storage: { saveCodeLocally: true, autoSaveEnabled: true, autoSaveInterval: 5000 },
    ui: {
      consoleLinesLimit: 1000,
      customThemes: [],
      osFamily: "pc",
      expressionGutterEnabled: true,
      expressionLastTrackingEnabled: true,
      expressionClearButtonEnabled: true,
      gamepadPickerStyle: "grid",
    },
    visualisation: {
      windowDuration: 10,
      sampleCount: 100,
      lineWidth: 1.5,
      futureDashed: true,
      futureMaskOpacity: 0.35,
      futureMaskWidth: 12,
      circularOffset: 0,
      futureLeadSeconds: 1,
      digitalLaneGap: 4,
    },
    runtime: { autoReconnect: true, startLocallyWithoutHardware: true },
    wasm: { enabled: true },
  };

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("initial state matches activeUserSettings", async () => {
    const initial = { ...baseSettings, name: "Tester" };
    const { settings } = await loadSettingsStore(initial);
    expect(settings).toMatchObject(initial);
  });

  it("updateSettingsStore delegates to runtimeService.updateSettings", async () => {
    const { settings, updateSettingsStore, updateSettings } = await loadSettingsStore(baseSettings);
    updateSettingsStore({ ui: { consoleLinesLimit: 256 } });

    expect(updateSettings).toHaveBeenCalledWith({ ui: { consoleLinesLimit: 256 } });
    expect(settings.ui.consoleLinesLimit).toBe(256);
  });

  it("settingsChanged channel updates the store via reconcile", async () => {
    const { settings, channelSubscribers } = await loadSettingsStore(baseSettings);
    channelSubscribers.forEach((listener) =>
      listener({
        ...baseSettings,
        name: "FromChannel",
        ui: { ...baseSettings.ui, osFamily: "mac" },
      }),
    );

    expect(settings.name).toBe("FromChannel");
    expect(settings.ui.osFamily).toBe("mac");
  });

  it("re-syncs from activeUserSettings on module load", async () => {
    const initial = { ...baseSettings, wasm: { enabled: false } };
    const { settings } = await loadSettingsStore(initial);
    expect(settings.wasm.enabled).toBe(false);
  });
});
