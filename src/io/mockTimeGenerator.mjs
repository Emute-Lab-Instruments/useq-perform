/**
 * Mock Time Generator
 *
 * Simulates the time updates that normally come from the uSEQ hardware module.
 * Useful for testing serialVis behavior without a physical device connection.
 */

import { handleExternalTimeUpdate } from '../ui/serialVis/visualisationController.mjs';
import { dbg } from '../utils.mjs';

let isRunning = false;
let startTimeMs = null;
let animationFrameId = null;
let currentMockTime = 0;

/**
 * Get current performance time in milliseconds
 * @returns {number} Current time in milliseconds
 */
function performanceNow() {
  if (typeof window !== 'undefined' && window.performance && typeof window.performance.now === 'function') {
    return window.performance.now();
  }
  return Date.now();
}

let tickCount = 0;

/**
 * Animation frame callback that updates the mock time
 */
async function tick() {
  if (!isRunning) {
    console.log('Mock time generator: tick() called but not running');
    return;
  }

  tickCount++;
  const nowMs = performanceNow();
  const elapsedMs = nowMs - startTimeMs;
  currentMockTime = elapsedMs / 1000; // Convert to seconds

  try {
    await handleExternalTimeUpdate(currentMockTime);
  } catch (error) {
    dbg(`mockTimeGenerator: error updating time: ${error}`);
    console.error('Mock time generator: ERROR:', error);
  }

  // Schedule next frame
  if (isRunning) {
    animationFrameId = window.requestAnimationFrame(tick);
  }
}

/**
 * Start the mock time generator
 * Begins at t=0 and advances at real-time rate (~60fps updates)
 * @returns {boolean} True if started successfully, false if already running
 */
export function startMockTimeGenerator() {
  if (isRunning) {
    dbg('mockTimeGenerator: already running');
    console.log('Mock time generator: already running');
    return false;
  }

  dbg('mockTimeGenerator: starting');
  console.log('Mock time generator: STARTING at t=0');
  isRunning = true;
  startTimeMs = performanceNow();
  currentMockTime = 0;

  // Start the animation loop
  animationFrameId = window.requestAnimationFrame(tick);
  console.log('Mock time generator: Animation frame scheduled');

  return true;
}

/**
 * Stop the mock time generator
 * @returns {boolean} True if stopped successfully, false if not running
 */
export function stopMockTimeGenerator() {
  if (!isRunning) {
    dbg('mockTimeGenerator: not running');
    return false;
  }

  dbg('mockTimeGenerator: stopping');
  isRunning = false;

  if (animationFrameId !== null) {
    window.cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  return true;
}

/**
 * Check if the mock time generator is currently running
 * @returns {boolean} True if running, false otherwise
 */
export function isMockTimeGeneratorRunning() {
  return isRunning;
}

/**
 * Get the current mock time in seconds
 * @returns {number} Current mock time in seconds
 */
export function getCurrentMockTime() {
  return currentMockTime;
}

/**
 * Reset the mock time generator to t=0
 * If running, it will restart from zero
 */
export function resetMockTimeGenerator() {
  const wasRunning = isRunning;

  if (wasRunning) {
    stopMockTimeGenerator();
  }

  startTimeMs = null;
  currentMockTime = 0;

  if (wasRunning) {
    startMockTimeGenerator();
  }

  dbg('mockTimeGenerator: reset to t=0');
}
