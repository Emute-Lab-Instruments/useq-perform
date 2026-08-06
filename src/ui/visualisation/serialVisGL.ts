/**
 * Serial visualisation WebGL renderer — faithful-past / projected-future.
 *
 * Two paint entries:
 *   - drawSerialVisGL(input)         — pure entry; takes a `VisRenderInput`
 *                                      with all expressions/settings/buffers
 *                                      it needs.  Suitable for Storybook /
 *                                      Inspector harnesses with synthetic
 *                                      data; performs no singleton reads.
 *   - drawSerialVisGLFromStores()    — wired wrapper that builds the input
 *                                      from `visStore` + the buffer owner's
 *                                      `getRenderData()` and calls through.
 *                                      This is what the production render
 *                                      hook invokes.
 *
 * Other public helpers:
 *   - ensureGLCanvasGeometry()  — sync canvas buffer to its CSS size
 *   - activateGLCanvas()        — flip display:none → block on the canvas
 *   - isVisPanelVisible()       — visibility check
 *
 * Design notes:
 *   - One rendering context per canvas; the canvas is locked to WebGL2 once
 *     `drawSerialVisGL()` runs.
 *   - One rendering path: CPU-extruded triangle strip with miter joins
 *     (gentle curves) and bevel joins (sharp turns >~90°).  Geometry is
 *     pre-computed in clip space; the vertex shader is a pass-through.
 *     `lineWidth` parameterises the extrusion half-width.
 *   - Past/future alpha split is selected per draw call after the
 *     renderer uploads independent past and future VBOs.
 *   - Axis lines, value labels, and "no expressions" fallback text are
 *     kept on a 2D overlay canvas (created lazily and stacked under the
 *     GL canvas).  Drawing crisp text in WebGL is out of scope — and the
 *     overlay is allocated once, paints rarely (only on geometry/state
 *     changes), and costs nothing in the steady state.
 */

import { perf } from "../../lib/perfTrace.ts";
import { projectionTrace } from "../../lib/projectionTrace.ts";
import type { VisExpression, VisSettings } from "../../utils/visualisationStore.ts";
import { visStore } from "../../utils/visualisationStore.ts";
import {
  getRenderData as getRenderDataFromBuffers,
  setPastBufferSampleRate,
  type OutputRenderData,
} from "../../effects/visualisationBuffers.ts";
import { getSampleRateDivisor } from "../../effects/adaptiveQuality.ts";
import {
  compileShader,
  linkProgram,
  parseColor,
  flattenSamples,
  buildThickLineGeometry,
  sampleFingerprint,
  fingerprintChanged,
  ensureScratch,
  getScratch,
  ensureThickScratch,
  getThickScratch,
  THICK_FLOATS_PER_VERTEX,
  THICK_VERTEX_SRC as VERTEX_SHADER_SRC,
  FRAGMENT_SRC as FRAGMENT_SHADER_SRC,
  type VisSampleLike,
  type SampleFingerprint,
} from "./webglLineRenderer.ts";
import {
  buildCombinedSamples,
  computeAdaptivePastBufferRate,
  computeLaneLayout,
  futureBoundaryMaxGapSeconds,
  getCombinedSplitIndex,
  isDigitalOutput,
} from "./serialVisPlanning.ts";

export {
  computeAdaptivePastBufferRate,
  computeLaneLayout,
} from "./serialVisPlanning.ts";
export type { LaneBox, LaneLayoutGeometry } from "./serialVisPlanning.ts";

/**
 * All data required to paint one frame of the serial visualisation.
 *
 * The pure paint entry (`drawSerialVisGL`) takes this as its sole
 * argument so it can run with synthetic data in Storybook / Inspector
 * scenarios.  The wired entry (`drawSerialVisGLFromStores`) builds it
 * from the global `visStore` + sampler.
 */
export interface VisRenderInput {
  /** Map of exprType → expression descriptor (color, exprType, etc.). */
  expressions: Record<string, VisExpression>;
  /** Current rendering settings (lineWidth, windowDuration, ...). */
  settings: VisSettings;
  /** Current simulation time, used for past/future split + window. */
  currentTime: number;
  /**
   * Per-output render data accessor.  Returns the past + future
   * PastBuffers for a given exprType, or null if the output is unknown.
   */
  getRenderData: (exprType: string) => OutputRenderData | null;
}

const PANEL_ID = "panel-vis";
const GL_CANVAS_ID = "serialcanvas-gl";
const OVERLAY_ID = "serialcanvas-gl-overlay";

// ── Panel visibility (cached) ───────────────────────────────────────

let _panelVisibleCache = false;
let _panelVisibleCacheTime = 0;
const PANEL_VISIBLE_CACHE_MS = 200;

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

// Digital outputs are `d<n>` / `s<n>` (binary step traces); analogue
// outputs are `a<n>` (continuous). The channel set is dynamic (a1–a8,
// d1–d8, s1–s8 per spec §1.5), so lane layout is derived from the ACTIVE
// output set each frame, not a hardcoded channel list.
const VERTICAL_PADDING_FRACTION = 0.1;

function verticalPaddingFallback(height: number): number {
  return height * VERTICAL_PADDING_FRACTION;
}


const AXIS_COLOR = "rgba(255, 255, 255, 0.12)";
const TEXT_COLOR = "rgba(255, 255, 255, 0.5)";
const ACCENT_REFRESH_INTERVAL_MS = 250;

let cachedAccentColor: string | null = null;
let lastAccentColorRead = 0;

function readAccentColor(): string {
  if (typeof document === "undefined") return "#00ff41";
  const computed = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent-color");
  return (computed && computed.trim()) || "#00ff41";
}

function getAccentColor(): string {
  const now = (typeof performance !== "undefined" && performance.now)
    ? performance.now()
    : Date.now();
  if (cachedAccentColor !== null && now - lastAccentColorRead <= ACCENT_REFRESH_INTERVAL_MS) {
    return cachedAccentColor;
  }
  cachedAccentColor = readAccentColor();
  lastAccentColorRead = now;
  return cachedAccentColor;
}

let glCanvas: HTMLCanvasElement | null = null;

// ── Screenshot capture ─────────────────────────────────────────────

let _screenshotPending = false;

export function requestVisScreenshot(): void {
  _screenshotPending = true;
}

function captureScreenshot(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement): void {
  const w = canvas.width;
  const h = canvas.height;

  const pixels = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d")!;

  // GL readPixels is bottom-up; flip vertically
  const imageData = ctx.createImageData(w, h);
  for (let row = 0; row < h; row++) {
    const srcOffset = (h - 1 - row) * w * 4;
    const dstOffset = row * w * 4;
    imageData.data.set(pixels.subarray(srcOffset, srcOffset + w * 4), dstOffset);
  }

  // Draw the overlay (axes/labels) first, then GL content on top
  const overlay = overlayCanvas;
  if (overlay) ctx.drawImage(overlay, 0, 0);
  ctx.putImageData(imageData, 0, 0);
  // Re-draw overlay on top for labels
  if (overlay) {
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(overlay, 0, 0);
  }

  out.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vis-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}

/**
 * Get (or lazily create) a dedicated WebGL canvas inside the panel.
 */
function getCanvas(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  if (glCanvas && glCanvas.isConnected) return glCanvas;

  const existing = document.getElementById(GL_CANVAS_ID) as HTMLCanvasElement | null;
  if (existing) {
    glCanvas = existing;
    return existing;
  }

  const panel = getPanel();
  if (!panel) return null;

  const c = document.createElement("canvas");
  c.id = GL_CANVAS_ID;
  c.style.display = "block";
  c.style.width = "100%";
  c.style.height = "100%";
  c.style.backgroundColor = "transparent";
  c.style.position = "absolute";
  c.style.top = "0";
  c.style.left = "0";
  c.style.willChange = "contents";
  c.style.zIndex = "1000";

  panel.appendChild(c);
  glCanvas = c;
  return c;
}

function getPanel(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(PANEL_ID);
}

/**
 * Ensure the GL canvas is visible.  Called each frame from the render hook.
 */
export function activateGLCanvas(): void {
  const gl = glCanvas;
  if (!gl) return;
  if (gl.style.display === "none") gl.style.display = "block";
}

/**
 * Sync the WebGL canvas buffer resolution to its CSS layout size and
 * make sure the 2D overlay (axes/labels) tracks it as well.  Only
 * touches the buffers when dimensions change.
 */
function syncCanvasResolution(canvas: HTMLCanvasElement): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const overlay = ensureOverlayCanvas(canvas);
  if (overlay && (overlay.width !== w || overlay.height !== h)) {
    overlay.width = w;
    overlay.height = h;
  }
}

export function ensureGLCanvasGeometry(): void {
  const c = getCanvas();
  if (c) syncCanvasResolution(c);
}

// ── Overlay (2D) for axes, labels, and empty-state text ─────────────

let overlayCanvas: HTMLCanvasElement | null = null;

// Dirty-tracking for overlay repaint — only redraw axes/labels when these change.
let overlayDirtyW = 0;
let overlayDirtyH = 0;
let overlayDirtyHasExpr = false;
let overlayDirtyAccent = "";
let overlayDirtyShowFuture = true;

function ensureOverlayCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  if (overlayCanvas && overlayCanvas.isConnected) return overlayCanvas;
  const existing = document.getElementById(OVERLAY_ID) as HTMLCanvasElement | null;
  if (existing) {
    overlayCanvas = existing;
    return existing;
  }
  const o = document.createElement("canvas");
  o.id = OVERLAY_ID;
  o.style.position = "absolute";
  o.style.top = "0";
  o.style.left = "0";
  o.style.width = "100%";
  o.style.height = "100%";
  o.style.pointerEvents = "none";
  // Render the overlay *under* the WebGL canvas so the GL layer (alpha
  // blended) composites on top of the axes/labels.  Using zIndex
  // matters because the panel container places the canvas at zIndex
  // 1000 (see visualisationPanel.ts).
  o.style.zIndex = "999";
  const parent = canvas.parentElement || getPanel();
  if (parent) parent.appendChild(o);
  overlayCanvas = o;
  return o;
}

function drawOverlay(canvas: HTMLCanvasElement, hasExpressions: boolean, showFuture = true): void {
  const overlay = ensureOverlayCanvas(canvas);
  if (!overlay) return;
  const ctx = overlay.getContext("2d");
  if (!ctx) return;
  const w = overlay.width;
  const h = overlay.height;
  ctx.clearRect(0, 0, w, h);
  ctx.globalAlpha = 0.7;

  if (!hasExpressions) {
    ctx.fillStyle = TEXT_COLOR;
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText("No expressions selected for visualisation", w / 2, h / 2);
    return;
  }

  const accentColor = getAccentColor();
  const verticalPadding = h * 0.1;
  const drawableHeight = h - verticalPadding * 2;
  const centerY = h / 2;
  const nowX = showFuture ? w / 2 : w;

  // Center axis (0.5) dotted line
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(w, centerY);
  ctx.stroke();

  // Current time vertical line (center when showing future, right edge when past-only)
  if (showFuture) {
    ctx.setLineDash([]);
    ctx.strokeStyle = AXIS_COLOR;
    ctx.beginPath();
    ctx.moveTo(nowX, 0);
    ctx.lineTo(nowX, h);
    ctx.stroke();
  }

  // Y-axis markings
  ctx.font = "10px Arial";
  ctx.fillStyle = accentColor;
  ctx.textAlign = "left";
  for (let i = 0; i <= 1; i += 0.25) {
    const yClamped = Math.max(0, Math.min(1, i));
    const y = h - verticalPadding - (yClamped * drawableHeight);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(10, y);
    ctx.stroke();
    const textY = i >= 0.5 ? y - 4 : y + 12;
    ctx.fillText(i.toFixed(2), 12, textY);
  }
}

// ── WebGL2 context + program state ──────────────────────────────────

interface GLState {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  uColor: WebGLUniformLocation | null;
  uAlphaPast: WebGLUniformLocation | null;
  uAlphaFuture: WebGLUniformLocation | null;
  uCurrentTime: WebGLUniformLocation | null;
  uClipFutureStart: WebGLUniformLocation | null;
  buffers: Map<string, ExprBuffer>;
}

interface ExprBuffer {
  pastVbo: WebGLBuffer;
  pastCapacity: number;
  pastVertexCount: number;
  futureVbo: WebGLBuffer;
  futureCapacity: number;
  futureVertexCount: number;
  fingerprint: SampleFingerprint | null;
  lineWidth: number;
  /** Cached render params to detect window/viewport changes (C3 fix). */
  renderParams: RenderParamsFingerprint | null;
}

interface RenderParamsFingerprint {
  windowStart: number;
  windowEnd: number;
  yTop: number;
  yBottom: number;
  viewportW: number;
  viewportH: number;
}

function renderParamsChanged(
  a: RenderParamsFingerprint | null,
  b: RenderParamsFingerprint,
): boolean {
  return (
    !a ||
    a.windowStart !== b.windowStart ||
    a.windowEnd !== b.windowEnd ||
    a.yTop !== b.yTop ||
    a.yBottom !== b.yBottom ||
    a.viewportW !== b.viewportW ||
    a.viewportH !== b.viewportH
  );
}

let glState: GLState | null = null;

function ensureGLState(canvas: HTMLCanvasElement): GLState | null {
  if (glState && glState.gl.canvas === canvas && !glState.gl.isContextLost()) {
    return glState;
  }
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  }) as WebGL2RenderingContext | null;
  if (!gl) {
    console.warn("[serialVisGL] WebGL2 context unavailable");
    return null;
  }

  const program = linkProgram(gl, VERTEX_SHADER_SRC, FRAGMENT_SHADER_SRC, [
    [0, "aPosition"],
    [1, "aTime"],
  ]);
  if (!program) return null;
  const vao = gl.createVertexArray();
  if (!vao) return null;

  glState = {
    gl,
    program,
    vao,
    uColor: gl.getUniformLocation(program, "uColor"),
    uAlphaPast: gl.getUniformLocation(program, "uAlphaPast"),
    uAlphaFuture: gl.getUniformLocation(program, "uAlphaFuture"),
    uCurrentTime: gl.getUniformLocation(program, "uCurrentTime"),
    uClipFutureStart: gl.getUniformLocation(program, "uClipFutureStart"),
    buffers: new Map(),
  };
  return glState;
}

function getOrCreateBuffer(state: GLState, key: string): ExprBuffer {
  let buf = state.buffers.get(key);
  if (buf) return buf;
  const pastVbo = state.gl.createBuffer();
  if (!pastVbo) throw new Error("[serialVisGL] failed to create past VBO");
  const futureVbo = state.gl.createBuffer();
  if (!futureVbo) throw new Error("[serialVisGL] failed to create future VBO");
  buf = {
    pastVbo, pastCapacity: 0, pastVertexCount: 0,
    futureVbo, futureCapacity: 0, futureVertexCount: 0,
    fingerprint: null, lineWidth: 0, renderParams: null,
  };
  state.buffers.set(key, buf);
  return buf;
}

/**
 * Upload geometry for a single segment (past or future) to a VBO.
 * Returns the vertex count written.  Uses the shared scratch buffers
 * (flattenSamples → buildThickLineGeometry → thickScratch), so callers
 * must not interleave calls from different threads.
 */
function uploadSegmentGeometry(
  gl: WebGL2RenderingContext,
  vbo: WebGLBuffer,
  capacity: number,
  samples: VisSampleLike[],
  segStart: number,
  segEnd: number,
  stepMode: boolean,
  lineWidth: number,
  windowStart: number,
  windowEnd: number,
  yTop: number,
  yBottom: number,
  viewportW: number,
  viewportH: number,
): { vertexCount: number; capacity: number } {
  if (segEnd - segStart < 2) return { vertexCount: 0, capacity };

  const flatVertexCount = flattenSamples(samples, stepMode, segStart, segEnd);
  if (flatVertexCount < 2) return { vertexCount: 0, capacity };

  const halfWidth = Math.max(lineWidth, 1) / 2;
  const thickVertexCount = buildThickLineGeometry(
    flatVertexCount, halfWidth,
    windowStart, windowEnd,
    yTop, yBottom,
    viewportW, viewportH,
  );
  if (thickVertexCount < 3) return { vertexCount: 0, capacity };

  const floatCount = thickVertexCount * THICK_FLOATS_PER_VERTEX;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  let newCapacity = capacity;
  if (thickVertexCount > capacity) {
    const grown = Math.max(thickVertexCount, capacity * 2 || 256);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      grown * THICK_FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT,
      gl.DYNAMIC_DRAW,
    );
    newCapacity = grown;
    if (import.meta.env.DEV) perf.count("vis-gl-thick-buffer-grown");
  }
  const thickBuf = getThickScratch();
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, thickBuf.subarray(0, floatCount), 0, floatCount);
  return { vertexCount: thickVertexCount, capacity: newCapacity };
}

/**
 * Build and upload separate past/future geometry for one expression.
 *
 * C2 fix: Instead of a single continuous triangle strip with
 * fragment-shader clipping, we split at `combinedSplitIndex` and
 * upload two independent VBOs.  This eliminates cross-boundary
 * triangle interpolation (spec §3.9).
 *
 * C3 fix: The fingerprint cache now also tracks window/viewport
 * parameters so geometry is rebuilt when the view changes even if
 * sample data hasn't.
 *
 * m1 fix: stepMode is no longer excluded from the cache check —
 * the valueHash in the fingerprint already captures value changes.
 */
function uploadGeometry(
  state: GLState,
  buf: ExprBuffer,
  samples: VisSampleLike[],
  splitIndex: number,
  stepMode: boolean,
  lineWidth: number,
  windowStart: number,
  windowEnd: number,
  yTop: number,
  yBottom: number,
  viewportW: number,
  viewportH: number,
): void {
  const fp = sampleFingerprint(samples);
  const rp: RenderParamsFingerprint = {
    windowStart, windowEnd, yTop, yBottom, viewportW, viewportH,
  };
  // m1 fix: removed `&& !stepMode` — valueHash handles step-mode changes
  if (
    !fingerprintChanged(buf.fingerprint, fp) &&
    !renderParamsChanged(buf.renderParams, rp) &&
    (buf.pastVertexCount > 0 || buf.futureVertexCount > 0) &&
    buf.lineWidth === lineWidth
  ) {
    if (import.meta.env.DEV) perf.count("vis-gl-thick-upload-skipped");
    return;
  }

  if (import.meta.env.DEV) perf.begin("vis-gl-thick-upload");

  // Past segment: samples[0..splitIndex). Pass offsets instead of
  // slicing — the shared `combinedScratch` array is read synchronously
  // here, so no per-frame array allocation on the hot path (spec §5.5).
  const pastResult = uploadSegmentGeometry(
    state.gl, buf.pastVbo, buf.pastCapacity,
    samples, 0, splitIndex, stepMode, lineWidth,
    windowStart, windowEnd, yTop, yBottom, viewportW, viewportH,
  );
  buf.pastVertexCount = pastResult.vertexCount;
  buf.pastCapacity = pastResult.capacity;

  // Future segment: samples[splitIndex..end)
  const futureResult = uploadSegmentGeometry(
    state.gl, buf.futureVbo, buf.futureCapacity,
    samples, splitIndex, samples.length, stepMode, lineWidth,
    windowStart, windowEnd, yTop, yBottom, viewportW, viewportH,
  );
  buf.futureVertexCount = futureResult.vertexCount;
  buf.futureCapacity = futureResult.capacity;

  buf.fingerprint = fp;
  buf.renderParams = rp;
  buf.lineWidth = lineWidth;
  if (import.meta.env.DEV) {
    perf.count("vis-gl-thick-upload-applied");
    perf.count("vis-gl-thick-vertices-uploaded", buf.pastVertexCount + buf.futureVertexCount);
    perf.end("vis-gl-thick-upload");
  }
}


// ── Main draw entry ─────────────────────────────────────────────────

/**
 * Pure paint entry — renders one frame from the supplied `VisRenderInput`.
 *
 * No singleton reads.  Suitable for Storybook / Inspector harnesses
 * that want to drive the renderer with synthetic data.  The DOM bits
 * (`getCanvas`, overlay, panel-visibility cache) still touch the page
 * because the renderer paints to a real `<canvas id="serialcanvas-gl">`
 * inside `#panel-vis` — that's by design and is exercised through the
 * `activateGLCanvas()` / `ensureGLCanvasGeometry()` setup helpers.
 */
export function drawSerialVisGL(input: VisRenderInput): void {
  if (import.meta.env.DEV) perf.begin("vis-gl-render");
  if (import.meta.env.DEV) perf.begin("vis-gl-setup");
  const canvas = getCanvas();
  if (!canvas) {
    if (import.meta.env.DEV) {
      perf.end("vis-gl-setup");
      perf.end("vis-gl-render");
    }
    return;
  }
  if (!isVisPanelVisible()) {
    if (import.meta.env.DEV) {
      perf.count("vis-gl-skipped-hidden");
      perf.end("vis-gl-setup");
      perf.end("vis-gl-render");
    }
    return;
  }

  const state = ensureGLState(canvas);
  if (!state) {
    if (import.meta.env.DEV) {
      perf.end("vis-gl-setup");
      perf.end("vis-gl-render");
    }
    return;
  }

  const gl = state.gl;
  const w = canvas.width;
  const h = canvas.height;

  gl.viewport(0, 0, w, h);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const { expressions, settings, currentTime, getRenderData } = input;
  const exprKeys = Object.keys(expressions);
  const hasExpressions = exprKeys.length > 0;
  const showFuture = settings.showFutureProjection === true;
  if (import.meta.env.DEV) {
    perf.count("vis-gl-frames");
    perf.count("vis-gl-expressions-total", exprKeys.length);
  }

  // Push the pixel-matched sample rate to the sampler (spec
  // visualisation.md §2.2.1).  One sample per horizontal pixel in the
  // past region eliminates sub-pixel jitter.  When future projection is
  // off the past fills the full canvas width, so the rate doubles.
  // The sampler early-returns when the rate is unchanged.
  //
  // Lever 3 (adaptive quality, spec §1.7/§9.2): under sustained frame
  // pressure, divide the pixel-matched rate by the adaptive divisor
  // (1 / 2 / 4).  Halving the buffer sample rate halves the buffer size
  // and per-paint GPU work, at the cost of visible coarseness.
  const targetRate = computeAdaptivePastBufferRate(
    w,
    settings.windowDuration,
    getSampleRateDivisor(),
    showFuture,
  );
  if (targetRate !== null) setPastBufferSampleRate(targetRate);
  if (import.meta.env.DEV) perf.end("vis-gl-setup");

  // Repaint the overlay only when geometry, expression count, or accent changes.
  if (import.meta.env.DEV) perf.begin("vis-gl-overlay");
  const accent = hasExpressions ? getAccentColor() : "";
  const ow = canvas.width;
  const oh = canvas.height;
  if (
    ow !== overlayDirtyW ||
    oh !== overlayDirtyH ||
    hasExpressions !== overlayDirtyHasExpr ||
    accent !== overlayDirtyAccent ||
    showFuture !== overlayDirtyShowFuture
  ) {
    drawOverlay(canvas, hasExpressions, showFuture);
    overlayDirtyW = ow;
    overlayDirtyH = oh;
    overlayDirtyHasExpr = hasExpressions;
    overlayDirtyAccent = accent;
    overlayDirtyShowFuture = showFuture;
    if (import.meta.env.DEV) perf.count("vis-gl-overlay-painted");
  } else if (import.meta.env.DEV) {
    perf.count("vis-gl-overlay-skipped");
  }
  if (import.meta.env.DEV) perf.end("vis-gl-overlay");

  if (!hasExpressions) {
    if (import.meta.env.DEV) perf.end("vis-gl-render");
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const lineWidth = (settings.lineWidth ?? 1.5) * dpr;
  const futureLineAlpha = settings.futureLineAlpha ?? 0.6;
  const maxFutureBoundaryGap = futureBoundaryMaxGapSeconds(settings);
  const totalWindow = settings.windowDuration || 1;
  const halfWindow = totalWindow / 2;
  const windowStart = showFuture ? currentTime - halfWindow : currentTime - totalWindow;
  const windowEnd = showFuture ? currentTime + halfWindow : currentTime;

  const verticalPadding = h * VERTICAL_PADDING_FRACTION;

  // Lane layout is derived from the ACTIVE output set (spec §1.5): both
  // analogue and digital outputs are stacked into their own lanes. The
  // hardcoded d1/d2/d3 list is gone — `d4`/`s1`/etc. now lane correctly,
  // and analogue outputs no longer overlap on the full height.
  const activeExprTypes = exprKeys.map((key) => expressions[key].exprType);
  const laneLayout = computeLaneLayout(activeExprTypes, {
    height: h,
    verticalPadding,
    laneGap: Number(settings.digitalLaneGap ?? 4) || 0,
  });

  function laneY(exprType: string): { yTop: number; yBottom: number } | null {
    return laneLayout.get(exprType) ?? null;
  }

  if (import.meta.env.DEV) perf.begin("vis-gl-draw-pass");
  drawExpressions(
    state, gl, w, h, exprKeys, expressions, currentTime,
    futureLineAlpha, lineWidth, windowStart, windowEnd,
    laneY,
    getRenderData, showFuture, maxFutureBoundaryGap,
  );
  if (import.meta.env.DEV) perf.end("vis-gl-draw-pass");

  if (_screenshotPending) {
    _screenshotPending = false;
    captureScreenshot(gl, canvas);
  }

  if (import.meta.env.DEV) perf.end("vis-gl-render");
}

/**
 * Wired wrapper — reads from `visStore` and the buffer owner's `getRenderData`,
 * then delegates to the pure `drawSerialVisGL`.  This is the path the
 * production render hook calls.
 */
export function drawSerialVisGLFromStores(): void {
  drawSerialVisGL({
    expressions: visStore.expressions,
    settings: visStore.settings,
    currentTime: visStore.currentTime,
    getRenderData: getRenderDataFromBuffers,
  });
}

function drawExpressions(
  state: GLState,
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  exprKeys: string[],
  expressions: Record<string, VisExpression>,
  currentTime: number,
  futureLineAlpha: number,
  lineWidth: number,
  windowStart: number,
  windowEnd: number,
  laneY: (exprType: string) => { yTop: number; yBottom: number } | null,
  getRenderData: (exprType: string) => OutputRenderData | null,
  showFuture: boolean,
  maxFutureBoundaryGap: number,
): void {
  gl.useProgram(state.program);
  gl.bindVertexArray(state.vao);

  gl.uniform1f(state.uCurrentTime, currentTime);

  const stride = THICK_FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT;

  // Track which keys are still active for m3 cleanup below.
  const activeKeys = new Set<string>();

  for (const key of exprKeys) {
    activeKeys.add(key);
    const expression = expressions[key];
    if (import.meta.env.DEV) perf.begin("vis-gl-build-samples");
    const samples = buildCombinedSamples(
      key,
      getRenderData,
      currentTime,
      maxFutureBoundaryGap,
    );
    const splitIndex = getCombinedSplitIndex();
    if (import.meta.env.DEV) perf.end("vis-gl-build-samples");
    if (samples.length < 2) continue;

    const exprType = expression.exprType;
    const isDigital = isDigitalOutput(exprType);

    // Both digital and analogue outputs get their own stacked lane. Fall
    // back to the full padded height if the output isn't in the layout.
    const lane = laneY(exprType);
    const padding = verticalPaddingFallback(h);
    const yTop = lane ? lane.yTop : padding;
    const yBottom = lane ? lane.yBottom : h - padding;

    const buf = getOrCreateBuffer(state, key);
    uploadGeometry(
      state, buf, samples, splitIndex, isDigital, lineWidth,
      windowStart, windowEnd, yTop, yBottom, w, h,
    );
    if (buf.pastVertexCount < 3 && buf.futureVertexCount < 3) continue;

    if (import.meta.env.DEV) perf.begin("vis-gl-draw");

    const colorCss = expression.color || getAccentColor();
    const [r, g, b] = parseColor(colorCss);
    gl.uniform3f(state.uColor, r, g, b);
    gl.uniform1f(state.uAlphaPast, 1.0);
    gl.uniform1f(state.uAlphaFuture, Math.min(1, Math.max(0, futureLineAlpha)));

    let drawCalls = 0;

    // C2 fix: draw past and future as physically separate geometry —
    // no cross-boundary triangle interpolation.

    // Past segment (uClipFutureStart=0, contains only past vertices)
    if (buf.pastVertexCount >= 3) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.pastVbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);
      gl.uniform1f(state.uClipFutureStart, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, buf.pastVertexCount);
      drawCalls++;
    }

    // Future segment (uClipFutureStart=1, contains only future vertices)
    if (showFuture && buf.futureVertexCount >= 3) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf.futureVbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);
      gl.uniform1f(state.uClipFutureStart, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, buf.futureVertexCount);
      drawCalls++;
    }

    if (import.meta.env.DEV) {
      projectionTrace.record("renderer-draw", {
        output: key,
        currentTime,
        showFuture,
        splitIndex,
        sampleCount: samples.length,
        pastVertexCount: buf.pastVertexCount,
        futureVertexCount: buf.futureVertexCount,
        drawCalls,
        windowStart,
        windowEnd,
      });
      perf.count("vis-gl-draw-calls", drawCalls);
      perf.end("vis-gl-draw");
    }
  }

  // m3 fix: delete VBOs for expressions that are no longer active.
  for (const [key, buf] of state.buffers) {
    if (!activeKeys.has(key)) {
      gl.deleteBuffer(buf.pastVbo);
      gl.deleteBuffer(buf.futureVbo);
      state.buffers.delete(key);
      if (import.meta.env.DEV) perf.count("vis-gl-buffer-deleted");
    }
  }

  gl.bindVertexArray(null);
}

/**
 * Test seam — recreates the GL state on next paint.  No-op if there's
 * nothing cached.  Useful when swapping renderer setting at runtime
 * without a hard reload.
 */
export function _resetGLStateForTests(): void {
  glState = null;
  glCanvas = null;
  overlayCanvas = null;
  overlayDirtyW = 0;
  overlayDirtyH = 0;
  overlayDirtyHasExpr = false;
  overlayDirtyAccent = "";
  overlayDirtyShowFuture = true;
}

export const __serialVisGLInternals = {
  flattenSamples,
  buildThickLineGeometry,
  buildCombinedSamples,
  parseColor,
  ensureScratch,
  sampleFingerprint,
  fingerprintChanged,
  scratch: () => getScratch(),
  thickScratch: () => getThickScratch(),
  THICK_FLOATS_PER_VERTEX,
  computeLaneLayout,
  isDigitalOutput,
};
