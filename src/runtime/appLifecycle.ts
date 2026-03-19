import { post } from '../utils/consoleStore.ts';
import { checkForSavedPortAndMaybeConnect } from '../transport/connector.ts';
import { ensureUseqWasmLoaded } from './wasmInterpreter.ts';
import { startWebSocketServer, stopWebSocketServer } from '../effects/devmodeWebSocketServer.ts';
import { showModal } from '../ui/adapters/modal.tsx';
import { initializeMockControls } from '../effects/mockControlInputs.ts';
import { startLocalClock } from '../effects/localClock.ts';
import { registerVisualisation } from '../effects/visualisationSampler.ts';
import type { BootstrapPlan } from './bootstrapPlan.ts';
import { announceRuntimeSession } from './runtimeService.ts';
import { showVisualisationPanel } from '../ui/adapters/visualisationPanel';

const DEFAULT_NO_MODULE_EXPRESSIONS = [
  { exprType: 'a1', code: '(a1 bar)' },
  { exprType: 'a2', code: '(a2 (slow 2 bar))' }
];

function ensureSerialVisPanelVisibleForNoModule() {
  showVisualisationPanel();
}

async function activateNoModuleExpression({ exprType, code }) {
  try {
    await registerVisualisation(exprType, code);
    post(`uSEQ: ${code}`);
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const safeMessage = rawMessage.replace(/`/g, '\\`');
    post(`**Error**: Failed to evaluate ${code}: ${safeMessage}`);
    console.warn(`No-module startup expression failed for ${exprType}`, error);
  }
}

async function activateDefaultNoModuleExpressions() {
  for (const expression of DEFAULT_NO_MODULE_EXPRESSIONS) {
    await activateNoModuleExpression(expression);
  }
}

async function startBrowserLocalRuntime(options: {
  announceMessage: string;
  seedDefaultExpressions?: boolean;
}) {
  await ensureUseqWasmLoaded();
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

  post(options.announceMessage);

  if (options.seedDefaultExpressions) {
    post('uSEQ: mock module connected.');
    ensureSerialVisPanelVisibleForNoModule();
    await activateDefaultNoModuleExpressions();
  }
}

export function createApp(appUI, environmentState, bootstrapPlan: BootstrapPlan) {
  const app = {
    modals: {},

    async start() {
      // Start WebSocket server if in dev mode
      if (environmentState.isInDevmode) {
        try {
          await startWebSocketServer();
        } catch (error) {
          console.warn('Failed to start WebSocket server:', error);
        }
      }

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
          post('**Error**: Failed to initialise the in-browser interpreter.');
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

        post('**Warning**: Web Serial is unavailable and browser-local uSEQ is disabled.');
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
          post('**Error**: Failed to initialise the in-browser interpreter.');
        }

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
      // Stop WebSocket server if running
      if (environmentState.isInDevmode) {
        try {
          await stopWebSocketServer();
        } catch (error) {
          console.warn('Failed to stop WebSocket server:', error);
        }
      }
    }
  };

  return app;
}
