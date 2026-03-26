import { fireEvent, render, screen, within } from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateSettingsStore } = vi.hoisted(() => ({
  updateSettingsStore: vi.fn(),
}));

vi.mock("../../utils/settingsStore", () => ({
  settings: {
    visualisation: {
      windowDuration: 10,
      sampleCount: 100,
      lineWidth: 1.5,
      probeSampleCount: 40,
      probeLineWidth: 2,
      probeRefreshIntervalMs: 33,
      futureDashed: true,
      futureMaskOpacity: 0.35,
      futureMaskWidth: 12,
      circularOffset: 0,
      futureLeadSeconds: 1,
      digitalLaneGap: 4,
    },
  },
  updateSettingsStore,
}));

vi.mock("../../lib/visualisationUtils.ts", () => ({
  serialVisChannels: ["a1", "a2", "a3"],
}));

import { VisualisationSettings } from "./VisualisationSettings";

/** Open all collapsed sections/sub-groups so form rows become visible. */
function expandAll() {
  // Keep clicking until all bodies are rendered (Solid's Show is conditional)
  for (let i = 0; i < 3; i++) {
    for (const btn of document.querySelectorAll<HTMLElement>(
      ".panel-section-toggle, .panel-subgroup-toggle"
    )) {
      const parent = btn.closest(".panel-section, .panel-subgroup");
      if (parent && !parent.querySelector(".panel-section-body, .panel-subgroup-body")) {
        btn.click();
      }
    }
  }
}

function getRowInput(label: string): HTMLInputElement {
  const row = screen.getByText(label).closest(".panel-row");
  if (!(row instanceof HTMLElement)) {
    throw new Error(`Unable to find form row for ${label}`);
  }
  const input = row.querySelector("input");
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Unable to find input for ${label}`);
  }
  return input;
}

describe("VisualisationSettings", () => {
  beforeEach(() => {
    updateSettingsStore.mockClear();
  });

  it("renders canonical visualisation controls", () => {
    render(() => <VisualisationSettings />);
    expandAll();

    expect(screen.getByText("Visible window duration")).toBeTruthy();
    expect(screen.getByText("Future lead window")).toBeTruthy();
    expect(screen.getByText("Visible sample count")).toBeTruthy();
    expect(screen.queryByText("Visual offset window")).toBeNull();
  });

  it("updates windowDuration instead of legacy offsetSeconds", () => {
    render(() => <VisualisationSettings />);
    expandAll();

    fireEvent.change(getRowInput("Visible window duration"), {
      target: { value: "6.5" },
    });

    expect(updateSettingsStore).toHaveBeenCalledWith({
      visualisation: expect.objectContaining({
        windowDuration: 6.5,
        futureLeadSeconds: 1,
        sampleCount: 100,
        probeSampleCount: 40,
      }),
    });
    expect(updateSettingsStore.mock.calls[0][0].visualisation.offsetSeconds).toBeUndefined();
  });

  it("updates futureLeadSeconds through the dedicated control", () => {
    render(() => <VisualisationSettings />);
    expandAll();

    fireEvent.change(getRowInput("Future lead window"), {
      target: { value: "2.5" },
    });

    expect(updateSettingsStore).toHaveBeenCalledWith({
      visualisation: expect.objectContaining({
        futureLeadSeconds: 2.5,
        windowDuration: 10,
        probeLineWidth: 2,
      }),
    });
  });

  it("updates probe-specific controls", () => {
    render(() => <VisualisationSettings />);
    expandAll();

    fireEvent.change(getRowInput("Probe waveform line width"), {
      target: { value: "2.4" },
    });

    expect(updateSettingsStore).toHaveBeenCalledWith({
      visualisation: expect.objectContaining({
        probeLineWidth: 2.4,
      }),
    });

    updateSettingsStore.mockClear();
    fireEvent.input(getRowInput("Probe sample count"), {
      target: { value: "60" },
    });

    expect(updateSettingsStore).toHaveBeenCalledWith({
      visualisation: expect.objectContaining({
        probeSampleCount: 60,
      }),
    });
  });

  it("updates probe refresh rate through the settings panel", () => {
    render(() => <VisualisationSettings />);
    expandAll();

    fireEvent.change(getRowInput("Probe refresh rate"), {
      target: { value: "20" },
    });

    expect(updateSettingsStore).toHaveBeenCalledWith({
      visualisation: expect.objectContaining({
        probeRefreshIntervalMs: 50,
      }),
    });
  });
});
