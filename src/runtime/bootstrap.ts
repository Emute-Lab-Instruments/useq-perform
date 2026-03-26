/**
 * Canonical bootstrap owner.
 *
 * All startup-mode derivation happens here exactly once. The exported
 * `bootstrap()` function is the single public entry point; legacy
 * `main.ts` becomes a thin `DOMContentLoaded` trampoline.
 *
 * Design invariants:
 *   1. `resolveBootstrapPlan` is called at most once per session.
 *   2. `publishRuntimeDiagnostics` is called at most once per session.
 *   3. The plan is threaded *into* `createApp` – the app never
 *      recomputes it.
 */

import { examineEnvironment, type EnvironmentState } from './startupContext.ts';
import { createApp } from './appLifecycle.ts';
import { loadConfigurationWithMetadata, getAppSettings } from './appSettingsRepository.ts';
import { initEditorPanel, setEditor } from '../lib/editorStore.ts';
import { createGamepadIntentEmitter } from '../lib/gamepadIntents.ts';
import { bindGamepadNavigation } from '../editors/gamepadNavigation.ts';
import { bindGamepadMenuBridge } from '../ui/adapters/gamepadMenuBridge.ts';
import { registerVisualisationPanel } from '../ui/adapters/visualisationPanel';
import { mountModal } from '../ui/adapters/modal.tsx';
import { mountPickerMenu } from '../ui/adapters/picker-menu.tsx';
import { mountDoubleRadialMenu } from '../ui/adapters/double-radial-menu.tsx';
import {
  publishRuntimeDiagnostics,
  reportBootstrapFailure,
  type RuntimeSettingsSource,
} from './runtimeDiagnostics.ts';
import { preloadHelpContent } from '../lib/helpContentPreloader.ts';
// ── Bootstrap plan (pure decision function) ─────────────────────

export type BootstrapStartupMode =
  | "hardware"
  | "browser-local"
  | "no-module"
  | "unsupported-browser";

export interface BootstrapPlanInput {
  noModuleMode: boolean;
  isWebSerialAvailable: boolean;
  wasmEnabled: boolean;
  startLocallyWithoutHardware: boolean;
}

export interface BootstrapPlan {
  startupMode: BootstrapStartupMode;
  startBrowserLocal: boolean;
  seedDefaultNoModuleExpressions: boolean;
  attemptHardwareReconnect: boolean;
  showUnsupportedBrowserWarning: boolean;
}

export function resolveBootstrapPlan(
  input: BootstrapPlanInput,
): BootstrapPlan {
  if (input.noModuleMode) {
    return {
      startupMode: "no-module",
      startBrowserLocal: true,
      seedDefaultNoModuleExpressions: true,
      attemptHardwareReconnect: false,
      showUnsupportedBrowserWarning: false,
    };
  }

  if (!input.isWebSerialAvailable) {
    return {
      startupMode: input.wasmEnabled ? "browser-local" : "unsupported-browser",
      startBrowserLocal: input.wasmEnabled,
      seedDefaultNoModuleExpressions: false,
      attemptHardwareReconnect: false,
      showUnsupportedBrowserWarning: !input.wasmEnabled,
    };
  }

  if (input.wasmEnabled && input.startLocallyWithoutHardware) {
    return {
      startupMode: "browser-local",
      startBrowserLocal: true,
      seedDefaultNoModuleExpressions: false,
      attemptHardwareReconnect: true,
      showUnsupportedBrowserWarning: false,
    };
  }

  return {
    startupMode: "hardware",
    startBrowserLocal: false,
    seedDefaultNoModuleExpressions: false,
    attemptHardwareReconnect: true,
    showUnsupportedBrowserWarning: false,
  };
}
import {
  bootstrapRuntimeSession,
  replaceSettings,
  getSettings,
} from './runtimeService.ts';

// ── Types ──────────────────────────────────────────────────────────

interface AppUI {
  mainEditor: any;
  serialVis: HTMLElement | null;
  logConsole: null;
  statusBar: HTMLElement | null;
}

export interface BootstrapResult {
  app: ReturnType<typeof createApp>;
  appUI: AppUI;
  environmentState: EnvironmentState;
  bootstrapPlan: BootstrapPlan;
}

// ── UI bootstrap ────────────────────────────────────────────────────
// Merged from legacy/ui/ui.ts

async function createAppUI(environmentState: any): Promise<AppUI> {
  const editor = await initEditorPanel("#panel-main-editor");

  const visPanelEl = document.getElementById("panel-vis");
  registerVisualisationPanel(visPanelEl);
  if (visPanelEl) visPanelEl.style.display = "none";

  // Start the visualisation canvas render loop
  const { makeVis } = await import("../ui/visualisation/serialVis.ts");
  makeVis();

  // Mount Solid UI adapters and wire editor store.
  // panels.tsx and toolbars.tsx are loaded dynamically so Vite can split them into
  // separate chunks. The try/catch guards against mount-time failures.
  try {
    const [panels, toolbars] = await Promise.all([
      import("../ui/adapters/panels.tsx"),
      import("../ui/adapters/toolbars.tsx"),
    ]);
    setEditor(editor);
    // Mount toolbars first (they replace the static HTML toolbar elements)
    toolbars.mountTransportToolbar();
    toolbars.mountMainToolbar();
    mountModal();
    mountPickerMenu();
    mountDoubleRadialMenu();
    // Mount panels and design selector
    panels.mountSettingsPanel();
    panels.mountHelpPanel();
    panels.mountDesignSelector(environmentState?.startupFlags?.devmode === true);
  } catch (error) {
    reportBootstrapFailure("ui-adapter-mount", error);
  }

  // Wire up intent-based gamepad system: emitter → channels → subscribers
  const gamepadEmitter = createGamepadIntentEmitter();
  const navHandle = bindGamepadNavigation(editor);
  const menuHandle = bindGamepadMenuBridge({ view: editor });
  gamepadEmitter.start();

  return {
    mainEditor: editor,
    serialVis: document.getElementById("panel-vis") || null,
    logConsole: null,
    statusBar: document.getElementById("status-bar") || null,
  };
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Run the full application bootstrap.
 *
 * 1. Load settings (defaults + localStorage + URL overrides).
 * 2. Detect environment capabilities once.
 * 3. Derive the bootstrap plan once.
 * 4. Seed the runtime session store.
 * 5. Publish diagnostics exactly once.
 * 6. Mount the UI and start the app.
 */
export async function bootstrap(): Promise<BootstrapResult> {
  // ── Step 1: load settings ──────────────────────────────────────
  let settingsSources: RuntimeSettingsSource[] = ['defaults'];

  try {
    const result = await loadConfigurationWithMetadata();
    settingsSources = result.settingsSources;
    replaceSettings(result.config, { dispatch: true });
  } catch (error) {
    reportBootstrapFailure('config-loader', error);
    console.warn('bootstrap: failed to load configuration, using defaults:', error);
  }

  // ── Step 1b: preload help content (fire-and-forget) ────────────
  preloadHelpContent();

  // ── Step 2: detect environment ─────────────────────────────────
  const environmentState = await examineEnvironment(getSettings());
  const { userSettings, startupFlags } = environmentState;

  // ── Step 3: derive bootstrap plan (single call site) ───────────
  const bootstrapPlan = resolveBootstrapPlan({
    noModuleMode: startupFlags.noModuleMode,
    isWebSerialAvailable: environmentState.isWebSerialAvailable,
    wasmEnabled: userSettings.wasm.enabled,
    startLocallyWithoutHardware: userSettings.runtime.startLocallyWithoutHardware,
  });

  // ── Step 4: seed runtime session ───────────────────────────────
  const runtimeState = bootstrapRuntimeSession(
    {
      hasHardwareConnection: false,
      noModuleMode: startupFlags.noModuleMode,
      wasmEnabled: userSettings.wasm.enabled,
    },
    { connected: false },
  );

  // ── Step 5: publish diagnostics (single call site) ─────────────
  publishRuntimeDiagnostics({
    startupMode: environmentState.areInBrowser
      ? bootstrapPlan.startupMode
      : 'browser-local',
    settingsSources: [...settingsSources],
    activeEnvironment: {
      areInBrowser: environmentState.areInBrowser,
      areInDesktopApp: environmentState.areInDesktopApp,
      isWebSerialAvailable: environmentState.isWebSerialAvailable,
      isInDevmode: environmentState.isInDevmode,
      urlParams: environmentState.urlParams,
    },
    protocolMode: runtimeState.protocolMode,
    runtimeSession: runtimeState.session,
  });

  // ── Step 6: mount UI + start app ───────────────────────────────
  const appUI = await createAppUI(environmentState);
  const app = createApp(appUI, environmentState, bootstrapPlan);
  await app.start();

  return { app, appUI, environmentState, bootstrapPlan };
}
