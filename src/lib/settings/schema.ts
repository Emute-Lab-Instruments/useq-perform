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
  nodeHighlightCornerRadius: number;
  nodeHighlightYOffset: number;
  /**
   * Indent-guide visibility:
   *   - "always": draw a guide for every multi-line container in the document
   *   - "path":   draw guides only for the focused node's ancestor chain
   *   - "never":  hide indent guides
   */
  indentGuideMode: "always" | "path" | "never";
  indentGuideWidth: number;
  indentGuideOpacity: number;
  indentGuideLuminosity: number;
  indentGuideDash: number;
  indentGuideGap: number;
  indentGuideYPadding: number;
}

export interface VisualisationSettings {
  showFutureProjection: boolean;
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
  /** Whether from-list/seq element-cycling highlights are shown without active probes. */
  fromListHighlights: boolean;
  /** Default per-probe window duration (ms) inherited by newly-created probes. */
  probeDefaultWindowDurationMs: number;
  /** Extra seconds of past samples retained beyond the visible window half. */
  historyHeadroom: number;
  /** Hard cap on total history depth per output (seconds). */
  maxHistorySeconds: number;
  /** Absolute change threshold for external inputs to trigger future re-projection. */
  inputEpsilon: number;
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
  /**
   * When `true`, the visualisation pipeline detects sustained frame
   * pressure (rAF tick > 50ms for several of the last 8 frames) and
   * progressively degrades quality (skip far-edge future push, slow
   * probe refresh, halve buffer sample rate) until headroom returns.
   * When `false`, pressure detection still runs but levers are inert.
   * See docs/specs/visualisation.md §1.7/§9.2.
   */
  adaptiveQuality: boolean;
  futureLineAlpha: number;
  minFutureSampleRate: number;
  extensionBatchSize: number;
  /**
   * Fraction of the visual past-buffer sample rate used for live WASM
   * ticks. 1.0 means one temporal sample for each horizontal visual
   * sample column; lower values reduce CPU cost.
   */
  temporalSampleRateMultiplier: number;
  /**
   * When `true`, each snippet in the help panel's Code Snippets tab
   * renders a small live oscilloscope strip that samples the snippet's
   * inner expression via `eval-at-time`. Devmode-only.
   */
  snippetOscilloscopesEnabled: boolean;
}

export interface RuntimeSettings {
  autoReconnect: boolean;
  startLocallyWithoutHardware: boolean;
}

export interface WasmSettings {
  enabled: boolean;
}

/**
 * Structural-editing settings. The functional-core / adapter implementation
 * is the only structural-editing path; the legacy `new-structure.ts`
 * implementation has been retired.
 */
export interface StructureSettings {
  /** Whether wrappers and holes are folded to inline pills by default. */
  foldAllWrappers: boolean;
  /**
   * Promotion target when slurping onto a bare leaf (structural-editing.md
   * §5.2.9). The leaf is first wrapped in a singleton compound of this kind.
   */
  atomSlurpBehaviour: "promote-to-vector" | "promote-to-list" | "no-op";
  /**
   * Whether typing a printable key while focused on an editable leaf enters
   * insertion mode (structural-editing.md §4.2). Suppressed for gamepad input.
   */
  autoEnterInsertion: boolean;
  /**
   * Whether no-op rejections emit a console toast alongside the cursor flash
   * (structural-editing.md §7.2). The halo flash always fires regardless.
   */
  flashConsoleToasts: boolean;
}

/** Auto-formatting policy (docs/specs/formatting.md). */
export interface FormatSettings {
  /** Maximum line width before breaking (§3.1). */
  lineWidth: number;
  /** Node weight at which a parent must break (§3.2). */
  complexityThreshold: number;
  /** Fall back to body indent when alignment leaves fewer chars than this (§3.4). */
  minAvailableWidth: number;
  /** "align": args align to first arg. "fixed": 2-space indent always (§5). */
  indentStyle: "align" | "fixed";
  /**
   * Strategy used to format the affected top-level form after a structural
   * mutation. Auto-formatting is an open design question — strategies are
   * pickable for experimentation (see §2.6 / §7).
   *
   *  - "off": flat single-line print, no post-pass.
   *  - "reflow": full §3 width/complexity reprint via `formatNode`.
   *  - "indent-fixed-point": flat print with newlines at `do` children, then
   *    iterate CodeMirror's `indentRange` (= "press Tab to fixed point") on
   *    the affected range.
   */
  autoFormatStrategy: "off" | "reflow" | "indent-fixed-point";
}

/**
 * Hardware binding settings (docs/specs/hardware-bindings.md §6).
 */
export interface HardwareSettings {
  /** Master switch — when off, all bindings are inert (§6.1). */
  bindingsEnabled: boolean;
  /** Whether on-press/on-release/on-button/on-toggle wrappers fold to chips by default (§6.2). */
  bindingFoldDefault: boolean;
  /** Max queued events per binding before drops (§6.3). */
  bindingQueueDepth: number;
  /** UI tick rate in Hz for on-button :hold phase dispatch (§6.4). */
  holdTickHz: number;
}

/**
 * Live-edit settings (docs/specs/live-edit.md §10).
 *
 * Only a subset of these are currently read by the implementation
 * (`idAlphabet`/`idLength` by `markAction.ts`); the remainder are declared
 * here so the documented configuration surface exists and persists. Each
 * field maps 1:1 to a numbered §10 entry.
 */
export interface LiveEditSettings {
  /** §10.1 — eval strategy used by `liveEdit.commit`. */
  commitTriggersEval: "immediate" | "quantised";
  /** §10.2 — URL-safe, low-ambiguity alphabet for generated `:id`s. */
  idAlphabet: string;
  /** §10.3 — generated `:id` length. */
  idLength: number;
  /** §10.4 — default scalar widget rendering. */
  scalarWidget: "knob" | "slider";
  /** §10.5 — time-to-live (hours) for orphaned persisted values. */
  orphanGcHours: number;
  /** §10.6 — initial preview-marker state in vector-mark sub-mode. */
  vectorMarkDefault: "all" | "none";
  /** §10.7 — idle delay (ms) before auto-eval; 0 disables auto-eval. */
  idleEvalMs: number;
  /** §10.8 — master switch for §6.6 idle auto-eval. */
  autoEvalOnIdle: boolean;
  /** §10.9 — UI tick rate (Hz) for value batching/sending. */
  uiTickHz: number;
  /** §10.10 — default dock position for the live-edit panel. */
  panelDock: "right" | "bottom" | "left";
  /** §10.11 — panel ordering strategy. */
  panelOrder: "document" | "custom";
  /** §10.13 — default MIDI channel-scope for new bindings. */
  midiChannelScopeDefault: "specific" | "any";
  /** §10.14 — focus-popover knob size (px). */
  knobExpandPx: number;
  /** §10.15 — Shift-held fine-drag step multiplier. */
  fineDragRatio: number;
}

/**
 * CV 1V/oct calibration settings (docs/specs/calibration.md §9).
 *
 * `sliderRangeCents`/`snapZeroToleranceCents`/`fineStepCents`/`coarseStepCents`
 * are read by `CalibrationSlider`; `carryForwardOffset` gates the sequencer's
 * carry-forward behaviour. `octaveRange`/`helperTextShown` are declared for the
 * documented surface (§9.1/§9.6, §8.2).
 */
export interface CalibrationSettings {
  /** §9.1 — octave point range. Reserved; not user-exposed in MVP. */
  octaveRange: { from: number; to: number };
  /** §9.2 — ±extent of the adjust slider in cents. */
  sliderRangeCents: number;
  /** §9.3 — soft-detent tolerance (cents) for the slider's zero snap. */
  snapZeroToleranceCents: number;
  /** §9.4 — step size for Shift+arrow / Shift+scroll. */
  fineStepCents: number;
  /** §9.5 — step size for Ctrl+arrow. */
  coarseStepCents: number;
  /** §9.6 — whether the slider helper text is shown. */
  helperTextShown: boolean;
  /** §9.7 — start the next octave at the previous octave's offset. */
  carryForwardOffset: boolean;
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

/**
 * How new console entries appear.
 *
 * - `"slide"`      — slide up with a short opacity fade
 * - `"fade"`       — simple opacity fade
 * - `"typewriter"` — characters revealed one at a time (rate controlled by `typewriterIntervalMs`)
 * - `"none"`       — instant, no animation
 */
export type ConsoleEntryAnimation = "slide" | "fade" | "typewriter" | "none";

export interface ConsoleSettings {
  /** Show HH:MM:SS timestamp on each entry. */
  showTimestamp: boolean;
  /** Show the type badge (log/warn/error/wasm) on each entry. */
  showTypeBadge: boolean;
  /** How new entries animate into the console. */
  entryAnimation: ConsoleEntryAnimation;
  /** Interval in ms between each character when using typewriter animation. */
  typewriterIntervalMs: number;
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
  /** Display mode for modifier-hold hints overlay. */
  modifierHintStyle?: "cursor" | "bar" | "modal";
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
  console: ConsoleSettings;
  evalResults: EvalResultsSettings;
  structure: StructureSettings;
  format: FormatSettings;
  hardware: HardwareSettings;
  liveEdit: LiveEditSettings;
  calibration: CalibrationSettings;
  keybindings?: KeybindingsSettings;
  keymaps?: Record<string, string>;
  [key: string]: unknown;
}

export type AppSettingsPatch = Partial<
  Omit<AppSettings, "editor" | "storage" | "ui" | "visualisation" | "runtime" | "wasm" | "console" | "evalResults" | "structure" | "format" | "hardware" | "liveEdit" | "calibration" | "keybindings">
> & {
  editor?: Partial<EditorSettings>;
  storage?: Partial<StorageSettings>;
  ui?: Partial<UISettings>;
  visualisation?: Partial<VisualisationSettings>;
  runtime?: Partial<RuntimeSettings>;
  wasm?: Partial<WasmSettings>;
  console?: Partial<ConsoleSettings>;
  evalResults?: Partial<EvalResultsSettings>;
  structure?: Partial<StructureSettings>;
  format?: Partial<FormatSettings>;
  hardware?: Partial<HardwareSettings>;
  liveEdit?: Partial<LiveEditSettings>;
  calibration?: Partial<CalibrationSettings>;
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
  showFutureProjection: false,
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
  fromListHighlights: true,
  probeDefaultWindowDurationMs: 1000,
  historyHeadroom: 5,
  maxHistorySeconds: 30,
  inputEpsilon: 0.01,
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
  adaptiveQuality: true,
  futureLineAlpha: 0.6,
  minFutureSampleRate: 30,
  extensionBatchSize: 4,
  temporalSampleRateMultiplier: 1,
  snippetOscilloscopesEnabled: false,
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
    nodeHighlightCornerRadius: 3,
    nodeHighlightYOffset: 0,
    indentGuideMode: "always",
    indentGuideWidth: 2,
    indentGuideOpacity: 0.6,
    indentGuideLuminosity: 0.5,
    indentGuideDash: 4,
    indentGuideGap: 4,
    indentGuideYPadding: 2,
  },
  visualisation: { ...DEFAULT_VISUALISATION },
  runtime: {
    autoReconnect: true,
    startLocallyWithoutHardware: true,
  },
  wasm: {
    enabled: true,
  },
  console: {
    showTimestamp: true,
    showTypeBadge: true,
    entryAnimation: "slide",
    typewriterIntervalMs: 20,
  },
  evalResults: {
    mode: "inline-ephemeral",
    autoDismissMs: 3000,
    maxChars: 200,
    showTimestamp: false,
  },
  structure: {
    foldAllWrappers: true,
    atomSlurpBehaviour: "promote-to-vector",
    autoEnterInsertion: true,
    flashConsoleToasts: true,
  },
  format: {
    lineWidth: 60,
    complexityThreshold: 4,
    minAvailableWidth: 20,
    indentStyle: "align",
    autoFormatStrategy: "reflow",
  },
  hardware: {
    bindingsEnabled: true,
    bindingFoldDefault: true,
    bindingQueueDepth: 4,
    holdTickHz: 30,
  },
  liveEdit: {
    commitTriggersEval: "immediate",
    idAlphabet: "abcdefghjkmnpqrstuvwxyz23456789",
    idLength: 4,
    scalarWidget: "knob",
    orphanGcHours: 24,
    vectorMarkDefault: "all",
    idleEvalMs: 1500,
    autoEvalOnIdle: true,
    uiTickHz: 60,
    panelDock: "right",
    panelOrder: "document",
    midiChannelScopeDefault: "specific",
    knobExpandPx: 112,
    fineDragRatio: 0.1,
  },
  calibration: {
    octaveRange: { from: 0, to: 4 },
    sliderRangeCents: 50,
    snapZeroToleranceCents: 0.3,
    fineStepCents: 0.1,
    coarseStepCents: 10,
    helperTextShown: true,
    carryForwardOffset: true,
  },
  keybindings: {
    profile: "default",
    layout: "qwerty-us",
  },
};

/**
 * The full set of object-valued section keys in {@link AppSettings}, in a
 * single shared list so the config writer and reader cannot silently desync.
 * `keybindings`/`keymaps` are handled specially (custom normalisation /
 * optionality) and are intentionally excluded here.
 */
export const APP_SETTINGS_SECTION_KEYS = [
  "editor",
  "storage",
  "ui",
  "visualisation",
  "runtime",
  "wasm",
  "console",
  "evalResults",
  "structure",
  "format",
  "hardware",
  "liveEdit",
  "calibration",
] as const satisfies readonly (keyof AppSettings)[];

export type AppSettingsSectionKey = (typeof APP_SETTINGS_SECTION_KEYS)[number];

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
    console: { ...defaultUserSettings.console },
    evalResults: { ...defaultUserSettings.evalResults },
    structure: { ...defaultUserSettings.structure },
    format: { ...defaultUserSettings.format },
    hardware: { ...defaultUserSettings.hardware },
    liveEdit: { ...defaultUserSettings.liveEdit },
    calibration: {
      ...defaultUserSettings.calibration,
      octaveRange: { ...defaultUserSettings.calibration.octaveRange },
    },
    keybindings: defaultUserSettings.keybindings
      ? { ...defaultUserSettings.keybindings }
      : undefined,
    keymaps: defaultUserSettings.keymaps
      ? { ...defaultUserSettings.keymaps }
      : undefined,
  };
}
