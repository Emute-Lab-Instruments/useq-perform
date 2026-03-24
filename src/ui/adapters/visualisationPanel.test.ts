import { beforeEach, describe, expect, it, vi } from "vitest";

const { refreshSerialVisLoop, stopSerialVisLoop } = vi.hoisted(() => ({
  refreshSerialVisLoop: vi.fn(),
  stopSerialVisLoop: vi.fn(),
}));

vi.mock("../visualisation/serialVis", () => ({
  refreshSerialVisLoop,
  stopSerialVisLoop,
}));

describe("visualisationPanel", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div id="panel-vis" style="display:none" hidden></div>
      <canvas id="serialcanvas"></canvas>
    `;
    const canvas = document.getElementById("serialcanvas") as HTMLCanvasElement;
    canvas.getContext = vi.fn(() => ({
      clearRect: vi.fn(),
    })) as typeof canvas.getContext;
  });

  it("starts the serial vis loop when the panel is shown", async () => {
    const panelModule = await import("./visualisationPanel.ts");
    panelModule.registerVisualisationPanel(
      document.getElementById("panel-vis") as HTMLDivElement,
    );

    expect(panelModule.showVisualisationPanel()).toBe(true);
    expect(refreshSerialVisLoop).toHaveBeenCalledTimes(1);
    expect(panelModule.isVisualisationPanelVisible()).toBe(true);
  });

  it("stops the serial vis loop when the panel is hidden", async () => {
    const panelModule = await import("./visualisationPanel.ts");
    const panel = document.getElementById("panel-vis") as HTMLDivElement;
    panelModule.registerVisualisationPanel(panel);
    panel.hidden = false;
    panel.style.display = "block";

    expect(panelModule.hideVisualisationPanel()).toBe(true);
    expect(stopSerialVisLoop).toHaveBeenCalledTimes(1);
    expect(panelModule.isVisualisationPanelVisible()).toBe(false);
  });
});
