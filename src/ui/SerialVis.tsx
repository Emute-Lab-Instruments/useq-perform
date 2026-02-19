import { createEffect, onMount, onCleanup } from "solid-js";
import {
  visStore,
  DIGITAL_CHANNELS,
  type VisExpression,
  type VisSettings,
  type VisSample,
} from "../utils/visualisationStore";

const AXIS_COLOR = "rgba(255, 255, 255, 0.12)";
const TEXT_COLOR = "rgba(255, 255, 255, 0.5)";
const ACCENT_REFRESH_INTERVAL_MS = 250;

let cachedAccentColor: string | null = null;
let lastAccentColorRead = 0;

function readAccentColor(): string {
  const computed = getComputedStyle(document.documentElement).getPropertyValue(
    "--accent-color"
  );
  return (computed && computed.trim()) || "#00ff41";
}

function getAccentColor(): string {
  const now =
    window.performance && window.performance.now
      ? window.performance.now()
      : Date.now();
  if (
    cachedAccentColor !== null &&
    now - lastAccentColorRead <= ACCENT_REFRESH_INTERVAL_MS
  ) {
    return cachedAccentColor;
  }
  cachedAccentColor = readAccentColor();
  lastAccentColorRead = now;
  return cachedAccentColor;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function lowerBound(samples: VisSample[], target: number): number {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (samples[mid].time < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

function upperBound(samples: VisSample[], target: number): number {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (samples[mid].time <= target) low = mid + 1;
    else high = mid;
  }
  return low;
}

function findLastPastIndex(
  samples: VisSample[],
  currentTime: number,
  startIndex: number,
  endIndex: number
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

interface SegmentOptions {
  stepMode?: boolean;
  lineJoin?: CanvasLineJoin;
  lineCap?: CanvasLineCap;
}

interface Point {
  x: number;
  y: number;
}

function buildSegmentPoints(
  samples: VisSample[],
  startIndex: number,
  endIndex: number,
  currentTime: number,
  halfWindow: number,
  totalWindow: number,
  canvasWidth: number,
  mapValueToY: (v: number) => number,
  options: SegmentOptions = {}
): Point[] | null {
  if (!samples || endIndex - startIndex < 2) return null;

  const points: Point[] = [];
  const windowStart = currentTime - halfWindow;
  const useStepMode = options.stepMode === true;
  let previousPoint: Point | null = null;

  for (let i = startIndex; i < endIndex; i++) {
    const sample = samples[i];
    const relative = (sample.time - windowStart) / totalWindow;
    const x = clamp01(relative) * canvasWidth;
    const y = mapValueToY(sample.value);
    if (useStepMode && previousPoint && previousPoint.y !== y) {
      points.push({ x, y: previousPoint.y });
    }
    const point: Point = { x, y };
    points.push(point);
    previousPoint = point;
  }

  return points;
}

function traceSegment(ctx: CanvasRenderingContext2D, points: Point[]): boolean {
  if (!points || points.length < 2) return false;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  return true;
}

function drawPathSegment(
  ctx: CanvasRenderingContext2D,
  samples: VisSample[],
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
  options: SegmentOptions = {}
): void {
  const points = buildSegmentPoints(
    samples,
    startIndex,
    endIndex,
    currentTime,
    halfWindow,
    totalWindow,
    canvasWidth,
    mapValueToY,
    options
  );
  if (!points || points.length < 2) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
  ctx.setLineDash(dashPattern.length ? dashPattern : []);
  if (options.lineJoin) ctx.lineJoin = options.lineJoin;
  if (options.lineCap) ctx.lineCap = options.lineCap;

  if (traceSegment(ctx, points)) {
    ctx.stroke();
  }
  ctx.restore();
}

function drawFrame(
  canvas: HTMLCanvasElement,
  expressions: Record<string, VisExpression>,
  settings: VisSettings,
  displayTime: number,
  currentTime: number
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const c = canvas;
  const verticalPadding = c.height * 0.1;
  const centerY = c.height / 2;
  const drawableHeight = c.height - verticalPadding * 2;

  const time = Number.isFinite(displayTime) ? displayTime : currentTime;
  const { lineWidth = 1.5, digitalLaneGap: rawDigitalGap = 4 } = settings;
  const futureLineAlpha = settings.futureDashed === false ? 0.85 : 0.6;
  const totalWindow = settings.windowDuration || 1;

  const exprEntries = Object.values(expressions);
  const hasExpressions = exprEntries.length > 0;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, c.width, c.height);

  if (!hasExpressions) {
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      "No expressions selected for visualisation",
      c.width / 2,
      c.height / 2
    );
    return;
  }

  const accentColor = getAccentColor();
  const laneCount = DIGITAL_CHANNELS.length;
  const digitalLaneGap = Math.max(
    0,
    Math.min(drawableHeight, Number(rawDigitalGap) || 0)
  );
  const totalGapHeight = laneCount > 1 ? digitalLaneGap * (laneCount - 1) : 0;
  const availableDigitalHeight = Math.max(0, drawableHeight - totalGapHeight);
  const digitalLaneHeight =
    laneCount > 0 ? availableDigitalHeight / laneCount : 0;

  const mapAnalogValueToY = (value: number) => {
    const clamped = Math.max(0, Math.min(1, value));
    return c.height - verticalPadding - clamped * drawableHeight;
  };

  const makeDigitalMapper = (exprType: string) => {
    const laneIndex = (DIGITAL_CHANNELS as readonly string[]).indexOf(exprType);
    if (laneIndex < 0) return mapAnalogValueToY;

    const laneTop =
      verticalPadding + laneIndex * (digitalLaneHeight + digitalLaneGap);
    const laneBottom = laneTop + digitalLaneHeight;

    return (value: number) => {
      const clamped = Math.max(0, Math.min(1, value));
      return laneBottom - clamped * digitalLaneHeight;
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

  // Draw y-axis markings
  ctx.setLineDash([]);
  ctx.font = "10px Arial";
  ctx.fillStyle = accentColor;
  ctx.textAlign = "left";

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
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const halfWindow = totalWindow / 2;
  const startTime = time - halfWindow;
  const endTime = time + halfWindow;

  for (const expression of exprEntries) {
    const samples = expression.samples;
    if (!samples || samples.length < 2) continue;

    const exprType = expression.exprType;
    const isDigital = (DIGITAL_CHANNELS as readonly string[]).includes(
      exprType
    );
    const mapValueToY = isDigital
      ? makeDigitalMapper(exprType)
      : mapAnalogValueToY;
    const segmentOptions: SegmentOptions = isDigital
      ? { stepMode: true, lineJoin: "miter", lineCap: "butt" }
      : {};

    const windowStartIndex = lowerBound(samples, startTime);
    const windowEndIndex = upperBound(samples, endTime);
    const windowLength = windowEndIndex - windowStartIndex;
    if (windowLength < 2) continue;

    const color = expression.color || accentColor;
    const lastPastIndex = findLastPastIndex(
      samples,
      time,
      windowStartIndex,
      windowEndIndex
    );

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
        time,
        halfWindow,
        totalWindow,
        c.width,
        mapValueToY,
        [],
        segmentOptions
      );
    }

    // Future segment
    const futureStart =
      lastPastIndex >= windowStartIndex ? lastPastIndex : windowStartIndex;
    if (windowEndIndex - futureStart >= 2) {
      drawPathSegment(
        ctx,
        samples,
        futureStart,
        windowEndIndex,
        color,
        futureLineAlpha,
        lineWidth,
        time,
        halfWindow,
        totalWindow,
        c.width,
        mapValueToY,
        [],
        segmentOptions
      );
    }
  }
}

export function SerialVis() {
  let canvasRef: HTMLCanvasElement | undefined;
  let rafId: number | undefined;

  function resizeCanvas() {
    if (!canvasRef) return;
    const parent = canvasRef.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvasRef.width = rect.width * dpr;
    canvasRef.height = rect.height * dpr;
    canvasRef.style.width = `${rect.width}px`;
    canvasRef.style.height = `${rect.height}px`;
  }

  function loop() {
    if (!canvasRef) return;
    drawFrame(
      canvasRef,
      visStore.expressions,
      visStore.settings,
      visStore.displayTime,
      visStore.currentTime
    );
    rafId = window.requestAnimationFrame(loop);
  }

  let resizeObserver: ResizeObserver | undefined;

  onMount(() => {
    resizeCanvas();

    resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
    });
    if (canvasRef?.parentElement) {
      resizeObserver.observe(canvasRef.parentElement);
    }

    rafId = window.requestAnimationFrame(loop);
  });

  onCleanup(() => {
    if (rafId !== undefined) {
      window.cancelAnimationFrame(rafId);
    }
    resizeObserver?.disconnect();
  });

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
