/**
 * Shared WebGL line-rendering pipeline.
 *
 * Provides reusable shader programs, geometry builders, and draw helpers
 * for rendering time-series waveforms via WebGL2.  Used by the main
 * serial visualisation panel (`serialVisGL.ts`) and inline probe
 * oscilloscopes (`probes.ts`).
 *
 * One rendering path: CPU-extruded TRIANGLE_STRIP with bevel joins.
 * Geometry pre-computed in clip space; vertex shader is a pass-through.
 * `lineWidth` parameterises the extrusion half-width.
 *
 * The fragment shader handles past/future alpha split via `uClipFutureStart`.
 */

import { perf } from "../../lib/perfTrace.ts";

// ── Shader sources ─────────────────────────────────────────────────────

export const THIN_VERTEX_SRC = `#version 300 es
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
  float relX = (t - uWindowStart) / windowSpan;
  float clipX = (relX * 2.0) - 1.0;

  float y = mix(uYBottom, uYTop, v);
  float clipY = 1.0 - 2.0 * (y / max(uViewport.y, 1.0));

  vTime = t;
  vIsFuture = step(uCurrentTime, t);
  gl_Position = vec4(clipX, clipY, 0.0, 1.0);
}
`;

export const THICK_VERTEX_SRC = `#version 300 es
precision mediump float;

in vec2 aPosition;    // pre-computed clip-space XY
in float aTime;       // original sample time (for past/future split)

uniform float uCurrentTime;

out float vTime;
out float vIsFuture;

void main() {
  vTime = aTime;
  vIsFuture = aTime > uCurrentTime ? 1.0 : 0.0;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const FRAGMENT_SRC = `#version 300 es
precision mediump float;

uniform vec3  uColor;
uniform float uAlphaPast;
uniform float uAlphaFuture;
uniform float uClipFutureStart;  // 0 if rendering past, 1 if rendering future
in float vTime;
in float vIsFuture;
out vec4 fragColor;

void main() {
  if (uClipFutureStart > 0.5) {
    if (vIsFuture < 0.5) discard;
  } else {
    if (vIsFuture > 0.5) discard;
  }
  float alpha = mix(uAlphaPast, uAlphaFuture, vIsFuture);
  fragColor = vec4(uColor * alpha, alpha);
}
`;

// ── Shader compilation & linking ───────────────────────────────────────

export function compileShader(
  gl: WebGL2RenderingContext,
  kind: number,
  src: string,
): WebGLShader | null {
  const sh = gl.createShader(kind);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn("[webglLineRenderer] shader compile error:", gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export function linkProgram(
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
    console.warn("[webglLineRenderer] program link error:", gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

// ── Color parsing ──────────────────────────────────────────────────────

const colorCache = new Map<string, [number, number, number]>();
let colorParseCanvas: HTMLCanvasElement | null = null;

export function parseColor(css: string): [number, number, number] {
  const cached = colorCache.get(css);
  if (cached) {
    if (import.meta.env.DEV) perf.count("vis-gl-color-cache-hit");
    return cached;
  }
  if (import.meta.env.DEV) perf.count("vis-gl-color-cache-miss");
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
  // Fallback: bounce off a 1x1 2D canvas to resolve named/rgb()/hsl().
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

// ── Sample types and flattening ────────────────────────────────────────

export interface VisSampleLike {
  time: number;
  value: number;
}

export interface SampleFingerprint {
  len: number;
  firstTime: number;
  lastTime: number;
  valueHash: number;
}

export function sampleFingerprint(samples: VisSampleLike[]): SampleFingerprint {
  if (samples.length === 0) return { len: 0, firstTime: 0, lastTime: 0, valueHash: 0 };
  let hash = 0;
  for (let i = 0; i < samples.length; i++) {
    hash = (hash * 31 + (samples[i].value * 1e6) | 0) | 0;
  }
  return {
    len: samples.length,
    firstTime: samples[0].time,
    lastTime: samples[samples.length - 1].time,
    valueHash: hash,
  };
}

export function fingerprintChanged(a: SampleFingerprint | null, b: SampleFingerprint): boolean {
  return !a || a.len !== b.len || a.firstTime !== b.firstTime || a.lastTime !== b.lastTime || a.valueHash !== b.valueHash;
}

/** Reusable scratch Float32Array for upload -- grows but never shrinks. */
let scratch = new Float32Array(2048);

export function ensureScratch(floatCount: number): void {
  if (scratch.length >= floatCount) return;
  let next = scratch.length;
  while (next < floatCount) next *= 2;
  scratch = new Float32Array(next);
}

export function getScratch(): Float32Array {
  return scratch;
}

/**
 * Flatten samples into the scratch Float32Array as `[t0, v0, t1, v1, ...]`.
 * In step mode, each pair (i, i+1) is split into two output points
 * (i, i+1.time/i.value) -- same shape as step mode rendering.
 * Returns the number of vertices written.
 */
export function flattenSamples(
  samples: VisSampleLike[],
  stepMode: boolean,
): number {
  if (samples.length === 0) return 0;
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

// ── Thick-line geometry (triangle strip with bevel joins) ──────────────

export const THICK_FLOATS_PER_VERTEX = 3; // clipX, clipY, time

let thickScratch = new Float32Array(4096);

export function ensureThickScratch(floatCount: number): void {
  if (thickScratch.length >= floatCount) return;
  let next = thickScratch.length;
  while (next < floatCount) next *= 2;
  thickScratch = new Float32Array(next);
}

export function getThickScratch(): Float32Array {
  return thickScratch;
}

// Pooled scratch arrays for buildThickLineGeometry — grow-only, never shrink.
// Eliminates per-frame Float32Array allocations (~4 MB/s GC churn at 30 fps
// with 4 active expressions).
let geomCx = new Float32Array(1024);
let geomCy = new Float32Array(1024);
let geomTimes = new Float32Array(1024);

function ensureGeomScratch(vertexCount: number): void {
  if (geomCx.length >= vertexCount) return;
  let next = geomCx.length;
  while (next < vertexCount) next *= 2;
  geomCx = new Float32Array(next);
  geomCy = new Float32Array(next);
  geomTimes = new Float32Array(next);
}

/**
 * Convert flattened (time, value) polyline data in `scratch` into a
 * triangle-strip stored in `thickScratch`.
 *
 * Performs the time->clip and value->pixel->clip transforms itself
 * (same math as the thin-line vertex shader) so the thick-line vertex
 * shader can be a trivial pass-through.
 *
 * Returns the number of vertices written into `thickScratch`.
 */
export function buildThickLineGeometry(
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

  const maxVerts = vertexCount * 5;
  ensureThickScratch(maxVerts * THICK_FLOATS_PER_VERTEX);

  const windowSpan = Math.max(windowEnd - windowStart, 1e-6);
  const invViewportH = 1 / Math.max(viewportH, 1);

  ensureGeomScratch(vertexCount);
  const cx = geomCx;
  const cy = geomCy;
  const times = geomTimes;

  for (let i = 0; i < vertexCount; i++) {
    const t = scratch[i * 2];
    const v = Math.max(0, Math.min(1, scratch[i * 2 + 1]));
    const relX = (t - windowStart) / windowSpan;
    cx[i] = relX * 2 - 1;
    const pixelY = yBottom + (yTop - yBottom) * v;
    cy[i] = 1 - 2 * pixelY * invViewportH;
    times[i] = t;
  }

  const hwX = (halfWidth * 2) / Math.max(viewportW, 1);
  const hwY = (halfWidth * 2) / Math.max(viewportH, 1);

  let w = 0;

  function emit(x: number, y: number, time: number): void {
    thickScratch[w++] = x;
    thickScratch[w++] = y;
    thickScratch[w++] = time;
  }

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
    const [n0x, n0y] = segmentNormal(i - 1);
    const [n1x, n1y] = segmentNormal(i);

    let mx = (n0x + n1x) * 0.5;
    let my = (n0y + n1y) * 0.5;
    let mLen = Math.sqrt(mx * mx + my * my);

    if (mLen < 1e-10) {
      mx = n0x;
      my = n0y;
      mLen = 1;
    }

    const dot = (n0x * mx + n0y * my) / mLen;
    const miterFactor = dot > 0.5 ? 1 / dot : 2;

    if (miterFactor > 2) {
      emit(cx[i] + n0x * hwX, cy[i] + n0y * hwY, times[i]);
      emit(cx[i] - n0x * hwX, cy[i] - n0y * hwY, times[i]);
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

// ── VBO management types ───────────────────────────────────────────────

export interface LineBuffer {
  vbo: WebGLBuffer;
  capacity: number;
  length: number;
  fingerprint: SampleFingerprint | null;
}

export interface ThickLineBuffer {
  vbo: WebGLBuffer;
  capacity: number;
  vertexCount: number;
  fingerprint: SampleFingerprint | null;
  lineWidth: number;
}

export function createLineBuffer(gl: WebGL2RenderingContext): LineBuffer {
  const vbo = gl.createBuffer();
  if (!vbo) throw new Error("[webglLineRenderer] failed to create VBO");
  return { vbo, capacity: 0, length: 0, fingerprint: null };
}

export function createThickLineBuffer(gl: WebGL2RenderingContext): ThickLineBuffer {
  const vbo = gl.createBuffer();
  if (!vbo) throw new Error("[webglLineRenderer] failed to create thick VBO");
  return { vbo, capacity: 0, vertexCount: 0, fingerprint: null, lineWidth: 0 };
}

/**
 * Upload thin-line sample data to a VBO if the fingerprint has changed.
 * Returns the vertex count.
 */
export function uploadThinLineData(
  gl: WebGL2RenderingContext,
  buf: LineBuffer,
  samples: VisSampleLike[],
  stepMode: boolean,
): number {
  const fp = sampleFingerprint(samples);
  if (!fingerprintChanged(buf.fingerprint, fp) && buf.length > 0 && !stepMode) {
    return buf.length;
  }
  const vertexCount = flattenSamples(samples, stepMode);
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
  gl.bufferSubData(
    gl.ARRAY_BUFFER,
    0,
    scratch.subarray(0, vertexCount * 2),
    0,
    vertexCount * 2,
  );
  buf.fingerprint = fp;
  buf.length = vertexCount;
  return vertexCount;
}

/**
 * Upload thick-line geometry to a VBO if the fingerprint or lineWidth changed.
 * Returns the vertex count of the triangle strip.
 */
export function uploadThickLineData(
  gl: WebGL2RenderingContext,
  buf: ThickLineBuffer,
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
  if (
    !fingerprintChanged(buf.fingerprint, fp) &&
    buf.vertexCount > 0 &&
    buf.lineWidth === lineWidth &&
    !stepMode
  ) {
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
  buf.fingerprint = fp;
  buf.vertexCount = thickVertexCount;
  buf.lineWidth = lineWidth;
  return thickVertexCount;
}

// ── Probe-oriented high-level API ──────────────────────────────────────
//
// A self-contained mini-renderer for small inline probe oscilloscopes.
// Each probe gets its own tiny WebGL2 canvas.  State is cached per canvas
// via a WeakMap so multiple probes don't allocate redundant programs.

interface ProbeGLState {
  gl: WebGL2RenderingContext;
  thickProgram: WebGLProgram;
  thickVao: WebGLVertexArrayObject;
  tuColor: WebGLUniformLocation | null;
  tuAlphaPast: WebGLUniformLocation | null;
  tuAlphaFuture: WebGLUniformLocation | null;
  tuCurrentTime: WebGLUniformLocation | null;
  tuClipFutureStart: WebGLUniformLocation | null;
  buffer: ThickLineBuffer;
}

const probeGLStates = new WeakMap<HTMLCanvasElement, ProbeGLState>();

function getOrCreateProbeGLState(canvas: HTMLCanvasElement): ProbeGLState | null {
  const existing = probeGLStates.get(canvas);
  if (existing && !existing.gl.isContextLost()) return existing;

  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: true,
    preserveDrawingBuffer: false,
  }) as WebGL2RenderingContext | null;
  if (!gl || typeof gl.createShader !== "function") return null;

  const thickProgram = linkProgram(gl, THICK_VERTEX_SRC, FRAGMENT_SRC, [
    [0, "aPosition"],
    [1, "aTime"],
  ]);
  if (!thickProgram) return null;

  const thickVao = gl.createVertexArray();
  if (!thickVao) return null;

  const state: ProbeGLState = {
    gl,
    thickProgram,
    thickVao,
    tuColor: gl.getUniformLocation(thickProgram, "uColor"),
    tuAlphaPast: gl.getUniformLocation(thickProgram, "uAlphaPast"),
    tuAlphaFuture: gl.getUniformLocation(thickProgram, "uAlphaFuture"),
    tuCurrentTime: gl.getUniformLocation(thickProgram, "uCurrentTime"),
    tuClipFutureStart: gl.getUniformLocation(thickProgram, "uClipFutureStart"),
    buffer: createThickLineBuffer(gl),
  };
  probeGLStates.set(canvas, state);
  return state;
}

/**
 * Render input for a single probe oscilloscope frame.
 */
export interface ProbeRenderInput {
  /** The numeric samples to draw (Y values in 0..1 range or auto-scaled). */
  samples: number[];
  /** CSS color for the waveform line. */
  color: string;
  /** Line width in pixels. */
  lineWidth: number;
  /** Background color (CSS). Null = transparent. */
  backgroundColor?: string | null;
}

/**
 * Draw a probe oscilloscope waveform on a small canvas using WebGL2.
 *
 * This is the main entry point for probe rendering. It handles:
 * - Auto-scaling Y range (baseline 0..1, expands if samples exceed)
 * - Thick-line triangle-strip rendering
 * - Background fill
 * - Midline and border overlays (via a tiny 2D overlay)
 */
export function drawProbeWaveformGL(
  canvas: HTMLCanvasElement,
  input: ProbeRenderInput,
): void {
  if (import.meta.env.DEV) perf.begin("probe-gl-paint");
  const { samples, color, lineWidth } = input;
  const w = canvas.width;
  const h = canvas.height;

  if (w === 0 || h === 0) {
    if (import.meta.env.DEV) perf.end("probe-gl-paint");
    return;
  }

  const state = getOrCreateProbeGLState(canvas);
  if (!state) {
    if (import.meta.env.DEV) perf.end("probe-gl-paint");
    return;
  }

  const gl = state.gl;
  gl.viewport(0, 0, w, h);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  // Background fill
  if (input.backgroundColor) {
    const [br, bg, bb] = parseColor(input.backgroundColor);
    gl.clearColor(br, bg, bb, 0.94);
  } else {
    gl.clearColor(0, 0, 0, 0);
  }
  gl.clear(gl.COLOR_BUFFER_BIT);

  // Filter to finite samples for range computation
  const finiteSamples = samples.filter(Number.isFinite);
  if (finiteSamples.length < 2) {
    if (import.meta.env.DEV) perf.end("probe-gl-paint");
    return;
  }

  // Compute Y range: baseline [0, 1], expand if needed
  let min = 0;
  let max = 1;
  for (const value of finiteSamples) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (Math.abs(max - min) < 1e-9) {
    max = min + 1;
  }

  // Build sample-like objects for the geometry builder.
  // Use synthetic time 0..1 (probes don't need past/future split).
  if (import.meta.env.DEV) perf.begin("probe-gl-build");
  const sampleCount = samples.length;
  const visSamples: VisSampleLike[] = new Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const rawVal = samples[i];
    const normalizedVal = Number.isFinite(rawVal)
      ? (rawVal - min) / (max - min)
      : 0.5;
    visSamples[i] = {
      time: sampleCount > 1 ? i / (sampleCount - 1) : 0.5,
      value: normalizedVal,
    };
  }
  if (import.meta.env.DEV) perf.end("probe-gl-build");

  // Padding: 5% top and bottom
  const padding = h * 0.05;
  const yTop = padding;
  const yBottom = h - padding;

  // Upload thick-line geometry
  if (import.meta.env.DEV) perf.begin("probe-gl-upload");
  const fpBefore = state.buffer.fingerprint;
  const vertexCount = uploadThickLineData(
    gl,
    state.buffer,
    visSamples,
    false, // no step mode for probes
    lineWidth,
    0, 1, // window: 0..1 (synthetic time)
    yTop, yBottom,
    w, h,
  );
  if (import.meta.env.DEV) {
    perf.end("probe-gl-upload");
    if (state.buffer.fingerprint === fpBefore && vertexCount > 0) {
      perf.count("probe-gl-upload-skipped");
    } else {
      perf.count("probe-gl-upload-applied");
    }
  }

  if (vertexCount < 3) {
    if (import.meta.env.DEV) perf.end("probe-gl-paint");
    return;
  }

  // Draw
  if (import.meta.env.DEV) perf.begin("probe-gl-draw");
  gl.useProgram(state.thickProgram);
  gl.bindVertexArray(state.thickVao);

  const stride = THICK_FLOATS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT;
  gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer.vbo);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);

  const [r, g, b] = parseColor(color);
  gl.uniform3f(state.tuColor, r, g, b);
  gl.uniform1f(state.tuAlphaPast, 1.0);
  gl.uniform1f(state.tuAlphaFuture, 1.0);
  // No past/future split for probes -- set currentTime beyond all samples
  gl.uniform1f(state.tuCurrentTime, 2.0);
  gl.uniform1f(state.tuClipFutureStart, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertexCount);

  gl.bindVertexArray(null);
  if (import.meta.env.DEV) {
    perf.count("probe-gl-draw-calls");
    perf.end("probe-gl-draw");
    perf.end("probe-gl-paint");
  }
}

/**
 * Draw the overlay elements (midline + border) on top of a probe
 * oscilloscope canvas.  Uses a thin 2D overlay canvas stacked on top
 * to keep text/lines crisp without complicating the WebGL path.
 *
 * Returns the overlay canvas (which the caller should position
 * absolutely on top of the GL canvas).
 */
export function drawProbeOverlay(
  overlayCanvas: HTMLCanvasElement,
  width: number,
  height: number,
  hasData: boolean,
): void {
  const ctx = overlayCanvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, width, height);

  if (!hasData) {
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "10px monospace";
    ctx.fillText("no numeric output", 8, height / 2 + 3);
    return;
  }

  // Midline
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();

  // Border
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
}

// ── Test internals export ──────────────────────────────────────────────

export const __webglLineRendererInternals = {
  flattenSamples,
  buildThickLineGeometry,
  parseColor,
  ensureScratch,
  sampleFingerprint,
  fingerprintChanged,
  scratch: () => scratch,
  thickScratch: () => thickScratch,
  THICK_FLOATS_PER_VERTEX,
};
