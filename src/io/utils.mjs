/**
 * Updates the code highlight color based on connection status
 * @param {boolean} connected - Whether connected to the uSEQ module
 */
export function setCodeHighlightColor(connected) {
    const root = document.documentElement;
    
    let color = undefined;
    if (connected) {
      color = getComputedStyle(root).getPropertyValue('--code-eval-highlight-color-connected').trim();
    }
    else {
      color = getComputedStyle(root).getPropertyValue('--code-eval-highlight-color-disconnected').trim();
    }
  
    root.style.setProperty('--code-eval-highlight-color', color);
}

/**
 * Serial communication utility functions
 */

/**
 * Clean code by removing comments and newlines
 * @param {string} code - The code to clean
 * @returns {string} Cleaned code
 */
export function cleanCode(code) {
  // Remove comments (anything between ; and newline) and all newlines in a single step
  return code.replace(/;[^\n]*(\n|$)|\n/g, (match) =>
    match.startsWith(";") ? "" : ""
  );
}

/**
 * Combine existing buffer with new data
 * @param {Uint8Array} existingBuffer - Existing buffer data
 * @param {Uint8Array} newData - New data to append
 * @returns {Uint8Array} Combined buffer
 */
export function combineBuffers(existingBuffer, newData) {
  if (existingBuffer.length === 0) {
    return newData;
  }
  
  let combinedBuffer = new Uint8Array(existingBuffer.length + newData.length);
  combinedBuffer.set(existingBuffer);
  combinedBuffer.set(newData, existingBuffer.length);
  return combinedBuffer;
}

/**
 * Find the start marker in a byte array
 * @param {Uint8Array} byteArray - The byte array to search
 * @param {number} markerValue - The marker value to find
 * @returns {number} The index of the start marker or -1 if not found
 */
export function findMessageStartMarker(byteArray, markerValue) {
  return byteArray.findIndex(
    (byte, i) => i < byteArray.length - 1 && byte === markerValue
  );
}

/**
 * Update remaining bytes based on marker position
 * @param {Uint8Array} byteArray - The original byte array
 * @param {number} startIndex - The index where the marker was found
 * @returns {Uint8Array} The updated remaining bytes
 */
export function updateRemainingBytes(byteArray, startIndex) {
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
 * @param {Uint8Array} messageBytes - Message bytes to decode
 * @returns {string} Decoded message text
 */
export function extractMessageText(messageBytes) {
  return new TextDecoder().decode(messageBytes);
}

/**
 * Validates if a serial port exists
 * @param {SerialPort|null} port - Port to validate
 * @returns {boolean} True if port exists
 */
export function isSerialPortValid(port) {
  return port !== null;
}

/**
 * Check if the port is readable and not locked
 * @param {SerialPort} port - The port to check
 * @returns {boolean} True if the port is readable and not locked
 */
export function isPortReadableAndUnlocked(port) {
  return port && port.readable && !port.readable.locked;
}

/**
 * Check if the serial port is writable
 * @param {SerialPort} port - The port to check
 * @returns {boolean} True if the port is writable
 */
export function isPortWritable(port) {
  return port && port.writable;
}
  
  // Smoothing and interpolation settings
  export const smoothingSettings = {
    enabled: true,             // Enable/disable smoothing
    windowSize: 3,             // Size of moving average window (odd number recommended)
    interpolationPoints: 3,    // Number of points to interpolate between samples
    interpolationEnabled: true // Enable/disable interpolation
  };
  
  // Arrays to store previous values for smoothing
  export const createPreviousValuesArray = (channelCount) => 
    Array(channelCount).fill().map(() => []);
  
  /**
   * Apply a moving average filter to smooth the input value
   * @param {Array} previousValues - Array of previous values for the channel
   * @param {number} channelIndex - Index of the channel
   * @param {number} value - New value to smooth
   * @returns {number} Smoothed value
   */
  export function applySmoothing(previousValues, channelIndex, value) {
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
   * @param {number} channelIndex - Index of the channel
   * @param {number} previousValue - Last stored value
   * @param {number} currentValue - New incoming value
   * @param {Array} buffers - Array of circular buffers
   * @param {number} bufferIndex - Buffer index for this channel
   */
  export function applyInterpolation(
    channelIndex,
    previousValue,
    currentValue,
    buffers,
    bufferIndex
  ) {
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
  };