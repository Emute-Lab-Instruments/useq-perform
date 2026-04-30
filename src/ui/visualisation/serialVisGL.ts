/**
 * Serial visualisation WebGL renderer.
 *
 * Alternative to `serialVis.ts` (Canvas 2D) targeting the same `visStore`
 * snapshot.  Public surface mirrors `serialVis.ts` so adapters can swap
 * by changing imports:
 *
 *   - drawSerialVisGL()         — paint one frame from `visStore` via WebGL2
 *   - ensureGLCanvasGeometry()  — sync canvas buffer to its CSS size
 *   - isVisPanelVisible()       — visibility check (re-exported from serialVis)
 *
 * Design notes:
 *   - One rendering context per canvas; the canvas is locked to WebGL2 once
 *     `drawSerialVisGL()` runs (matching how `serialVis.ts` locks to "2d").
 *   - Two rendering paths:
 *       thin (lineWidth ≤ 1) — GL LINE_STRIP, vertex shader maps
 *         (time, value) to clip space.  Fast but fixed 1px width.
 *       thick (lineWidth > 1) — CPU-extruded triangle strip with
 *         bevel joins.  Geometry is pre-computed in clip space so the
 *         vertex shader is a pass-through.  Matches the Canvas 2D
 *         renderer's line width setting.
 *   - Both share the same fragment shader (past/future alpha split
 *     via uClipFutureStart).
 *   - Vertex buffers are reused across frames per expression key.  Buffer
 *     re-upload is gated on a `(length, sampleArrayRef)` cache key so a
 *     run of identical-length sample arrays only re-uploads when the
 *     array reference changes.  In practice `rebuildAllExpressions`
 *     allocates new arrays each tick, so this still uploads each tick;
 *     however, when samples are stable (e.g. paused, or hardware mode
 *     between time updates) the path is upload-free.
 *   - Past/future fade is a fragment-shader uniform: `uCurrentTimeNorm`
 *     (the normalized X for current time) splits past from future.
 *   - The 2D path's axis lines, value labels, and "no expressions"
 *     fallback text are kept on a 2D overlay canvas (created lazily and
 *     stacked under the GL canvas).  Drawing crisp text in WebGL is
 *     out of scope — and the overlay is allocated once, paints rarely
 *     (only on geometry/state changes), and costs nothing in the steady
 *     state.
 */

import { perf } from "../../lib/perfTrace.ts";
import type { VisExpression } from "../../utils/visualisationStore.ts";
import { visStore } from "../../utils/visualisationStore.ts";
import { isVisPanelVisible } from "./serialVis.ts";

export { isVisPanelVisible };

const PANEL_ID = "panel-vis";
const CANVAS_ID = "serialcanvas";
const OVERLAY_ID = "serialcanvas-gl-overlay";

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

function getCanvas(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(CANVAS_ID) as HTMLCanvasElement | null;
}

function getPanel(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(PANEL_ID);
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
  // Cache key — the array reference of the samples last uploaded.
  samplesRef: object | null;
}

interface ThickExprBuffer {
  vbo: WebGLBuffer;
  capacity: number;
  vertexCount: number;
  samplesRef: object | null;
  lineWidth: number;
}

let glState: GLState | null = null;

const VERTEX_SHADER_SRC = `#version 300 es
precision mediump float;

in vec2 aTimeValue;     // (time, value)

uniform float uCurrentTime;
uniform float uWindowStart;
uniform float uWindowEnd;
uniform float uYTop;        // pixel Y for value=1
uniform float uYBottom;     // pixel Y for value=0
uniform vec2  uViewport;    // (canvas.width, canvas.height)

out float vTime;
out float vIsFuture;

void main() {
  float t = aTimeValue.x;
  float v = clamp(aTimeValue.y, 0.0, 1.0);

  float windowSpan = max(uWindowEnd - uWindowStart, 1e-6);
  float relX = (t - uWindowStart) / windowSpan;             // 0..1 across window
  // Allow vertices slightly off-window; the segment may still extend
  // visibly into the canvas.
  float clipX = (relX * 2.0) - 1.0;                          // -1..1

  float y = mix(uYBottom, uYTop, v);                         // pixel Y
  // Convert pixel Y to clip space: pixel 0 = top => clipY = +1
  float clipY = 1.0 - 2.0 * (y / max(uViewport.y, 1.0));

  vTime = t;
  vIsFuture = step(uCurrentTime, t);                          // 0 if past, 1 if future
  gl_Position = vec4(clipX, clipY, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SRC = `#version 300 es
precision mediump float;

uniform vec3  uColor;
uniform float uAlphaPast;
uniform float uAlphaFuture;
uniform float uClipFutureStart;  // 0 if rendering past, 1 if rendering future
in float vTime;
in float vIsFuture;
out vec4 fragColor;

void main() {
  // When rendering the past pass, drop future fragments; vice versa.
  if (uClipFutureStart > 0.5) {
    if (vIsFuture < 0.5) discard;
  } else {
    if (vIsFuture > 0.5) discard;
  }
  float alpha = mix(uAlphaPast, uAlphaFuture, vIsFuture);
  fragColor = vec4(uColor * alpha, alpha);
}
`;

// ── Thick-line shaders (triangle-strip with bevel joins) ───────────
//
// Each polyline vertex becomes two triangle-strip vertices offset
// perpendicular to the line direction by ±halfWidth.  The vertex
// shader receives pre-computed clip-space positions (the extrusion is
// done on CPU so we can compute proper miter/bevel geometry with
// knowledge of the full polyline topology).

const THICK_VERTEX_SRC = `#version 300 es
precision mediump float;

in vec2 aPosition;    // pre-computed clip-space XY
in float aTime;       // original sample time (for past/future split)

uniform float uCurrentTime;

out float vTime;
out float vIsFuture;

void main() {
  vTime = aTime;
  vIsFuture = step(uCurrentTime, aTime);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const THICK_FRAGMENT_SRC = FRAGMENT_SHADER_SRC;

function compileShader(gl: WebGL2RenderingContext, kind: number, src: string): WebGLShader | null {
  const sh = gl.createShader(kind);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
     
    console.warn("[serialVisGL] shader compile error:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function linkProgram(
  gl: WebGL2RenderingContext,
  vsSrc: string,
  fsSrc: string,
  attribBindings: [number, string][],
): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  for (const [loc, name] of attribBindings) {
    gl.bindAttribLocation(prog, loc, name);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn("[serialVisGL] program link error:", gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

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

interface VisSampleLike {
  time: number;
  value: number;
}

/** Reusable scratch Float32Array for upload — grows but never shrinks. */
let scratch = new Float32Array(2048);
function ensureScratch(floatCount: number): void {
  if (scratch.length >= floatCount) return;
  let next = scratch.length;
  while (next < floatCount) next *= 2;
  scratch = new Float32Array(next);
}

/**
 * Flatten samples into the scratch Float32Array as `[t0, v0, t1, v1, ...]`.
 * In step mode, each pair (i, i+1) is split into two output points
 * (i, i+1.time/i.value) — same shape as `serialVis`'s step mode.
 * Returns the number of vertices written.
 */
function flattenSamples(
  samples: VisSampleLike[],
  stepMode: boolean,
): number {
  if (samples.length === 0) return 0;
  // Worst case for step mode: 2× the input count.
  const maxFloats = samples.length * 2 * (stepMode ? 2 : 1);
  ensureScratch(maxFloats);
  let w = 0;
  let prevValue = NaN;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const t = s.time;
    const v = s.value;
    if (stepMode && i > 0 && prevValue !== v) {
      scratch[w++] = t;
      scratch[w++] = prevValue;
    }
    scratch[w++] = t;
    scratch[w++] = v;
    prevValue = v;
  }
  return w >>> 1; // vertex count
}

function getOrCreateExprBuffer(state: GLState, key: string): ExprBuffer {
  let buf = state.buffers.get(key);
  if (buf) return buf;
  const vbo = state.gl.createBuffer();
  if (!vbo) {
    throw new Error("[serialVisGL] failed to create VBO");
  }
  buf = { vbo, capacity: 0, length: 0, samplesRef: null };
  state.buffers.set(key, buf);
  return buf;
}

function uploadIfNeeded(
  state: GLState,
  buf: ExprBuffer,
  samples: VisSampleLike[],
  stepMode: boolean,
): number {
  // Identity-cache: if the array reference and length match, we can
  // skip the flatten + upload entirely.  rebuildAllExpressions tends
  // to allocate fresh arrays every tick so this rarely fires in
  // local-time mode but does help when no new sample has landed.
  if (buf.samplesRef === samples && buf.length > 0 && !stepMode) {
    return buf.length;
  }
  const vertexCount = flattenSamples(samples, stepMode);
  const gl = state.gl;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf.vbo);
  if (vertexCount > buf.capacity) {
    // Grow with some headroom to avoid frequent re-allocation.
    const grown = Math.max(vertexCount, buf.capacity * 2 || 256);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      grown * 2 * Float32Array.BYTES_PER_ELEMENT,
      gl.DYNAMIC_DRAW,
    );
    buf.capacity = grown;
  }
  gl.bufferSubData(
    gl.ARRAY_BUFFER,
    0,
    scratch.subarray(0, vertexCount * 2),
    0,
    vertexCount * 2,
  );
  buf.samplesRef = samples;
  buf.length = vertexCount;
  return vertexCount;
}

// ── Thick-line geometry (triangle strip with bevel joins) ──────────
//
// Each segment of the polyline becomes a quad (4 vertices, drawn as
// TRIANGLE_STRIP).  At joins we use a bevel (one extra triangle) to
// avoid spikes at sharp angles.  The output is interleaved as:
//   [clipX, clipY, time, clipX, clipY, time, ...]
// Three floats per vertex (position.xy + time), laid out for a single
// TRIANGLE_STRIP draw call.

const THICK_FLOATS_PER_VERTEX = 3; // clipX, clipY, time

let thickScratch = new Float32Array(4096);
function ensureThickScratch(floatCount: number): void {
  if (thickScratch.length >= floatCount) return;
  let next = thickScratch.length;
  while (next < floatCount) next *= 2;
  thickScratch = new Float32Array(next);
}

/**
 * Convert flattened (time, value) polyline data in `scratch` into a
 * triangle-strip stored in `thickScratch`.
 *
 * The function performs the time→clip and value→pixel→clip transforms
 * itself (same math as the thin-line vertex shader) so the thick-line
 * vertex shader can be a trivial pass-through.
 *
 * Returns the number of vertices written into `thickScratch`.
 */
function buildThickLineGeometry(
  vertexCount: number,
  halfWidth: number,
  windowStart: number,
  windowEnd: number,
  yTop: number,
  yBottom: number,
  viewportW: number,
  viewportH: number,
): number {
  if (vertexCount < 2) return 0;

  // Each segment produces 2 strip vertices; bevel joins add up to 3
  // degenerate-linking vertices.  Worst case ≈ 5 verts per input point.
  const maxVerts = vertexCount * 5;
  ensureThickScratch(maxVerts * THICK_FLOATS_PER_VERTEX);

  const windowSpan = Math.max(windowEnd - windowStart, 1e-6);
  const invViewportH = 1 / Math.max(viewportH, 1);

  // Pre-compute clip-space positions for every input point.
  // Reuse a local buffer to avoid per-frame allocation for moderate
  // channel counts (the hot path).
  const cx = new Float32Array(vertexCount);
  const cy = new Float32Array(vertexCount);
  const times = new Float32Array(vertexCount);

  for (let i = 0; i < vertexCount; i++) {
    const t = scratch[i * 2];
    const v = Math.max(0, Math.min(1, scratch[i * 2 + 1]));
    const relX = (t - windowStart) / windowSpan;
    cx[i] = relX * 2 - 1;
    const pixelY = yBottom + (yTop - yBottom) * v;
    cy[i] = 1 - 2 * pixelY * invViewportH;
    times[i] = t;
  }

  // Convert halfWidth from pixels to clip-space units along each axis.
  const hwX = (halfWidth * 2) / Math.max(viewportW, 1);
  const hwY = (halfWidth * 2) / Math.max(viewportH, 1);

  let w = 0;

  function emit(x: number, y: number, time: number): void {
    thickScratch[w++] = x;
    thickScratch[w++] = y;
    thickScratch[w++] = time;
  }

  // For a segment from P[i] to P[i+1], compute the perpendicular
  // normal in clip space (accounting for non-square aspect ratio).
  function segmentNormal(i: number): [number, number] {
    const dx = cx[i + 1] - cx[i];
    const dy = cy[i + 1] - cy[i];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-10) return [0, hwY];
    return [-dy / len, dx / len];
  }

  // First segment cap
  {
    const [nx, ny] = segmentNormal(0);
    emit(cx[0] + nx * hwX, cy[0] + ny * hwY, times[0]);
    emit(cx[0] - nx * hwX, cy[0] - ny * hwY, times[0]);
  }

  for (let i = 1; i < vertexCount - 1; i++) {
    // Compute normals for segments (i-1,i) and (i,i+1), then average
    // for a miter-like join.  If the miter ratio exceeds 2 we fall
    // back to a bevel (two sets of offset vertices) to avoid spikes.
    const [n0x, n0y] = segmentNormal(i - 1);
    const [n1x, n1y] = segmentNormal(i);

    let mx = (n0x + n1x) * 0.5;
    let my = (n0y + n1y) * 0.5;
    let mLen = Math.sqrt(mx * mx + my * my);

    // Degenerate (collinear or near-zero) — just use the incoming normal.
    if (mLen < 1e-10) {
      mx = n0x;
      my = n0y;
      mLen = 1;
    }

    // Project miter against one of the segment normals to get the
    // miter length factor.  Clamp to avoid spikes.
    const dot = (n0x * mx + n0y * my) / mLen;
    const miterFactor = dot > 0.5 ? 1 / dot : 2;

    if (miterFactor > 2) {
      // Bevel: close with incoming normal, start fresh with outgoing.
      emit(cx[i] + n0x * hwX, cy[i] + n0y * hwY, times[i]);
      emit(cx[i] - n0x * hwX, cy[i] - n0y * hwY, times[i]);
      // Degenerate triangle to jump to new strip position.
      emit(cx[i] - n0x * hwX, cy[i] - n0y * hwY, times[i]);
      emit(cx[i] + n1x * hwX, cy[i] + n1y * hwY, times[i]);
      emit(cx[i] + n1x * hwX, cy[i] + n1y * hwY, times[i]);
      emit(cx[i] - n1x * hwX, cy[i] - n1y * hwY, times[i]);
    } else {
      const scale = miterFactor / Math.max(mLen, 1e-10);
      const ox = mx * scale * hwX;
      const oy = my * scale * hwY;
      emit(cx[i] + ox, cy[i] + oy, times[i]);
      emit(cx[i] - ox, cy[i] - oy, times[i]);
    }
  }

  // Last segment cap
  {
    const last = vertexCount - 1;
    const [nx, ny] = segmentNormal(last - 1);
    emit(cx[last] + nx * hwX, cy[last] + ny * hwY, times[last]);
    emit(cx[last] - nx * hwX, cy[last] - ny * hwY, times[last]);
  }

  return w / THICK_FLOATS_PER_VERTEX;
}

function getOrCreateThickBuffer(state: GLState, key: string): ThickExprBuffer {
  let buf = state.thickBuffers.get(key);
  if (buf) return buf;
  const vbo = state.gl.createBuffer();
  if (!vbo) throw new Error("[serialVisGL] failed to create thick VBO");
  buf = { vbo, capacity: 0, vertexCount: 0, samplesRef: null, lineWidth: 0 };
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
  if (buf.samplesRef === samples && buf.vertexCount > 0 && buf.lineWidth === lineWidth && !stepMode) {
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
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, thickScratch.subarray(0, floatCount), 0, floatCount);
  buf.samplesRef = samples;
  buf.vertexCount = thickVertexCount;
  buf.lineWidth = lineWidth;
  return thickVertexCount;
}

// ── Color parsing ───────────────────────────────────────────────────
//
// CSS colour strings need to become vec3.  Cache results per literal.

const colorCache = new Map<string, [number, number, number]>();
let colorParseCanvas: HTMLCanvasElement | null = null;

function parseColor(css: string): [number, number, number] {
  const cached = colorCache.get(css);
  if (cached) return cached;
  // Fast path: hex literals.
  const hex = css.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    const h = hex[1];
    let r: number, g: number, b: number;
    if (h.length === 3 || h.length === 4) {
      r = parseInt(h[0] + h[0], 16);
      g = parseInt(h[1] + h[1], 16);
      b = parseInt(h[2] + h[2], 16);
    } else {
      r = parseInt(h.slice(0, 2), 16);
      g = parseInt(h.slice(2, 4), 16);
      b = parseInt(h.slice(4, 6), 16);
    }
    const out: [number, number, number] = [r / 255, g / 255, b / 255];
    colorCache.set(css, out);
    return out;
  }
  // Fallback: bounce off a 1×1 2D canvas to resolve named/rgb()/hsl().
  if (typeof document === "undefined") {
    const fallback: [number, number, number] = [1, 1, 1];
    colorCache.set(css, fallback);
    return fallback;
  }
  if (!colorParseCanvas) {
    colorParseCanvas = document.createElement("canvas");
    colorParseCanvas.width = 1;
    colorParseCanvas.height = 1;
  }
  const ctx = colorParseCanvas.getContext("2d");
  if (!ctx) {
    const fallback: [number, number, number] = [1, 1, 1];
    colorCache.set(css, fallback);
    return fallback;
  }
  ctx.fillStyle = "#000";
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const data = ctx.getImageData(0, 0, 1, 1).data;
  const out: [number, number, number] = [data[0] / 255, data[1] / 255, data[2] / 255];
  colorCache.set(css, out);
  return out;
}

// ── Main draw entry ─────────────────────────────────────────────────

export function drawSerialVisGL(): void {
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

  const currentTime = visStore.currentTime;
  const settings = visStore.settings;
  const expressions = visStore.expressions;
  const exprKeys = Object.keys(expressions);
  const hasExpressions = exprKeys.length > 0;

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
    );
  } else {
    drawExpressionsThin(
      state, gl, w, h, exprKeys, expressions, currentTime,
      futureLineAlpha, windowStart, windowEnd,
      analogYTop, analogYBottom, digitalLaneY,
    );
  }

  perf.end("render-frame");
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
    const samples = expression.samples;
    if (!samples || samples.length < 2) continue;

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
): void {
  gl.useProgram(state.thickProgram);
  gl.bindVertexArray(state.thickVao);

  gl.uniform1f(state.tuCurrentTime, currentTime);

  const stride = THICK_FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT;

  for (const key of exprKeys) {
    const expression = expressions[key];
    const samples = expression.samples;
    if (!samples || samples.length < 2) continue;

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
  overlayCanvas = null;
}

export const __serialVisGLInternals = {
  flattenSamples,
  buildThickLineGeometry,
  parseColor,
  ensureScratch,
  scratch: () => scratch,
  thickScratch: () => thickScratch,
  THICK_FLOATS_PER_VERTEX,
};
