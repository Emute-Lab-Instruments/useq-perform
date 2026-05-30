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
import { attachBridgeToEditor, installPageLifecycleHandlers } from '../effects/liveEditRuntime.ts';
import { createGamepadPipeline } from '../lib/gamepad/index.ts';
import { bindGamepadNavigation, hideSystemCursor } from '../editors/gamepadNavigation.ts';
import { registerVisualisationPanel } from '../ui/adapters/visualisationPanel';
import { mountModal } from '../ui/adapters/modal.tsx';
import { mountRadialMenu } from '../ui/adapters/radialMenu.tsx';
import { mountMainMenu } from '../ui/adapters/mainMenu.tsx';
import { mountPalette } from '../ui/adapters/palette.tsx';
import { createMenuDispatcher } from '../lib/menu/dispatcher.ts';
import { menuState, dispatchMenuInput } from '../lib/menu/store.ts';
import { getCachedManifest } from '../lib/menu/manifest.ts';
import { mountModifierHints } from '../ui/adapters/modifier-hints.tsx';
import {
  publishRuntimeDiagnostics,
  reportBootstrapFailure,
  type RuntimeSettingsSource,
} from './runtimeDiagnostics.ts';
import { preloadHelpContent } from '../lib/helpContentPreloader.ts';
import { applyKeymapFromUrl } from './applyKeymapFromUrl.ts';
import {
  getActiveWasmRuntimePort,
  setActiveWasmRuntimePort,
} from './activeWasmRuntimePort.ts';
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

  // The visualisation runtime starts on demand when the panel is shown
  // (see `requestVisualisationRender` in `visualisationRuntime.ts`); no
  // boot-time rAF loop is needed.

  // Attach the live-edit store→widget bridge so reactive slot changes
  // flow into the CodeMirror widget decorations.
  attachBridgeToEditor(editor);

  // Install pagehide/visibilitychange flush for live-edit persistence (§7.2).
  installPageLifecycleHandlers();

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
    toolbars.mountOnboardingBanner();
    mountModal();
    mountRadialMenu();
    mountMainMenu();
    mountPalette();
    mountModifierHints();
    // Mount panels and design selector
    panels.mountSettingsPanel();
    panels.mountHelpPanel();
    panels.mountDesignSelector(environmentState?.startupFlags?.devmode === true);
  } catch (error) {
    reportBootstrapFailure("ui-adapter-mount", error);
  }

  // Mount virtual gamepad overlay when ?virtualGamepad=true is set.
  // Must be installed before the gamepad pipeline starts so the synthetic
  // gamepad is visible to the first poll.
  if (environmentState?.startupFlags?.params?.virtualGamepad === "true") {
    try {
      const { mountVirtualGamepad } = await import("../ui/adapters/virtualGamepad.tsx");
      mountVirtualGamepad();
    } catch (error) {
      reportBootstrapFailure("virtual-gamepad-mount", error);
    }
  }

  // Wire up three-stage gamepad pipeline + menu dispatcher.
  // Structural nav flows through the keybindings handler registry directly:
  // gamepad pipeline → ActionId (`nav.up`/`nav.down`/`nav.left`/`nav.right`,
  // `edit.*`) → handler → structural dispatcher. Menu actions (`menu.*`)
  // route to the menu dispatcher which drives the pure state machine.
  const menuDispatcher = createMenuDispatcher({
    getMenuState: menuState,
    dispatchInput: dispatchMenuInput,
    getManifest: () => getCachedManifest(),
    getEditorView: () => editor,
  });
  const gamepadPipeline = createGamepadPipeline({ editor, menuDispatcher, onAction: hideSystemCursor });
  const menuCleanup = menuDispatcher.bind(editor);
  const navHandle = bindGamepadNavigation(editor);
  // Expose dispatcher on window for console-driven testing during round 2.
  if (typeof globalThis !== 'undefined') {
    void import('../editors/extensions/structure/adapter/dispatcher.ts')
      .then((mod) => {
        (globalThis as unknown as Record<string, unknown>).__structDispatch =
          (action: string) => mod.dispatchAction(editor, action);
      })
      .catch(() => {
        // Best-effort exposure; failure is non-fatal for app boot.
      });
  }
  gamepadPipeline.start();

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

  // ── Step 1c: select the WASM runtime port. ──
  // Default: worker-backed port — WASM eval runs off the main thread.
  // The in-process port is the fallback when Web Workers are unavailable
  // or fail to construct (rare in practice, but keep the recovery path).
  if (typeof window !== "undefined" && typeof Worker !== "undefined") {
    try {
      const { createWasmRuntimeWorkerPort } = await import(
        "./wasmRuntimeWorkerPort.ts"
      );
      setActiveWasmRuntimePort(createWasmRuntimeWorkerPort());
    } catch (error) {
      reportBootstrapFailure("wasm-worker-port", error);
      console.warn(
        "[bootstrap] failed to construct WASM worker port; falling back to in-process:",
        error,
      );
    }
  }

  // Start the WASM download + compile immediately instead of waiting
  // until after app.start(), which already needs the WASM runtime.
  const wasmPreload = getActiveWasmRuntimePort()
    .ensureLoaded()
    .catch(() => {});


  // ── Step 2: detect environment ─────────────────────────────────
  const environmentState = await examineEnvironment(getSettings());

  // ── Step 2b: apply ?keymap URL profile ─────────────────────────
  // url-params.md §2.3: read independently of the startupFlags parser.
  if (typeof window !== "undefined") {
    try {
      applyKeymapFromUrl(window.location.href);
    } catch (error) {
      reportBootstrapFailure("keymap-url", error);
    }
  }

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
