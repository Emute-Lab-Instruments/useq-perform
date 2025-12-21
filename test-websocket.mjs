#!/usr/bin/env node

/**
 * Test script for WebSocket dev mode functionality
 *
 * This script connects to the WebSocket server running in dev mode
 * and sends test messages to verify the functionality.
 *
 * Usage:
 * 1. Start the dev server with devmode=true: npm run dev (with ?devmode=true in URL)
 * 2. Run this script: node test-websocket.mjs
 */

import WebSocket from 'ws';

const WS_URL = 'ws://localhost:8082';

console.log('🔌 Testing WebSocket dev mode functionality...');
console.log(`📍 Connecting to ${WS_URL}`);

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('✅ Connected to WebSocket server');

  // Send a test message
  console.log('📤 Sending test message...');
  ws.send(JSON.stringify({
    type: 'text',
    content: 'Hello from test script!'
  }));

  // Wait a bit then send the disconnect command
  setTimeout(() => {
    console.log('📤 Sending disconnect-from-module command...');
    ws.send('disconnect-from-module');
  }, 1000);

  // Close connection after testing
  setTimeout(() => {
    console.log('🔌 Closing connection...');
    ws.close();
  }, 2000);
});

ws.on('message', (data) => {
  const message = data.toString();
  console.log('📥 Received:', message);
});

ws.on('close', () => {
  console.log('✅ Connection closed');
  console.log('🎉 WebSocket test completed!');
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
  console.log('\n💡 Make sure:');
  console.log('   1. The dev server is running with ?devmode=true');
  console.log('   2. The WebSocket server started successfully');
  console.log('   3. No other process is using port 8082');
});
