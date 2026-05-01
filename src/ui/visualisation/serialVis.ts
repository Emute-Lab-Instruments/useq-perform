/**
 * Serial visualisation canvas renderer — faithful-past / projected-future.
 *
 * Draws past values from per-output rolling buffers (ground truth) and
 * future values from WASM projections.  The two halves are stitched at
 * t = now with no blending — discontinuities on expression change are
 * shown honestly.
 *
 * Public API:
 *   - drawSerialVis()         — paint one frame
 *   - ensureCanvasGeometry()  — sync canvas buffer to CSS size
 *   - isVisPanelVisible()     — cached visibility check
 */

import { perf } from "../../lib/perfTrace.ts";
import { visStore } from "../../utils/visualisationStore.ts";
import { getRenderData } from "../../effects/visualisationSampler.ts";
import type { PastBuffer } from "../../lib/PastBuffer.ts";

const AXIS_COLOR = "rgba(255, 255, 255, 0.12)";
const TEXT_COLOR = "rgba(255, 255, 255, 0.5)";
const ACCENT_REFRESH_INTERVAL_MS = 250;

let cachedAccentColor: string | null = null;
let lastAccentColorRead = 0;

function readAccentColor(): string {
  const computed = getComputedStyle(
    document.documentElement,
  ).getPropertyValue("--accent-color");
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

const DIGITAL_CHANNELS = ["d1", "d2", "d3"];
const PANEL_ID = "panel-vis";
const CANVAS_ID = "serialcanvas";

let _panelVisibleCache = false;
let _panelVisibleCacheTime = 0;
const PANEL_VISIBLE_CACHE_MS = 200;

function getPanel(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(PANEL_ID);
}

function getCanvas(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(CANVAS_ID) as HTMLCanvasElement | null;
}

export function isVisPanelVisible(): boolean {
  const now = performance.now();
  if (now - _panelVisibleCacheTime < PANEL_VISIBLE_CACHE_MS) {
    return _panelVisibleCache;
  }
  const panel = getPanel();
  if (!panel || typeof window === "undefined") {
    _panelVisibleCache = false;
    _panelVisibleCacheTime = now;
    return false;
  }
  const style = window.getComputedStyle(panel);
  _panelVisibleCache =
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    !panel.hidden;
  _panelVisibleCacheTime = now;
  return _panelVisibleCache;
}

function syncCanvasResolution(c: HTMLCanvasElement): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = c.getBoundingClientRect();
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
}

export function ensureCanvasGeometry(): void {
  const c = getCanvas();
  if (c) syncCanvasResolution(c);
}

// ── Pre-allocated point buffers ─────────────────────────────────────

let pointBufX = new Float64Array(512);
let pointBufY = new Float64Array(512);

function ensurePointCapacity(required: number): void {
  if (required <= pointBufX.length) return;
  const next = Math.max(required, pointBufX.length * 2);
  pointBufX = new Float64Array(next);
  pointBufY = new Float64Array(next);
}

// ── Coordinate mapping ──────────────────────────────────────────────

function timeToX(
  t: number,
  windowStart: number,
  totalWindow: number,
  canvasWidth: number,
): number {
  const relative = (t - windowStart) / totalWindow;
  return clamp01(relative) * canvasWidth;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

// ── Past segment rendering ──────────────────────────────────────────

function buildPastPoints(
  buf: PastBuffer,
  windowStart: number,
  windowEnd: number,
  totalWindow: number,
  canvasWidth: number,
  mapValueToY: (v: number) => number,
  stepMode: boolean,
  mapOrigin?: number,
): number {
  const bufLen = buf.length;
  if (bufLen < 2) return 0;

  let startIdx = -1;
  let endIdx = -1;
  for (let i = 0; i < bufLen; i++) {
    const t = buf.timeAt(i);
    if (t >= windowStart && startIdx < 0) startIdx = i;
    if (t <= windowEnd) endIdx = i;
  }
  if (startIdx < 0 || endIdx < 0 || endIdx - startIdx < 1) return 0;

  const count = endIdx - startIdx + 1;
  ensurePointCapacity(count * 2);

  const xOrigin = mapOrigin ?? windowStart;
  let ptCount = 0;
  let prevY = NaN;

  for (let i = startIdx; i <= endIdx; i++) {
    const t = buf.timeAt(i);
    const x = timeToX(t, xOrigin, totalWindow, canvasWidth);
    const y = mapValueToY(buf.valueAt(i));

    if (stepMode && ptCount > 0 && prevY !== y) {
      pointBufX[ptCount] = x;
      pointBufY[ptCount] = prevY;
      ptCount++;
    }
    pointBufX[ptCount] = x;
    pointBufY[ptCount] = y;
    ptCount++;
    prevY = y;
  }

  return ptCount;
}

// ── Path tracing ────────────────────────────────────────────────────

function traceAndStroke(
  ctx: CanvasRenderingContext2D,
  pointCount: number,
  color: string,
  alpha: number,
  lineWidth: number,
  options: {
    lineJoin?: CanvasLineJoin;
    lineCap?: CanvasLineCap;
  } = {},
): void {
  if (pointCount < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
  ctx.setLineDash([]);
  if (options.lineJoin) ctx.lineJoin = options.lineJoin;
  if (options.lineCap) ctx.lineCap = options.lineCap;
  ctx.beginPath();
  ctx.moveTo(pointBufX[0], pointBufY[0]);
  for (let i = 1; i < pointCount; i++) {
    ctx.lineTo(pointBufX[i], pointBufY[i]);
  }
  ctx.stroke();
  ctx.restore();
}

// ── Main draw ───────────────────────────────────────────────────────

export function drawSerialVis(): void {
  perf.begin("render-frame");
  const c = getCanvas();
  if (!c) {
    perf.end("render-frame");
    return;
  }
  const ctx = c.getContext("2d");
  if (!ctx) {
    perf.end("render-frame");
    return;
  }
  if (!isVisPanelVisible()) {
    perf.end("render-frame");
    return;
  }

  ctx.globalAlpha = 0.7;

  const verticalPadding = c.height * 0.1;
  const centerY = c.height / 2;
  const drawableHeight = c.height - verticalPadding * 2;

  const currentTime = visStore.currentTime;
  const settings = visStore.settings;
  const expressions = visStore.expressions;
  const { lineWidth = 1.5, digitalLaneGap: rawDigitalGap = 4 } = settings;
  const futureLineAlpha = settings.futureDashed === false ? 0.85 : 0.6;
  const totalWindow = settings.windowDuration || 1;
  const halfWindow = totalWindow / 2;
  const windowStart = currentTime - halfWindow;
  const windowEnd = currentTime + halfWindow;

  const exprKeys = Object.keys(expressions);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, c.width, c.height);

  if (exprKeys.length === 0) {
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      "No expressions selected for visualisation",
      c.width / 2,
      c.height / 2,
    );
    perf.end("render-frame");
    return;
  }

  const accentColor = getAccentColor();
  const laneCount = DIGITAL_CHANNELS.length;
  const digitalLaneGap = Math.max(
    0,
    Math.min(drawableHeight, Number(rawDigitalGap) || 0),
  );
  const totalGapHeight =
    laneCount > 1 ? digitalLaneGap * (laneCount - 1) : 0;
  const availableDigitalHeight = Math.max(0, drawableHeight - totalGapHeight);
  const digitalLaneHeight =
    laneCount > 0 ? availableDigitalHeight / laneCount : 0;

  const mapAnalogValueToY = (value: number): number => {
    const clamped = Math.max(0, Math.min(1, value));
    return c.height - verticalPadding - clamped * drawableHeight;
  };

  const makeDigitalMapper = (
    exprType: string,
  ): ((value: number) => number) => {
    const laneIndex = DIGITAL_CHANNELS.indexOf(exprType);
    if (laneIndex < 0) return mapAnalogValueToY;
    const laneTop =
      verticalPadding + laneIndex * (digitalLaneHeight + digitalLaneGap);
    const laneBottom = laneTop + digitalLaneHeight;
    return (value: number) => {
      const clamped = Math.max(0, Math.min(1, value));
      return laneBottom - clamped * digitalLaneHeight;
    };
  };

  // Center axis (0.5) dotted line
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(c.width, centerY);
  ctx.stroke();

  // Current time vertical line
  const centerX = c.width / 2;
  ctx.setLineDash([]);
  ctx.strokeStyle = AXIS_COLOR;
  ctx.beginPath();
  ctx.moveTo(centerX, 0);
  ctx.lineTo(centerX, c.height);
  ctx.stroke();

  // Y-axis markings
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

  // Data traces
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (const key of exprKeys) {
    const expression = expressions[key];
    const renderData = getRenderData(key);
    if (!renderData) continue;

    const exprType = expression.exprType;
    const isDigital = DIGITAL_CHANNELS.includes(exprType);
    const mapValueToY = isDigital
      ? makeDigitalMapper(exprType)
      : mapAnalogValueToY;
    const segOpts = isDigital
      ? { lineJoin: "miter" as const, lineCap: "butt" as const }
      : {};
    const color = expression.color || accentColor;

    // Past segment (from rolling buffer)
    const pastCount = buildPastPoints(
      renderData.pastBuffer,
      windowStart,
      currentTime,
      totalWindow,
      c.width,
      mapValueToY,
      isDigital,
    );
    if (pastCount >= 2) {
      traceAndStroke(ctx, pastCount, color, 1, lineWidth, segOpts);
    }

    // Future segment (from future buffer)
    const fb = renderData.futureBuffer;
    if (fb && fb.length >= 2) {
      const futureCount = buildPastPoints(
        fb,
        currentTime,
        windowEnd,
        totalWindow,
        c.width,
        mapValueToY,
        isDigital,
        windowStart,
      );
      if (futureCount >= 2) {
        traceAndStroke(
          ctx,
          futureCount,
          color,
          futureLineAlpha,
          lineWidth,
          segOpts,
        );
      }
    }
  }

  perf.end("render-frame");
}

// ── Exports for external use ────────────────────────────────────────

export function timeToXPublic(
  t: number,
  now: number,
  halfWindow: number,
  totalWindow: number,
  canvasWidth: number,
): number {
  const windowStart = now - halfWindow;
  return timeToX(t, windowStart, totalWindow, canvasWidth);
}

export { timeToXPublic as timeToX };

export function xToTime(
  x: number,
  now: number,
  halfWindow: number,
  totalWindow: number,
  canvasWidth: number,
): number {
  const windowStart = now - halfWindow;
  return windowStart + (x / canvasWidth) * totalWindow;
}

export const __serialVisInternals = {
  isVisPanelVisible,
};
