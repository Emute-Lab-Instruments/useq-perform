import {
  defaultFontSize,
  defaultMainEditorStartingCode,
  defaultTheme,
} from "./editorDefaults.ts";
import { themes } from "../editors/themes.ts";
import type { RuntimeSettingsSource } from "../runtime/runtimeDiagnostics.ts";
import { isLocalStorageBypassedInStartupContext } from "../runtime/startupContext.ts";

export const CONFIG_VERSION = "1.0.0";
export const settingsStorageKey = "uSEQ-Perform-User-Settings";
export const codeStorageKey = "uSEQ-Perform-User-Code";

const legacyCodeStorageKey = "useqcode";
const legacyEditorConfigKey = "editorConfig";
const legacySettingsKey = "useqConfig";

export interface EditorSettings {
  code: string;
  theme: string;
  fontSize: number;
  preventBracketUnbalancing: boolean;
}

export interface StorageSettings {
  saveCodeLocally: boolean;
  autoSaveEnabled: boolean;
  autoSaveInterval: number;
}

export interface UISettings {
  consoleLinesLimit: number;
  customThemes: unknown[];
  osFamily: "pc" | "mac";
  expressionGutterEnabled: boolean;
  expressionLastTrackingEnabled: boolean;
  expressionClearButtonEnabled: boolean;
  gamepadPickerStyle: "grid" | "radial";
}

export interface VisualisationSettings {
  windowDuration: number;
  sampleCount: number;
  lineWidth: number;
  futureDashed: boolean;
  futureMaskOpacity: number;
  futureMaskWidth: number;
  circularOffset: number;
  futureLeadSeconds: number;
  digitalLaneGap: number;
}

export interface RuntimeSettings {
  autoReconnect: boolean;
  startLocallyWithoutHardware: boolean;
}

export interface WasmSettings {
  enabled: boolean;
}

export interface AppSettings {
  name: string;
  editor: EditorSettings;
  storage: StorageSettings;
  ui: UISettings;
  visualisation: VisualisationSettings;
  runtime: RuntimeSettings;
  wasm: WasmSettings;
  keymaps?: Record<string, string>;
  [key: string]: unknown;
}

type AppSettingsPatch = Partial<
  Omit<AppSettings, "editor" | "storage" | "ui" | "visualisation" | "runtime" | "wasm">
> & {
  editor?: Partial<EditorSettings>;
  storage?: Partial<StorageSettings>;
  ui?: Partial<UISettings>;
  visualisation?: Partial<VisualisationSettings>;
  runtime?: Partial<RuntimeSettings>;
  wasm?: Partial<WasmSettings>;
  keymaps?: Record<string, string>;
};

export interface StoredAppSettings
  extends Omit<AppSettings, "editor"> {
  editor: Omit<EditorSettings, "code"> & {
    code?: string;
  };
}

export interface ConfigDocumentMetadata {
  lastModified: string | null;
  source: string;
  description?: string;
}

export interface AppConfigDocument {
  version: string;
  metadata: ConfigDocumentMetadata;
  user: AppSettingsPatch;
  devMode: AppDevModeState;
}

export interface AppDevModeState {
  enabled: boolean;
  mockConnection: {
    autoConnect: boolean;
  };
  mockControls: {
    ain1: number;
    ain2: number;
    din1: number;
    din2: number;
    swm: number;
    swt: number;
  };
}

const DEFAULT_VISUALISATION: VisualisationSettings = {
  windowDuration: 10,
  sampleCount: 100,
  lineWidth: 1.5,
  futureDashed: true,
  futureMaskOpacity: 0.35,
  futureMaskWidth: 12,
  circularOffset: 0,
  futureLeadSeconds: 1,
  digitalLaneGap: 4,
};

export const defaultDevModeConfiguration: AppDevModeState = {
  enabled: false,
  mockConnection: {
    autoConnect: false,
  },
  mockControls: {
    ain1: 0.5,
    ain2: 0.5,
    din1: 0,
    din2: 0,
    swm: 0,
    swt: 0.5,
  },
};

export const defaultUserSettings: AppSettings = {
  name: "Livecoder",
  editor: {
    code: defaultMainEditorStartingCode,
    theme: defaultTheme,
    fontSize: defaultFontSize,
    preventBracketUnbalancing: true,
  },
  storage: {
    saveCodeLocally: true,
    autoSaveEnabled: true,
    autoSaveInterval: 5000,
  },
  ui: {
    consoleLinesLimit: 1000,
    customThemes: [],
    osFamily: "pc",
    expressionGutterEnabled: true,
    expressionLastTrackingEnabled: true,
    expressionClearButtonEnabled: true,
    gamepadPickerStyle: "grid",
  },
  visualisation: { ...DEFAULT_VISUALISATION },
  runtime: {
    autoReconnect: true,
    startLocallyWithoutHardware: true,
  },
  wasm: {
    enabled: true,
  },
};

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

export function createDefaultUserSettings(): AppSettings {
  return {
    ...defaultUserSettings,
    editor: { ...defaultUserSettings.editor },
    storage: { ...defaultUserSettings.storage },
    ui: {
      ...defaultUserSettings.ui,
      customThemes: [...defaultUserSettings.ui.customThemes],
    },
    visualisation: { ...defaultUserSettings.visualisation },
    runtime: { ...defaultUserSettings.runtime },
    wasm: { ...defaultUserSettings.wasm },
    keymaps: defaultUserSettings.keymaps
      ? { ...defaultUserSettings.keymaps }
      : undefined,
  };
}

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

export function isLocalStorageBypassed(options: {
  search?: string;
  bypassLocalStorage?: boolean;
} = {}): boolean {
  if (typeof options.bypassLocalStorage === "boolean") {
    return options.bypassLocalStorage;
  }

  if (typeof window === "undefined") {
    return isLocalStorageBypassedInStartupContext();
  }

  const search = options.search ?? window.location.search;

  try {
    return new URLSearchParams(search).has("nosave");
  } catch {
    return false;
  }
}

function shouldBypassLocalStorage(options: {
  bypassLocalStorage?: boolean;
  search?: string;
} = {}): boolean {
  if (typeof options.bypassLocalStorage === "boolean") {
    return options.bypassLocalStorage;
  }

  if (typeof window === "undefined") {
    return isLocalStorageBypassedInStartupContext();
  }

  return isLocalStorageBypassed(options);
}

function decodeStoredCode(code: unknown): string | null {
  if (typeof code !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(code);
    if (typeof parsed === "string") {
      return parsed;
    }
  } catch {
    // Keep plain-text code as the canonical format.
  }

  return code;
}

function hasLegacySettings(storage: Storage): boolean {
  return Boolean(
    storage.getItem(legacyEditorConfigKey) ||
      storage.getItem(legacySettingsKey) ||
      storage.getItem(legacyCodeStorageKey),
  );
}

function migrateLegacySettings(storage: Storage): AppSettingsPatch {
  const migrated: AppSettingsPatch = {};
  const editorConfigStr = storage.getItem(legacyEditorConfigKey);
  const settingsConfigStr = storage.getItem(legacySettingsKey);

  if (editorConfigStr) {
    try {
      const editorConfig = JSON.parse(editorConfigStr) as Record<string, unknown>;
      const themeNames = Object.keys(themes);
      const themeIndex = Number(editorConfig.currentTheme) % themeNames.length;
      migrated.editor = {
        ...editorConfig,
        theme: themeNames[themeIndex] || defaultTheme,
      };
      delete (migrated.editor as Record<string, unknown>).currentTheme;
    } catch { /* corrupt legacy data, skip migration */ }
    storage.removeItem(legacyEditorConfigKey);
  }

  if (settingsConfigStr) {
    try {
      const generalConfig = JSON.parse(settingsConfigStr);
      if (isRecord(generalConfig.storage)) {
        migrated.storage = {
          ...generalConfig.storage,
          saveCodeLocally:
            generalConfig.storage.savelocal == null
              ? undefined
              : generalConfig.storage.savelocal !== false,
        };
        delete (migrated.storage as Record<string, unknown>).savelocal;
      }

      if (isRecord(generalConfig.ui)) {
        migrated.ui = { ...generalConfig.ui };
      }
    } catch { /* corrupt legacy data, skip migration */ }
    storage.removeItem(legacySettingsKey);
  }

  const legacyCodeValue =
    storage.getItem(legacyCodeStorageKey) ?? storage.getItem(codeStorageKey);
  const decodedCode = decodeStoredCode(legacyCodeValue);
  if (decodedCode !== null) {
    migrated.editor = {
      ...(migrated.editor || {}),
      code: decodedCode,
    };
    storage.removeItem(legacyCodeStorageKey);
  }

  return migrated;
}

export function readPersistedUserSettings(options: {
  bypassLocalStorage?: boolean;
} = {}): AppSettings | null {
  if (typeof window === "undefined" || shouldBypassLocalStorage(options)) {
    return null;
  }

  const storage = window.localStorage;
  const storedSettingsStr = storage.getItem(settingsStorageKey);
  const legacySettingsPresent = hasLegacySettings(storage);
  const storedCodeValue = storage.getItem(codeStorageKey);

  if (!storedSettingsStr && storedCodeValue == null && !legacySettingsPresent) {
    return null;
  }

  let loaded: AppSettingsPatch = {};

  if (storedSettingsStr) {
    try {
      const parsed = JSON.parse(storedSettingsStr);
      loaded = isRecord(parsed) ? (parsed as Partial<AppSettings>) : {};
    } catch { /* corrupt stored settings, fall through to defaults */ }
  } else if (legacySettingsPresent) {
    loaded = migrateLegacySettings(storage);
  }

  const legacyCodeValue =
    !storedSettingsStr && legacySettingsPresent
      ? storage.getItem(legacyCodeStorageKey)
      : null;
  const decodedCode = decodeStoredCode(storedCodeValue ?? legacyCodeValue);
  if (decodedCode !== null) {
    loaded = {
      ...loaded,
      editor: {
        ...(loaded.editor ?? {}),
        code: decodedCode,
      },
    };
  }

  const normalized = normalizeUserSettings(loaded);
  writePersistedUserSettings(normalized);
  return normalized;
}

export function writePersistedUserSettings(settings: unknown, options: {
  bypassLocalStorage?: boolean;
} = {}): void {
  if (typeof window === "undefined" || shouldBypassLocalStorage(options)) {
    return;
  }

  const normalized = normalizeUserSettings(settings);
  const storedSettings = createStoredSettingsSnapshot(normalized);

  window.localStorage.setItem(settingsStorageKey, JSON.stringify(storedSettings));
  window.localStorage.setItem(codeStorageKey, normalized.editor.code);
}

export function clearPersistedUserSettings(): void {
  if (typeof window === "undefined") {
    return;
  }

  const storage = window.localStorage;
  storage.removeItem(settingsStorageKey);
  storage.removeItem(codeStorageKey);
  storage.removeItem(legacyEditorConfigKey);
  storage.removeItem(legacySettingsKey);
  storage.removeItem(legacyCodeStorageKey);
}

export async function loadBootstrapSettings(options: {
  defaultSettings?: unknown;
  loadUrlConfig?: () => Promise<unknown>;
  loadUrlCode?: () => Promise<string | null>;
  bypassLocalStorage?: boolean;
} = {}): Promise<{
  config: AppSettings;
  settingsSources: RuntimeSettingsSource[];
}> {
  const settingsSources: RuntimeSettingsSource[] = ["defaults"];
  let config = normalizeUserSettings(
    options.defaultSettings ?? createDefaultUserSettings(),
  );

  const persisted = readPersistedUserSettings({
    bypassLocalStorage: options.bypassLocalStorage,
  });
  if (persisted) {
    config = mergeUserSettings(config, persisted);
    settingsSources.push("local-storage");
  }

  if (options.loadUrlConfig) {
    const urlConfig = await options.loadUrlConfig();
    if (urlConfig) {
      config = mergeUserSettings(config, urlConfig);
      settingsSources.push("url-config");
    }
  }

  if (options.loadUrlCode) {
    const urlCode = await options.loadUrlCode();
    if (typeof urlCode === "string") {
      config = mergeUserSettings(config, {
        editor: { code: urlCode },
      });
      settingsSources.push("url-code");
    }
  }

  if (shouldBypassLocalStorage({ bypassLocalStorage: options.bypassLocalStorage })) {
    config = mergeUserSettings(config, {
      storage: { saveCodeLocally: false },
    });
    settingsSources.push("nosave");
  }

  return { config, settingsSources };
}
