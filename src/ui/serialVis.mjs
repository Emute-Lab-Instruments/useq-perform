import { dbg } from "../utils.mjs";
import { serialBuffers, smoothingSettings } from "../io/serialComms.mjs";

import {
  plotCtx,
  lineCtx,
  activeBuffer,
  swapBuffer,
} from "./internalVis/main.mjs";
import { toggleSerialVis } from "../editors/editorConfig.mjs";

let linePosition = 0.0;
let plotNeedsRedrawing = true;

// TODO internalVisBuffers

// Helper function moved outside
const getCatmullRomPoint = (p0, p1, p2, p3, t) => {
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

function drawPlot() {
  dbg("Drawing plot");
  
  // Setup
  const ctx = plotCtx;
  const c = ctx.canvas;
  
  // Enable antialiasing
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  
  const amplitudeMultiplier = 0.9;
  const zeroY = c.height / 2;
  const gap = c.width / serialBuffers[0].bufferLength;
  ctx.clearRect(0, 0, c.width, c.height);

  const mapValueToY = (value) =>
    zeroY - (value * amplitudeMultiplier * zeroY);

  // Draw dashed 0-line
  ctx.strokeStyle = "#777777";
  ctx.lineWidth = 0.5;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(0, zeroY);
  ctx.lineTo(c.width, zeroY);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.font = "10px Arial";
  ctx.fillStyle = "#777777";
  ctx.textAlign = "right";

  // Draw quarter amplitude lines & labels
  for (let i = -1; i <= 1; i += 0.25) {
    const y = zeroY - i * amplitudeMultiplier * zeroY;
    ctx.beginPath();
    ctx.moveTo(c.width - 10, y);
    ctx.lineTo(c.width, y);
    ctx.stroke();
    const textY = i > 0 ? y - 4 : i < 0 ? y + 12 : y + 12;
    ctx.fillText(i.toFixed(2), c.width - 12, textY);
  }

  ctx.lineWidth = 1;

  // Pre-calculate interpolation steps
  const segments = 5;
  const step = 1 / segments;
  const interpolationSteps = Array.from({ length: segments + 1 }, (_, i) => i * step);

  // Draw all channels
  for (let ch = 0; ch < activeBuffer.length; ch++) {
    const channelValues = activeBuffer[ch];
    
    // Create points array - do this once per channel
    const points = new Array(channelValues.length);
    for (let i = 0; i < channelValues.length; i++) {
      points[i] = {
        x: gap * i,
        y: mapValueToY(channelValues[i])
      };
    }

    ctx.beginPath();
    // Use theme-aware palette
    ctx.strokeStyle = serialVisPalette[ch];
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Draw curve with Catmull-Rom interpolation
    ctx.moveTo(points[0].x, points[0].y);
    
    for (let i = 0; i < points.length - 3; i++) {
      const p0 = points[Math.max(0, i)];
      const p1 = points[i + 1];
      const p2 = points[i + 2];
      const p3 = points[Math.min(points.length - 1, i + 3)];

      // Use pre-calculated steps
      for (const t of interpolationSteps) {
        const pt = getCatmullRomPoint(p0, p1, p2, p3, t);
        ctx.lineTo(pt.x, pt.y);
      }
    }
    
    ctx.stroke();
  }
}

let time = 0;

function drawTimeLine() {
  const ctx = lineCtx;
  const c = ctx.canvas;

  const x = c.width * (time/3000.0 % 1.0);

  // Clear the line canvas
  ctx.clearRect(0, 0, c.width, c.height);

  // Set up the line style
  ctx.strokeStyle = "red";
  ctx.lineWidth = 2;

  // Draw the vertical line
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, c.height);
  ctx.stroke();

  // FIXME
}

export function drawSerialVisInternal() {
  // FIXME get time from module every now and then
  time = Date.now();

  if (plotNeedsRedrawing) {
    drawPlot();
    plotNeedsRedrawing = false;
  }

  drawTimeLine();

  window.requestAnimationFrame(drawSerialVis);
}

// Export palette arrays so they can be accessed from the theme manager
export const serialVisPaletteLight = ['#ace397', '#45a5ad', '#fcbf5d', '#ff809f', '#ff005e', '#c9004c', '#93003a', '#00429d'];
// Brighter colors that work better on dark backgrounds
export const serialVisPaletteDark = ['#00ff41', '#1adbdb', '#ffee33', '#ffaa00', '#ff5500', '#ff0080', '#aa00ff', '#0088ff'];
// Use let instead of const so it can be changed
let serialVisPalette = serialVisPaletteLight;

// Create a setter function to update the palette
export function setSerialVisPalette(palette) {
  if (Array.isArray(palette) && palette.length > 0) {
    serialVisPalette = palette;
    // Force redraw of the plot with new colors
    plotNeedsRedrawing = true;
    dbg("Serial visualization palette updated");
    return true;
  }
  return false;
}

// Getter to access the current palette
export function getSerialVisPalette() {
  return serialVisPalette;
}

function drawSerialVis() {
  const c = document.getElementById("serialcanvas");
  const ctx = c.getContext("2d");
  const amplitudeMultiplier = 0.9;
  const zeroY = c.height / 2;
  const gap = c.width / serialBuffers[0].bufferLength;
  
  // Enable antialiasing for smoother lines
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  
  // Clear canvas
  ctx.clearRect(0, 0, c.width, c.height);
  
  // Helper function for mapping values to Y coordinates
  const mapValueToY = value => zeroY - (value * amplitudeMultiplier * zeroY);
  
  // Draw 0 axis dotted line
  ctx.strokeStyle = '#777777';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(0, zeroY);
  ctx.lineTo(c.width, zeroY);
  ctx.stroke();
  
  // Draw y-axis markings on right side
  ctx.setLineDash([]);
  ctx.font = '10px Arial';
  ctx.fillStyle = '#777777';
  ctx.textAlign = 'right';  // Right-align text

  for (let i = -1; i <= 1; i += 0.25) {
    const y = zeroY - (i * amplitudeMultiplier * zeroY);
    ctx.beginPath();
    ctx.moveTo(c.width - 10, y);  // Start from right side
    ctx.lineTo(c.width, y);       // Draw to edge
    ctx.stroke();
    
    // Position text above or below the marking based on which side of x-axis it's on
    const textY = i > 0 ? y - 4 : (i < 0 ? y + 12 : y + 12); // Special case for 0
    ctx.fillText(i.toFixed(2), c.width - 12, textY);
  }
  
  // Draw data traces
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  
  // Pre-calculate interpolation steps for the spline
  const segments = 5;
  const step = 1 / segments;
  const interpolationSteps = Array.from({ length: segments + 1 }, (_, i) => i * step);
  
  // Pre-calculate oldest values once for each channel to avoid repeated method calls
  const oldestValues = Array(8).fill().map((_, ch) => {
    const buffer = serialBuffers[ch];
    return Array(buffer.bufferLength - 1).fill().map((_, i) => buffer.oldest(i));
  });
  
  // Draw each channel
  for (let ch = 0; ch < 8; ch++) {
    const channelValues = oldestValues[ch];
    const points = channelValues.map((value, i) => ({
      x: gap * i,
      y: mapValueToY(value)
    }));
    
    ctx.beginPath();
    ctx.strokeStyle = serialVisPalette[ch];
    
    // Plot first point
    ctx.moveTo(points[0].x, points[0].y);
    
    // Use Catmull-Rom spline for smooth curves if we have enough points
    if (points.length > 3) {
      for (let i = 0; i < points.length - 3; i++) {
        const p0 = points[Math.max(0, i)];
        const p1 = points[i + 1];
        const p2 = points[i + 2];
        const p3 = points[Math.min(points.length - 1, i + 3)];
        
        // Generate points along the spline curve
        for (const t of interpolationSteps) {
          const pt = getCatmullRomPoint(p0, p1, p2, p3, t);
          ctx.lineTo(pt.x, pt.y);
        }
      }
    } else {
      // Fall back to simple lines if not enough points
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }
    }
    
    ctx.stroke();
  }
  
  window.requestAnimationFrame(drawSerialVis);
}

export function makeVis() {
  dbg("Visualization", "makeVis", "Initializing serial visualization panel");
  window.requestAnimationFrame(drawSerialVis);
  dbg("Visualization", "makeVis", "Started animation loop for serial visualization");
  createSmoothingControls();
  dbg("Visualization", "makeVis", "Created smoothing controls");
}

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
  controlsContainer.className = "serial-vis-controls";
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
