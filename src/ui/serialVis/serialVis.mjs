import { dbg } from "../../utils.mjs";
import { serialBuffers } from "../../io/serialComms.mjs";
import {fillSerialBuffersDefault, serialVisPalette, getCatmullRomPoint} from "./utils.mjs";
import { devmode } from "../../urlParams.mjs";



function drawSerialVis() {
  const c = document.getElementById("serialcanvas");
  const ctx = c.getContext("2d");
  console.log("c.height", c.height);
  const verticalPadding = c.height * 0.1; // 10% padding top and bottom
  const centerY = c.height / 2; // Center point of canvas
  const drawableHeight = c.height - verticalPadding * 2; // Height available for drawing
  const gap = c.width / serialBuffers[0].bufferLength;
  
  // Enable antialiasing for smoother lines
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  
  // Clear canvas
  ctx.clearRect(0, 0, c.width, c.height);
  
  // Helper function for mapping values to Y coordinates with 0.5 at center
  const mapValueToY = value => {
    // Map 0-1 range to canvas with padding (0 at bottom, 1 at top)
    return c.height - verticalPadding - (value * drawableHeight);
  };
  
  // Get accent color from CSS variables
  const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color') || '#00ff41';
  
  // Draw center axis (0.5) dotted line
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(c.width, centerY);
  ctx.stroke();
  
  // Draw y-axis markings on left side
  ctx.setLineDash([]);
  ctx.font = '10px Arial';
  ctx.fillStyle = accentColor;
  ctx.textAlign = 'left';  // Left-align text

  // Draw markers at quarter intervals
  for (let i = 0; i <= 1; i += 0.25) {
    const y = mapValueToY(i);
    ctx.beginPath();
    ctx.moveTo(0, y);          // Start from left side
    ctx.lineTo(10, y);         // Draw towards right
    ctx.stroke();
    
    // Position text slightly above or below the marking
    const textY = i >= 0.5 ? y - 4 : y + 12;
    ctx.fillText(i.toFixed(2), 12, textY);
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
  // TODO incorporate these in the vis panel
  // createSmoothingControls();
  dbg("Visualization", "makeVis", "Created smoothing controls");

  if (devmode){
    // fillSerialBuffersDefault();
  }
}

