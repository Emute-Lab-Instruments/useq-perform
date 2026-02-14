/**
 * Updates the code highlight color based on connection status
 */
export function setCodeHighlightColor(
    connected: boolean,
    doc: Document | null = typeof document !== 'undefined' ? document : null,
    win: (Window & typeof globalThis) | null = typeof window !== 'undefined' ? window : null
): void {
    // Fallback if no DOM available (e.g., in tests)
    if (!doc || !win) {
      return;
    }

    const root = doc.documentElement;

    let color: string | undefined = undefined;
    if (connected) {
      color = win.getComputedStyle(root).getPropertyValue('--code-eval-highlight-color-connected').trim();
    }
    else {
      color = win.getComputedStyle(root).getPropertyValue('--code-eval-highlight-color-disconnected').trim();
    }

    root.style.setProperty('--code-eval-highlight-color', color ?? null);
}

/**
 * Serial communication utility functions
 */

/**
 * Clean code by removing comments and newlines
 */
export function cleanCode(code: string): string {
  // Remove comments (anything between ; and newline) and all newlines in a single step
  return code.replace(/;[^\n]*(\n|$)|\n/g, (match) =>
    match.startsWith(";") ? "" : ""
  );
}

/**
 * Combine existing buffer with new data
 */
export function combineBuffers(existingBuffer: Uint8Array, newData: Uint8Array): Uint8Array {
  if (existingBuffer.length === 0) {
    return newData;
  }

  const combinedBuffer = new Uint8Array(existingBuffer.length + newData.length);
  combinedBuffer.set(existingBuffer);
  combinedBuffer.set(newData, existingBuffer.length);
  return combinedBuffer;
}

/**
 * Find the start marker in a byte array
 */
export function findMessageStartMarker(byteArray: Uint8Array, markerValue: number): number {
  return byteArray.findIndex(
    (byte, i) => i < byteArray.length - 1 && byte === markerValue
  );
}

/**
 * Update remaining bytes based on marker position
 */
export function updateRemainingBytes(byteArray: Uint8Array, startIndex: number): Uint8Array {
  if (startIndex >= 0) {
    // Found message start, keep from here onwards
    return byteArray.slice(startIndex);
  } else {
    // Nothing useful, discard everything
    return new Uint8Array(0);
  }
}

/**
 * Extracts message text from byte array
 */
export function extractMessageText(messageBytes: Uint8Array): string {
  return new TextDecoder().decode(messageBytes);
}

/**
 * Validates if a serial port exists
 */
export function isSerialPortValid(port: SerialPort | null): port is SerialPort {
  return port !== null;
}

/**
 * Check if the port is readable and not locked
 */
export function isPortReadableAndUnlocked(port: SerialPort | null): boolean {
  return port !== null && port.readable !== null && !port.readable.locked;
}

/**
 * Check if the serial port is writable
 */
export function isPortWritable(port: SerialPort | null): boolean {
  // Check for dev mode connection mock first
  try {
    // Dynamic import to avoid circular dependencies
    const urlParams = new URLSearchParams(window.location.search);
    const isDevMode = urlParams.has('devmode') && urlParams.get('devmode') === 'true';

    if (isDevMode) {
      // In dev mode, check the mocked connection status
      // We need to access the connectedToModule variable from serialComms
      // Since we can't easily import it here due to circular deps, we'll check if
      // the connect button has the 'connected' class which indicates mock connection
      const connectButton = document.getElementById('button-connect');
      if (connectButton && connectButton.classList.contains('connected')) {
        return true; // Mock connection is active
      }
    }
  } catch (error) {
    // If there's any error checking dev mode, fall back to normal behavior
    console.warn('Error checking dev mode connection status:', error);
  }

  // Normal behavior: check if actual port is writable
  return port !== null && port.writable !== null;
}

/** Smoothing and interpolation settings */
export interface SmoothingConfig {
  enabled: boolean;
  windowSize: number;
  interpolationPoints: number;
  interpolationEnabled: boolean;
}

export const smoothingSettings: SmoothingConfig = {
  enabled: true,             // Enable/disable smoothing
  windowSize: 3,             // Size of moving average window (odd number recommended)
  interpolationPoints: 3,    // Number of points to interpolate between samples
  interpolationEnabled: true // Enable/disable interpolation
};

/** Buffer-like object with a push method (e.g., CircularBuffer) */
export interface PushableBuffer {
  push(value: number): void;
}

// Arrays to store previous values for smoothing
export const createPreviousValuesArray = (channelCount: number): number[][] =>
  Array.from({ length: channelCount }, () => [] as number[]);

/**
 * Apply a moving average filter to smooth the input value
 */
export function applySmoothing(previousValues: number[][], channelIndex: number, value: number): number {
  if (!smoothingSettings.enabled || smoothingSettings.windowSize <= 1) {
    return value;
  }

  const values = previousValues[channelIndex];
  values.push(value);

  // Keep only the last windowSize values
  while (values.length > smoothingSettings.windowSize) {
    values.shift();
  }

  // Calculate the moving average
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

/**
 * Generate interpolated points between previous and current value
 */
export function applyInterpolation(
  _channelIndex: number,
  previousValue: number,
  currentValue: number,
  buffers: PushableBuffer[],
  bufferIndex: number
): void {
  if (
    !smoothingSettings.interpolationEnabled ||
    smoothingSettings.interpolationPoints < 2
  ) {
    return;
  }

  // Get the buffer for this channel
  const buffer = buffers[bufferIndex];

  // Generate interpolation points
  for (let i = 1; i < smoothingSettings.interpolationPoints; i++) {
    const t = i / smoothingSettings.interpolationPoints;
    // Linear interpolation: previousValue * (1-t) + currentValue * t
    const interpolatedValue = previousValue * (1 - t) + currentValue * t;
    buffer.push(interpolatedValue);
  }
}
