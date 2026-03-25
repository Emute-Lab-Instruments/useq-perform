import { visualisationSessionChannel } from "../../contracts/visualisationChannels";
import { perf } from "../../lib/perfTrace.ts";
import { visStore } from "../../utils/visualisationStore.ts";

const AXIS_COLOR = 'rgba(255, 255, 255, 0.12)';
const TEXT_COLOR = 'rgba(255, 255, 255, 0.5)';
const ACCENT_REFRESH_INTERVAL_MS = 250;

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
const PANEL_ID = "panel-vis";
const CANVAS_ID = "serialcanvas";

let frameId: number | null = null;
let subscriptionsBound = false;

function getPanel(): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  return document.getElementById(PANEL_ID);
}

function getCanvas(): HTMLCanvasElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  return document.getElementById(CANVAS_ID) as HTMLCanvasElement | null;
}

function isPanelVisible(): boolean {
  const panel = getPanel();
  if (!panel || typeof window === "undefined") {
    return false;
  }

  const style = window.getComputedStyle(panel);
  return style.display !== "none" && style.visibility !== "hidden" && !panel.hidden;
}

function hasActiveExpressions(): boolean {
  return Object.keys(visStore.expressions).length > 0;
}

function clearCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function drawEmptyState(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  clearCanvas(canvas, ctx);
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = '12px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('No expressions selected for visualisation', canvas.width / 2, canvas.height / 2);
}

function scheduleNextFrame(): void {
  if (frameId !== null || typeof window === "undefined") {
    return;
  }

  if (!isPanelVisible() || !hasActiveExpressions()) {
    return;
  }

  frameId = window.requestAnimationFrame(drawSerialVis);
}

function drawSerialVis(): void {
  frameId = null;
  perf.begin("render-frame");

  const c = getCanvas();
  if (!c) {
    perf.end("render-frame");
    return;
  }
  const ctx = c.getContext("2d");
  if (!ctx) {
    return;
  }
  if (!isPanelVisible()) {
    return;
  }
  const verticalPadding = c.height * 0.1;
  const centerY = c.height / 2;
  const drawableHeight = c.height - verticalPadding * 2;

  // Read from the reactive store — time advances every frame (via localClock
  // or hardware serial), so no interpolation is needed.
  const currentTime = visStore.currentTime;
  const settings = visStore.settings;
  const expressions = visStore.expressions;

  const effectiveTime = currentTime;
  const { lineWidth = 1.5, digitalLaneGap: rawDigitalGap = 4 } = settings;
  const futureLineAlpha = settings.futureDashed === false ? 0.85 : 0.6;
  const totalWindow = settings.windowDuration || 1;
  const exprKeys = Object.keys(expressions);
  const hasExpressions = exprKeys.length > 0;

  // Enable antialiasing for smoother lines
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Clear canvas
  clearCanvas(c, ctx);

  if (!hasExpressions) {
    drawEmptyState(c, ctx);
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

  perf.end("render-frame");
}

export function makeVis(): void {
  if (!subscriptionsBound) {
    subscriptionsBound = true;
    visualisationSessionChannel.subscribe(() => {
      refreshSerialVisLoop();
    });
  }

  refreshSerialVisLoop();
}

export function stopSerialVisLoop(): void {
  if (frameId === null || typeof window === "undefined") {
    return;
  }

  window.cancelAnimationFrame(frameId);
  frameId = null;
}

export function refreshSerialVisLoop(): void {
  const canvas = getCanvas();
  const ctx = canvas?.getContext("2d");

  if (!isPanelVisible()) {
    stopSerialVisLoop();
    return;
  }

  if (!canvas || !ctx) {
    stopSerialVisLoop();
    return;
  }

  if (!hasActiveExpressions()) {
    stopSerialVisLoop();
    drawEmptyState(canvas, ctx);
    return;
  }

  scheduleNextFrame();
}

interface SamplePoint {
  time: number;
  value: number;
}

// ── Pre-allocated point buffers ─────────────────────────────────────
// Reuse Float64Arrays for segment points instead of allocating Point[]
// every frame. Capacity grows as needed but never shrinks.

let pointBufX = new Float64Array(512);
let pointBufY = new Float64Array(512);

function ensurePointCapacity(required: number): void {
  if (required <= pointBufX.length) return;
  const next = Math.max(required, pointBufX.length * 2);
  pointBufX = new Float64Array(next);
  pointBufY = new Float64Array(next);
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
): boolean {
  const pointCount = buildSegmentPointsInto(
    samples, startIndex, endIndex, currentTime, halfWindow,
    totalWindow, canvasWidth, mapValueToY, options,
  );
  if (pointCount < 2) {
    return false;
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

  if (traceSegmentFromBuffers(ctx, pointCount)) {
    ctx.stroke();
  }

  ctx.restore();
  return true;
}

/**
 * Write segment points into the pre-allocated pointBufX/pointBufY arrays.
 * Returns the number of points written. Zero allocations.
 */
function buildSegmentPointsInto(
  samples: SamplePoint[],
  startIndex: number,
  endIndex: number,
  currentTime: number,
  halfWindow: number,
  totalWindow: number,
  canvasWidth: number,
  mapValueToY: (v: number) => number,
  options: { stepMode?: boolean } = {},
): number {
  if (!samples || endIndex - startIndex < 2) {
    return 0;
  }

  // Worst case: step mode doubles the point count
  const maxPoints = (endIndex - startIndex) * 2;
  ensurePointCapacity(maxPoints);

  const windowStart = currentTime - halfWindow;
  const useStepMode = options?.stepMode === true;
  let count = 0;
  let prevY = NaN;

  for (let i = startIndex; i < endIndex; i++) {
    const sample = samples[i];
    const relative = (sample.time - windowStart) / totalWindow;
    const x = clamp01(relative) * canvasWidth;
    const y = mapValueToY(sample.value);
    if (useStepMode && count > 0 && prevY !== y) {
      pointBufX[count] = x;
      pointBufY[count] = prevY;
      count++;
    }
    pointBufX[count] = x;
    pointBufY[count] = y;
    count++;
    prevY = y;
  }

  return count;
}

function traceSegmentFromBuffers(ctx: CanvasRenderingContext2D, pointCount: number): boolean {
  if (pointCount < 2) {
    return false;
  }

  ctx.beginPath();
  ctx.moveTo(pointBufX[0], pointBufY[0]);
  for (let i = 1; i < pointCount; i++) {
    ctx.lineTo(pointBufX[i], pointBufY[i]);
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
  buildSegmentPointsInto,
  hasActiveExpressions,
  isPanelVisible,
};
