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

  it("normalizes structure settings: defaults, valid overrides, and invalid coercion (structural-editing.md §5.2.9/§4.2/§7.2)", async () => {
    const settingsModule = await import("./appSettings.ts");

    // Defaults applied when absent.
    const fromEmpty = settingsModule.normalizeUserSettings({});
    expect(fromEmpty.structure.atomSlurpBehaviour).toBe("promote-to-vector");
    expect(fromEmpty.structure.autoEnterInsertion).toBe(true);
    expect(fromEmpty.structure.flashConsoleToasts).toBe(true);

    // Valid overrides preserved.
    const overridden = settingsModule.normalizeUserSettings({
      structure: {
        atomSlurpBehaviour: "promote-to-list",
        autoEnterInsertion: false,
        flashConsoleToasts: false,
      },
    });
    expect(overridden.structure.atomSlurpBehaviour).toBe("promote-to-list");
    expect(overridden.structure.autoEnterInsertion).toBe(false);
    expect(overridden.structure.flashConsoleToasts).toBe(false);

    // Invalid enum value falls back to the default.
    const invalid = settingsModule.normalizeUserSettings({
      structure: { atomSlurpBehaviour: "promote-to-banana" },
    });
    expect(invalid.structure.atomSlurpBehaviour).toBe("promote-to-vector");
  });

  it("normalizes runtime.failureMode: lkg default, valid overrides, invalid coercion (failure-model.md §3.2)", async () => {
    const settingsModule = await import("./appSettings.ts");

    // Default applied when absent.
    expect(settingsModule.normalizeUserSettings({}).runtime.failureMode).toBe("lkg");

    // Valid overrides preserved.
    expect(
      settingsModule.normalizeUserSettings({ runtime: { failureMode: "zero" } }).runtime
        .failureMode,
    ).toBe("zero");
    expect(
      settingsModule.normalizeUserSettings({ runtime: { failureMode: "lkg" } }).runtime
        .failureMode,
    ).toBe("lkg");

    // Invalid enum value falls back to the default.
    expect(
      settingsModule.normalizeUserSettings({
        runtime: { failureMode: "banana" as never },
      }).runtime.failureMode,
    ).toBe("lkg");
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
      failureMode: "lkg",
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
      failureMode: "lkg",
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

  // [T7] Config export/import must be symmetric and complete over the full
  // AppSettings schema. Previously the writer dropped console/structure/format/
  // hardware and the reader dropped console/structure/format, so non-default
  // values in those sections silently vanished on round-trip (CF3).
  it("round-trips a non-default value in EVERY schema section without dropping any", async () => {
    const settingsModule = await import("./appSettings.ts");
    const { APP_SETTINGS_SECTION_KEYS } = await import(
      "./settings/schema.ts"
    );

    // A single, clearly-non-default override per section, with the assertion
    // path used to read it back. Derived from the shared section-key list so a
    // newly-added section that isn't wired up here will fail this test.
    const overrides: Record<string, unknown> = {
      editor: { fontSize: 19 },
      storage: { autoSaveInterval: 7000 },
      ui: { consoleLinesLimit: 222 },
      visualisation: { windowDuration: 13 },
      runtime: { autoReconnect: false },
      wasm: { enabled: false },
      console: { entryAnimation: "typewriter", typewriterIntervalMs: 99 },
      evalResults: { mode: "console" },
      structure: { atomSlurpBehaviour: "no-op" },
      format: { lineWidth: 77 },
      hardware: { bindingQueueDepth: 9 },
      liveEdit: { idLength: 6 },
      calibration: { sliderRangeCents: 41 },
    };

    const checks: Array<[string, (s: Record<string, any>) => unknown, unknown]> = [
      ["editor", (s) => s.editor.fontSize, 19],
      ["storage", (s) => s.storage.autoSaveInterval, 7000],
      ["ui", (s) => s.ui.consoleLinesLimit, 222],
      ["visualisation", (s) => s.visualisation.windowDuration, 13],
      ["runtime", (s) => s.runtime.autoReconnect, false],
      ["wasm", (s) => s.wasm.enabled, false],
      ["console", (s) => s.console.entryAnimation, "typewriter"],
      ["console", (s) => s.console.typewriterIntervalMs, 99],
      ["evalResults", (s) => s.evalResults.mode, "console"],
      ["structure", (s) => s.structure.atomSlurpBehaviour, "no-op"],
      ["format", (s) => s.format.lineWidth, 77],
      ["hardware", (s) => s.hardware.bindingQueueDepth, 9],
      ["liveEdit", (s) => s.liveEdit.idLength, 6],
      ["calibration", (s) => s.calibration.sliderRangeCents, 41],
    ];

    // Guard: every schema section must have an override + a check here, so a
    // future section can't silently desync writer/reader without us noticing.
    for (const key of APP_SETTINGS_SECTION_KEYS) {
      expect(overrides, `missing override for section "${key}"`).toHaveProperty(
        key as string,
      );
      expect(
        checks.some(([section]) => section === key),
        `missing round-trip check for section "${key}"`,
      ).toBe(true);
    }

    const base = settingsModule.mergeUserSettings(
      settingsModule.createDefaultUserSettings(),
      overrides,
    );
    const document = settingsModule.createConfigurationDocument(base, {
      includeCode: false,
    });

    // Writer must emit every section.
    for (const key of APP_SETTINGS_SECTION_KEYS) {
      expect(
        (document.user as Record<string, unknown>)[key as string],
        `writer dropped section "${key}"`,
      ).toBeTruthy();
    }

    const patch = settingsModule.settingsPatchFromConfiguration(document);

    // Reader must surface every section in the patch.
    for (const key of APP_SETTINGS_SECTION_KEYS) {
      expect(
        (patch as Record<string, unknown>)[key as string],
        `reader dropped section "${key}"`,
      ).toBeTruthy();
    }

    const roundTripped = settingsModule.mergeUserSettings(
      settingsModule.createDefaultUserSettings(),
      patch,
    ) as Record<string, any>;

    for (const [section, read, expected] of checks) {
      expect(read(roundTripped), `section "${section}" lost on round-trip`).toBe(
        expected,
      );
    }
  });

  // [T8] settings.md §1.7: normalisation clamps out-of-range numerics and drops
  // unknown fields (CF12 + SF6).
  it("clamps out-of-range numerics and drops unknown top-level keys (settings.md §1.7)", async () => {
    const settingsModule = await import("./appSettings.ts");

    // fontSize out of range (8–32) is clamped, not passed through.
    expect(
      settingsModule.normalizeUserSettings({ editor: { fontSize: 200 } }).editor
        .fontSize,
    ).toBe(32);
    expect(
      settingsModule.normalizeUserSettings({ editor: { fontSize: 2 } }).editor
        .fontSize,
    ).toBe(8);

    // autoSaveInterval below the 1000 floor is clamped up.
    expect(
      settingsModule.normalizeUserSettings({ storage: { autoSaveInterval: -50 } })
        .storage.autoSaveInterval,
    ).toBe(1000);

    // windowDuration / sampleCount must be strictly positive.
    const negVis = settingsModule.normalizeUserSettings({
      visualisation: { windowDuration: -10, sampleCount: 0 },
    });
    expect(negVis.visualisation.windowDuration).toBeGreaterThan(0);
    expect(negVis.visualisation.sampleCount).toBeGreaterThan(0);

    // Non-finite / string inputs fall back to defaults and stay in range.
    const defaults = settingsModule.createDefaultUserSettings();
    const garbage = settingsModule.normalizeUserSettings({
      editor: { fontSize: Number.POSITIVE_INFINITY },
      storage: { autoSaveInterval: Number.NaN },
      visualisation: { windowDuration: "lots", sampleCount: "nope" },
    });
    expect(garbage.editor.fontSize).toBe(defaults.editor.fontSize);
    expect(garbage.storage.autoSaveInterval).toBe(
      defaults.storage.autoSaveInterval,
    );
    expect(garbage.visualisation.windowDuration).toBe(
      defaults.visualisation.windowDuration,
    );
    expect(garbage.visualisation.sampleCount).toBe(
      defaults.visualisation.sampleCount,
    );

    // Unknown top-level keys are dropped, not retained verbatim.
    const withJunk = settingsModule.normalizeUserSettings({
      foo: 1,
      bogusSection: { a: 2 },
      editor: { fontSize: 16 },
    }) as Record<string, unknown>;
    expect(withJunk.foo).toBeUndefined();
    expect(withJunk.bogusSection).toBeUndefined();
    expect((withJunk.editor as Record<string, unknown>).fontSize).toBe(16);
  });
});
