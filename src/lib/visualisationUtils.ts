// @ts-nocheck
import { serialBuffers, serialMapFunctions } from "../transport/stream-parser.ts";
import { dbg } from "./debug.ts";
import {
  SERIAL_VIS_PALETTE_CHANGED_EVENT,
  dispatchVisualisationEvent,
} from "../contracts/visualisationEvents";

export const serialVisChannels = ['a1', 'a2', 'a3', 'a4', 'd1', 'd2', 'd3'];

const clampOffset = (rawOffset, length) => {
  if (!length) {
    return 0;
  }
  const numeric = Number(rawOffset) || 0;
  const mod = numeric % length;
  return mod < 0 ? mod + length : mod;
};

const normalisePalette = (paletteCandidate) => {
  if (Array.isArray(paletteCandidate) && paletteCandidate.length > 0) {
    return paletteCandidate;
  }
  return getSerialVisPalette();
};

export const getSerialVisChannelColor = (exprType, circularOffset = 0, paletteOverride = null) => {
  if (!exprType) {
    return null;
  }
  const index = serialVisChannels.indexOf(exprType);
  if (index < 0) {
    return null;
  }
  const palette = normalisePalette(paletteOverride || serialVisPalette);
  if (!Array.isArray(palette) || palette.length === 0) {
    return null;
  }
  const rotationLength = serialVisChannels.length || palette.length;
  const offset = clampOffset(circularOffset, rotationLength);
  const paletteIndex = (index + offset) % palette.length;
  return palette[paletteIndex] || null;
};

export const buildSerialVisColorMap = (circularOffset = 0, paletteOverride = null) => {
  const palette = normalisePalette(paletteOverride || serialVisPalette);
  return serialVisChannels.reduce((acc, channel) => {
    const color = getSerialVisChannelColor(channel, circularOffset, palette);
    if (color) {
      acc.set(channel, color);
    }
    return acc;
  }, new Map());
};

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
  const baseFreq = 0.5; // 0.5 Hz for the first user buffer
  const freqMultipliers = [1, 1.5, 2, 2.5, 3, 4, 5, 6];
  
  // Generate different amplitudes for visual distinction
  const amplitudes = [1.0, 0.8, 0.7, 0.9, 0.6, 0.85, 0.75, 0.65];
  
  // Create different phase offsets for each channel
  const phaseOffsets = Array.from({ length: 8 }, (_, i) => i * Math.PI / 4);
  
  // Clear existing buffers and fill with new data
  serialBuffers.forEach((buffer, index) => {
    buffer.clear();
    
    if (index === 0) {
      const timeSeries = Array.from({ length: Math.floor(duration * sampleRate) }, (_, i) => i / sampleRate);
      timeSeries.forEach(value => buffer.push(value));
    } else {
      const channelIdx = index - 1;
      const frequency = baseFreq * freqMultipliers[channelIdx % freqMultipliers.length];
      const amplitude = amplitudes[channelIdx % amplitudes.length];
      const phase = phaseOffsets[channelIdx % phaseOffsets.length];

      const waveData = createSineWaveData(frequency, duration, sampleRate, amplitude, phase);
      waveData.forEach(value => buffer.push(value));
    }
    
    // Trigger the map function if one is registered for user channels
    const mapIndex = index - 1;
    if (mapIndex >= 0 && serialMapFunctions[mapIndex]) {
      serialMapFunctions[mapIndex](buffer);
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
export const serialVisPaletteDark = [
  '#00ff41', 
  '#1adbdb', 
  '#ffaa00',
  '#ff0080',
  '#ff5500',
  '#ffee33',
  '#0088ff',
  '#aa00ff',
];
// Use let instead of const so it can be changed
export let serialVisPalette = serialVisPaletteLight;

// Create a setter function to update the palette
export function setSerialVisPalette(palette) {
  if (Array.isArray(palette) && palette.length > 0) {
    serialVisPalette = palette;
    // Force redraw of the plot with new colors
    // plotNeedsRedrawing = true;
    dbg("Serial visualization palette updated");
    if (typeof window !== 'undefined' && window?.dispatchEvent) {
      try {
        dispatchVisualisationEvent(SERIAL_VIS_PALETTE_CHANGED_EVENT, { palette });
      } catch (error) {
        dbg(`Serial visualization palette event failed: ${error}`);
      }
    }
    return true;
  }
  return false;
}

// Getter to access the current palette (safe against circular-import TDZ)
export function getSerialVisPalette() {
  try {
    return serialVisPalette;
  } catch {
    // Fallback when serialVisPalette is in the temporal dead zone due to
    // circular imports (utils -> serialComms -> visualisationController -> utils).
    return ['#ace397', '#45a5ad', '#fcbf5d', '#ff809f', '#ff005e', '#c9004c', '#93003a', '#00429d'];
  }
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
