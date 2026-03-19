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
    futureDashed:
      raw.futureDashed == null ? defaults.futureDashed : raw.futureDashed !== false,
    futureMaskOpacity: coerceNumber(raw.futureMaskOpacity, defaults.futureMaskOpacity),
    futureMaskWidth: coerceNumber(raw.futureMaskWidth, defaults.futureMaskWidth),
    circularOffset: coerceNumber(raw.circularOffset, defaults.circularOffset),
    futureLeadSeconds: coerceNumber(raw.futureLeadSeconds, defaults.futureLeadSeconds),
    digitalLaneGap: coerceNumber(raw.digitalLaneGap, defaults.digitalLaneGap),
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
