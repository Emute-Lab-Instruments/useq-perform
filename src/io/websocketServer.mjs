/**
 * WebSocket Server Module for Dev Mode
 *
 * Provides a local WebSocket server that listens for messages from development scripts
 * and can trigger actions like disconnecting from the uSEQ module.
 */
import { WebSocketServer } from 'ws';
import { disconnect } from './serialComms.mjs';
import { post } from './console.mjs';
import { dbg } from '../utils.mjs';

let wss = null;
let server = null;

/**
 * Start the WebSocket server for dev mode
 * @param {number} port - Port to run the WebSocket server on (default: 8080)
 * @returns {Promise<void>}
 */
export async function startWebSocketServer(port = 8080) {
  return new Promise((resolve, reject) => {
    try {
      // Create HTTP server for WebSocket
      const http = require('http');
      server = http.createServer();

      // Create WebSocket server
      wss = new WebSocketServer({ server });

      wss.on('connection', (ws, req) => {
        const clientInfo = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
        dbg(`WebSocket client connected from ${clientInfo}`);
        post(`**Info**: Dev mode WebSocket client connected from ${clientInfo}`);

        ws.on('message', (message) => {
          handleWebSocketMessage(message, ws);
        });

        ws.on('close', () => {
          dbg(`WebSocket client disconnected from ${clientInfo}`);
          post(`**Info**: Dev mode WebSocket client disconnected`);
        });

        ws.on('error', (error) => {
          console.error('WebSocket error:', error);
          dbg(`WebSocket error from ${clientInfo}:`, error);
        });
      });

      wss.on('error', (error) => {
        console.error('WebSocket server error:', error);
        reject(error);
      });

      server.listen(port, () => {
        dbg(`WebSocket server started on port ${port}`);
        post(`**Info**: Dev mode WebSocket server started on port ${port}`);
        resolve();
      });

      server.on('error', (error) => {
        console.error('HTTP server error:', error);
        reject(error);
      });

    } catch (error) {
      console.error('Failed to start WebSocket server:', error);
      reject(error);
    }
  });
}

/**
 * Handle incoming WebSocket messages
 * @param {Buffer|string|ArrayBuffer} message - The message received
 * @param {WebSocket} ws - The WebSocket connection
 */
function handleWebSocketMessage(message, ws) {
  try {
    // Convert message to string if it's not already
    const messageStr = typeof message === 'string' ? message : message.toString();
    dbg(`Received WebSocket message: ${messageStr}`);

    // Parse JSON message if possible
    let parsedMessage;
    try {
      parsedMessage = JSON.parse(messageStr);
    } catch (e) {
      // Not JSON, treat as plain text
      parsedMessage = { type: 'text', content: messageStr };
    }

    // Handle different message types
    if (parsedMessage.type === 'disconnect-from-module' || messageStr === 'disconnect-from-module') {
      handleDisconnectFromModule(ws);
    } else if (parsedMessage.type === 'text') {
      // Echo back text messages for debugging
      post(`**Dev Mode**: ${parsedMessage.content}`);
      ws.send(JSON.stringify({
        type: 'echo',
        content: parsedMessage.content,
        timestamp: new Date().toISOString()
      }));
    } else {
      // Handle other structured messages
      post(`**Dev Mode**: Received structured message: ${JSON.stringify(parsedMessage)}`);
      ws.send(JSON.stringify({
        type: 'ack',
        received: parsedMessage,
        timestamp: new Date().toISOString()
      }));
    }

  } catch (error) {
    console.error('Error handling WebSocket message:', error);
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Failed to process message',
      error: error.message,
      timestamp: new Date().toISOString()
    }));
  }
}

/**
 * Handle disconnect-from-module message
 * @param {WebSocket} ws - The WebSocket connection
 */
function handleDisconnectFromModule(ws) {
  dbg('Received disconnect-from-module command via WebSocket');

  try {
    // Call the disconnect function from serialComms
    disconnect();

    // Send confirmation back to client
    ws.send(JSON.stringify({
      type: 'disconnect-confirmation',
      message: 'Successfully disconnected from module',
      timestamp: new Date().toISOString()
    }));

    post('**Info**: Disconnected from uSEQ module via dev mode WebSocket command');

  } catch (error) {
    console.error('Error disconnecting from module:', error);

    // Send error back to client
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Failed to disconnect from module',
      error: error.message,
      timestamp: new Date().toISOString()
    }));
  }
}

/**
 * Stop the WebSocket server
 * @returns {Promise<void>}
 */
export async function stopWebSocketServer() {
  return new Promise((resolve) => {
    if (wss) {
      dbg('Stopping WebSocket server...');
      wss.close(() => {
        dbg('WebSocket server stopped');
        post('**Info**: Dev mode WebSocket server stopped');
        wss = null;
        resolve();
      });
    } else {
      resolve();
    }

    if (server) {
      server.close();
      server = null;
    }
  });
}

/**
 * Get the current WebSocket server instance
 * @returns {WebSocketServer|null} The WebSocket server instance or null if not running
 */
export function getWebSocketServer() {
  return wss;
}

/**
 * Check if the WebSocket server is running
 * @returns {boolean} True if the server is running, false otherwise
 */
export function isWebSocketServerRunning() {
  return wss !== null && server !== null;
}
