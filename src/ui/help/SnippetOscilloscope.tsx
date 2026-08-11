import { Component, onCleanup, onMount } from "solid-js";
import { visualisationSession } from "../../effects/visualisationSession.ts";
import { drawProbeWaveformGL } from "../../ui/visualisation/webglLineRenderer.ts";
import { dbg } from "../../lib/debug.ts";

interface SnippetOscilloscopeProps {
  code: string;
}

const REFRESH_INTERVAL_MS = 100;
const SAMPLE_COUNT = 16;
const WINDOW_DURATION_S = 1;

const ERROR_PREFIX = "Error:";

/**
 * Read the first balanced parenthesised S-expression from a code string,
 * starting at the first non-whitespace character.
 */
function readFirstSExpression(text: string): string | null {
  let i = 0;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (i >= text.length || text[i] !== "(") return null;
  let depth = 0;
  let inString = false;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (inString) {
      if (c === "\\") {
        j++;
        continue;
      }
      if (c === "\"") inString = false;
      continue;
    }
    if (c === "\"") {
      inString = true;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return text.slice(i, j + 1);
    }
  }
  return null;
}

/**
 * Strip a leading output binding `(an|dn|sn|qn <expr>)` from a snippet
 * so that sampling does not re-bind a live runtime output as a side
 * effect. Returns the inner expression, or the snippet as-is when no
 * output binding is found.
 */
function extractSampleExpression(code: string): string | null {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const firstForm = readFirstSExpression(trimmed) ?? trimmed;
  const m = firstForm.match(/^\(\s*([adsq][0-9])\s+([\s\S]*)\)\s*$/);
  if (m) {
    const inner = m[2].trim();
    return inner || null;
  }
  return firstForm;
}

function formatTime(t: number): string {
  if (!Number.isFinite(t) || Math.abs(t) < 1e-9) return "0";
  return t.toFixed(6).replace(/\.?0+$/, "");
}

function buildBatchSampleExpression(
  expr: string,
  times: readonly number[],
): string {
  const parts = times.map((t) => `(eval-at-time ${formatTime(t)} ${expr})`);
  return `[${parts.join(" ")}]`;
}

function parseNumericVector(text: string): number[] | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  const parts = inner.split(/[\s,]+/).filter(Boolean);
  const values = new Array<number>(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const value = Number(parts[i]);
    if (!Number.isFinite(value)) return null;
    values[i] = value;
  }
  return values;
}

function readAccentColor(): string {
  const computed = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent-color");
  return (computed && computed.trim()) || "#00ff41";
}

export const SnippetOscilloscope: Component<SnippetOscilloscopeProps> = (props) => {
  let canvas: HTMLCanvasElement | undefined;
  let frameId: number | null = null;
  let lastRun = 0;
  let inFlight = false;
  let cancelled = false;

  const tick = async (now: number) => {
    if (cancelled) return;
    frameId = window.requestAnimationFrame(tick);
    if (inFlight) return;
    if (now - lastRun < REFRESH_INTERVAL_MS) return;
    lastRun = now;

    const expr = extractSampleExpression(props.code);
    if (!expr || !canvas) return;

    const currentTime = visualisationSession.state.currentTime || 0;
    const startTime = currentTime - WINDOW_DURATION_S;
    const step = WINDOW_DURATION_S / (SAMPLE_COUNT - 1);
    const times = new Array<number>(SAMPLE_COUNT);
    for (let i = 0; i < SAMPLE_COUNT; i++) times[i] = startTime + step * i;

    const batchCode = buildBatchSampleExpression(expr, times);
    inFlight = true;
    try {
      const raw = await visualisationSession.probes.evaluate(batchCode);
      if (cancelled || !canvas) return;
      if (typeof raw !== "string") return;
      const trimmed = raw.trim();
      if (trimmed.startsWith(ERROR_PREFIX)) return;
      const samples = parseNumericVector(trimmed);
      if (!samples || samples.length !== SAMPLE_COUNT) return;
      drawProbeWaveformGL(canvas, {
        samples,
        color: readAccentColor(),
        lineWidth: 1.5,
        backgroundColor: "rgba(13, 18, 24, 0.94)",
      });
    } catch (error) {
      dbg(`snippet oscilloscope: sample failed (${error})`);
    } finally {
      inFlight = false;
    }
  };

  onMount(() => {
    frameId = window.requestAnimationFrame(tick);
  });

  onCleanup(() => {
    cancelled = true;
    if (frameId != null) {
      window.cancelAnimationFrame(frameId);
      frameId = null;
    }
  });

  return (
    <div class="code-snippet-oscilloscope" title="Live oscilloscope">
      <canvas ref={canvas} width={240} height={36} />
    </div>
  );
};
