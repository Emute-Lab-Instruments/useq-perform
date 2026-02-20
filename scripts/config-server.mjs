#!/usr/bin/env node

/**
 * Configuration WebSocket Server
 *
 * Runs alongside npm run dev to handle configuration file writes.
 * Listens on port 8081 for save-config messages from the webapp.
 *
 * This server has filesystem access and can write config files directly
 * to the source directory, enabling persistence of UI changes in git.
 */

import { WebSocketServer } from 'ws';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

const PREFERRED_PORT = parseInt(process.env.CONFIG_SERVER_PORT ?? process.argv[2] ?? '8081', 10);

function findAvailablePort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(startPort, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', () => resolve(findAvailablePort(startPort + 1)));
  });
}

const PORT = await findAvailablePort(PREFERRED_PORT);
if (PORT !== PREFERRED_PORT) {
  console.warn(`⚠️  Port ${PREFERRED_PORT} in use, using ${PORT} instead`);
}

const wss = new WebSocketServer({ port: PORT });

console.log('');
console.log('🔧 uSEQ Config Server');
console.log('━'.repeat(50));
console.log(`📡 WebSocket server: ws://localhost:${PORT}`);
console.log(`📁 Project root: ${PROJECT_ROOT}`);
console.log('━'.repeat(50));
console.log('✅ Ready to receive configuration saves from webapp');
console.log('');

wss.on('connection', (ws, req) => {
  const clientAddr = req.socket.remoteAddress;
  console.log(`🔌 Client connected: ${clientAddr}`);

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      await handleMessage(message, ws);
    } catch (error) {
      console.error('❌ Error handling message:', error.message);
      ws.send(JSON.stringify({
        type: 'error',
        error: error.message
      }));
    }
  });

  ws.on('close', () => {
    console.log(`🔌 Client disconnected: ${clientAddr}`);
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error.message);
  });
});

/**
 * Handle incoming WebSocket messages
 */
async function handleMessage(message, ws) {
  const { type, requestId } = message;

  if (type === 'save-config') {
    await handleSaveConfig(message, ws);
  } else if (type === 'load-config') {
    await handleLoadConfig(message, ws);
  } else if (type === 'ping') {
    ws.send(JSON.stringify({
      requestId,
      type: 'pong',
      timestamp: new Date().toISOString()
    }));
  } else {
    ws.send(JSON.stringify({
      requestId,
      type: 'error',
      error: `Unknown message type: ${type}`
    }));
  }
}

/**
 * Handle save-config request
 */
async function handleSaveConfig(message, ws) {
  const { requestId, path: relativePath, data } = message;

  try {
    // Resolve path relative to project root
    const absolutePath = path.join(PROJECT_ROOT, relativePath);

    // Security check: ensure path is within project
    if (!absolutePath.startsWith(PROJECT_ROOT)) {
      throw new Error('Security violation: path outside project directory');
    }

    // Ensure directory exists
    const dir = path.dirname(absolutePath);
    fs.mkdirSync(dir, { recursive: true });

    // Write file with pretty formatting
    const jsonContent = JSON.stringify(data, null, 2);
    fs.writeFileSync(absolutePath, jsonContent + '\n', 'utf-8');

    console.log(`✅ Config saved: ${relativePath}`);
    console.log(`   Size: ${(jsonContent.length / 1024).toFixed(2)} KB`);

    ws.send(JSON.stringify({
      requestId,
      type: 'save-config-success',
      success: true,
      path: relativePath,
      absolutePath,
      timestamp: new Date().toISOString()
    }));

  } catch (error) {
    console.error(`❌ Failed to save config: ${error.message}`);
    ws.send(JSON.stringify({
      requestId,
      type: 'save-config-error',
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }));
  }
}

/**
 * Handle load-config request
 */
async function handleLoadConfig(message, ws) {
  const { requestId, path: relativePath } = message;

  try {
    const absolutePath = path.join(PROJECT_ROOT, relativePath);

    // Security check
    if (!absolutePath.startsWith(PROJECT_ROOT)) {
      throw new Error('Security violation: path outside project directory');
    }

    if (!fs.existsSync(absolutePath)) {
      throw new Error('Config file not found');
    }

    const fileContent = fs.readFileSync(absolutePath, 'utf-8');
    const data = JSON.parse(fileContent);

    console.log(`✅ Config loaded: ${relativePath}`);

    ws.send(JSON.stringify({
      requestId,
      type: 'load-config-success',
      success: true,
      data,
      timestamp: new Date().toISOString()
    }));

  } catch (error) {
    console.error(`❌ Failed to load config: ${error.message}`);
    ws.send(JSON.stringify({
      requestId,
      type: 'load-config-error',
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }));
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n');
  console.log('━'.repeat(50));
  console.log('👋 Shutting down config server...');
  wss.close(() => {
    console.log('✅ Config server stopped');
    console.log('━'.repeat(50));
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n');
  console.log('━'.repeat(50));
  console.log('👋 Received SIGTERM, shutting down...');
  wss.close(() => {
    console.log('✅ Config server stopped');
    console.log('━'.repeat(50));
    process.exit(0);
  });
});
