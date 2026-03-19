import { visStore } from "../../utils/visualisationStore.ts";

const AXIS_COLOR = 'rgba(255, 255, 255, 0.12)';
const TEXT_COLOR = 'rgba(255, 255, 255, 0.5)';
const ACCENT_REFRESH_INTERVAL_MS = 250;

// Smooth time interpolation state — avoids jerky scrolling by
// interpolating between store time updates using wall-clock time.
let lastStoreTime = 0;
let lastStoreWallMs = 0;
let smoothTime = 0;

let cachedAccentColor: string | null = null;
let lastAccentColorRead = 0;

function readAccentColor(): string {
  const computed = getComputedStyle(document.documentElement).getPropertyValue('--accent-color');
  return (computed && computed.trim()) || '#00ff41';
}

// Cache accent color lookups to avoid allocating strings every animation frame.
function getAccentColor(): string {
  const now = (window.performance && window.performance.now) ? window.performance.now() : Date.now();
  if (cachedAccentColor !== null && now - lastAccentColorRead <= ACCENT_REFRESH_INTERVAL_MS) {
    return cachedAccentColor;
  }

  cachedAccentColor = readAccentColor();
  lastAccentColorRead = now;
  return cachedAccentColor;
}

const DIGITAL_CHANNELS = ['d1', 'd2', 'd3'];

function drawSerialVis(): void {
  const c = document.getElementById("serialcanvas") as HTMLCanvasElement | null;
  if (!c) {
    window.requestAnimationFrame(drawSerialVis);
    return;
  }
  const ctx = c.getContext("2d");
  if (!ctx) {
    window.requestAnimationFrame(drawSerialVis);
    return;
  }
  const verticalPadding = c.height * 0.1;
  const centerY = c.height / 2;
  const drawableHeight = c.height - verticalPadding * 2;

  // Read directly from the reactive store
  const storeTime = visStore.currentTime;
  const settings = visStore.settings;
  const expressions = visStore.expressions;

  // Smooth time interpolation: when the store time advances, extrapolate
  // linearly between updates so the waveform scrolls smoothly instead
  // of jumping when the async rebuild completes.
  const nowMs = performance.now();
  if (storeTime !== lastStoreTime) {
    lastStoreTime = storeTime;
    lastStoreWallMs = nowMs;
    smoothTime = storeTime;
  } else if (lastStoreWallMs > 0) {
    const elapsedSinceUpdate = (nowMs - lastStoreWallMs) / 1000;
    smoothTime = storeTime + elapsedSinceUpdate;
  }
  const effectiveTime = Number.isFinite(smoothTime) ? smoothTime : storeTime;
  const { lineWidth = 1.5, digitalLaneGap: rawDigitalGap = 4 } = settings;
  const futureLineAlpha = settings.futureDashed === false ? 0.85 : 0.6;
  const totalWindow = settings.windowDuration || 1;
  const exprKeys = Object.keys(expressions);
  const hasExpressions = exprKeys.length > 0;

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

  const mapAnalogValueToY = (value: number): number => {
    const clamped = Math.max(0, Math.min(1, value));
    return c.height - verticalPadding - (clamped * drawableHeight);
  };

  const makeDigitalMapper = (exprType: string): ((value: number) => number) => {
    const laneIndex = DIGITAL_CHANNELS.indexOf(exprType);
    if (laneIndex < 0) {
      return mapAnalogValueToY;
    }

    const laneTop = verticalPadding + laneIndex * (digitalLaneHeight + digitalLaneGap);
    const laneBottom = laneTop + digitalLaneHeight;

    return (value: number) => {
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
  ctx.textAlign = 'left';

  for (let i = 0; i <= 1; i += 0.25) {
    const y = mapAnalogValueToY(i);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(10, y);
    ctx.stroke();

    const textY = i >= 0.5 ? y - 4 : y + 12;
    ctx.fillText(i.toFixed(2), 12, textY);
  }

  // Draw data traces
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const halfWindow = totalWindow / 2;
  const startTime = effectiveTime - halfWindow;
  const endTime = effectiveTime + halfWindow;

  // Draw each registered expression
  for (const key of exprKeys) {
    const expression = expressions[key];
    const samples = expression.samples;
    if (!samples || samples.length < 2) {
      continue;
    }

    const exprType = expression.exprType;
    const isDigital = DIGITAL_CHANNELS.includes(exprType);
    const mapValueToY = isDigital ? makeDigitalMapper(exprType) : mapAnalogValueToY;
    const segmentOptions = isDigital
      ? { stepMode: true, lineJoin: 'miter' as const, lineCap: 'butt' as const }
      : {};

    const windowStartIndex = lowerBound(samples, startTime);
    const windowEndIndex = upperBound(samples, endTime);
    const windowLength = windowEndIndex - windowStartIndex;
    if (windowLength < 2) {
      continue;
    }

    const color = expression.color || accentColor;
    const lastPastIndex = findLastPastIndex(samples, effectiveTime, windowStartIndex, windowEndIndex);

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
        effectiveTime,
        halfWindow,
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
        effectiveTime,
        halfWindow,
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

export function makeVis(): void {
  window.requestAnimationFrame(drawSerialVis);
}

interface SamplePoint {
  time: number;
  value: number;
}

interface Point {
  x: number;
  y: number;
}

function findLastPastIndex(
  samples: SamplePoint[],
  currentTime: number,
  startIndex: number,
  endIndex: number,
): number {
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

function drawPathSegment(
  ctx: CanvasRenderingContext2D,
  samples: SamplePoint[],
  startIndex: number,
  endIndex: number,
  color: string,
  alpha: number,
  lineWidth: number,
  currentTime: number,
  halfWindow: number,
  totalWindow: number,
  canvasWidth: number,
  mapValueToY: (v: number) => number,
  dashPattern: number[] = [],
  options: { stepMode?: boolean; lineJoin?: CanvasLineJoin; lineCap?: CanvasLineCap } = {},
): Point[] | null {
  const points = buildSegmentPoints(
    samples, startIndex, endIndex, currentTime, halfWindow,
    totalWindow, canvasWidth, mapValueToY, options,
  );
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

function buildSegmentPoints(
  samples: SamplePoint[],
  startIndex: number,
  endIndex: number,
  currentTime: number,
  halfWindow: number,
  totalWindow: number,
  canvasWidth: number,
  mapValueToY: (v: number) => number,
  options: { stepMode?: boolean } = {},
): Point[] | null {
  if (!samples || endIndex - startIndex < 2) {
    return null;
  }

  const points: Point[] = [];
  const windowStart = currentTime - halfWindow;
  const useStepMode = options?.stepMode === true;
  let previousPoint: Point | null = null;

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

function traceSegment(ctx: CanvasRenderingContext2D, points: Point[]): boolean {
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

function lowerBound(samples: SamplePoint[], target: number): number {
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

function upperBound(samples: SamplePoint[], target: number): number {
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

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export const __serialVisInternals = {
  buildSegmentPoints,
};
