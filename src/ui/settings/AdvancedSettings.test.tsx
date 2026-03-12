import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { updateSettingsStore } = vi.hoisted(() => ({
  updateSettingsStore: vi.fn(),
}));

vi.mock("../../utils/settingsStore", () => ({
  settings: {
    runtime: {
      autoReconnect: true,
      startLocallyWithoutHardware: true,
    },
    wasm: { enabled: true },
  },
  updateSettingsStore,
}));

import { AdvancedSettings } from "./AdvancedSettings";

describe("AdvancedSettings", () => {
  beforeEach(() => {
    updateSettingsStore.mockClear();
  });

  it("renders WASM interpreter toggle", () => {
    render(() => <AdvancedSettings />);
    expect(screen.getByText("Advanced Settings")).toBeTruthy();
    expect(screen.getByText("Reconnect saved hardware on startup")).toBeTruthy();
    expect(screen.getByText("Start locally before hardware connects")).toBeTruthy();
    expect(screen.getByText("Enable WASM Interpreter")).toBeTruthy();
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes.every((checkbox) => checkbox.checked)).toBe(true);
  });

  it("updates runtime.autoReconnect when toggled", () => {
    render(() => <AdvancedSettings />);
    const checkbox = screen.getAllByRole("checkbox")[0];
    fireEvent.input(checkbox, { target: { checked: false } });
    expect(updateSettingsStore).toHaveBeenCalledWith({
      runtime: {
        autoReconnect: false,
        startLocallyWithoutHardware: true,
      },
    });
  });

  it("updates runtime.startLocallyWithoutHardware when toggled", () => {
    render(() => <AdvancedSettings />);
    const checkbox = screen.getAllByRole("checkbox")[1];
    fireEvent.input(checkbox, { target: { checked: false } });
    expect(updateSettingsStore).toHaveBeenCalledWith({
      runtime: {
        autoReconnect: true,
        startLocallyWithoutHardware: false,
      },
    });
  });

  it("updates wasm.enabled when toggled", () => {
    render(() => <AdvancedSettings />);
    const checkbox = screen.getAllByRole("checkbox")[2];
    fireEvent.input(checkbox, { target: { checked: false } });
    expect(updateSettingsStore).toHaveBeenCalledWith({
      wasm: { enabled: false },
    });
  });
});
