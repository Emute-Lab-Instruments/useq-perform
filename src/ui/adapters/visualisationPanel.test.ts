import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requestVisualisationRender,
  pauseVisualisationRender,
  registerVisualisationRenderHook,
} = vi.hoisted(() => ({
  requestVisualisationRender: vi.fn(),
  pauseVisualisationRender: vi.fn(),
  registerVisualisationRenderHook: vi.fn(),
}));

vi.mock("../../effects/visualisationRuntime", () => ({
  requestVisualisationRender,
  pauseVisualisationRender,
  registerVisualisationRenderHook,
}));

describe("visualisationPanel", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = `
      <div id="panel-vis" style="display:none" hidden></div>
    `;
  });

  it("starts the serial vis loop when the panel is shown", async () => {
    const panelModule = await import("./visualisationPanel.ts");
    panelModule.registerVisualisationPanel(
      document.getElementById("panel-vis") as HTMLDivElement,
    );

    expect(panelModule.showVisualisationPanel()).toBe(true);
    expect(requestVisualisationRender).toHaveBeenCalledTimes(1);
    expect(panelModule.isVisualisationPanelVisible()).toBe(true);
  });

  it("stops the serial vis loop when the panel is hidden", async () => {
    const panelModule = await import("./visualisationPanel.ts");
    const panel = document.getElementById("panel-vis") as HTMLDivElement;
    panelModule.registerVisualisationPanel(panel);
    panel.hidden = false;
    panel.style.display = "block";

    expect(panelModule.hideVisualisationPanel()).toBe(true);
    expect(pauseVisualisationRender).toHaveBeenCalledTimes(1);
    expect(panelModule.isVisualisationPanelVisible()).toBe(false);
  });
});
