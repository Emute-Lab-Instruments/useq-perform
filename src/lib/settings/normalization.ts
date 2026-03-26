/**
 * Settings Normalization
 *
 * Validation, normalization, merging, and configuration document helpers.
 */

import { defaultTheme } from "../editorDefaults.ts";
import { themes } from "../../editors/themes.ts";
import type {
  AppConfigDocument,
  AppDevModeState,
  AppSettings,
  AppSettingsPatch,
  StoredAppSettings,
  VisualisationSettings,
} from "./schema.ts";
import {
  CONFIG_VERSION,
  createDefaultUserSettings,
  defaultDevModeConfiguration,
  defaultUserSettings,
} from "./schema.ts";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function coerceNumber(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function detectOsFamily(): "pc" | "mac" {
  const platformStr =
    (typeof navigator !== "undefined" &&
      (navigator.platform || navigator.userAgent || "")) ||
    "";
  return /Mac|iPhone|iPad|iPod/i.test(platformStr) ? "mac" : "pc";
}

function normalizeTheme(value: unknown): string {
  const requestedTheme =
    typeof value === "string" && value.length > 0 ? value : defaultTheme;
  const availableThemes = themes as Record<string, unknown>;

  if (requestedTheme === "default") {
    return defaultTheme;
  }

  return availableThemes[requestedTheme] ? requestedTheme : defaultTheme;
}

function normalizeVisualisationSettings(
  value: unknown,
  defaults: VisualisationSettings = defaultUserSettings.visualisation,
): VisualisationSettings {
  const raw = isRecord(value) ? value : {};

  return {
    windowDuration: coerceNumber(raw.windowDuration, defaults.windowDuration),
    sampleCount: coerceNumber(raw.sampleCount, defaults.sampleCount),
    lineWidth: coerceNumber(raw.lineWidth, defaults.lineWidth),
    probeSampleCount: coerceNumber(
      raw.probeSampleCount,
      defaults.probeSampleCount,
    ),
    probeLineWidth: coerceNumber(raw.probeLineWidth, defaults.probeLineWidth),
    probeRefreshIntervalMs: coerceNumber(
      raw.probeRefreshIntervalMs,
      defaults.probeRefreshIntervalMs,
    ),
    futureDashed:
      raw.futureDashed == null ? defaults.futureDashed : raw.futureDashed !== false,
    futureMaskOpacity: coerceNumber(raw.futureMaskOpacity, defaults.futureMaskOpacity),
    futureMaskWidth: coerceNumber(raw.futureMaskWidth, defaults.futureMaskWidth),
    circularOffset: coerceNumber(raw.circularOffset, defaults.circularOffset),
    futureLeadSeconds: coerceNumber(raw.futureLeadSeconds, defaults.futureLeadSeconds),
    digitalLaneGap: coerceNumber(raw.digitalLaneGap, defaults.digitalLaneGap),
    readabilityBlurRadius: coerceNumber(raw.readabilityBlurRadius, defaults.readabilityBlurRadius),
    readabilityPadding: coerceNumber(raw.readabilityPadding, defaults.readabilityPadding),
    readabilityTintOpacity: coerceNumber(raw.readabilityTintOpacity, defaults.readabilityTintOpacity),
    readabilityAlpha: coerceNumber(raw.readabilityAlpha, defaults.readabilityAlpha),
    readabilityPasses: coerceNumber(raw.readabilityPasses, defaults.readabilityPasses),
    readabilityFeather: coerceNumber(raw.readabilityFeather, defaults.readabilityFeather),
    readabilityMaxDarken: coerceNumber(raw.readabilityMaxDarken, defaults.readabilityMaxDarken),
    readabilityDebounceMs: coerceNumber(raw.readabilityDebounceMs, defaults.readabilityDebounceMs),
    readabilityOverscan: coerceNumber(raw.readabilityOverscan, defaults.readabilityOverscan),
    readabilityEnabled:
      raw.readabilityEnabled == null ? defaults.readabilityEnabled : raw.readabilityEnabled !== false,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function normalizeUserSettings(value: unknown): AppSettings {
  const raw = isRecord(value) ? value : {};
  const defaults = createDefaultUserSettings();

  const editor = isRecord(raw.editor) ? raw.editor : {};
  const storage = isRecord(raw.storage) ? raw.storage : {};
  const ui = isRecord(raw.ui) ? raw.ui : {};
  const runtime = isRecord(raw.runtime) ? raw.runtime : {};
  const wasm = isRecord(raw.wasm) ? raw.wasm : {};
  const keymaps = isRecord(raw.keymaps) ? raw.keymaps : undefined;

  return {
    ...defaults,
    ...raw,
    name: typeof raw.name === "string" && raw.name.length > 0 ? raw.name : defaults.name,
    editor: {
      ...defaults.editor,
      ...editor,
      code:
        typeof editor.code === "string" ? editor.code : defaults.editor.code,
      theme: normalizeTheme(editor.theme),
      fontSize: coerceNumber(editor.fontSize, defaults.editor.fontSize),
      preventBracketUnbalancing:
        editor.preventBracketUnbalancing == null
          ? defaults.editor.preventBracketUnbalancing
          : editor.preventBracketUnbalancing !== false,
    },
    storage: {
      ...defaults.storage,
      ...storage,
      saveCodeLocally:
        storage.saveCodeLocally == null
          ? defaults.storage.saveCodeLocally
          : storage.saveCodeLocally !== false,
      autoSaveEnabled:
        storage.autoSaveEnabled == null
          ? defaults.storage.autoSaveEnabled
          : storage.autoSaveEnabled !== false,
      autoSaveInterval: coerceNumber(
        storage.autoSaveInterval,
        defaults.storage.autoSaveInterval,
      ),
    },
    ui: {
      ...defaults.ui,
      ...ui,
      customThemes: Array.isArray(ui.customThemes)
        ? [...ui.customThemes]
        : [...defaults.ui.customThemes],
      osFamily:
        ui.osFamily === "mac"
          ? "mac"
          : ui.osFamily === "pc"
            ? "pc"
            : detectOsFamily(),
      expressionGutterEnabled:
        ui.expressionGutterEnabled == null
          ? defaults.ui.expressionGutterEnabled
          : ui.expressionGutterEnabled !== false,
      expressionLastTrackingEnabled:
        ui.expressionLastTrackingEnabled == null
          ? defaults.ui.expressionLastTrackingEnabled
          : ui.expressionLastTrackingEnabled !== false,
      expressionClearButtonEnabled:
        ui.expressionClearButtonEnabled == null
          ? defaults.ui.expressionClearButtonEnabled
          : ui.expressionClearButtonEnabled !== false,
      gamepadPickerStyle:
        ui.gamepadPickerStyle === "radial" ? "radial" : defaults.ui.gamepadPickerStyle,
    },
    visualisation: normalizeVisualisationSettings(raw.visualisation, defaults.visualisation),
    runtime: {
      ...defaults.runtime,
      ...runtime,
      autoReconnect:
        runtime.autoReconnect == null
          ? defaults.runtime.autoReconnect
          : runtime.autoReconnect !== false,
      startLocallyWithoutHardware:
        runtime.startLocallyWithoutHardware == null
          ? defaults.runtime.startLocallyWithoutHardware
          : runtime.startLocallyWithoutHardware !== false,
    },
    wasm: {
      ...defaults.wasm,
      ...wasm,
      enabled: wasm.enabled == null ? defaults.wasm.enabled : wasm.enabled !== false,
    },
    keymaps: keymaps
      ? (Object.fromEntries(
          Object.entries(keymaps).filter(
            ([key, mapValue]) => typeof key === "string" && typeof mapValue === "string",
          ),
        ) as Record<string, string>)
      : undefined,
  };
}

export function mergeUserSettings(
  base: unknown,
  values: unknown = {},
): AppSettings {
  const normalizedBase = normalizeUserSettings(base);
  const patch = isRecord(values) ? values : {};

  return normalizeUserSettings({
    ...normalizedBase,
    ...patch,
    editor: isRecord(patch.editor)
      ? { ...normalizedBase.editor, ...patch.editor }
      : normalizedBase.editor,
    storage: isRecord(patch.storage)
      ? { ...normalizedBase.storage, ...patch.storage }
      : normalizedBase.storage,
    ui: isRecord(patch.ui)
      ? { ...normalizedBase.ui, ...patch.ui }
      : normalizedBase.ui,
    visualisation: isRecord(patch.visualisation)
      ? { ...normalizedBase.visualisation, ...patch.visualisation }
      : normalizedBase.visualisation,
    runtime: isRecord(patch.runtime)
      ? { ...normalizedBase.runtime, ...patch.runtime }
      : normalizedBase.runtime,
    wasm: isRecord(patch.wasm)
      ? { ...normalizedBase.wasm, ...patch.wasm }
      : normalizedBase.wasm,
    keymaps: isRecord(patch.keymaps)
      ? { ...(normalizedBase.keymaps || {}), ...patch.keymaps }
      : normalizedBase.keymaps,
  });
}

export function createStoredSettingsSnapshot(
  settings: AppSettings,
): StoredAppSettings {
  const normalized = normalizeUserSettings(settings);
  const stored = normalizeUserSettings({
    ...normalized,
    editor: { ...normalized.editor },
  });
  const { code: _code, ...storedEditor } = stored.editor;
  return {
    ...stored,
    editor: storedEditor,
  };
}

export function createConfigurationDocument(
  settings: unknown,
  options: {
    includeCode?: boolean;
    includeDevMode?: boolean;
    metadataSource?: string;
    metadataDescription?: string;
    devMode?: AppDevModeState;
  } = {},
): AppConfigDocument {
  const normalized = normalizeUserSettings(settings);
  const includeCode = options.includeCode ?? false;
  const includeDevMode = options.includeDevMode ?? true;

  const document: AppConfigDocument = {
    version: CONFIG_VERSION,
    metadata: {
      lastModified: new Date().toISOString(),
      source: options.metadataSource ?? "webapp-export",
      ...(options.metadataDescription
        ? { description: options.metadataDescription }
        : {}),
    },
    user: {
      name: normalized.name,
      editor: {
        theme: normalized.editor.theme,
        fontSize: normalized.editor.fontSize,
        preventBracketUnbalancing: normalized.editor.preventBracketUnbalancing,
        ...(includeCode ? { code: normalized.editor.code } : {}),
      },
      storage: { ...normalized.storage },
      ui: {
        ...normalized.ui,
        customThemes: [...normalized.ui.customThemes],
      },
      visualisation: { ...normalized.visualisation },
      runtime: { ...normalized.runtime },
      wasm: { ...normalized.wasm },
      ...(normalized.keymaps ? { keymaps: { ...normalized.keymaps } } : {}),
    },
    devMode: includeDevMode
      ? { ...defaultDevModeConfiguration, ...(options.devMode || {}) }
      : defaultDevModeConfiguration,
  };

  return document;
}

export function settingsPatchFromConfiguration(
  config: unknown,
): AppSettingsPatch {
  if (!isRecord(config) || !isRecord(config.user)) {
    return {};
  }

  const user = config.user;
  const patch: AppSettingsPatch = {};

  if (typeof user.name === "string") {
    patch.name = user.name;
  }

  if (isRecord(user.editor)) {
    patch.editor = { ...user.editor };
  }

  if (isRecord(user.storage)) {
    patch.storage = { ...user.storage };
  }

  if (isRecord(user.ui)) {
    patch.ui = { ...user.ui };
  }

  if (isRecord(user.visualisation)) {
    const visualisationPatch: Partial<VisualisationSettings> = {};
    const visualisation = user.visualisation;

    if ("windowDuration" in visualisation) {
      visualisationPatch.windowDuration = normalizeVisualisationSettings(
        {
          windowDuration: visualisation.windowDuration,
        },
        defaultUserSettings.visualisation,
      ).windowDuration;
    }

    if ("sampleCount" in visualisation) {
      visualisationPatch.sampleCount = coerceNumber(
        visualisation.sampleCount,
        defaultUserSettings.visualisation.sampleCount,
      );
    }

    if ("lineWidth" in visualisation) {
      visualisationPatch.lineWidth = coerceNumber(
        visualisation.lineWidth,
        defaultUserSettings.visualisation.lineWidth,
      );
    }

    if ("probeSampleCount" in visualisation) {
      visualisationPatch.probeSampleCount = coerceNumber(
        visualisation.probeSampleCount,
        defaultUserSettings.visualisation.probeSampleCount,
      );
    }

    if ("probeLineWidth" in visualisation) {
      visualisationPatch.probeLineWidth = coerceNumber(
        visualisation.probeLineWidth,
        defaultUserSettings.visualisation.probeLineWidth,
      );
    }

    if ("probeRefreshIntervalMs" in visualisation) {
      visualisationPatch.probeRefreshIntervalMs = coerceNumber(
        visualisation.probeRefreshIntervalMs,
        defaultUserSettings.visualisation.probeRefreshIntervalMs,
      );
    }

    if ("futureDashed" in visualisation) {
      visualisationPatch.futureDashed = visualisation.futureDashed !== false;
    }

    if ("futureMaskOpacity" in visualisation) {
      visualisationPatch.futureMaskOpacity = coerceNumber(
        visualisation.futureMaskOpacity,
        defaultUserSettings.visualisation.futureMaskOpacity,
      );
    }

    if ("futureMaskWidth" in visualisation) {
      visualisationPatch.futureMaskWidth = coerceNumber(
        visualisation.futureMaskWidth,
        defaultUserSettings.visualisation.futureMaskWidth,
      );
    }

    if ("circularOffset" in visualisation) {
      visualisationPatch.circularOffset = coerceNumber(
        visualisation.circularOffset,
        defaultUserSettings.visualisation.circularOffset,
      );
    }

    if ("futureLeadSeconds" in visualisation) {
      visualisationPatch.futureLeadSeconds = coerceNumber(
        visualisation.futureLeadSeconds,
        defaultUserSettings.visualisation.futureLeadSeconds,
      );
    }

    if ("digitalLaneGap" in visualisation) {
      visualisationPatch.digitalLaneGap = coerceNumber(
        visualisation.digitalLaneGap,
        defaultUserSettings.visualisation.digitalLaneGap,
      );
    }

    if ("readabilityBlurRadius" in visualisation) {
      visualisationPatch.readabilityBlurRadius = coerceNumber(
        visualisation.readabilityBlurRadius,
        defaultUserSettings.visualisation.readabilityBlurRadius,
      );
    }

    if ("readabilityPadding" in visualisation) {
      visualisationPatch.readabilityPadding = coerceNumber(
        visualisation.readabilityPadding,
        defaultUserSettings.visualisation.readabilityPadding,
      );
    }

    if ("readabilityTintOpacity" in visualisation) {
      visualisationPatch.readabilityTintOpacity = coerceNumber(
        visualisation.readabilityTintOpacity,
        defaultUserSettings.visualisation.readabilityTintOpacity,
      );
    }

    if ("readabilityAlpha" in visualisation) {
      visualisationPatch.readabilityAlpha = coerceNumber(
        visualisation.readabilityAlpha,
        defaultUserSettings.visualisation.readabilityAlpha,
      );
    }

    if ("readabilityPasses" in visualisation) {
      visualisationPatch.readabilityPasses = coerceNumber(
        visualisation.readabilityPasses,
        defaultUserSettings.visualisation.readabilityPasses,
      );
    }

    if ("readabilityFeather" in visualisation) {
      visualisationPatch.readabilityFeather = coerceNumber(
        visualisation.readabilityFeather,
        defaultUserSettings.visualisation.readabilityFeather,
      );
    }

    if ("readabilityMaxDarken" in visualisation) {
      visualisationPatch.readabilityMaxDarken = coerceNumber(
        visualisation.readabilityMaxDarken,
        defaultUserSettings.visualisation.readabilityMaxDarken,
      );
    }

    if ("readabilityDebounceMs" in visualisation) {
      visualisationPatch.readabilityDebounceMs = coerceNumber(
        visualisation.readabilityDebounceMs,
        defaultUserSettings.visualisation.readabilityDebounceMs,
      );
    }

    if ("readabilityOverscan" in visualisation) {
      visualisationPatch.readabilityOverscan = coerceNumber(
        visualisation.readabilityOverscan,
        defaultUserSettings.visualisation.readabilityOverscan,
      );
    }

    if ("readabilityEnabled" in visualisation) {
      visualisationPatch.readabilityEnabled = visualisation.readabilityEnabled !== false;
    }

    patch.visualisation = visualisationPatch;
  }

  if (isRecord(user.runtime)) {
    patch.runtime = { ...user.runtime };
  }

  if (isRecord(user.wasm)) {
    patch.wasm = { ...user.wasm };
  }

  if (isRecord(user.keymaps)) {
    patch.keymaps = Object.fromEntries(
      Object.entries(user.keymaps).filter(
        ([key, mapValue]) => typeof key === "string" && typeof mapValue === "string",
      ),
    ) as Record<string, string>;
  }

  return patch;
}

// ---------------------------------------------------------------------------
// Configuration document validation & diff
// (Migrated from src/runtime/configSchema.ts)
// ---------------------------------------------------------------------------

/**
 * Validate a configuration document (import/URL config format).
 * Checks required top-level fields and critical value constraints.
 */
export function validateConfiguration(config: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Configuration is null or undefined'] };
  }

  const cfg = config as Partial<AppConfigDocument>;

  if (!cfg.version) {
    errors.push('Missing version field');
  }

  if (!cfg.user) {
    errors.push('Missing user field');
  } else {
    if (!cfg.user.editor) {
      errors.push('Missing user.editor field');
    }
    if (!cfg.user.storage) {
      errors.push('Missing user.storage field');
    }
    if (!cfg.user.ui) {
      errors.push('Missing user.ui field');
    }
    if (!cfg.user.visualisation) {
      errors.push('Missing user.visualisation field');
    }
  }

  if (cfg.user?.editor?.fontSize) {
    const fontSize = cfg.user.editor.fontSize;
    if (typeof fontSize !== 'number' || fontSize < 8 || fontSize > 32) {
      errors.push('user.editor.fontSize must be a number between 8 and 32');
    }
  }

  if (cfg.user?.storage?.autoSaveInterval) {
    const interval = cfg.user.storage.autoSaveInterval;
    if (typeof interval !== 'number' || interval < 1000) {
      errors.push('user.storage.autoSaveInterval must be a number >= 1000');
    }
  }

  if (
    cfg.user?.visualisation &&
    cfg.user.visualisation.windowDuration == null
  ) {
    errors.push('user.visualisation.windowDuration is required');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get a human-readable summary of configuration differences.
 */
export function getConfigurationDiff(current: Partial<AppConfigDocument>, incoming: Partial<AppConfigDocument>): string[] {
  const diffs: string[] = [];

  if (current.user?.editor?.theme !== incoming.user?.editor?.theme) {
    diffs.push(`Theme: ${current.user?.editor?.theme} → ${incoming.user?.editor?.theme}`);
  }

  if (current.user?.editor?.fontSize !== incoming.user?.editor?.fontSize) {
    diffs.push(`Font Size: ${current.user?.editor?.fontSize} → ${incoming.user?.editor?.fontSize}`);
  }

  if (current.user?.visualisation?.windowDuration !== incoming.user?.visualisation?.windowDuration) {
    diffs.push(`Visual Window: ${current.user?.visualisation?.windowDuration}s → ${incoming.user?.visualisation?.windowDuration}s`);
  }

  if (current.user?.visualisation?.lineWidth !== incoming.user?.visualisation?.lineWidth) {
    diffs.push(`Line Width: ${current.user?.visualisation?.lineWidth}px → ${incoming.user?.visualisation?.lineWidth}px`);
  }

  return diffs;
}
