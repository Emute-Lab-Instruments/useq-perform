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
  probeSampleCount: number;
  probeLineWidth: number;
  probeRefreshIntervalMs: number;
  futureDashed: boolean;
  futureMaskOpacity: number;
  futureMaskWidth: number;
  circularOffset: number;
  futureLeadSeconds: number;
  digitalLaneGap: number;
  /** Blur radius (px) for the readability overlay behind code text. */
  readabilityBlurRadius: number;
  /** Extra padding (px) around each code line in the blur mask. */
  readabilityPadding: number;
  /** Opacity (0–1) of a dark tint applied to blurred waveform content (frosted glass). */
  readabilityTintOpacity: number;
  /** Overall opacity (0–1) of the readability overlay when composited. */
  readabilityAlpha: number;
  /** Extra blur passes (0–5) that stack alpha for a denser effect without increasing radius. */
  readabilityPasses: number;
  /** Feather radius (px) to soften the edges of the mask polygons. */
  readabilityFeather: number;
  /** Maximum brightness reduction (0–1) the darken slider can apply. */
  readabilityMaxDarken: number;
  /** Debounce delay (ms) before polygon rebuild after scrolling stops. */
  readabilityDebounceMs: number;
  /** Lines of overscan beyond the viewport for pre-computed blur coverage during scroll. */
  readabilityOverscan: number;
  /** Whether the readability blur overlay is enabled at all. */
  readabilityEnabled: boolean;
}

export interface RuntimeSettings {
  autoReconnect: boolean;
  startLocallyWithoutHardware: boolean;
}

export interface WasmSettings {
  enabled: boolean;
}

/**
 * How evaluation results are displayed in the editor.
 *
 * - `"console"`          — results go to the console panel only (legacy default)
 * - `"inline"`           — result widget appended to the evaluated line, stays until next eval
 * - `"inline-ephemeral"` — same as inline but auto-dismisses after `autoDismissMs`
 * - `"floating"`         — floating tooltip near the evaluated expression, auto-dismisses
 */
export type EvalResultMode =
  | "console"
  | "inline"
  | "inline-ephemeral"
  | "floating";

export interface EvalResultsSettings {
  /** Display mode for eval results. */
  mode: EvalResultMode;
  /** Auto-dismiss timeout in ms. 0 = manual dismiss (only applies to ephemeral/floating). */
  autoDismissMs: number;
  /** Truncate displayed result text beyond this many characters. 0 = no limit. */
  maxChars: number;
  /** Show a timestamp next to the result. */
  showTimestamp: boolean;
}

export interface KeybindingsSettings {
  /** Base profile ID (e.g. "default", "vim", "emacs"). */
  profile: string;
  /** Keyboard layout identifier (e.g. "qwerty-us", "dvorak", "azerty"). */
  layout: string;
  /** ActionId → key override (sparse — only user-changed bindings). */
  overrides?: Record<string, string>;
  /** ActionId → gamepad combo overrides (sparse). */
  gamepadOverrides?: Record<string, string[]>;
  /** Milliseconds to wait for the next key in a chord sequence. */
  chordTimeout?: number;
  /** Milliseconds before modifier-hold hints appear. */
  modifierHintDelay?: number;
  /** Whether modifier keys latch instead of requiring hold. */
  stickyModifiers?: boolean;
}

export interface AppSettings {
  name: string;
  editor: EditorSettings;
  storage: StorageSettings;
  ui: UISettings;
  visualisation: VisualisationSettings;
  runtime: RuntimeSettings;
  wasm: WasmSettings;
  evalResults: EvalResultsSettings;
  keybindings?: KeybindingsSettings;
  keymaps?: Record<string, string>;
  [key: string]: unknown;
}

export type AppSettingsPatch = Partial<
  Omit<AppSettings, "editor" | "storage" | "ui" | "visualisation" | "runtime" | "wasm" | "evalResults" | "keybindings">
> & {
  editor?: Partial<EditorSettings>;
  storage?: Partial<StorageSettings>;
  ui?: Partial<UISettings>;
  visualisation?: Partial<VisualisationSettings>;
  runtime?: Partial<RuntimeSettings>;
  wasm?: Partial<WasmSettings>;
  evalResults?: Partial<EvalResultsSettings>;
  keybindings?: Partial<KeybindingsSettings>;
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
  probeSampleCount: 40,
  probeLineWidth: 2,
  probeRefreshIntervalMs: 33,
  futureDashed: true,
  futureMaskOpacity: 0.35,
  futureMaskWidth: 12,
  circularOffset: 0,
  futureLeadSeconds: 1,
  digitalLaneGap: 4,
  readabilityBlurRadius: 10,
  readabilityPadding: 3,
  readabilityTintOpacity: 0.5,
  readabilityAlpha: 0.85,
  readabilityPasses: 2,
  readabilityFeather: 4,
  readabilityMaxDarken: 0.85,
  readabilityDebounceMs: 80,
  readabilityOverscan: 30,
  readabilityEnabled: true,
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
  evalResults: {
    mode: "inline-ephemeral",
    autoDismissMs: 3000,
    maxChars: 200,
    showTimestamp: false,
  },
  keybindings: {
    profile: "default",
    layout: "qwerty-us",
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
    evalResults: { ...defaultUserSettings.evalResults },
    keybindings: defaultUserSettings.keybindings
      ? { ...defaultUserSettings.keybindings }
      : undefined,
    keymaps: defaultUserSettings.keymaps
      ? { ...defaultUserSettings.keymaps }
      : undefined,
  };
}
