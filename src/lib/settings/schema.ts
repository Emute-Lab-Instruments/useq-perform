/**
 * Settings Schema
 *
 * Type definitions, default values, and factory functions for application settings.
 */

import {
  defaultFontSize,
  defaultMainEditorStartingCode,
  defaultTheme,
} from "../editorDefaults.ts";

export const CONFIG_VERSION = "1.0.0";
export const settingsStorageKey = "uSEQ-Perform-User-Settings";
export const codeStorageKey = "uSEQ-Perform-User-Code";

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

export type AppSettingsPatch = Partial<
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
