import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { updateSettingsStore } = vi.hoisted(() => ({
  updateSettingsStore: vi.fn(),
}));

vi.mock("../../utils/settingsStore", () => ({
  settings: { wasm: { enabled: true } },
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
    expect(screen.getByText("Enable WASM Interpreter")).toBeTruthy();
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("updates wasm.enabled when toggled", () => {
    render(() => <AdvancedSettings />);
    const checkbox = screen.getByRole("checkbox");
    fireEvent.input(checkbox, { target: { checked: false } });
    expect(updateSettingsStore).toHaveBeenCalledWith({
      wasm: { enabled: false },
    });
  });
});
