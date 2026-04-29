import { beforeEach, describe, expect, it, vi } from "vitest";
import { timeToX, xToTime } from "./serialVis.ts";

function makeContext(): CanvasRenderingContext2D {
  return {
    clearRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe("drawSerialVis (pure renderer)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    document.body.innerHTML = `
      <div id="panel-vis"></div>
      <canvas id="serialcanvas" width="320" height="180"></canvas>
    `;
    const panel = document.getElementById("panel-vis") as HTMLDivElement;
    panel.hidden = false;
    panel.style.display = "block";
  });

  it("draws the empty-state message when no expressions are registered", async () => {
    const context = makeContext();
    const canvas = document.getElementById("serialcanvas") as HTMLCanvasElement;
    canvas.getContext = vi.fn(() => context);

    const { drawSerialVis } = await import("./serialVis.ts");
    drawSerialVis();

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, canvas.width, canvas.height);
    expect(context.fillText).toHaveBeenCalledWith(
      "No expressions selected for visualisation",
      canvas.width / 2,
      canvas.height / 2,
    );
  });

  it("renders nothing when the panel is hidden", async () => {
    const panel = document.getElementById("panel-vis") as HTMLDivElement;
    panel.hidden = true;
    panel.style.display = "none";

    const context = makeContext();
    const canvas = document.getElementById("serialcanvas") as HTMLCanvasElement;
    canvas.getContext = vi.fn(() => context);

    const { drawSerialVis } = await import("./serialVis.ts");
    drawSerialVis();

    expect(context.clearRect).not.toHaveBeenCalled();
    expect(context.fillText).not.toHaveBeenCalled();
  });

  it("does not throw when the canvas is missing", async () => {
    document.getElementById("serialcanvas")?.remove();
    const { drawSerialVis } = await import("./serialVis.ts");
    expect(() => drawSerialVis()).not.toThrow();
  });
});

describe("time-axis mapping: centre column = now", () => {
  const WIDTH = 800;
  const NOW = 1000;
  const WINDOW = 10;
  const HALF = WINDOW / 2;

  it("xToTime at centre pixel equals now", () => {
    expect(xToTime(WIDTH / 2, NOW, HALF, WINDOW, WIDTH)).toBeCloseTo(NOW, 10);
  });

  it("xToTime at left edge equals now minus half-window", () => {
    expect(xToTime(0, NOW, HALF, WINDOW, WIDTH)).toBeCloseTo(NOW - HALF, 10);
  });

  it("xToTime at right edge equals now plus half-window", () => {
    expect(xToTime(WIDTH, NOW, HALF, WINDOW, WIDTH)).toBeCloseTo(NOW + HALF, 10);
  });

  it("timeToX at now equals centre pixel", () => {
    expect(timeToX(NOW, NOW, HALF, WINDOW, WIDTH)).toBeCloseTo(WIDTH / 2, 10);
  });

  it("timeToX at now minus half-window equals 0", () => {
    expect(timeToX(NOW - HALF, NOW, HALF, WINDOW, WIDTH)).toBeCloseTo(0, 10);
  });

  it("timeToX at now plus half-window equals canvasWidth", () => {
    expect(timeToX(NOW + HALF, NOW, HALF, WINDOW, WIDTH)).toBeCloseTo(WIDTH, 10);
  });

  it("round-trip: timeToX(xToTime(x)) ≈ x for several values", () => {
    for (const x of [0, WIDTH * 0.25, WIDTH / 2, WIDTH * 0.75, WIDTH]) {
      expect(timeToX(xToTime(x, NOW, HALF, WINDOW, WIDTH), NOW, HALF, WINDOW, WIDTH)).toBeCloseTo(x, 10);
    }
  });

  it("tiny windowDuration produces no NaN or Infinity", () => {
    const tiny = 1e-10;
    const halfTiny = tiny / 2;
    const x = timeToX(NOW, NOW, halfTiny, tiny, WIDTH);
    const t = xToTime(WIDTH / 2, NOW, halfTiny, tiny, WIDTH);
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(t)).toBe(true);
  });
});
