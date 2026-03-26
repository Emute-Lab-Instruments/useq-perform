import { Component, onMount, onCleanup, createEffect } from "solid-js";
import type { VisSignal } from "../guide/guideTypes";
import { getSerialVisChannelColor } from "../../../lib/visualisationUtils";

/** Number of sample points to draw per signal. */
const SAMPLE_COUNT = 200;
const VERTICAL_PAD = 8;

/** Fallback palette when a signal label doesn't match a known channel. */
const FALLBACK_COLORS = [
  "#00ff41", "#ff6b6b", "#4ecdc4", "#ffe66d",
  "#a29bfe", "#fd79a8", "#74b9ff", "#e17055",
];

const DIGITAL_LANE_HEIGHT = 14;
const DIGITAL_LANE_GAP = 3;

/**
 * Resolve a signal's color using the gutter rail color system.
 * Priority: explicit `channel` field → channel prefix in label → fallback.
 */
function resolveSignalColor(sig: VisSignal, index: number): string {
  // 1. Explicit channel field (e.g. channel: "a1")
  if (sig.channel) {
    const color = getSerialVisChannelColor(sig.channel, 0);
    if (color) return color;
  }
  // 2. Extract channel from label (e.g. "a1: bar" → "a1", "d2: >0.7" → "d2")
  const channelMatch = sig.label.match(/^([ad]\d)/);
  if (channelMatch) {
    const color = getSerialVisChannelColor(channelMatch[1], 0);
    if (color) return color;
  }
  // 3. Fallback for labels like "mix", "tremolo", "decay"
  return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

interface MiniVisProps {
  signals: VisSignal[];
  /** Canvas height in px.  Defaults to 120. */
  height?: number;
  /** Number of bars the x-axis spans.  Defaults to 1. */
  bars?: number;
}

export const MiniVis: Component<MiniVisProps> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  let resizeObserver: ResizeObserver | undefined;

  function draw() {
    const canvas = canvasRef;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width;
    const h = rect.height;

    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const signals = props.signals;
    if (!signals.length) return;

    const bars = props.bars ?? 1;
    const digitalSignals = signals.filter((s) => s.digital);
    const analogSignals = signals.filter((s) => !s.digital);

    // Layout: digital lanes at the top, analog area below
    const digitalTotalHeight =
      digitalSignals.length > 0
        ? digitalSignals.length * DIGITAL_LANE_HEIGHT +
          (digitalSignals.length - 1) * DIGITAL_LANE_GAP +
          VERTICAL_PAD
        : 0;

    const analogTop = digitalTotalHeight + VERTICAL_PAD;
    const analogBottom = h - VERTICAL_PAD;
    const analogHeight = analogBottom - analogTop;

    // -- Draw bar dividers ---------------------------------------------------
    if (bars > 1) {
      ctx.strokeStyle = "rgba(255,255,255,0.1)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      for (let b = 1; b < bars; b++) {
        const x = (b / bars) * w;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Bar labels at the bottom
      ctx.font = "8px var(--code-font, monospace)";
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      for (let b = 0; b < bars; b++) {
        const x = ((b + 0.5) / bars) * w;
        ctx.fillText(`bar ${b + 1}`, x - 12, h - 2);
      }
    }

    // -- Draw digital lanes --------------------------------------------------
    digitalSignals.forEach((sig, laneIdx) => {
      const color = resolveSignalColor(sig, signals.indexOf(sig));
      const laneTop =
        VERTICAL_PAD + laneIdx * (DIGITAL_LANE_HEIGHT + DIGITAL_LANE_GAP);
      const laneBottom = laneTop + DIGITAL_LANE_HEIGHT;

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();

      for (let i = 0; i < SAMPLE_COUNT; i++) {
        const phase = (i / (SAMPLE_COUNT - 1)) * bars;
        const x = (i / (SAMPLE_COUNT - 1)) * w;
        const val = sig.fn(phase) > 0.5 ? 1 : 0;
        const y = laneBottom - val * DIGITAL_LANE_HEIGHT;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // -- Draw analog zero line -----------------------------------------------
    if (analogSignals.length > 0 && analogHeight > 0) {
      const zeroY = analogBottom;
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, zeroY);
      ctx.lineTo(w, zeroY);
      ctx.stroke();

      // 0.5 line
      const halfY = analogTop + analogHeight * 0.5;
      ctx.beginPath();
      ctx.moveTo(0, halfY);
      ctx.lineTo(w, halfY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // -- Draw analog signals -------------------------------------------------
    analogSignals.forEach((sig) => {
      const color = resolveSignalColor(sig, signals.indexOf(sig));
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();

      for (let i = 0; i < SAMPLE_COUNT; i++) {
        const phase = (i / (SAMPLE_COUNT - 1)) * bars;
        const x = (i / (SAMPLE_COUNT - 1)) * w;
        const val = Math.max(0, Math.min(1, sig.fn(phase)));
        const y = analogBottom - val * analogHeight;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    });

    // No legend text — colors match the gutter rails in the main editor,
    // so the color itself identifies the channel.
  }

  onMount(() => {
    if (canvasRef) {
      resizeObserver = new ResizeObserver(() => draw());
      resizeObserver.observe(canvasRef);
    }
    draw();
  });

  // Redraw when signals change
  createEffect(() => {
    // Track the signals array reference
    void props.signals;
    draw();
  });

  onCleanup(() => {
    resizeObserver?.disconnect();
  });

  return (
    <canvas
      ref={canvasRef}
      class="lesson-mini-vis"
      style={{
        width: "100%",
        height: `${props.height ?? 120}px`,
        "background-color": "rgba(0, 0, 0, 0.3)",
        "border-radius": "6px",
        display: "block",
        "border": "1px solid rgba(255, 255, 255, 0.06)",
      }}
    />
  );
};
