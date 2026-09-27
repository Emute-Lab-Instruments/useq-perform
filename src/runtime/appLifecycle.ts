import { post } from '../utils/consoleStore.ts';
import { checkForSavedPortAndMaybeConnect } from '../transport/connector.ts';
import { getActiveWasmRuntimePort } from './runtimeCoordinator.ts';
import { getTransportOrchestrator } from '../effects/transportOrchestrator.ts';

import { showModal, showConfirmModal } from '../ui/adapters/modal.tsx';
import { initializeMockControls } from '../effects/mockControlInputs.ts';
import { visualisationSession } from '../effects/visualisationSession.ts';
import {
  initHardwareConnectPrompt,
  teardownHardwareConnectPrompt,
} from '../effects/hardwareConnectPrompt.ts';
import {
  initFirmwareUpdatePrompt,
  teardownFirmwareUpdatePrompt,
} from '../effects/firmwareUpdatePrompt.ts';
import { webSerialHostPort } from '../transport/webSerialHostPort.ts';
import {
  createHardwareBindingDispatcher,
  type HardwareBindingDispatcherHandle,
  type DispatcherConfig,
} from '../effects/hardwareBindingDispatcher.ts';
import {
  setBindingChips,
  setBindingChipFireCallback,
} from '../editors/extensions/hardwareBinding/chipWidget.ts';
import { editor as getEditorSignal, getEditorContent } from '../lib/editorStore.ts';
import { pushDiagnostics } from '../editors/extensions/diagnostics.ts';
import { initStandaloneDiagnosticsRouter, teardownStandaloneDiagnosticsRouter } from '../effects/standaloneDiagnosticsRouter.ts';
import { initFailureModeSync, teardownFailureModeSync } from '../effects/failureModeSync.ts';
import type { BootstrapPlan } from './bootstrap.ts';
import type { EnvironmentState } from './startupContext.ts';
import {
  announceRuntimeSession,
  getRuntimeServiceSnapshot,
  subscribeRuntimeService,
  type RuntimeSessionState,
} from './runtimeService.ts';
import { showVisualisationPanel } from '../ui/adapters/visualisationPanel';
import { devicePluggedIn as devicePluggedInChannel } from '../contracts/runtimeChannels.ts';
import type { BrowserWasmRuntimeController } from './browserWasmRuntime.ts';
import { uninstallBrowserWasmRuntimeController } from './browserWasmRuntime.ts';

interface NoModuleExpression {
  exprType: string;
  code: string;
}

const DEFAULT_NO_MODULE_EXPRESSIONS: NoModuleExpression[] = [
  { exprType: 'a1', code: '(a1 bar)' },
  { exprType: 'a2', code: '(a2 (slow 2 bar))' }
];

function ensureSerialVisPanelVisibleForNoModule() {
  showVisualisationPanel();
}

async function activateNoModuleExpression({ exprType, code }: NoModuleExpression) {
  try {
    await visualisationSession.expressions.register(exprType, code);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    post(`Failed to evaluate ${code}: ${rawMessage}`, "error");
    console.warn(`No-module startup expression failed for ${exprType}`, error);
  }
}

async function activateDefaultNoModuleExpressions() {
  for (const expression of DEFAULT_NO_MODULE_EXPRESSIONS) {
    await activateNoModuleExpression(expression);
  }
}

/** Active hardware binding dispatcher handle — disposed on app.stop(). */
let hwBindingDispatcher: HardwareBindingDispatcherHandle | null = null;

/**
 * Build the DispatcherConfig that bridges the effects layer (dispatcher)
 * with the editors layer (chip widget). This lives in appLifecycle.ts
 * because the runtime layer is allowed to import from both.
 */
function createDispatcherConfig(): DispatcherConfig {
  return {
    syncChips(chips) {
      const view = getEditorSignal();
      if (view) setBindingChips(view, chips);
    },
    setFireCallback(cb) {
      setBindingChipFireCallback(cb);
    },
  };
}

async function startBrowserLocalRuntime(options: {
  announceMessage: string;
  startupMode: BootstrapPlan['startupMode'];
  seedDefaultExpressions?: boolean;
  recovering?: boolean;
}) {
  await getActiveWasmRuntimePort().ensureLoaded();
  announceRuntimeSession();

  if (options.recovering) {
    const program = getEditorContent();
    if (program?.trim()) {
      try {
        await getActiveWasmRuntimePort().evalCodeSilently(program);
      } catch (error) {
        console.warn('Recovered Worker could not replay the current editor program:', error);
      }
    }
  }

  try {
    await initializeMockControls();
  } catch (error) {
    console.warn('Failed to initialise mock controls:', error);
  }

  // Browser-local startup auto-runs through the transport machine so its
  // state, runtime command, and local-clock policy stay in sync. A Worker
  // activated as a hardware shadow must not start playback automatically.
  if (options.startupMode === 'browser-local' || options.startupMode === 'no-module') {
    getTransportOrchestrator().startBrowserLocalRuntime();
  }

  try {
    visualisationSession.shadow.start(webSerialHostPort, getActiveWasmRuntimePort());
  } catch (error) {
    console.warn('Failed to initialise state sync orchestrator:', error);
  }

  // runtime-modes.md §1.7: prompt to send the current program when hardware
  // connects while WASM is running (wasm → both transition).
  try {
    initHardwareConnectPrompt(showConfirmModal);
  } catch (error) {
    console.warn('Failed to initialise hardware-connect prompt:', error);
  }

  post(options.announceMessage);

  if (options.seedDefaultExpressions) {
    post('uSEQ: mock module connected.');
    ensureSerialVisPanelVisibleForNoModule();
    await activateDefaultNoModuleExpressions();
  }
}

export function createApp(
  appUI: { dispose?: () => void | Promise<void> } | null,
  environmentState: EnvironmentState,
  bootstrapPlan: BootstrapPlan,
  options: { browserWasmRuntime?: BrowserWasmRuntimeController } = {},
) {
  let stopped = false;
  let unsubscribeRuntime: (() => void) | null = null;
  let wasmActive = false;
  let wasmActivationInFlight = false;
  let wasmActivationFailed = false;
  let wasmHasActivated = false;
  let wasmActivationGeneration = 0;
  let unsubscribeDevicePluggedIn: (() => void) | null = null;

  async function activateAvailableWasm(): Promise<void> {
    if (stopped || wasmActive || wasmActivationInFlight || wasmActivationFailed) return;
    wasmActivationInFlight = true;
    const activationGeneration = wasmActivationGeneration;
    const recovering = wasmHasActivated;
    try {
      await startBrowserLocalRuntime({
        startupMode: bootstrapPlan.startupMode,
        announceMessage: !recovering && bootstrapPlan.startupMode === 'no-module'
          ? 'No-module mode active: expressions will run on the in-browser interpreter.'
          : recovering
          ? 'Browser-local uSEQ recovered; visualisation and probes resumed.'
          : environmentState.isWebSerialAvailable
            ? 'Browser-local uSEQ is ready. You can start editing and evaluating before hardware reconnect finishes.'
            : 'Web Serial is unavailable. Browser-local uSEQ is ready, and hardware can be paired later from a supported browser.',
        seedDefaultExpressions:
          !recovering && bootstrapPlan.seedDefaultNoModuleExpressions,
        recovering,
      });
      if (
        !stopped
        && activationGeneration === wasmActivationGeneration
        && getRuntimeServiceSnapshot().session.wasmEnabled
      ) {
        wasmActive = true;
        wasmHasActivated = true;
      } else {
        visualisationSession.shadow.stop();
      }
    } catch (error) {
      wasmActivationFailed = true;
      post(`Failed to initialise the in-browser interpreter: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      wasmActivationInFlight = false;
      if (!stopped && !wasmActivationFailed && getRuntimeServiceSnapshot().session.wasmEnabled && !wasmActive) {
        void activateAvailableWasm();
      }
    }
  }

  function reconcileRuntimeAvailability(state: RuntimeSessionState): void {
    if (state.session.wasmEnabled) {
      void activateAvailableWasm();
      return;
    }
    if (!wasmActive && !wasmActivationInFlight) return;
    wasmActivationGeneration += 1;
    wasmActive = false;
    visualisationSession.shadow.stop();
    if (!state.session.hasHardwareConnection) {
      visualisationSession.clock.setLocal(false);
    }
  }

  const app: { modals: Record<string, unknown>; start(): Promise<void>; stop(): Promise<void> } = {
    modals: {},

    async start() {
      unsubscribeDevicePluggedIn = devicePluggedInChannel.subscribe(() => {
        post('Previously saved uSEQ device detected; reconnecting.');
      });
      // Route unsolicited device→editor diagnostics frames (wire §5.9) into
      // the editor's inline annotation pipeline. Active in every runtime mode.
      initStandaloneDiagnosticsRouter({
        getEditor: getEditorSignal,
        pushDiagnostics,
      });

      // A published same-origin manifest activates this prompt. A missing
      // manifest is a silent "no beta available" state.
      initFirmwareUpdatePrompt(showConfirmModal);

      // Keep the engine's non-finite failure policy in step with the
      // runtime.failureMode setting across both runtimes (failure-model.md §3.2).
      initFailureModeSync();

      // Display welcome message
      const userName = environmentState.userSettings.name || 'User';
      post(`Hello, ${userName}!`);

      const plan = bootstrapPlan;

      unsubscribeRuntime = subscribeRuntimeService((state) => {
        wasmActivationFailed = false;
        reconcileRuntimeAvailability(state);
      });
      reconcileRuntimeAvailability(getRuntimeServiceSnapshot());

      // Hardware input bindings never wait for Worker readiness.
      if (!hwBindingDispatcher) {
        try {
          hwBindingDispatcher = createHardwareBindingDispatcher(createDispatcherConfig());
        } catch (error) {
          console.warn('Failed to start hardware binding dispatcher:', error);
        }
      }

      if (plan.startupMode === 'no-module') {
        post('No-module mode active: waiting for the in-browser Worker runtime.');
        return;
      }

      if (plan.showUnsupportedBrowserWarning) {
        const modalContent = `
          <p>No runtime is currently available. Browser-local WASM requires a working Web Worker, and no hardware runtime is active.</p>
          <p>Use a browser with Worker support or connect uSEQ hardware from a Web Serial-capable browser.</p>
        `;

        app.modals.webserialWarning = showModal(
          'webserial-warning-modal',
          'Browser Runtime Required',
          modalContent
        );

        post('Browser-local uSEQ is unavailable and no hardware runtime is active.', 'warn');
        announceRuntimeSession();
        return;
      }

      if (plan.startBrowserLocal) {
        if (plan.attemptHardwareReconnect) {
          void checkForSavedPortAndMaybeConnect();
        }
        return;
      }

      if (plan.attemptHardwareReconnect) {
        await checkForSavedPortAndMaybeConnect();
      }

    },

    async stop() {
      if (stopped) return;
      stopped = true;
      unsubscribeRuntime?.();
      unsubscribeRuntime = null;
      visualisationSession.dispose();
      teardownHardwareConnectPrompt();
      unsubscribeDevicePluggedIn?.();
      unsubscribeDevicePluggedIn = null;
      teardownStandaloneDiagnosticsRouter();
      teardownFailureModeSync();
      teardownFirmwareUpdatePrompt();
      const { teardownEngineAutoplayListener } = await import('../effects/engineAutoplayListener.ts');
      teardownEngineAutoplayListener();
      const [{ getActiveSynthesisService, setActiveSynthesisService }, { teardownBrowserEvalSurface }] = await Promise.all([
        import('./activeSynthesisService.ts'),
        import('./browserEvalSurface.ts'),
      ]);
      const synthesisService = getActiveSynthesisService();
      setActiveSynthesisService(null);
      try {
        await synthesisService?.dispose();
      } catch (error) {
        console.warn('Failed to dispose synthesis service during app shutdown:', error);
      }
      if (environmentState.startupFlags.devmode && typeof window !== 'undefined') {
        teardownBrowserEvalSurface(window);
        delete (window as unknown as Record<string, unknown>).__useqAudioCapabilities;
        delete (window as unknown as Record<string, unknown>).__useqSynthesisDev;
      }
      if (hwBindingDispatcher) {
        hwBindingDispatcher.dispose();
        hwBindingDispatcher = null;
      }
      if (options.browserWasmRuntime) {
        uninstallBrowserWasmRuntimeController(options.browserWasmRuntime);
      }
      const { disposeTransportOrchestrator } = await import('../effects/transportOrchestrator.ts');
      disposeTransportOrchestrator();
      const { disconnect } = await import('../transport/connector.ts');
      await disconnect();
      await appUI?.dispose?.();
    }
  };

  return app;
}
