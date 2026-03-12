import { post } from '../../utils/consoleStore.ts';
import { announceRuntimeSession, checkForSavedPortAndMaybeConnect } from '../io/serialComms.ts';
import { ensureUseqWasmLoaded } from '../io/useqWasmInterpreter.ts';
import { noModuleMode } from '../urlParams.ts';
import { startWebSocketServer, stopWebSocketServer } from '../io/websocketServer.ts';
import { showModal } from '../../ui/adapters/modal.tsx';
import { initializeMockControls } from '../io/mockControlInputs.ts';
import { startMockTimeGenerator } from '../io/mockTimeGenerator.ts';
import { registerVisualisation } from '../ui/serialVis/visualisationController.ts';
import { toggleSerialVis } from '../editors/editorConfig.ts';

const DEFAULT_NO_MODULE_EXPRESSIONS = [
  { exprType: 'a1', code: '(a1 bar)' },
  { exprType: 'a2', code: '(a2 (slow 2 bar))' }
];

function ensureSerialVisPanelVisibleForNoModule() {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }

  const panel = document.getElementById('panel-vis');
  if (!panel) {
    return;
  }

  const computed = window.getComputedStyle(panel);
  const hidden = panel.hidden || computed.display === 'none' || computed.visibility === 'hidden';
  if (!hidden) {
    return;
  }

  let panelShown = false;

  try {
    panelShown = Boolean(toggleSerialVis());
  } catch (error) {
    console.warn('Failed to toggle serial visualisation panel automatically via helper:', error);
  }

  if (!panelShown) {
    panel.hidden = false;
    panel.style.display = 'block';
    panel.style.visibility = 'visible';
    panel.style.opacity = '0.7';
    panel.style.pointerEvents = 'none';

    const canvas = document.getElementById('serialcanvas');
    if (canvas) {
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.pointerEvents = 'none';

      try {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      } catch (dimensionError) {
        console.warn('Failed to resize serial visualisation canvas during fallback:', dimensionError);
      }
    }

    panelShown = true;
  }

  if (panelShown && typeof window.dispatchEvent === 'function') {
    const CustomEventCtor = window.CustomEvent || globalThis?.CustomEvent;
    if (typeof CustomEventCtor === 'function') {
      try {
        window.dispatchEvent(new CustomEventCtor('useq-serialvis-auto-open', { detail: { source: 'no-module-startup' } }));
      } catch (dispatchError) {
        console.warn('Failed to dispatch serial visualisation auto-open event:', dispatchError);
      }
    }
  }
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
    startMockTimeGenerator();
  } catch (error) {
    console.warn('Failed to start mock time generator:', error);
  }

  post(options.announceMessage);

  if (options.seedDefaultExpressions) {
    post('uSEQ: mock module connected.');
    ensureSerialVisPanelVisibleForNoModule();
    await activateDefaultNoModuleExpressions();
  }
}

export function createApp(appUI, environmentState) {
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

      const isWasmEnabled = environmentState.userSettings?.wasm?.enabled !== false;
      const startLocallyWithoutHardware =
        environmentState.userSettings?.runtime?.startLocallyWithoutHardware !== false;

      if (noModuleMode) {
        try {
          await startBrowserLocalRuntime({
            announceMessage: 'No-module mode active: expressions will run on the in-browser interpreter.',
            seedDefaultExpressions: true,
          });
        } catch (error) {
          post('**Error**: Failed to initialise the in-browser interpreter.');
        }
        return;
      }

      if (!environmentState.isWebSerialAvailable) {
        if (isWasmEnabled) {
          try {
            await startBrowserLocalRuntime({
              announceMessage:
                'Web Serial is unavailable. Browser-local uSEQ is ready, and hardware can be paired later from a supported browser.',
            });
          } catch (_error) {
            post('**Error**: Failed to initialise the in-browser interpreter.');
          }
        } else {
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
        }
        return;
      }

      if (isWasmEnabled && startLocallyWithoutHardware) {
        try {
          await startBrowserLocalRuntime({
            announceMessage:
              'Browser-local uSEQ is ready. You can start editing and evaluating before hardware reconnect finishes.',
          });
        } catch (_error) {
          post('**Error**: Failed to initialise the in-browser interpreter.');
        }

        void checkForSavedPortAndMaybeConnect();
        return;
      }

      await checkForSavedPortAndMaybeConnect();
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
