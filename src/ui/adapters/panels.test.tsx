import { screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../settings/SettingsPanel", () => ({
  SettingsPanel: () => <div data-testid="settings-panel">Settings Panel</div>,
}));

vi.mock("../help/HelpPanel", () => ({
  HelpPanel: () => <div data-testid="help-panel">Help Panel</div>,
}));

vi.mock("../panel-chrome/PanelChrome", () => ({
  PanelChrome: (props: {
    panelId: string;
    title: string;
    onClose: () => void;
    children: unknown;
  }) => (
    <div data-testid={`${props.panelId}-chrome`}>
      <button onClick={props.onClose}>close {props.title}</button>
      {props.children}
    </div>
  ),
}));

async function loadPanelsModule() {
  vi.resetModules();
  return import("./panels.tsx");
}

describe("panels adapter", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.body.style.overflow = "";
  });

  afterEach(async () => {
    const { _resetForTesting } = await import("../overlayManager");
    _resetForTesting();
    document.body.innerHTML = "";
    document.body.style.overflow = "";
    vi.restoreAllMocks();
  });

  it("locks scroll and closes the settings panel on Escape", async () => {
    const panels = await loadPanelsModule();

    panels.mountSettingsPanel();
    panels.showPanel("settings");
    await Promise.resolve();

    expect(screen.getByTestId("settings-panel")).toBeTruthy();
    expect(document.body.style.overflow).toBe("hidden");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await Promise.resolve();

    expect(screen.queryByTestId("settings-panel")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("switches panel ownership cleanly between help and settings", async () => {
    const panels = await loadPanelsModule();

    panels.mountHelpPanel();
    panels.mountSettingsPanel();
    panels.showPanel("help");
    await Promise.resolve();
    expect(screen.getByTestId("help-panel")).toBeTruthy();

    panels.showPanel("settings");
    await Promise.resolve();

    expect(screen.queryByTestId("help-panel")).toBeNull();
    expect(screen.getByTestId("settings-panel")).toBeTruthy();
    expect(document.body.style.overflow).toBe("hidden");
  });
});
