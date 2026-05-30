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
    const settingsModule = await import("./appSettings.ts");

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
    const settingsModule = await import("./appSettings.ts");
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
    const settingsModule = await import("./appSettings.ts");

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
          probeSampleCount: 48,
          probeLineWidth: 2.25,
          probeRefreshIntervalMs: 25,
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
      probeSampleCount: 48,
      probeLineWidth: 2.25,
      probeRefreshIntervalMs: 25,
    });
    expect((document.user.visualisation as Record<string, unknown>).offsetSeconds).toBeUndefined();
    expect(roundTripped.runtime).toEqual({
      autoReconnect: false,
      startLocallyWithoutHardware: false,
    });
    expect(roundTripped.wasm).toEqual({ enabled: false });
    expect(roundTripped.visualisation.windowDuration).toBe(12);
    expect(roundTripped.visualisation.futureLeadSeconds).toBe(2.5);
    expect(roundTripped.visualisation.probeSampleCount).toBe(48);
    expect(roundTripped.visualisation.probeLineWidth).toBe(2.25);
    expect(roundTripped.visualisation.probeRefreshIntervalMs).toBe(25);
  });

  it("provides liveEdit (§10) and calibration (§9) defaults", async () => {
    const settingsModule = await import("./appSettings.ts");
    const normalized = settingsModule.normalizeUserSettings({});

    // live-edit.md §10 defaults.
    expect(normalized.liveEdit.idAlphabet).toBe("abcdefghjkmnpqrstuvwxyz23456789");
    expect(normalized.liveEdit.idLength).toBe(4);
    expect(normalized.liveEdit.scalarWidget).toBe("knob");
    expect(normalized.liveEdit.orphanGcHours).toBe(24);
    expect(normalized.liveEdit.uiTickHz).toBe(60);
    expect(normalized.liveEdit.commitTriggersEval).toBe("immediate");
    expect(normalized.liveEdit.autoEvalOnIdle).toBe(true);

    // calibration.md §9 defaults.
    expect(normalized.calibration.sliderRangeCents).toBe(50);
    expect(normalized.calibration.snapZeroToleranceCents).toBe(0.3);
    expect(normalized.calibration.fineStepCents).toBe(0.1);
    expect(normalized.calibration.coarseStepCents).toBe(10);
    expect(normalized.calibration.carryForwardOffset).toBe(true);
    expect(normalized.calibration.octaveRange).toEqual({ from: 0, to: 4 });
  });

  it("normalizes and clamps liveEdit/calibration overrides to valid shapes", async () => {
    const settingsModule = await import("./appSettings.ts");
    const normalized = settingsModule.normalizeUserSettings({
      liveEdit: {
        idLength: 6,
        scalarWidget: "slider",
        commitTriggersEval: "quantised",
        autoEvalOnIdle: false,
        panelDock: "bottom",
        scalarWidgetBogus: "nope",
      },
      calibration: {
        sliderRangeCents: 75,
        carryForwardOffset: false,
        octaveRange: { from: 1, to: 3 },
        helperTextShown: false,
      },
    });

    expect(normalized.liveEdit.idLength).toBe(6);
    expect(normalized.liveEdit.scalarWidget).toBe("slider");
    expect(normalized.liveEdit.commitTriggersEval).toBe("quantised");
    expect(normalized.liveEdit.autoEvalOnIdle).toBe(false);
    expect(normalized.liveEdit.panelDock).toBe("bottom");

    expect(normalized.calibration.sliderRangeCents).toBe(75);
    expect(normalized.calibration.carryForwardOffset).toBe(false);
    expect(normalized.calibration.helperTextShown).toBe(false);
    expect(normalized.calibration.octaveRange).toEqual({ from: 1, to: 3 });

    // Invalid enum falls back to default.
    const invalid = settingsModule.normalizeUserSettings({
      liveEdit: { scalarWidget: "wibble", commitTriggersEval: "weird" },
    });
    expect(invalid.liveEdit.scalarWidget).toBe("knob");
    expect(invalid.liveEdit.commitTriggersEval).toBe("immediate");
  });

  it("round-trips liveEdit/calibration through configuration documents", async () => {
    const settingsModule = await import("./appSettings.ts");
    const base = settingsModule.normalizeUserSettings({
      liveEdit: { idLength: 5, uiTickHz: 30 },
      calibration: { sliderRangeCents: 40, carryForwardOffset: false },
    });
    const document = settingsModule.createConfigurationDocument(base, {
      includeCode: false,
    });
    const patch = settingsModule.settingsPatchFromConfiguration(document);
    const roundTripped = settingsModule.mergeUserSettings(
      settingsModule.createDefaultUserSettings(),
      patch,
    );

    expect(roundTripped.liveEdit.idLength).toBe(5);
    expect(roundTripped.liveEdit.uiTickHz).toBe(30);
    expect(roundTripped.calibration.sliderRangeCents).toBe(40);
    expect(roundTripped.calibration.carryForwardOffset).toBe(false);
  });
});
