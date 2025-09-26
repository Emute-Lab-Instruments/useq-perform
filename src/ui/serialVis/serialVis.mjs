import { dbg } from "../../utils.mjs";
import { getVisualisationState } from "./visualisationController.mjs";

const AXIS_COLOR = 'rgba(255, 255, 255, 0.12)';
const TEXT_COLOR = 'rgba(255, 255, 255, 0.5)';

function drawSerialVis() {
  const c = document.getElementById("serialcanvas");
  const ctx = c.getContext("2d");
  const verticalPadding = c.height * 0.1;
  const centerY = c.height / 2;
  const drawableHeight = c.height - verticalPadding * 2;

  const state = getVisualisationState();
  const { currentTime, settings, expressions } = state;
  const {
    lineWidth = 1.5,
    futureDashed = true,
    futureMaskOpacity = 0.35,
    futureMaskWidth = 12,
  } = settings;
  const futureLineAlpha = futureDashed ? 0.6 : 0.85;
  const offset = settings.offsetSeconds || 0.5;
  const totalWindow = offset * 2;
  const hasExpressions = expressions.size > 0;

  // Enable antialiasing for smoother lines
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Clear canvas
  ctx.clearRect(0, 0, c.width, c.height);

  if (!hasExpressions) {
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('No expressions selected for visualisation', c.width / 2, c.height / 2);
    window.requestAnimationFrame(drawSerialVis);
    return;
  }

  // Helper function for mapping values to Y coordinates with 0.5 at center
  const mapValueToY = value => {
    const clamped = Math.max(0, Math.min(1, value));
    // Map 0-1 range to canvas with padding (0 at bottom, 1 at top)
    return c.height - verticalPadding - (clamped * drawableHeight);
  };

  const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent-color') || '#00ff41';

  // Draw center axis (0.5) dotted line
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(c.width, centerY);
  ctx.stroke();

  // Draw current time vertical line
  const centerX = c.width / 2;
  ctx.setLineDash([]);
  ctx.strokeStyle = AXIS_COLOR;
  ctx.beginPath();
  ctx.moveTo(centerX, 0);
  ctx.lineTo(centerX, c.height);
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
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Draw each registered expression
  for (const expression of expressions.values()) {
    const samplesInRange = expression.samples
      .filter(sample => sample.time >= currentTime - offset && sample.time <= currentTime + offset)
      .sort((a, b) => a.time - b.time);

    if (samplesInRange.length < 2) {
      continue;
    }

    const color = expression.color || accentColor;
    const lastPastIndex = findLastPastIndex(samplesInRange, currentTime);

    if (lastPastIndex >= 1) {
      const pastSamples = samplesInRange.slice(0, lastPastIndex + 1);
      drawPath(ctx, pastSamples, color, 1, lineWidth, currentTime, offset, totalWindow, c.width, mapValueToY);
    }

    const futureStart = lastPastIndex >= 0 ? lastPastIndex : 0;
    if (futureStart < samplesInRange.length - 1) {
      const futureSamples = samplesInRange.slice(futureStart, samplesInRange.length);
      if (futureSamples.length >= 2) {
        drawPath(ctx, futureSamples, color, futureLineAlpha, lineWidth, currentTime, offset, totalWindow, c.width, mapValueToY);
      }
    } else if (lastPastIndex < 1) {
      // No past samples; draw entire range as future
      drawPath(ctx, samplesInRange, color, futureLineAlpha, lineWidth, currentTime, offset, totalWindow, c.width, mapValueToY);
    }
  }

  const maskOpacity = Math.min(1, Math.max(0, settings.futureMaskOpacity ?? futureMaskOpacity));
  const maskWidth = Math.max(2, Math.round(settings.futureMaskWidth ?? futureMaskWidth));

  if (futureDashed && maskOpacity > 0.001) {
    drawFutureMask(ctx, c.width, c.height, maskWidth, maskOpacity);
  }

  window.requestAnimationFrame(drawSerialVis);
}

export function makeVis() {
  window.requestAnimationFrame(drawSerialVis);
}

function findLastPastIndex(samples, currentTime) {
  for (let i = samples.length - 1; i >= 0; i--) {
    if (samples[i].time <= currentTime) {
      return i;
    }
  }
  return -1;
}

function drawPath(ctx, samples, color, alpha, lineWidth, currentTime, offset, totalWindow, canvasWidth, mapValueToY, dashPattern = []) {
  if (!samples || samples.length < 2) {
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  const safeAlpha = Math.min(1, Math.max(0, alpha));
  ctx.globalAlpha = safeAlpha;
  ctx.setLineDash(Array.isArray(dashPattern) && dashPattern.length ? dashPattern : []);

  const start = samples[0];
  const startRelative = (start.time - (currentTime - offset)) / totalWindow;
  const startX = clamp01(startRelative) * canvasWidth;
  ctx.moveTo(startX, mapValueToY(start.value));

  for (let i = 1; i < samples.length; i++) {
    const sample = samples[i];
    const relative = (sample.time - (currentTime - offset)) / totalWindow;
    const x = clamp01(relative) * canvasWidth;
    ctx.lineTo(x, mapValueToY(sample.value));
  }

  ctx.stroke();
  ctx.restore();
}

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

let futureMaskCache = { key: null, canvas: null };

function drawFutureMask(ctx, canvasWidth, canvasHeight, stripeWidth, opacity) {
  const centerX = canvasWidth / 2;
  if (opacity <= 0) {
    return;
  }

  const patternCanvas = getFutureMaskPatternCanvas(stripeWidth);
  const pattern = ctx.createPattern(patternCanvas, 'repeat');
  if (!pattern) {
    return;
  }

  ctx.save();
  ctx.translate(centerX, 0);
  ctx.fillStyle = pattern;
  ctx.globalAlpha = Math.min(1, Math.max(0, opacity));
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillRect(0, 0, canvasWidth - centerX, canvasHeight);
  ctx.restore();
}

function getFutureMaskPatternCanvas(stripeWidth) {
  const width = Math.max(2, Math.round(stripeWidth));
  const key = `${width}`;
  if (futureMaskCache.key === key && futureMaskCache.canvas) {
    return futureMaskCache.canvas;
  }

  const size = width * 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const patternCtx = canvas.getContext('2d');
  patternCtx.clearRect(0, 0, size, size);
  patternCtx.fillStyle = '#000';
  patternCtx.fillRect(0, 0, width, size);

  futureMaskCache = { key, canvas };
  return canvas;
}
