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