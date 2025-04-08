import { serialBuffers, serialMapFunctions } from "../../io/serialComms.mjs";
import { dbg } from "../../utils.mjs";

/**
 * Generates a sine wave data point at a specific time
 * @param {number} frequency - The frequency of the sine wave in Hz
 * @param {number} time - The time in seconds
 * @param {number} amplitude - The amplitude of the sine wave (default: 1.0)
 * @param {number} phase - The phase offset in radians (default: 0)
 * @returns {number} The sine wave value at the given time
 */
function sineWaveAt(frequency, time, amplitude = 1.0, phase = 0) {
  return amplitude * Math.sin(2 * Math.PI * frequency * time + phase);
}

/**
 * Creates sine wave data for a buffer
 * @param {number} frequency - The frequency of the sine wave in Hz
 * @param {number} duration - Duration in seconds
 * @param {number} sampleRate - Samples per second
 * @param {number} amplitude - The amplitude of the sine wave
 * @param {number} phase - The phase offset in radians
 * @returns {Array<number>} Array of sine wave values
 */
function createSineWaveData(frequency, duration, sampleRate, amplitude = 1.0, phase = 0) {
  const numSamples = Math.floor(duration * sampleRate);
  return Array.from({ length: numSamples }, (_, i) => {
    const time = i / sampleRate;
    return sineWaveAt(frequency, time, amplitude, phase);
  });
}

/**
 * Fills the serial buffers with sine waves of different frequencies for testing purposes
 * @param {number} duration - Duration of test data in seconds (default: 2.0)
 * @param {number} sampleRate - Samples per second (default: 100)
 * @returns {Array<CircularBuffer>} The filled circular buffers
 */
export function fillSerialBuffersDefault(duration = 2.0, sampleRate = 100) {
  // Base frequency and multipliers for each channel (creating harmonic relationships)
  const baseFreq = 0.5; // 0.5 Hz for the first buffer
  const freqMultipliers = [1, 1.5, 2, 2.5, 3, 4, 5, 6];
  
  // Generate different amplitudes for visual distinction
  const amplitudes = [1.0, 0.8, 0.7, 0.9, 0.6, 0.85, 0.75, 0.65];
  
  // Create different phase offsets for each channel
  const phaseOffsets = Array.from({ length: 8 }, (_, i) => i * Math.PI / 4);
  
  // Clear existing buffers and fill with new data
  serialBuffers.forEach((buffer, index) => {
    buffer.clear();
    
    const frequency = baseFreq * freqMultipliers[index];
    const amplitude = amplitudes[index];
    const phase = phaseOffsets[index];
    
    const waveData = createSineWaveData(frequency, duration, sampleRate, amplitude, phase);
    waveData.forEach(value => buffer.push(value));
    
    // Trigger the map function if one is registered
    if (serialMapFunctions[index]) {
      serialMapFunctions[index](buffer);
    }
  });
  
  dbg("Filled serial buffers with test sine waves");
  return serialBuffers;
}

export const getCatmullRomPoint = (p0, p1, p2, p3, t) => {
  const t2 = t * t;
  const t3 = t2 * t;
  
  // Cache common calculations
  const t2Times2 = 2 * t2;
  const t3Times3 = 3 * t3;
  
  return {
    x: 0.5 * (
      (2 * p1.x) +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
    ),
    y: 0.5 * (
      (2 * p1.y) +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
    )
  };
};

// Export palette arrays so they can be accessed from the theme manager
export const serialVisPaletteLight = ['#ace397', '#45a5ad', '#fcbf5d', '#ff809f', '#ff005e', '#c9004c', '#93003a', '#00429d'];
// Brighter colors that work better on dark backgrounds
export const serialVisPaletteDark = ['#00ff41', '#1adbdb', '#ffee33', '#ffaa00', '#ff5500', '#ff0080', '#aa00ff', '#0088ff'];
// Use let instead of const so it can be changed
export let serialVisPalette = serialVisPaletteLight;

// Create a setter function to update the palette
export function setSerialVisPalette(palette) {
  if (Array.isArray(palette) && palette.length > 0) {
    serialVisPalette = palette;
    // Force redraw of the plot with new colors
    // plotNeedsRedrawing = true;
    dbg("Serial visualization palette updated");
    return true;
  }
  return false;
}

// Getter to access the current palette
export function getSerialVisPalette() {
  return serialVisPalette;
}



/// CONTROLS
/**
 * Create UI controls for smoothing and interpolation settings
 */
function createSmoothingControls() {
  const visPanel = document.getElementById("panel-vis");
  if (!visPanel) {
    console.error("Visualization panel not found");
    return;
  }
  
  // Create a control container
  const controlsContainer = document.createElement("div");
  controlsContainer.id = "serial-vis-controls";
  controlsContainer.Name = "serial-vis-controls";
  controlsContainer.style.cssText = "padding: 10px; margin-top: 10px; background: rgba(0,0,0,0.1); border-radius: 4px;";
  
  // Create heading
  const heading = document.createElement("h3");
  heading.textContent = "Visualization Settings";
  heading.style.cssText = "margin: 0 0 10px 0; font-size: 14px;";
  controlsContainer.appendChild(heading);
  
  // Smoothing toggle
  const smoothingToggle = createToggle(
    "Enable Smoothing", 
    smoothingSettings.enabled,
    (checked) => {
      smoothingSettings.enabled = checked;
      dbg(`Smoothing ${checked ? 'enabled' : 'disabled'}`);
    }
  );
  controlsContainer.appendChild(smoothingToggle);
  
  // Smoothing window size
  const windowSizeSlider = createRangeControl(
    "Window Size",
    smoothingSettings.windowSize,
    1, 10, 1,
    (value) => {
      smoothingSettings.windowSize = parseInt(value);
      dbg(`Smoothing window size set to ${value}`);
    }
  );
  controlsContainer.appendChild(windowSizeSlider);
  
  // Interpolation toggle
  const interpolationToggle = createToggle(
    "Enable Interpolation", 
    smoothingSettings.interpolationEnabled,
    (checked) => {
      smoothingSettings.interpolationEnabled = checked;
      dbg(`Interpolation ${checked ? 'enabled' : 'disabled'}`);
    }
  );
  controlsContainer.appendChild(interpolationToggle);
  
  // Interpolation points
  const interpolationSlider = createRangeControl(
    "Interpolation Points",
    smoothingSettings.interpolationPoints,
    2, 10, 1,
    (value) => {
      smoothingSettings.interpolationPoints = parseInt(value);
      dbg(`Interpolation points set to ${value}`);
    }
  );
  controlsContainer.appendChild(interpolationSlider);
  
  // Add controls to the panel
  visPanel.appendChild(controlsContainer);
}

/**
 * Create a toggle switch control
 * @param {string} label - Control label
 * @param {boolean} initialValue - Initial toggle state
 * @param {Function} onChange - Change event handler
 * @returns {HTMLDivElement} Container element
 */
function createToggle(label, initialValue, onChange) {
  const container = document.createElement("div");
  container.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;";
  
  const labelEl = document.createElement("label");
  labelEl.textContent = label;
  labelEl.style.cssText = "flex-grow: 1; font-size: 12px;";
  container.appendChild(labelEl);
  
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = initialValue;
  toggle.addEventListener("change", (e) => onChange(e.target.checked));
  container.appendChild(toggle);
  
  return container;
}

/**
 * Create a range slider control
 * @param {string} label - Control label
 * @param {number} initialValue - Initial slider value
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @param {number} step - Step size
 * @param {Function} onChange - Change event handler
 * @returns {HTMLDivElement} Container element
 */
function createRangeControl(label, initialValue, min, max, step, onChange) {
  const container = document.createElement("div");
  container.style.cssText = "margin-bottom: 12px;";
  
  const labelContainer = document.createElement("div");
  labelContainer.style.cssText = "display: flex; justify-content: space-between; margin-bottom: 2px;";
  
  const labelEl = document.createElement("label");
  labelEl.textContent = label;
  labelEl.style.cssText = "font-size: 12px;";
  labelContainer.appendChild(labelEl);
  
  const valueEl = document.createElement("span");
  valueEl.textContent = initialValue;
  valueEl.style.cssText = "font-size: 12px;";
  labelContainer.appendChild(valueEl);
  
  container.appendChild(labelContainer);
  
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = min;
  slider.max = max;
  slider.step = step;
  slider.value = initialValue;
  slider.style.cssText = "width: 100%;";
  slider.addEventListener("input", (e) => {
    const value = e.target.value;
    valueEl.textContent = value;
    onChange(value);
  });
  container.appendChild(slider);
  
  return container;
}
