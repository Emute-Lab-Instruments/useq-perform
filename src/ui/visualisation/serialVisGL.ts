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
 *                                      from `visStore` + the sampler's
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
 *   - Two rendering paths:
 *       thin (lineWidth ≤ 1) — GL LINE_STRIP, vertex shader maps
 *         (time, value) to clip space.  Fast but fixed 1px width.
 *       thick (lineWidth > 1) — CPU-extruded triangle strip with
 *         bevel joins.  Geometry is pre-computed in clip space so the
 *         vertex shader is a pass-through.
 *   - Both share the same fragment shader (past/future alpha split
 *     via uClipFutureStart).
 *   - Past/future fade is a fragment-shader uniform: `uCurrentTimeNorm`
 *     (the normalized X for current time) splits past from future.
 *   - Axis lines, value labels, and "no expressions" fallback text are
 *     kept on a 2D overlay canvas (created lazily and stacked under the
 *     GL canvas).  Drawing crisp text in WebGL is out of scope — and the
 *     overlay is allocated once, paints rarely (only on geometry/state
 *     changes), and costs nothing in the steady state.
 */

import { perf } from "../../lib/perfTrace.ts";
import type { VisExpression, VisSettings } from "../../utils/visualisationStore.ts";
import { visStore } from "../../utils/visualisationStore.ts";
import {
  getRenderData as getRenderDataFromSampler,
  setPastBufferSampleRate,
  type OutputRenderData,
} from "../../effects/visualisationSampler.ts";
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
  ensureThickScratch,
  getScratch,
  getThickScratch,
  THICK_FLOATS_PER_VERTEX,
  THIN_VERTEX_SRC as VERTEX_SHADER_SRC,
  THICK_VERTEX_SRC,
  FRAGMENT_SRC as FRAGMENT_SHADER_SRC,
  type VisSampleLike,
  type SampleFingerprint,
} from "./webglLineRenderer.ts";

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

const DIGITAL_CHANNELS = ["d1", "d2", "d3"] as const;
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

function drawOverlay(canvas: HTMLCanvasElement, hasExpressions: boolean): void {
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
  const centerX = w / 2;

  // Center axis (0.5) dotted line
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(w, centerY);
  ctx.stroke();

  // Current time vertical line
  ctx.setLineDash([]);
  ctx.strokeStyle = AXIS_COLOR;
  ctx.beginPath();
  ctx.moveTo(centerX, 0);
  ctx.lineTo(centerX, h);
  ctx.stroke();

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
  // Uniform locations (thin-line program)
  uColor: WebGLUniformLocation | null;
  uAlphaPast: WebGLUniformLocation | null;
  uAlphaFuture: WebGLUniformLocation | null;
  uCurrentTime: WebGLUniformLocation | null;
  uWindowStart: WebGLUniformLocation | null;
  uWindowEnd: WebGLUniformLocation | null;
  uYTop: WebGLUniformLocation | null;
  uYBottom: WebGLUniformLocation | null;
  uClipFutureStart: WebGLUniformLocation | null;
  // Thick-line program (triangle-strip)
  thickProgram: WebGLProgram;
  thickVao: WebGLVertexArrayObject;
  tuColor: WebGLUniformLocation | null;
  tuAlphaPast: WebGLUniformLocation | null;
  tuAlphaFuture: WebGLUniformLocation | null;
  tuCurrentTime: WebGLUniformLocation | null;
  tuClipFutureStart: WebGLUniformLocation | null;
  // Per-expression VBO cache
  buffers: Map<string, ExprBuffer>;
  thickBuffers: Map<string, ThickExprBuffer>;
}


interface ExprBuffer {
  vbo: WebGLBuffer;
  capacity: number;
  length: number;
  fingerprint: SampleFingerprint | null;
}

interface ThickExprBuffer {
  vbo: WebGLBuffer;
  capacity: number;
  vertexCount: number;
  fingerprint: SampleFingerprint | null;
  lineWidth: number;
}

let glState: GLState | null = null;

const THICK_FRAGMENT_SRC = FRAGMENT_SHADER_SRC;

function ensureGLState(canvas: HTMLCanvasElement): GLState | null {
  if (glState && glState.gl.canvas === canvas && !glState.gl.isContextLost()) {
    return glState;
  }
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: true,
    preserveDrawingBuffer: false,
  }) as WebGL2RenderingContext | null;
  if (!gl) {
    console.warn("[serialVisGL] WebGL2 context unavailable");
    return null;
  }

  const program = linkProgram(gl, VERTEX_SHADER_SRC, FRAGMENT_SHADER_SRC, [
    [0, "aTimeValue"],
  ]);
  if (!program) return null;
  const vao = gl.createVertexArray();
  if (!vao) return null;

  const thickProgram = linkProgram(gl, THICK_VERTEX_SRC, THICK_FRAGMENT_SRC, [
    [0, "aPosition"],
    [1, "aTime"],
  ]);
  if (!thickProgram) return null;
  const thickVao = gl.createVertexArray();
  if (!thickVao) return null;

  glState = {
    gl,
    program,
    vao,
    uColor: gl.getUniformLocation(program, "uColor"),
    uAlphaPast: gl.getUniformLocation(program, "uAlphaPast"),
    uAlphaFuture: gl.getUniformLocation(program, "uAlphaFuture"),
    uCurrentTime: gl.getUniformLocation(program, "uCurrentTime"),
    uWindowStart: gl.getUniformLocation(program, "uWindowStart"),
    uWindowEnd: gl.getUniformLocation(program, "uWindowEnd"),
    uYTop: gl.getUniformLocation(program, "uYTop"),
    uYBottom: gl.getUniformLocation(program, "uYBottom"),
    uClipFutureStart: gl.getUniformLocation(program, "uClipFutureStart"),
    thickProgram,
    thickVao,
    tuColor: gl.getUniformLocation(thickProgram, "uColor"),
    tuAlphaPast: gl.getUniformLocation(thickProgram, "uAlphaPast"),
    tuAlphaFuture: gl.getUniformLocation(thickProgram, "uAlphaFuture"),
    tuCurrentTime: gl.getUniformLocation(thickProgram, "uCurrentTime"),
    tuClipFutureStart: gl.getUniformLocation(thickProgram, "uClipFutureStart"),
    buffers: new Map(),
    thickBuffers: new Map(),
  };
  return glState;
}

// ── Sample → vertex flattening ──────────────────────────────────────

/**
 * Module-level reusable scratch for `buildCombinedSamples`.
 *
 * The result is consumed synchronously by the caller (read once, then
 * uploaded to a VBO) so a single shared buffer is safe.  Each entry is
 * a stable `{time, value}` object that we mutate in place; we grow the
 * pool lazily and never shrink.  `result.length` tracks the current
 * write count so consumers see the right size.
 */
const combinedScratch: VisSampleLike[] = [];

function ensureCombinedSlot(i: number): VisSampleLike {
  let slot = combinedScratch[i];
  if (!slot) {
    slot = { time: 0, value: 0 };
    combinedScratch[i] = slot;
  }
  return slot;
}

function buildCombinedSamples(
  key: string,
  getRenderData: (exprType: string) => OutputRenderData | null,
  currentTime: number,
): VisSampleLike[] {
  combinedScratch.length = 0;
  const data = getRenderData(key);
  if (!data) return combinedScratch;
  const past = data.pastBuffer;
  const fb = data.futureBuffer;
  let w = 0;
  for (let i = 0; i < past.length; i++) {
    const slot = ensureCombinedSlot(w++);
    slot.time = past.timeAt(i);
    slot.value = past.valueAt(i);
  }
  if (fb) {
    for (let i = 0; i < fb.length; i++) {
      const t = fb.timeAt(i);
      if (t <= currentTime) continue;
      const slot = ensureCombinedSlot(w++);
      slot.time = t;
      slot.value = fb.valueAt(i);
    }
  }
  combinedScratch.length = w;
  return combinedScratch;
}


function getOrCreateExprBuffer(state: GLState, key: string): ExprBuffer {
  let buf = state.buffers.get(key);
  if (buf) return buf;
  const vbo = state.gl.createBuffer();
  if (!vbo) {
    throw new Error("[serialVisGL] failed to create VBO");
  }
  buf = { vbo, capacity: 0, length: 0, fingerprint: null };
  state.buffers.set(key, buf);
  return buf;
}

function uploadIfNeeded(
  state: GLState,
  buf: ExprBuffer,
  samples: VisSampleLike[],
  stepMode: boolean,
): number {
  const fp = sampleFingerprint(samples);
  if (!fingerprintChanged(buf.fingerprint, fp) && buf.length > 0 && !stepMode) {
    return buf.length;
  }
  const vertexCount = flattenSamples(samples, stepMode);
  const gl = state.gl;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf.vbo);
  if (vertexCount > buf.capacity) {
    const grown = Math.max(vertexCount, buf.capacity * 2 || 256);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      grown * 2 * Float32Array.BYTES_PER_ELEMENT,
      gl.DYNAMIC_DRAW,
    );
    buf.capacity = grown;
  }
  const scratchBuf = getScratch();
  gl.bufferSubData(
    gl.ARRAY_BUFFER,
    0,
    scratchBuf.subarray(0, vertexCount * 2),
    0,
    vertexCount * 2,
  );
  buf.fingerprint = fp;
  buf.length = vertexCount;
  return vertexCount;
}

function getOrCreateThickBuffer(state: GLState, key: string): ThickExprBuffer {
  let buf = state.thickBuffers.get(key);
  if (buf) return buf;
  const vbo = state.gl.createBuffer();
  if (!vbo) throw new Error("[serialVisGL] failed to create thick VBO");
  buf = { vbo, capacity: 0, vertexCount: 0, fingerprint: null, lineWidth: 0 };
  state.thickBuffers.set(key, buf);
  return buf;
}

function uploadThickGeometry(
  state: GLState,
  buf: ThickExprBuffer,
  samples: VisSampleLike[],
  stepMode: boolean,
  lineWidth: number,
  windowStart: number,
  windowEnd: number,
  yTop: number,
  yBottom: number,
  viewportW: number,
  viewportH: number,
): number {
  const fp = sampleFingerprint(samples);
  if (!fingerprintChanged(buf.fingerprint, fp) && buf.vertexCount > 0 && buf.lineWidth === lineWidth && !stepMode) {
    return buf.vertexCount;
  }

  const flatVertexCount = flattenSamples(samples, stepMode);
  if (flatVertexCount < 2) return 0;

  const halfWidth = Math.max(lineWidth, 1) / 2;
  const thickVertexCount = buildThickLineGeometry(
    flatVertexCount, halfWidth,
    windowStart, windowEnd,
    yTop, yBottom,
    viewportW, viewportH,
  );
  if (thickVertexCount < 3) return 0;

  const gl = state.gl;
  const floatCount = thickVertexCount * THICK_FLOATS_PER_VERTEX;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf.vbo);
  if (thickVertexCount > buf.capacity) {
    const grown = Math.max(thickVertexCount, buf.capacity * 2 || 256);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      grown * THICK_FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT,
      gl.DYNAMIC_DRAW,
    );
    buf.capacity = grown;
  }
  const thickBuf = getThickScratch();
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, thickBuf.subarray(0, floatCount), 0, floatCount);
  buf.fingerprint = fp;
  buf.vertexCount = thickVertexCount;
  buf.lineWidth = lineWidth;
  return thickVertexCount;
}


// ── Pixel-matched buffer rate (spec §2.2.1, with adaptive Lever 3) ─

/**
 * Compute the target past-buffer sample rate (Hz) for the current
 * canvas geometry and adaptive divisor.
 *
 * Spec visualisation.md §2.2.1: pixel-matched capacity is
 * `floor(canvasWidth / 2) / (windowDuration / 2)`.
 *
 * Lever 3 (§1.7/§9.2): the renderer divides the pixel-matched rate by
 * the pressure-derived divisor (1 / 2 / 4) before pushing it to the
 * sampler.  Returns `null` when the geometry would yield a non-positive
 * rate (e.g. zero canvas width or non-positive window).
 */
export function computeAdaptivePastBufferRate(
  canvasWidth: number,
  windowDurationSeconds: number,
  divisor: number,
): number | null {
  const halfWindowSeconds = (windowDurationSeconds || 1) / 2;
  if (halfWindowSeconds <= 0 || canvasWidth <= 0) return null;
  const baseRate = Math.floor(canvasWidth / 2) / halfWindowSeconds;
  const safeDivisor = divisor > 0 ? divisor : 1;
  const target = baseRate / safeDivisor;
  return target > 0 ? target : null;
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
  perf.begin("render-frame");
  const canvas = getCanvas();
  if (!canvas) {
    perf.end("render-frame");
    return;
  }
  if (!isVisPanelVisible()) {
    perf.end("render-frame");
    return;
  }

  const state = ensureGLState(canvas);
  if (!state) {
    perf.end("render-frame");
    return;
  }

  const gl = state.gl;
  const w = canvas.width;
  const h = canvas.height;

  gl.viewport(0, 0, w, h);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const { expressions, settings, currentTime, getRenderData } = input;
  const exprKeys = Object.keys(expressions);
  const hasExpressions = exprKeys.length > 0;

  // Push the pixel-matched sample rate to the sampler (spec
  // visualisation.md §2.2.1).  One sample per horizontal pixel in the
  // past half eliminates sub-pixel jitter.  The sampler early-returns
  // when the rate is unchanged, so this is cheap on every paint.
  //
  // Lever 3 (adaptive quality, spec §1.7/§9.2): under sustained frame
  // pressure, divide the pixel-matched rate by the adaptive divisor
  // (1 / 2 / 4).  Halving the buffer sample rate halves the buffer size
  // and per-paint GPU work, at the cost of visible coarseness.
  const targetRate = computeAdaptivePastBufferRate(
    w,
    settings.windowDuration,
    getSampleRateDivisor(),
  );
  if (targetRate !== null) setPastBufferSampleRate(targetRate);

  // Always paint the overlay (cheap; only re-rasterises axes + text).
  drawOverlay(canvas, hasExpressions);

  if (!hasExpressions) {
    perf.end("render-frame");
    return;
  }

  const lineWidth = settings.lineWidth ?? 1.5;
  const useThickLines = lineWidth > 1;
  const futureLineAlpha = settings.futureDashed === false ? 0.85 : 0.6;
  const totalWindow = settings.windowDuration || 1;
  const halfWindow = totalWindow / 2;
  const windowStart = currentTime - halfWindow;
  const windowEnd = currentTime + halfWindow;

  const verticalPadding = h * 0.1;
  const drawableHeight = h - verticalPadding * 2;

  const analogYTop = verticalPadding;
  const analogYBottom = h - verticalPadding;

  // Digital lane geometry (mirrors serialVis).
  const rawDigitalGap = settings.digitalLaneGap ?? 4;
  const digitalLaneGap = Math.max(0, Math.min(drawableHeight, Number(rawDigitalGap) || 0));
  const laneCount = DIGITAL_CHANNELS.length;
  const totalGapHeight = laneCount > 1 ? digitalLaneGap * (laneCount - 1) : 0;
  const availableDigitalHeight = Math.max(0, drawableHeight - totalGapHeight);
  const digitalLaneHeight = laneCount > 0 ? availableDigitalHeight / laneCount : 0;

  function digitalLaneY(exprType: string): { yTop: number; yBottom: number } | null {
    const idx = (DIGITAL_CHANNELS as readonly string[]).indexOf(exprType);
    if (idx < 0) return null;
    const laneTop = verticalPadding + idx * (digitalLaneHeight + digitalLaneGap);
    const laneBottom = laneTop + digitalLaneHeight;
    return { yTop: laneTop, yBottom: laneBottom };
  }

  if (useThickLines) {
    drawExpressionsThick(
      state, gl, w, h, exprKeys, expressions, currentTime,
      futureLineAlpha, lineWidth, windowStart, windowEnd,
      analogYTop, analogYBottom, digitalLaneY,
      getRenderData,
    );
  } else {
    drawExpressionsThin(
      state, gl, w, h, exprKeys, expressions, currentTime,
      futureLineAlpha, windowStart, windowEnd,
      analogYTop, analogYBottom, digitalLaneY,
      getRenderData,
    );
  }

  perf.end("render-frame");
}

/**
 * Wired wrapper — reads from `visStore` and the sampler's `getRenderData`,
 * then delegates to the pure `drawSerialVisGL`.  This is the path the
 * production render hook calls.
 */
export function drawSerialVisGLFromStores(): void {
  drawSerialVisGL({
    expressions: visStore.expressions,
    settings: visStore.settings,
    currentTime: visStore.currentTime,
    getRenderData: getRenderDataFromSampler,
  });
}

function drawExpressionsThin(
  state: GLState,
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  exprKeys: string[],
  expressions: Record<string, VisExpression>,
  currentTime: number,
  futureLineAlpha: number,
  windowStart: number,
  windowEnd: number,
  analogYTop: number,
  analogYBottom: number,
  digitalLaneY: (exprType: string) => { yTop: number; yBottom: number } | null,
  getRenderData: (exprType: string) => OutputRenderData | null,
): void {
  gl.useProgram(state.program);
  gl.bindVertexArray(state.vao);

  gl.uniform1f(state.uCurrentTime, currentTime);
  gl.uniform1f(state.uWindowStart, windowStart);
  gl.uniform1f(state.uWindowEnd, windowEnd);
  const uViewportLoc = gl.getUniformLocation(state.program, "uViewport");
  gl.uniform2f(uViewportLoc, w, h);

  for (const key of exprKeys) {
    const expression = expressions[key];
    const samples = buildCombinedSamples(key, getRenderData, currentTime);
    if (samples.length < 2) continue;

    const exprType = expression.exprType;
    const isDigital = (DIGITAL_CHANNELS as readonly string[]).includes(exprType);

    const lane = isDigital ? digitalLaneY(exprType) : null;
    const yTop = lane ? lane.yTop : analogYTop;
    const yBottom = lane ? lane.yBottom : analogYBottom;

    const buf = getOrCreateExprBuffer(state, key);
    const vertexCount = uploadIfNeeded(state, buf, samples, isDigital);
    if (vertexCount < 2) continue;

    gl.bindBuffer(gl.ARRAY_BUFFER, buf.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const colorCss = expression.color || getAccentColor();
    const [r, g, b] = parseColor(colorCss);
    gl.uniform3f(state.uColor, r, g, b);
    gl.uniform1f(state.uYTop, yTop);
    gl.uniform1f(state.uYBottom, yBottom);
    gl.uniform1f(state.uAlphaPast, 1.0);
    gl.uniform1f(state.uAlphaFuture, Math.min(1, Math.max(0, futureLineAlpha)));

    gl.uniform1f(state.uClipFutureStart, 0);
    gl.drawArrays(gl.LINE_STRIP, 0, vertexCount);
    gl.uniform1f(state.uClipFutureStart, 1);
    gl.drawArrays(gl.LINE_STRIP, 0, vertexCount);
  }

  gl.bindVertexArray(null);
}

function drawExpressionsThick(
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
  analogYTop: number,
  analogYBottom: number,
  digitalLaneY: (exprType: string) => { yTop: number; yBottom: number } | null,
  getRenderData: (exprType: string) => OutputRenderData | null,
): void {
  gl.useProgram(state.thickProgram);
  gl.bindVertexArray(state.thickVao);

  gl.uniform1f(state.tuCurrentTime, currentTime);

  const stride = THICK_FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT;

  for (const key of exprKeys) {
    const expression = expressions[key];
    const samples = buildCombinedSamples(key, getRenderData, currentTime);
    if (samples.length < 2) continue;

    const exprType = expression.exprType;
    const isDigital = (DIGITAL_CHANNELS as readonly string[]).includes(exprType);

    const lane = isDigital ? digitalLaneY(exprType) : null;
    const yTop = lane ? lane.yTop : analogYTop;
    const yBottom = lane ? lane.yBottom : analogYBottom;

    const buf = getOrCreateThickBuffer(state, key);
    const vertexCount = uploadThickGeometry(
      state, buf, samples, isDigital, lineWidth,
      windowStart, windowEnd, yTop, yBottom, w, h,
    );
    if (vertexCount < 3) continue;

    gl.bindBuffer(gl.ARRAY_BUFFER, buf.vbo);
    // aPosition (location 0): vec2 at offset 0
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    // aTime (location 1): float at offset 8
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);

    const colorCss = expression.color || getAccentColor();
    const [r, g, b] = parseColor(colorCss);
    gl.uniform3f(state.tuColor, r, g, b);
    gl.uniform1f(state.tuAlphaPast, 1.0);
    gl.uniform1f(state.tuAlphaFuture, Math.min(1, Math.max(0, futureLineAlpha)));

    gl.uniform1f(state.tuClipFutureStart, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertexCount);
    gl.uniform1f(state.tuClipFutureStart, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertexCount);
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
};
