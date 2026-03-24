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

describe("serialVis loop control", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    document.body.innerHTML = `
      <div id="panel-vis" style="display:none" hidden></div>
      <canvas id="serialcanvas" width="320" height="180"></canvas>
    `;
  });

  it("does not schedule frames while the panel is hidden", async () => {
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => 1);
    const cancelAnimationFrame = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});

    const { setVisStore } = await import("../../utils/visualisationStore.ts");
    setVisStore("expressions", {
      a1: {
        exprType: "a1",
        expressionText: "(a1 bar)",
        samples: [{ time: 0, value: 0.5 }, { time: 1, value: 0.75 }],
        color: "#0f0",
      },
    });

    const canvas = document.getElementById("serialcanvas") as HTMLCanvasElement;
    canvas.getContext = vi.fn(() => makeContext());

    const { refreshSerialVisLoop, stopSerialVisLoop } = await import("./serialVis.ts");
    refreshSerialVisLoop();

    expect(requestAnimationFrame).not.toHaveBeenCalled();

    stopSerialVisLoop();
    expect(cancelAnimationFrame).not.toHaveBeenCalled();
  });

  it("schedules at most one frame when visible and expressions are active", async () => {
    let nextFrameId = 7;
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => nextFrameId++);
    const cancelAnimationFrame = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});

    const { setVisStore } = await import("../../utils/visualisationStore.ts");
    setVisStore("expressions", {
      a1: {
        exprType: "a1",
        expressionText: "(a1 bar)",
        samples: [{ time: 0, value: 0.5 }, { time: 1, value: 0.75 }],
        color: "#0f0",
      },
    });

    const panel = document.getElementById("panel-vis") as HTMLDivElement;
    panel.hidden = false;
    panel.style.display = "block";

    const canvas = document.getElementById("serialcanvas") as HTMLCanvasElement;
    canvas.getContext = vi.fn(() => makeContext());

    const { refreshSerialVisLoop, stopSerialVisLoop } = await import("./serialVis.ts");

    refreshSerialVisLoop();
    refreshSerialVisLoop();

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    stopSerialVisLoop();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
  });

  it("draws the empty state once and stops when the panel is visible without expressions", async () => {
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(() => 1);

    const panel = document.getElementById("panel-vis") as HTMLDivElement;
    panel.hidden = false;
    panel.style.display = "block";

    const context = makeContext();
    const canvas = document.getElementById("serialcanvas") as HTMLCanvasElement;
    canvas.getContext = vi.fn(() => context);

    const { refreshSerialVisLoop } = await import("./serialVis.ts");
    refreshSerialVisLoop();

    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, canvas.width, canvas.height);
    expect(context.fillText).toHaveBeenCalledWith(
      "No expressions selected for visualisation",
      canvas.width / 2,
      canvas.height / 2,
    );
  });
});
