/**
 * Mock Time Generator
 *
 * Simulates the time updates that normally come from the uSEQ hardware module.
 * Useful for testing serialVis behavior without a physical device connection.
 */

import { handleExternalTimeUpdate } from '../ui/visualisation/visualisationController.ts';
import { dbg } from '../lib/debug.ts';

let isRunning = false;
let startTimeMs: number | null = null;
let animationFrameId: number | null = null;
let currentMockTime = 0;
let tickInFlight = false;

/**
 * Get current performance time in milliseconds
 */
function performanceNow(): number {
  if (typeof window !== 'undefined' && window.performance && typeof window.performance.now === 'function') {
    return window.performance.now();
  }
  return Date.now();
}

let tickCount = 0;

/**
 * Animation frame callback that updates the mock time
 */
async function tick(): Promise<void> {
  if (!isRunning) {
    console.log('Mock time generator: tick() called but not running');
    return;
  }

  if (tickInFlight) return;
  tickInFlight = true;

  tickCount++;
  const nowMs = performanceNow();
  const elapsedMs = nowMs - (startTimeMs ?? 0);
  currentMockTime = elapsedMs / 1000; // Convert to seconds

  try {
    await handleExternalTimeUpdate(currentMockTime);
  } catch (error) {
    dbg(`mockTimeGenerator: error updating time: ${error}`);
    console.error('Mock time generator: ERROR:', error);
  } finally {
    tickInFlight = false;
  }

  // Schedule next frame
  if (isRunning) {
    animationFrameId = window.requestAnimationFrame(tick);
  }
}

/**
 * Start the mock time generator
 * Begins at t=0 and advances at real-time rate (~60fps updates)
 */
export function startMockTimeGenerator(): boolean {
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
 */
export function stopMockTimeGenerator(): boolean {
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
 */
export function isMockTimeGeneratorRunning(): boolean {
  return isRunning;
}

/**
 * Get the current mock time in seconds
 */
export function getCurrentMockTime(): number {
  return currentMockTime;
}

/**
 * Reset the mock time generator to t=0
 * If running, it will restart from zero
 */
export function resetMockTimeGenerator(): void {
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

/**
 * Resume the mock time generator from where it left off
 */
export function resumeMockTimeGenerator(): boolean {
  if (isRunning) {
    return false;
  }

  dbg('mockTimeGenerator: resuming');
  isRunning = true;
  // Calculate startTimeMs such that currentMockTime is preserved
  // currentMockTime = (now - startTime) / 1000
  // startTime = now - (currentMockTime * 1000)
  startTimeMs = performanceNow() - (currentMockTime * 1000);

  animationFrameId = window.requestAnimationFrame(tick);
  return true;
}
