import { beforeEach, describe, expect, it, vi } from "vitest";

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
