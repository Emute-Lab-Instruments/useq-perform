import { getVisualisationState } from "./visualisationController.mjs";

const AXIS_COLOR = 'rgba(255, 255, 255, 0.12)';
const TEXT_COLOR = 'rgba(255, 255, 255, 0.5)';
const ACCENT_REFRESH_INTERVAL_MS = 250;

let cachedAccentColor = null;
let lastAccentColorRead = 0;

function readAccentColor() {
  const computed = getComputedStyle(document.documentElement).getPropertyValue('--accent-color');
  return (computed && computed.trim()) || '#00ff41';
}

// Cache accent color lookups to avoid allocating strings every animation frame.
function getAccentColor() {
  const now = (window.performance && window.performance.now) ? window.performance.now() : Date.now();
  if (cachedAccentColor !== null && now - lastAccentColorRead <= ACCENT_REFRESH_INTERVAL_MS) {
    return cachedAccentColor;
  }

  cachedAccentColor = readAccentColor();
  lastAccentColorRead = now;
  return cachedAccentColor;
}

const DIGITAL_CHANNELS = ['d1', 'd2', 'd3'];

function drawSerialVis() {
  const c = document.getElementById("serialcanvas");
  const ctx = c.getContext("2d");
  const verticalPadding = c.height * 0.1;
  const centerY = c.height / 2;
  const drawableHeight = c.height - verticalPadding * 2;

  const state = getVisualisationState();
  const { displayTime, currentTime: rawTime, settings, expressions } = state;
  const currentTime = Number.isFinite(displayTime) ? displayTime : rawTime;
  const { lineWidth = 1.5, digitalLaneGap: rawDigitalGap = 4 } = settings;
  const futureLineAlpha = settings.futureDashed === false ? 0.85 : 0.6;
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

  const accentColor = getAccentColor();
  const laneCount = DIGITAL_CHANNELS.length;
  const digitalLaneGap = Math.max(0, Math.min(drawableHeight, Number(rawDigitalGap) || 0));
  const totalGapHeight = laneCount > 1 ? digitalLaneGap * (laneCount - 1) : 0;
  const availableDigitalHeight = Math.max(0, drawableHeight - totalGapHeight);
  const digitalLaneHeight = laneCount > 0 ? availableDigitalHeight / laneCount : 0;

  const mapAnalogValueToY = (value) => {
    const clamped = Math.max(0, Math.min(1, value));
    return c.height - verticalPadding - (clamped * drawableHeight);
  };

  const makeDigitalMapper = (exprType) => {
    const laneIndex = DIGITAL_CHANNELS.indexOf(exprType);
    if (laneIndex < 0) {
      return mapAnalogValueToY;
    }

    const laneTop = verticalPadding + laneIndex * (digitalLaneHeight + digitalLaneGap);
    const laneBottom = laneTop + digitalLaneHeight;

    return (value) => {
      const clamped = Math.max(0, Math.min(1, value));
      return laneBottom - (clamped * digitalLaneHeight);
    };
  };

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
    const y = mapAnalogValueToY(i);
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

  const startTime = currentTime - offset;
  const endTime = currentTime + offset;

  // Draw each registered expression
  for (const expression of expressions.values()) {
    const samples = expression.samples;
    if (!samples || samples.length < 2) {
      continue;
    }

    const exprType = expression.exprType;
    const isDigital = DIGITAL_CHANNELS.includes(exprType);
    const mapValueToY = isDigital ? makeDigitalMapper(exprType) : mapAnalogValueToY;
    const segmentOptions = isDigital
      ? { stepMode: true, lineJoin: 'miter', lineCap: 'butt' }
      : {};

    // Samples are kept sorted by time when populated in the controller.
    const windowStartIndex = lowerBound(samples, startTime);
    const windowEndIndex = upperBound(samples, endTime);
    const windowLength = windowEndIndex - windowStartIndex;
    if (windowLength < 2) {
      continue;
    }

    const color = expression.color || accentColor;
    const lastPastIndex = findLastPastIndex(samples, currentTime, windowStartIndex, windowEndIndex);

    // Past segment
    if (lastPastIndex - windowStartIndex >= 1) {
      drawPathSegment(
        ctx,
        samples,
        windowStartIndex,
        lastPastIndex + 1,
        color,
        1,
        lineWidth,
        currentTime,
        offset,
        totalWindow,
        c.width,
        mapValueToY,
        [],
        segmentOptions
      );
    }

    // Future segment (includes pivot sample to ensure continuity)
    const futureStart = lastPastIndex >= windowStartIndex ? lastPastIndex : windowStartIndex;
    if (windowEndIndex - futureStart >= 2) {
      drawPathSegment(
        ctx,
        samples,
        futureStart,
        windowEndIndex,
        color,
        futureLineAlpha,
        lineWidth,
        currentTime,
        offset,
        totalWindow,
        c.width,
        mapValueToY,
        [],
        segmentOptions
      );
    }
  }

  window.requestAnimationFrame(drawSerialVis);
}

export function makeVis() {
  window.requestAnimationFrame(drawSerialVis);
}

function findLastPastIndex(samples, currentTime, startIndex, endIndex) {
  let low = startIndex;
  let high = endIndex - 1;
  let result = -1;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (samples[mid].time <= currentTime) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

function drawPathSegment(ctx, samples, startIndex, endIndex, color, alpha, lineWidth, currentTime, offset, totalWindow, canvasWidth, mapValueToY, dashPattern = [], options = {}) {
  const points = buildSegmentPoints(samples, startIndex, endIndex, currentTime, offset, totalWindow, canvasWidth, mapValueToY, options);
  if (!points || points.length < 2) {
    return null;
  }

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  const safeAlpha = Math.min(1, Math.max(0, alpha));
  ctx.globalAlpha = safeAlpha;
  ctx.setLineDash(Array.isArray(dashPattern) && dashPattern.length ? dashPattern : []);
  if (options?.lineJoin) {
    ctx.lineJoin = options.lineJoin;
  }
  if (options?.lineCap) {
    ctx.lineCap = options.lineCap;
  }

  if (traceSegment(ctx, points)) {
    ctx.stroke();
  }

  ctx.restore();
  return points;
}

function buildSegmentPoints(samples, startIndex, endIndex, currentTime, offset, totalWindow, canvasWidth, mapValueToY, options = {}) {
  if (!samples || endIndex - startIndex < 2) {
    return null;
  }

  const points = [];
  const windowStart = currentTime - offset;
  const useStepMode = options?.stepMode === true;
  let previousPoint = null;

  for (let i = startIndex; i < endIndex; i++) {
    const sample = samples[i];
    const relative = (sample.time - windowStart) / totalWindow;
    const x = clamp01(relative) * canvasWidth;
    const y = mapValueToY(sample.value);
    if (useStepMode && previousPoint && previousPoint.y !== y) {
      points.push({ x, y: previousPoint.y });
    }
    const point = { x, y };
    points.push(point);
    previousPoint = point;
  }

  return points;
}

function traceSegment(ctx, points) {
  if (!points || points.length < 2) {
    return false;
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    ctx.lineTo(point.x, point.y);
  }
  return true;
}

function lowerBound(samples, target) {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (samples[mid].time < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

function upperBound(samples, target) {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (samples[mid].time <= target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
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

export const __serialVisInternals = {
  buildSegmentPoints,
};
