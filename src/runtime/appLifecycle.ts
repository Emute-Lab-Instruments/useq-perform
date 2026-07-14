import { post } from '../utils/consoleStore.ts';
import { checkForSavedPortAndMaybeConnect } from '../transport/connector.ts';
import { getActiveWasmRuntimePort } from './activeWasmRuntimePort.ts';
import { SHARED_TRANSPORT_COMMANDS } from '../contracts/useqRuntimeContract.ts';

import { showModal, showConfirmModal } from '../ui/adapters/modal.tsx';
import { initializeMockControls } from '../effects/mockControlInputs.ts';
import { startLocalClock } from '../effects/localClock.ts';
import { registerVisualisation } from '../effects/visualisationSampler.ts';
import {
  initStateSyncOrchestrator,
  teardownStateSyncOrchestrator,
} from '../effects/stateSyncOrchestrator.ts';
import { initHardwareConnectPrompt } from '../effects/hardwareConnectPrompt.ts';
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
import { editor as getEditorSignal } from '../lib/editorStore.ts';
import { initStandaloneDiagnosticsRouter } from '../effects/standaloneDiagnosticsRouter.ts';
import { initFailureModeSync } from '../effects/failureModeSync.ts';
import type { BootstrapPlan } from './bootstrap.ts';
import type { EnvironmentState } from './startupContext.ts';
import { announceRuntimeSession } from './runtimeService.ts';
import { showVisualisationPanel } from '../ui/adapters/visualisationPanel';

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
    await registerVisualisation(exprType, code);
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
  seedDefaultExpressions?: boolean;
}) {
  await getActiveWasmRuntimePort().ensureLoaded();
  announceRuntimeSession();

  try {
    await initializeMockControls();
  } catch (error) {
    console.warn('Failed to initialise mock controls:', error);
  }

  try {
    startLocalClock();
  } catch (error) {
    console.warn('Failed to start local clock:', error);
  }

  // The transport machine boots "paused" (transport.machine.ts initial:'paused'),
  // and emitPlay only fires on transitions. Browser-local (hardware-optional)
  // startup intentionally auto-runs the program for instant feedback, so we send
  // (useq-play) to the WASM interpreter explicitly here. This nudges only the
  // interpreter, not the machine's state value. Documented as the intended
  // behaviour in transport.md §1.1.
  try {
    await getActiveWasmRuntimePort().sendTransportCommand(SHARED_TRANSPORT_COMMANDS.play);
  } catch (_e) {
    // Non-fatal: the interpreter will accept play commands later.
  }

  // Start hardware binding dispatcher after WASM and editor are available.
  try {
    hwBindingDispatcher = createHardwareBindingDispatcher(createDispatcherConfig());
  } catch (error) {
    console.warn('Failed to start hardware binding dispatcher:', error);
  }

  try {
    initStateSyncOrchestrator(webSerialHostPort, getActiveWasmRuntimePort());
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
  appUI: unknown,
  environmentState: EnvironmentState,
  bootstrapPlan: BootstrapPlan,
) {
  void appUI;
  const app: { modals: Record<string, unknown>; start(): Promise<void>; stop(): Promise<void> } = {
    modals: {},

    async start() {
      // Route unsolicited device→editor diagnostics frames (wire §5.9) into
      // the editor's inline annotation pipeline. Active in every runtime mode.
      initStandaloneDiagnosticsRouter();

      // Keep the engine's non-finite failure policy in step with the
      // runtime.failureMode setting across both runtimes (failure-model.md §3.2).
      initFailureModeSync();

      // Display welcome message
      const userName = environmentState.userSettings.name || 'User';
      post(`Hello, ${userName}!`);

      const plan = bootstrapPlan;

      if (plan.startupMode === 'no-module') {
        try {
          await startBrowserLocalRuntime({
            announceMessage: 'No-module mode active: expressions will run on the in-browser interpreter.',
            seedDefaultExpressions: plan.seedDefaultNoModuleExpressions,
          });
        } catch (error) {
          post('Failed to initialise the in-browser interpreter.', 'error');
        }
        return;
      }

      if (plan.showUnsupportedBrowserWarning) {
        const modalContent = `
          <p>This browser doesn't support the WebSerial API, and browser-local WASM is disabled in settings.</p>
          <p>Use a Chromium-based browser or re-enable the browser-local runtime to keep working locally.</p>
        `;

        app.modals.webserialWarning = showModal(
          'webserial-warning-modal',
          'Browser Runtime Required',
          modalContent
        );

        post('Web Serial is unavailable and browser-local uSEQ is disabled.', 'warn');
        announceRuntimeSession();
        return;
      }

      if (plan.startBrowserLocal) {
        try {
          await startBrowserLocalRuntime({
            announceMessage: environmentState.isWebSerialAvailable
              ? 'Browser-local uSEQ is ready. You can start editing and evaluating before hardware reconnect finishes.'
              : 'Web Serial is unavailable. Browser-local uSEQ is ready, and hardware can be paired later from a supported browser.',
          });
        } catch (_error) {
          post('Failed to initialise the in-browser interpreter.', 'error');
        }

        if (plan.attemptHardwareReconnect) {
          void checkForSavedPortAndMaybeConnect();
        }
        return;
      }

      if (plan.attemptHardwareReconnect) {
        await checkForSavedPortAndMaybeConnect();
      }

      // Start hardware binding dispatcher for hardware-only mode too.
      // Events from the device still need binding dispatch even without
      // a browser-local WASM runtime.
      if (!hwBindingDispatcher) {
        try {
          hwBindingDispatcher = createHardwareBindingDispatcher(createDispatcherConfig());
        } catch (error) {
          console.warn('Failed to start hardware binding dispatcher:', error);
        }
      }
    },

    async stop() {
      teardownStateSyncOrchestrator();
      if (hwBindingDispatcher) {
        hwBindingDispatcher.dispose();
        hwBindingDispatcher = null;
      }
    }
  };

  return app;
}
