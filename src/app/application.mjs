import { post } from '../io/console.mjs';
import { checkForSavedPortAndMaybeConnect, setConnectedToModule } from '../io/serialComms.mjs';
import { ensureUseqWasmLoaded } from '../io/useqWasmInterpreter.mjs';
import { noModuleMode } from '../urlParams.mjs';
import { startWebSocketServer, stopWebSocketServer } from '../io/websocketServer.mjs';
import { showModal } from '../ui/modal.mjs';
import { initializeMockControls } from '../io/mockControlInputs.mjs';
import { startMockTimeGenerator } from '../io/mockTimeGenerator.mjs';

export function createApp(appUI, environmentState) {
  const app = {
    modals: {},

    async start() {
      // Show warning modal if Web Serial is not available in browser
      if (!noModuleMode && environmentState.areInBrowser && !environmentState.isWebSerialAvailable) {
        const modalContent = `
          <p>This browser doesn't support the WebSerial API. Please try using a Chrome or Chromium-based browser, like Brave or Microsoft Edge.</p>
          <p>The WebSerial API is required to connect to your uSEQ hardware module.</p>
        `;

        app.modals.webserialWarning = showModal(
          'webserial-warning-modal',
          'Browser Not Supported',
          modalContent
        );

        post('Web Serial API is not available in this browser. Please use a supported browser.');
        return;
      }

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

      // Check for saved port and maybe connect
      if (noModuleMode) {
        try {
          await ensureUseqWasmLoaded();
          post('No-module mode active: expressions will run on the in-browser interpreter.');

          setConnectedToModule(true);

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

          post('uSEQ: mock module connected.');
        } catch (error) {
          post('**Error**: Failed to initialise the in-browser interpreter.');
        }
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
