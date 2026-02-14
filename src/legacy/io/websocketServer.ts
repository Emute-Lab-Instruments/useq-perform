/**
 * WebSocket Server Module for Dev Mode
 *
 * Provides a local WebSocket server that listens for messages from development scripts
 * and can trigger actions like disconnecting from the uSEQ module.
 */
import { WebSocketServer } from 'ws';
import { disconnect } from './serialComms.ts';
import { post } from './console.ts';
import { dbg } from '../utils.ts';

// ws package has no bundled types; use `any` for WS-related objects
type WsServer = any;
type WsSocket = any;
type HttpServer = any;

let wss: WsServer | null = null;
let server: HttpServer | null = null;

/**
 * Start the WebSocket server for dev mode
 */
export async function startWebSocketServer(port: number = 8082): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      // Create HTTP server for WebSocket
      const http = require('http');
      server = http.createServer();

      // Create WebSocket server
      wss = new WebSocketServer({ server });

      wss.on('connection', (ws: WsSocket, req: any) => {
        const clientInfo = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
        dbg(`WebSocket client connected from ${clientInfo}`);
        post(`**Info**: Dev mode WebSocket client connected from ${clientInfo}`);

        ws.on('message', (message: Buffer | string | ArrayBuffer) => {
          handleWebSocketMessage(message, ws);
        });

        ws.on('close', () => {
          dbg(`WebSocket client disconnected from ${clientInfo}`);
          post(`**Info**: Dev mode WebSocket client disconnected`);
        });

        ws.on('error', (error: Error) => {
          console.error('WebSocket error:', error);
          dbg(`WebSocket error from ${clientInfo}:`, error);
        });
      });

      wss.on('error', (error: Error) => {
        console.error('WebSocket server error:', error);
        reject(error);
      });

      server.listen(port, () => {
        dbg(`WebSocket server started on port ${port}`);
        post(`**Info**: Dev mode WebSocket server started on port ${port}`);
        resolve();
      });

      server.on('error', (error: Error) => {
        console.error('HTTP server error:', error);
        reject(error);
      });

    } catch (error) {
      console.error('Failed to start WebSocket server:', error);
      reject(error);
    }
  });
}

/** Parsed WebSocket message structure */
interface ParsedWsMessage {
  type: string;
  content?: string;
  [key: string]: unknown;
}

/**
 * Handle incoming WebSocket messages
 */
function handleWebSocketMessage(message: Buffer | string | ArrayBuffer, ws: WsSocket): void {
  try {
    // Convert message to string if it's not already
    const messageStr = typeof message === 'string' ? message : message.toString();
    dbg(`Received WebSocket message: ${messageStr}`);

    // Parse JSON message if possible
    let parsedMessage: ParsedWsMessage;
    try {
      parsedMessage = JSON.parse(messageStr);
    } catch (_e) {
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
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    }));
  }
}

/**
 * Handle disconnect-from-module message
 */
function handleDisconnectFromModule(ws: WsSocket): void {
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
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    }));
  }
}

/**
 * Stop the WebSocket server
 */
export async function stopWebSocketServer(): Promise<void> {
  return new Promise<void>((resolve) => {
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
 */
export function getWebSocketServer(): WsServer | null {
  return wss;
}

/**
 * Check if the WebSocket server is running
 */
export function isWebSocketServerRunning(): boolean {
  return wss !== null && server !== null;
}
