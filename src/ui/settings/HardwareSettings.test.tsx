import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectionChanged, type ConnectionChangedDetail } from "../../contracts/runtimeChannels.ts";
import { HardwareSettings, type HardwareConnectionState } from "./HardwareSettings";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function probe(connected: boolean, jsonProtocol = true): () => HardwareConnectionState {
  return () => ({ connected, jsonProtocol });
}

/** Section components render collapsed; expand before asserting on contents. */
function renderExpanded(ui: () => JSX.Element) {
  const result = render(ui);
  fireEvent.click(screen.getByRole("button", { name: "Hardware" }));
  return result;
}

function publishConnection(connected: boolean, protocolMode: ConnectionChangedDetail["protocolMode"]): void {
  // Only the fields the section reads; the rest of the session snapshot is
  // irrelevant to this component.
  connectionChanged.publish({ connected, protocolMode } as ConnectionChangedDetail);
}

describe("HardwareSettings (calibration.md §2.1)", () => {
  it("renders the Hardware section with a Calibrate CV Outputs button", () => {
    renderExpanded(() => <HardwareSettings connectionProbe={probe(true)} onBeginCalibration={() => true} />);
    const button = screen.getByRole("button", { name: "Calibrate CV Outputs…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("enables the button and calls beginCalibration when a JSON-protocol module is connected", () => {
    const onBeginCalibration = vi.fn(() => true);
    renderExpanded(() => <HardwareSettings connectionProbe={probe(true)} onBeginCalibration={onBeginCalibration} />);
    const button = screen.getByRole("button", { name: "Calibrate CV Outputs…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onBeginCalibration).toHaveBeenCalledTimes(1);
  });

  it("disables the button with an explanation when no module is connected", () => {
    renderExpanded(() => <HardwareSettings connectionProbe={probe(false)} onBeginCalibration={() => true} />);
    const button = screen.getByRole("button", { name: "Calibrate CV Outputs…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const explanation = screen.getByText(/disabled until a module is plugged in/);
    expect(explanation).toBeTruthy();
  });

  it("disables the button when the module is connected but not on the JSON protocol", () => {
    renderExpanded(() => <HardwareSettings connectionProbe={probe(true, false)} onBeginCalibration={() => true} />);
    const button = screen.getByRole("button", { name: "Calibrate CV Outputs…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("follows connectionChanged so a late hardware connection enables the button", async () => {
    renderExpanded(() => <HardwareSettings connectionProbe={probe(false)} onBeginCalibration={() => true} />);
    let button = screen.getByRole("button", { name: "Calibrate CV Outputs…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    publishConnection(true, "json");
    button = screen.getByRole("button", { name: "Calibrate CV Outputs…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    publishConnection(false, "json");
    button = screen.getByRole("button", { name: "Calibrate CV Outputs…" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
