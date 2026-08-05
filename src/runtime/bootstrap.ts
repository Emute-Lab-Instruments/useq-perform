/**
 * Canonical bootstrap owner.
 *
 * All startup-mode derivation happens here exactly once. The exported
 * `bootstrap()` function is the single public entry point; legacy
 * `main.ts` becomes a thin `DOMContentLoaded` trampoline.
 *
 * Design invariants:
 *   1. `resolveBootstrapPlan` is called at most once per session.
 *   2. `publishDiagnosticsSnapshot` is called at most once per session.
 *   3. The plan is threaded *into* `createApp` – the app never
 *      recomputes it.
 */

import { examineEnvironment, type EnvironmentState } from './startupContext.ts';
import { createApp } from './appLifecycle.ts';
import { loadConfigurationWithMetadata, getAppSettings } from './appSettingsRepository.ts';
import { editorSession, initEditorPanel, setEditor } from '../lib/editorStore.ts';
import { recogniseStatefulForms } from '../editors/extensions/stateIdentity/identityClassify.ts';
import { installPageLifecycleHandlers, liveEditStore } from '../effects/liveEditRuntime.ts';
import { attachLiveEditStoreBridge } from '../editors/extensions/liveEdit/widgetStoreBridge.ts';
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
  seedBootstrapDiagnostics,
  publishDiagnosticsSnapshot,
  reportBootstrapFailure,
  type RuntimeSettingsSource,
} from './runtimeDiagnostics.ts';
import { preloadHelpContent } from '../lib/helpContentPreloader.ts';
import { setActiveSynthesisService } from './activeSynthesisService.ts';
import { applyKeymapFromUrl } from './applyKeymapFromUrl.ts';
import {
  installBrowserEvalSurface,
} from './browserEvalSurface.ts';
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

/**
 * Audio activation is only relevant once the editor contains a real synth
 * form. Use the same tree-aware classifier as the editor's state-identity
 * sidecar so `(synth ...)` inside a comment/string or a malformed partial
 * form cannot create a suspended AudioContext on an ordinary editor click.
 */
function editorContainsSynthForm(): boolean {
  const view = editorSession.view;
  return (
    view !== null &&
    recogniseStatefulForms(view.state).some(({ kind }) => kind === "synth")
  );
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
  attachLiveEditStoreBridge(editor, liveEditStore);

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
    // VAL-ENGINE-020/021: the synthesis engine indicator is a
    // transport-family member. Mount it after the transport toolbar
    // so the indicator's root can attach inside the toolbar area.
    toolbars.mountEngineIndicator();
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

  // ── Step 2b: expose immutable audio-capability telemetry (devmode only)
  //
  // VAL-HOST-005 / VAL-HOST-011: the bootstrap snapshot is read-only
  // devmode telemetry. Outside devmode the global is never installed so
  // production surfaces stay inert. The exposed value is the same frozen
  // object held by startupContext, so attempts to mutate it throw in
  // strict mode.
  if (startupFlags.devmode && typeof window !== "undefined") {
    (window as unknown as { __useqAudioCapabilities?: unknown }).__useqAudioCapabilities =
      environmentState.audioCapabilities;
    // VAL-CROSS-013 (verified browser eval route): install a tiny
    // devmode-only surface that routes agent-browser eval through the
    // production `evaluate(view, "toplevel")` function. Prior evidence
    // used an unverified synthetic `KeyboardEvent` dispatched via
    // `dispatchEvent`, which silently failed in several journey steps
    // and could not prove the synth committed. The surface reads the
    // editor and telemetry at call time so it stays correct across
    // hot-reload and recovery.
    installBrowserEvalSurface(window);
  }

  // ── Step 2c: construct the synthesis service (VAL-ENGINE-017..022).
  //
  // The service owns AudioContext, worklet node, NodeDef module
  // compilation, engine state, and graph lifecycle. Construction is
  // lazy: the AudioContext is NOT created here — the service waits for
  // the first `resumeOnUserActivation()` call, which respects the
  // browser autoplay contract (synthesis.md §6.5).
  //
  // In devmode the read-only telemetry global is installed and the
  // controlled fault actions (producer termination, reinitialise) are
  // exposed on `window.__useqSynthesisDev`. Outside devmode neither
  // surface exists (VAL-HOST-011 / VAL-HOST-012).
  //
  // VAL-ENGINE-017/018/019: a global capture-phase keydown/pointerdown
  // listener is installed after the service is registered. Only trusted
  // events reach the resume path; programmatic and non-user triggers
  // (timers, synthetic events, gamepad intents, restored code, idle
  // auto-eval) cannot grant activation.
  //
  // VAL-ENGINE-022: suspended and error transitions post one clear
  // non-flooding console message through the central console store.
  if (environmentState.audioCapabilities.audioCapable) {
    try {
      const [{ createBrowserSynthesisService }, { addConsoleMessage }] =
        await Promise.all([
          import("../audio/synthesisServiceBrowser.ts"),
          import("../utils/consoleStore.ts"),
        ]);
      // VAL-ENGINE-010: the synthesis service arms the Worker producer's
      // program epoch after every successful synth commit. The active
      // WASM runtime port is the Worker-backed implementation; its
      // `producerArmEpoch` method satisfies the SynthesisWorkerPort
      // contract. We pass the same port the eval pipeline uses so
      // there is exactly one Worker and one producer.
      const { getActiveWasmRuntimePort } = await import(
        "./activeWasmRuntimePort.ts"
      );
      const synthesisService = createBrowserSynthesisService({
        capabilities: environmentState.audioCapabilities,
        devmode: startupFlags.devmode,
        workerPort: getActiveWasmRuntimePort(),
        consoleMessageSink: (message, type) => {
          // The synthesis service emits plain strings; the console
          // store escapes and renders inline markdown. The sink types
          // map directly: error → error, otherwise log.
          addConsoleMessage(message, type === "error" ? "error" : "log");
        },
      });
      // Register the service so the autoplay listener and the engine
      // indicator adapter can reach it through the accessor.
      setActiveSynthesisService(synthesisService);
      // Install the global autoplay resume listener. The listener
      // filters on event.isTrusted so only real user input reaches
      // the service's resume path.
      const { installEngineAutoplayListener } = await import(
        "../effects/engineAutoplayListener.ts"
      );
      installEngineAutoplayListener({
        // Autoplay recovery is for the synthesis engine only. Ordinary
        // output expressions use the browser-local rAF clock and must not
        // create a suspended AudioContext merely because the editor was
        // clicked.
        shouldAttemptResume: editorContainsSynthForm,
      });
    } catch (error) {
      reportBootstrapFailure("synthesis-service", error);
    }
  }

  // ── Step 3: derive bootstrap plan (single call site) ───────────
  const bootstrapPlan = resolveBootstrapPlan({
    noModuleMode: startupFlags.noModuleMode,
    isWebSerialAvailable: environmentState.isWebSerialAvailable,
    wasmEnabled: userSettings.wasm.enabled,
    startLocallyWithoutHardware: userSettings.runtime.startLocallyWithoutHardware,
  });

  // ── Step 4: seed runtime session ───────────────────────────────
  bootstrapRuntimeSession(
    {
      hasHardwareConnection: false,
      noModuleMode: startupFlags.noModuleMode,
      wasmEnabled: userSettings.wasm.enabled,
    },
    { connected: false },
  );

  // ── Step 5: publish diagnostics (single call site) ─────────────
  // Seed the bootstrap-only fields (startupMode, settingsSources); the rest of
  // the snapshot (activeEnvironment, protocolMode, runtimeSession) is derived
  // from canonical state by publishDiagnosticsSnapshot().
  seedBootstrapDiagnostics({
    startupMode: environmentState.areInBrowser
      ? bootstrapPlan.startupMode
      : 'browser-local',
    settingsSources: [...settingsSources],
  });
  publishDiagnosticsSnapshot();

  // ── Step 6: mount UI + start app ───────────────────────────────
  const appUI = await createAppUI(environmentState);
  const app = createApp(appUI, environmentState, bootstrapPlan);
  await app.start();

  // ── Step 7: optional native-bridge connection ──────────────────
  // `?nativeBridge[=<port>]` connects to a uSEQ engine running in a separate
  // native process (e.g. the VCV Rack plugin) over a loopback WebSocket,
  // presenting it to the rest of the app as an ordinary serial port. Distinct
  // from `noModuleMode` (which freezes WASM-only mode and is left false here so
  // both eval and stream dispatch reach the native engine).
  await maybeConnectNativeBridge(environmentState);

  return { app, appUI, environmentState, bootstrapPlan };
}

const DEFAULT_NATIVE_BRIDGE_PORT = 17890;

/**
 * Connect to a native uSEQ bridge over a loopback WebSocket when the
 * `?nativeBridge` (or `?wsPort=`) URL param is present.
 *
 * Runs after `app.start()` so it composes with the normal startup plan rather
 * than racing it: any saved-port auto-reconnect (`attemptHardwareReconnect`)
 * targets `navigator.serial.getPorts()`, which can never contain the virtual
 * port, so there is no conflict. The injected port flows through the same
 * `connectToSerialPort()` entry as real hardware, so `hasHardwareConnection`
 * flips true and the handshake proceeds identically (bead useq-perform-3zfc).
 */
async function maybeConnectNativeBridge(
  environmentState: EnvironmentState,
): Promise<void> {
  const params = environmentState.startupFlags?.params ?? {};
  const raw = params.nativeBridge ?? params.wsPort;
  if (raw === undefined) return;

  const parsed = Number.parseInt(raw, 10);
  const wsPort =
    Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_NATIVE_BRIDGE_PORT;
  const url = `ws://127.0.0.1:${wsPort}`;

  try {
    const [{ WebSocketSerialPort }, { connectToSerialPort, disconnect }] =
      await Promise.all([
        import("../transport/webSocketSerialPort.ts"),
        import("../transport/connector.ts"),
      ]);
    const serialPort = new WebSocketSerialPort({
      url,
      // Propagate socket close to connection-state teardown — a WS-backed port
      // never emits a navigator.serial "disconnect" event (bead useq-perform-0lzs).
      onClose: () => {
        void disconnect(serialPort);
      },
    });
    console.log(`[bootstrap] native bridge: connecting to ${url}`);
    await connectToSerialPort(serialPort);
  } catch (error) {
    reportBootstrapFailure("native-bridge", error);
    console.error(`[bootstrap] native bridge connect to ${url} failed:`, error);
  }
}
