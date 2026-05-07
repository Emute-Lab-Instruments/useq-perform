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

  it("only mounts the active tab; inactive tabs are not yet rendered", () => {
    render(() => <SettingsPanel />);
    // General tab is active by default and rendered
    expect(screen.getByTestId("general-settings")).toBeTruthy();
    // Themes tab has not been activated yet — its content is not mounted
    expect(screen.queryByTestId("theme-settings")).toBeNull();
  });
});
