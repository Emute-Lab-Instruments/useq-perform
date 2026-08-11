/**
 * Canonical bootstrap owner.
 *
 * All startup-mode derivation happens here exactly once. The exported
 * `bootstrap()` function is the single public entry point; legacy
 * `main.ts` becomes a thin `DOMContentLoaded` trampoline.
 *
 * Design invariants:
 *   1. `resolveBootstrapPlan` is called at most once per session.
 *   2. Bootstrap diagnostics are seeded once; runtime transitions may publish
 *      fresh snapshots as actual capabilities become available or fail.
 *   3. The plan is threaded *into* `createApp` – the app never
 *      recomputes it.
 */

import { examineEnvironment, type EnvironmentState } from './startupContext.ts';
import { createApp } from './appLifecycle.ts';
import type { EditorView } from '@codemirror/view';
import { loadConfigurationWithMetadata } from './appSettingsRepository.ts';
import { editorSession, setEditorSession } from '../lib/editorStore.ts';
import {
  disposeEditorLifecycle,
  initEditorPanel,
} from '../editors/editorLifecycle.ts';
import { recogniseStatefulForms } from '../editors/extensions/stateIdentity/identityClassify.ts';
import { installPageLifecycleHandlers, liveEditStore } from '../effects/liveEditRuntime.ts';
import {
  attachLiveEditStoreBridge,
  detachLiveEditStoreBridge,
} from '../editors/extensions/liveEdit/widgetStoreBridge.ts';
import { createGamepadPipeline } from '../lib/gamepad/index.ts';
import {
  bindGamepadNavigation,
  hideSystemCursor,
  readGamepadEditorContext,
} from '../editors/gamepadNavigation.ts';
import { executeAction } from '../editors/commands/actionHandlers.ts';
import { registerVisualisationPanel } from '../ui/adapters/visualisationPanel';
import { visualisationSession } from '../effects/visualisationSession.ts';
import { createMenuDispatcher } from '../lib/menu/dispatcher.ts';
import { menuState, dispatchMenuInput } from '../lib/menu/store.ts';
import { getCachedManifest } from '../lib/menu/manifest.ts';
import type { ApplicationRootHandle } from '../ui/ApplicationRoot.tsx';
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
  hasActiveWasmRuntimePort,
  isWasmRuntimeAvailable,
} from './runtimeCoordinator.ts';
import {
  createBrowserWasmRuntimeController,
  installBrowserWasmRuntimeController,
} from './browserWasmRuntime.ts';
import {
  clearBootstrapRecovery,
  showBootstrapRecovery,
} from './bootstrapRecoverySurface.ts';
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
    if (!input.wasmEnabled) {
      return {
        startupMode: "unsupported-browser",
        startBrowserLocal: false,
        seedDefaultNoModuleExpressions: false,
        attemptHardwareReconnect: false,
        showUnsupportedBrowserWarning: true,
      };
    }
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
  mainEditor: EditorView;
  serialVis: HTMLElement | null;
  logConsole: null;
  statusBar: HTMLElement | null;
  dispose(): void;
}

export interface BootstrapResult {
  app: ReturnType<typeof createApp>;
  appUI: AppUI;
  environmentState: EnvironmentState;
  bootstrapPlan: BootstrapPlan;
}

// ── UI bootstrap ────────────────────────────────────────────────────
// Merged from legacy/ui/ui.ts

async function createAppUI(environmentState: EnvironmentState): Promise<AppUI> {
  const documentSession = initEditorPanel("#panel-main-editor");
  const editor = documentSession.view;

  visualisationSession.begin();
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
  const removePageLifecycleHandlers = installPageLifecycleHandlers();

  // The editor must be visible to wired components before the single Solid
  // application root mounts.
  setEditorSession(documentSession);
  let applicationRoot: ApplicationRootHandle | null = null;
  try {
    // Keep pure bootstrap-plan consumers free of the browser-only Solid graph.
    // The application root is still mounted exactly once on the real UI path.
    const { mountApplicationRoot } = await import('../ui/ApplicationRoot.tsx');
    applicationRoot = mountApplicationRoot({
      devmode: environmentState?.startupFlags?.devmode === true,
      virtualGamepad: environmentState?.startupFlags?.params?.virtualGamepad === "true",
    });
    clearBootstrapRecovery("application-root");
  } catch (error) {
    reportBootstrapFailure("application-root-mount", error);
    showBootstrapRecovery({
      id: "application-root",
      title: "Application controls failed to start",
      message: "The editor is still available, but the application controls could not mount.",
      detail: error instanceof Error ? error.message : String(error),
    });
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
  const gamepadPipeline = createGamepadPipeline({
    editor,
    menuDispatcher,
    onAction: hideSystemCursor,
    actionExecutor: (action, view) => executeAction(action, "gamepad", view),
    readEditorContext: readGamepadEditorContext,
  });
  const menuCleanup = menuDispatcher.bind();
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

  let disposed = false;
  return {
    mainEditor: editor,
    serialVis: document.getElementById("panel-vis") || null,
    logConsole: null,
    statusBar: document.getElementById("status-bar") || null,
    dispose() {
      if (disposed) return;
      disposed = true;
      menuCleanup();
      navHandle.dispose();
      gamepadPipeline.dispose();
      applicationRoot?.dispose();
      registerVisualisationPanel(null);
      removePageLifecycleHandlers();
      detachLiveEditStoreBridge();
      disposeEditorLifecycle();
      setEditorSession(null);
    },
  };
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Run the full application bootstrap.
 *
 * 1. Load settings (defaults + localStorage + URL overrides).
 * 2. Detect environment capabilities once.
 * 3. Derive the bootstrap plan once.
 * 4. Seed the runtime coordinator.
 * 5. Seed bootstrap diagnostics and publish the initial snapshot.
 * 6. Mount the UI and start the app.
 */
export async function bootstrap(): Promise<BootstrapResult> {
  // ── Step 1: load settings ──────────────────────────────────────
  let settingsSources: RuntimeSettingsSource[] = ['defaults'];

  try {
    const result = await loadConfigurationWithMetadata();
    settingsSources = result.settingsSources;
    replaceSettings(result.config);
  } catch (error) {
    reportBootstrapFailure('config-loader', error);
    console.warn('bootstrap: failed to load configuration, using defaults:', error);
  }

  // ── Step 1b: preload help content (fire-and-forget) ────────────
  preloadHelpContent();

  // ── Step 1c: eagerly start (but do not await) Worker-only WASM. ──
  // Actual availability is published only after the Worker handshake. UI and
  // hardware startup continue while the Worker loads.
  const wasmConfigured = getSettings().wasm.enabled;
  const browserWasmRuntime = createBrowserWasmRuntimeController({
    onFailure({ reason, error }) {
      reportBootstrapFailure(`wasm-worker-${reason}`, error);
      const abiMismatch = reason === "abi-mismatch";
      showBootstrapRecovery({
        id: "wasm-worker",
        title: abiMismatch
          ? "Browser runtime ABI mismatch"
          : "Browser runtime unavailable",
        message: abiMismatch
          ? "The generated WASM bundle is incompatible with this editor. Hardware remains usable; rebuild or refresh the WASM assets."
          : "Hardware remains usable. Browser-local evaluation and visualisation probes are disabled until the Worker can start.",
        detail: error.message,
      });
      console.warn("[bootstrap] browser-local WASM unavailable:", error);
    },
    onRecovered() {
      clearBootstrapRecovery("wasm-worker");
    },
  });
  installBrowserWasmRuntimeController(browserWasmRuntime);
  void browserWasmRuntime.configure(wasmConfigured);


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
  if (
    environmentState.audioCapabilities.audioCapable
    && hasActiveWasmRuntimePort()
  ) {
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
        "./runtimeCoordinator.ts"
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
    wasmEnabled: userSettings.wasm.enabled && typeof Worker !== "undefined",
    startLocallyWithoutHardware: userSettings.runtime.startLocallyWithoutHardware,
  });

  // ── Step 4: seed runtime session ───────────────────────────────
  bootstrapRuntimeSession(
    {
      hasHardwareConnection: false,
      noModuleMode: startupFlags.noModuleMode,
      wasmEnabled: isWasmRuntimeAvailable(),
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
  const app = createApp(appUI, environmentState, bootstrapPlan, {
    browserWasmRuntime,
  });
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
