/**
 * Settings Normalization
 *
 * Validation, normalization, merging, and configuration document helpers.
 *
 * Domain-specific normalizers live in sibling modules:
 *   - normalizeKeybindings.ts
 *   - normalizeVisualisation.ts
 *   - normalizeEvalResults.ts
 *   - normalizationHelpers.ts (shared utilities)
 *
 * This file re-exports all public symbols so existing import sites are unchanged.
 */

import { defaultTheme } from "../editorDefaults.ts";
import { themeNameSet } from "../themes.ts";
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
import { isRecord, coerceNumber, detectOsFamily } from "./normalizationHelpers.ts";
import { normalizeKeybindingsSettings } from "./normalizeKeybindings.ts";
import { normalizeVisualisationSettings, extractVisualisationPatch } from "./normalizeVisualisation.ts";
import { normalizeEvalResultsSettings } from "./normalizeEvalResults.ts";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function normalizeTheme(value: unknown): string {
  const requestedTheme =
    typeof value === "string" && value.length > 0 ? value : defaultTheme;

  if (requestedTheme === "default") {
    return defaultTheme;
  }

  return themeNameSet.has(requestedTheme) ? requestedTheme : defaultTheme;
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
  const structure = isRecord(raw.structure) ? raw.structure : {};
  const format = isRecord(raw.format) ? raw.format : {};
  const hardware = isRecord(raw.hardware) ? raw.hardware : {};
  const keybindings = isRecord(raw.keybindings) ? raw.keybindings : undefined;
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
      indentGuideMode:
        ui.indentGuideMode === "always" ||
        ui.indentGuideMode === "path" ||
        ui.indentGuideMode === "never"
          ? ui.indentGuideMode
          : defaults.ui.indentGuideMode,
    },
    visualisation: normalizeVisualisationSettings(raw.visualisation, defaults.visualisation),
    evalResults: normalizeEvalResultsSettings(raw.evalResults, defaults.evalResults),
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
    structure: {
      ...defaults.structure,
      ...structure,
      foldAllWrappers:
        structure.foldAllWrappers == null
          ? defaults.structure.foldAllWrappers
          : structure.foldAllWrappers !== false,
    },
    format: {
      ...defaults.format,
      ...format,
      lineWidth: coerceNumber(format.lineWidth, defaults.format.lineWidth),
      complexityThreshold: coerceNumber(format.complexityThreshold, defaults.format.complexityThreshold),
      minAvailableWidth: coerceNumber(format.minAvailableWidth, defaults.format.minAvailableWidth),
      indentStyle:
        format.indentStyle === "align" || format.indentStyle === "fixed"
          ? format.indentStyle
          : defaults.format.indentStyle,
      autoFormatOnMutation:
        format.autoFormatOnMutation == null
          ? defaults.format.autoFormatOnMutation
          : format.autoFormatOnMutation !== false,
    },
    hardware: {
      ...defaults.hardware,
      ...hardware,
      bindingsEnabled:
        hardware.bindingsEnabled == null
          ? defaults.hardware.bindingsEnabled
          : hardware.bindingsEnabled !== false,
      bindingFoldDefault:
        hardware.bindingFoldDefault == null
          ? defaults.hardware.bindingFoldDefault
          : hardware.bindingFoldDefault !== false,
      bindingQueueDepth: coerceNumber(
        hardware.bindingQueueDepth,
        defaults.hardware.bindingQueueDepth,
      ),
      holdTickHz: coerceNumber(
        hardware.holdTickHz,
        defaults.hardware.holdTickHz,
      ),
    },
    keybindings: keybindings
      ? normalizeKeybindingsSettings(keybindings, defaults.keybindings)
      : defaults.keybindings,
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
    evalResults: isRecord(patch.evalResults)
      ? { ...normalizedBase.evalResults, ...patch.evalResults }
      : normalizedBase.evalResults,
    runtime: isRecord(patch.runtime)
      ? { ...normalizedBase.runtime, ...patch.runtime }
      : normalizedBase.runtime,
    wasm: isRecord(patch.wasm)
      ? { ...normalizedBase.wasm, ...patch.wasm }
      : normalizedBase.wasm,
    structure: isRecord(patch.structure)
      ? { ...normalizedBase.structure, ...patch.structure }
      : normalizedBase.structure,
    hardware: isRecord(patch.hardware)
      ? { ...normalizedBase.hardware, ...patch.hardware }
      : normalizedBase.hardware,
    keybindings: isRecord(patch.keybindings)
      ? { ...(normalizedBase.keybindings || {}), ...patch.keybindings }
      : normalizedBase.keybindings,
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
      evalResults: { ...normalized.evalResults },
      runtime: { ...normalized.runtime },
      wasm: { ...normalized.wasm },
      ...(normalized.keybindings ? { keybindings: { ...normalized.keybindings } } : {}),
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
    patch.visualisation = extractVisualisationPatch(
      user.visualisation as Record<string, unknown>,
    );
  }

  if (isRecord(user.evalResults)) {
    patch.evalResults = { ...user.evalResults };
  }

  if (isRecord(user.runtime)) {
    patch.runtime = { ...user.runtime };
  }

  if (isRecord(user.wasm)) {
    patch.wasm = { ...user.wasm };
  }

  if (isRecord(user.hardware)) {
    patch.hardware = { ...user.hardware };
  }

  if (isRecord(user.keybindings)) {
    patch.keybindings = normalizeKeybindingsSettings(user.keybindings);
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
