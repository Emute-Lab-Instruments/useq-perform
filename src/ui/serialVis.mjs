import { serialBuffers } from "../io/serialComms.mjs";
import { toggleAuxPanel } from "./ui.mjs";
import {
  plotCtx,
  lineCtx,
  activeBuffer,
  swapBuffer,
} from "./internalVis/main.mjs";

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
  console.log("Drawing plot");
  const palette = [
    "#00429d",
    "#45a5ad",
    "#ace397",
    "#fcbf5d",
    "#ff809f",
    "#ff005e",
    "#c9004c",
    "#93003a",
  ];
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
    zeroY - (value * 2 - 1) * amplitudeMultiplier * zeroY;

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

  //   if ($("#serialvis").is(":visible")) {
  //     $(".header").css("right", "50px");
  //   } else {
  //     $(".header").css("right", "20px");
  //   }

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
    ctx.strokeStyle = palette[ch];
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

export function drawSerialVis() {
  // FIXME get time from module every now and then
  time = Date.now();

  if (plotNeedsRedrawing) {
    drawPlot();
    plotNeedsRedrawing = false;
  }

  drawTimeLine();

  window.requestAnimationFrame(drawSerialVis);
}

export function initVisPanel() {
  console.log("Initializing serial visualization panel");
  // Start animation loop for serial visualization
  window.requestAnimationFrame(drawSerialVis);
}
