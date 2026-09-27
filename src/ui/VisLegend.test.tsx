import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";

import { VisLegend, type VisLegendChannel } from "./VisLegend";

const channels = (): VisLegendChannel[] => [
  { channel: "a1", color: "#00ff41", active: true, label: "a1 sine" },
  { channel: "d1", color: null, active: false, label: "d1 gate" },
];

describe("VisLegend", () => {
  it("renders one entry per channel with swatch and label", () => {
    const { container } = render(() => <VisLegend channels={channels()} />);
    const entries = container.querySelectorAll(".vis-legend-entry");
    expect(entries.length).toBe(2);

    const labels = container.querySelectorAll(".vis-legend-label");
    expect(labels[0].textContent).toBe("a1 sine");
    expect(labels[1].textContent).toBe("d1 gate");

    const swatches = container.querySelectorAll(".vis-legend-swatch");
    expect(swatches.length).toBe(2);
  });

  it("marks inactive entries with the inactive modifier class", () => {
    const { container } = render(() => <VisLegend channels={channels()} />);
    const entries = container.querySelectorAll(".vis-legend-entry");
    expect(entries[0].classList.contains("vis-legend-entry--inactive")).toBe(
      false,
    );
    expect(entries[1].classList.contains("vis-legend-entry--inactive")).toBe(
      true,
    );
  });

  it("marks colourless swatches with the empty modifier class", () => {
    const { container } = render(() => <VisLegend channels={channels()} />);
    const swatches = container.querySelectorAll(".vis-legend-swatch");
    expect(swatches[0].classList.contains("vis-legend-swatch--empty")).toBe(
      false,
    );
    expect(swatches[1].classList.contains("vis-legend-swatch--empty")).toBe(
      true,
    );
  });
});
