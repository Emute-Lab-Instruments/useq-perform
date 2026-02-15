import { render, screen } from "@solidjs/testing-library";
import { describe, it, expect, vi } from "vitest";

// Mock child components to avoid pulling in complex dependencies
vi.mock("./GeneralSettings", () => ({
  GeneralSettings: () => <div data-testid="general-settings">General Settings</div>,
}));
vi.mock("./ThemeSettings", () => ({
  ThemeSettings: () => <div data-testid="theme-settings">Theme Settings</div>,
}));

import { SettingsPanel } from "./SettingsPanel";

describe("SettingsPanel", () => {
  it("renders within a settings-panel-container", () => {
    const { container } = render(() => <SettingsPanel />);
    expect(container.querySelector(".settings-panel-container")).toBeTruthy();
  });

  it("renders General and Themes tab buttons", () => {
    render(() => <SettingsPanel />);
    expect(screen.getByText("General")).toBeTruthy();
    expect(screen.getByText("Themes")).toBeTruthy();
  });

  it("shows General tab content by default", () => {
    render(() => <SettingsPanel />);
    const generalBtn = screen.getByText("General");
    expect(generalBtn).toHaveClass("active");
  });

  it("renders only the active tab content in DOM", () => {
    render(() => <SettingsPanel />);
    // General tab is active by default
    expect(screen.getByTestId("general-settings")).toBeTruthy();
    // Inactive tab content should not be in the DOM (lazy rendering)
    expect(screen.queryByTestId("theme-settings")).toBeNull();
  });
});
