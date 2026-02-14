import { onMount, onCleanup } from "solid-js";
import { visStore } from "../utils/visualisationStore";

interface Point {
  x: number;
  y: number;
}

function getCatmullRomPoint(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number
): Point {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

const AMPLITUDE_MULTIPLIER = 0.9;
const INTERPOLATION_SEGMENTS = 5;
const INTERPOLATION_STEPS = Array.from(
  { length: INTERPOLATION_SEGMENTS + 1 },
  (_, i) => i / INTERPOLATION_SEGMENTS
);

function drawPlot(
  ctx: CanvasRenderingContext2D,
  channels: number[][],
  palette: string[],
  bufferCapacity: number
) {
  const c = ctx.canvas;
  const zeroY = c.height / 2;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, c.width, c.height);

  if (channels.length === 0 || bufferCapacity === 0) return;

  const gap = c.width / bufferCapacity;

  const mapValueToY = (value: number) =>
    zeroY - value * AMPLITUDE_MULTIPLIER * zeroY;

  // Draw dashed zero-line
  ctx.strokeStyle = "#777777";
  ctx.lineWidth = 0.5;
  ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.moveTo(0, zeroY);
  ctx.lineTo(c.width, zeroY);
  ctx.stroke();

  // Draw y-axis markings
  ctx.setLineDash([]);
  ctx.font = "10px Arial";
  ctx.fillStyle = "#777777";
  ctx.textAlign = "right";

  for (let i = -1; i <= 1; i += 0.25) {
    const y = zeroY - i * AMPLITUDE_MULTIPLIER * zeroY;
    ctx.beginPath();
    ctx.moveTo(c.width - 10, y);
    ctx.lineTo(c.width, y);
    ctx.stroke();
    const textY = i > 0 ? y - 4 : i < 0 ? y + 12 : y + 12;
    ctx.fillText(i.toFixed(2), c.width - 12, textY);
  }

  ctx.lineWidth = 1;

  // Draw each channel with Catmull-Rom interpolation
  for (let ch = 0; ch < channels.length; ch++) {
    const channelValues = channels[ch];
    if (!channelValues || channelValues.length < 4) continue;

    const points: Point[] = new Array(channelValues.length);
    for (let i = 0; i < channelValues.length; i++) {
      points[i] = { x: gap * i, y: mapValueToY(channelValues[i]) };
    }

    ctx.beginPath();
    ctx.strokeStyle = palette[ch % palette.length] || "#777";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 0; i < points.length - 3; i++) {
      const p0 = points[Math.max(0, i)];
      const p1 = points[i + 1];
      const p2 = points[i + 2];
      const p3 = points[Math.min(points.length - 1, i + 3)];

      for (const t of INTERPOLATION_STEPS) {
        const pt = getCatmullRomPoint(p0, p1, p2, p3, t);
        ctx.lineTo(pt.x, pt.y);
      }
    }

    ctx.stroke();
  }
}

function drawTimeLine(
  ctx: CanvasRenderingContext2D,
  timeMs: number
) {
  const c = ctx.canvas;
  const x = c.width * ((timeMs / 3000.0) % 1.0);

  ctx.clearRect(0, 0, c.width, c.height);
  ctx.strokeStyle = "red";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, c.height);
  ctx.stroke();
}

export function InternalVis() {
  let plotCanvasRef: HTMLCanvasElement | undefined;
  let lineCanvasRef: HTMLCanvasElement | undefined;
  let rafId: number | undefined;
  let plotNeedsRedrawing = true;

  function resizeCanvases() {
    const parent = plotCanvasRef?.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width * dpr;
    const h = rect.height * dpr;

    if (plotCanvasRef) {
      plotCanvasRef.width = w;
      plotCanvasRef.height = h;
      plotCanvasRef.style.width = `${rect.width}px`;
      plotCanvasRef.style.height = `${rect.height}px`;
    }
    if (lineCanvasRef) {
      lineCanvasRef.width = w;
      lineCanvasRef.height = h;
      lineCanvasRef.style.width = `${rect.width}px`;
      lineCanvasRef.style.height = `${rect.height}px`;
    }
    plotNeedsRedrawing = true;
  }

  function loop() {
    const timeMs = Date.now();

    if (plotNeedsRedrawing && plotCanvasRef) {
      const plotCtx = plotCanvasRef.getContext("2d");
      if (plotCtx) {
        // Use serial buffer snapshots from the store, skipping channel 0 (time)
        const allChannels = visStore.serialBuffers.channels;
        const dataChannels = allChannels.length > 1 ? allChannels.slice(1) : [];
        const capacity =
          allChannels.length > 1 ? allChannels[1]?.length ?? 0 : 0;
        drawPlot(plotCtx, dataChannels, visStore.palette, capacity);
        plotNeedsRedrawing = false;
      }
    }

    if (lineCanvasRef) {
      const lineCtx = lineCanvasRef.getContext("2d");
      if (lineCtx) {
        drawTimeLine(lineCtx, timeMs);
      }
    }

    rafId = window.requestAnimationFrame(loop);
  }

  // Mark plot dirty whenever the serial buffer data changes
  // We check the store's serialBuffers reactively via the lengths array
  // which changes whenever snapshotSerialBuffers is called.
  let lastLengthsJson = "";
  function checkBufferChange() {
    const json = JSON.stringify(visStore.serialBuffers.lengths);
    if (json !== lastLengthsJson) {
      lastLengthsJson = json;
      plotNeedsRedrawing = true;
    }
  }

  let resizeObserver: ResizeObserver | undefined;

  onMount(() => {
    resizeCanvases();

    resizeObserver = new ResizeObserver(() => {
      resizeCanvases();
    });
    if (plotCanvasRef?.parentElement) {
      resizeObserver.observe(plotCanvasRef.parentElement);
    }

    // Poll for buffer changes on each frame (the rAF loop reads store reactively)
    const intervalId = setInterval(checkBufferChange, 100);

    rafId = window.requestAnimationFrame(loop);

    onCleanup(() => {
      if (rafId !== undefined) window.cancelAnimationFrame(rafId);
      clearInterval(intervalId);
      resizeObserver?.disconnect();
    });
  });

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas
        ref={plotCanvasRef}
        style={{
          position: "absolute",
          top: "0",
          left: "0",
          width: "100%",
          height: "100%",
        }}
      />
      <canvas
        ref={lineCanvasRef}
        style={{
          position: "absolute",
          top: "0",
          left: "0",
          width: "100%",
          height: "100%",
          "pointer-events": "none",
        }}
      />
    </div>
  );
}
