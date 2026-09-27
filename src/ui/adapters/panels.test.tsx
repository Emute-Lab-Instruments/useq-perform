import { render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../settings/SettingsPanel", () => ({
  SettingsPanel: () => <div data-testid="settings-panel">Settings Panel</div>,
}));

vi.mock("../help/HelpPanel", () => ({
  HelpPanel: () => <div data-testid="help-panel">Help Panel</div>,
}));

vi.mock("../help/machine/MachinePanel", () => ({
  WiredMachinePanel: () => <div data-testid="machine-panel">Machine Panel</div>,
}));

vi.mock("../../utils/settingsStore", () => ({
  settings: { ui: { panelChrome: "drawer" } },
}));

vi.mock("../panel-chrome/PanelChrome", () => ({
  PanelChrome: (props: {
    panelId: string;
    title: string;
    design?: string;
    side?: string;
    stackIndex?: number;
    onClose: () => void;
    children: import("solid-js").JSX.Element;
  }) => (
    <div
      data-testid={`${props.panelId}-chrome`}
      data-design={props.design}
      data-side={props.side}
      data-stack={String(props.stackIndex)}
    >
      <button onClick={props.onClose}>close {props.title}</button>
      {props.children}
    </div>
  ),
}));

const escape = async () => {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  await Promise.resolve();
};

async function loadPanelsModule() {
  vi.resetModules();
  return import("./panels.tsx");
}

describe("panels adapter", () => {
  beforeEach(() => {
    window.innerWidth = 1280;
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

    const mounted = render(() => <panels.PanelRoot />);
    panels.showPanel("settings");
    await Promise.resolve();

    expect(screen.getByTestId("settings-panel")).toBeTruthy();
    expect(document.body.style.overflow).toBe("hidden");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await Promise.resolve();

    expect(screen.queryByTestId("settings-panel")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    mounted.unmount();
  });

  it("keeps help open alongside settings on opposite sides", async () => {
    const panels = await loadPanelsModule();

    const mounted = render(() => <panels.PanelRoot />);
    panels.showPanel("help");
    await Promise.resolve();
    expect(screen.getByTestId("help-panel")).toBeTruthy();

    panels.showPanel("settings");
    await Promise.resolve();

    expect(screen.getByTestId("help-panel")).toBeTruthy();
    expect(screen.getByTestId("settings-panel")).toBeTruthy();
    expect(screen.getByTestId("help-chrome").dataset.side).toBe("left");
    expect(screen.getByTestId("settings-chrome").dataset.side).toBe("right");
    expect(document.body.style.overflow).toBe("hidden");
    mounted.unmount();
  });

  it("drives the chrome design from settings.ui.panelChrome", async () => {
    const panels = await loadPanelsModule();

    const mounted = render(() => <panels.PanelRoot />);
    panels.showPanel("settings");
    await Promise.resolve();

    expect(screen.getByTestId("settings-chrome").dataset.design).toBe("drawer");
    mounted.unmount();
  });

  it("dismisses side-by-side panels LIFO on Escape and keeps scroll lock counted", async () => {
    const panels = await loadPanelsModule();
    const { _stackDepth } = await import("../overlayManager");

    const mounted = render(() => <panels.PanelRoot />);
    panels.showPanel("settings");
    panels.showPanel("help");
    await Promise.resolve();
    expect(_stackDepth()).toBe(2);
    expect(screen.getByTestId("help-chrome").dataset.stack).toBe("1");
    expect(screen.getByTestId("settings-chrome").dataset.stack).toBe("0");

    await escape();
    expect(screen.queryByTestId("help-panel")).toBeNull();
    expect(screen.getByTestId("settings-panel")).toBeTruthy();
    expect(document.body.style.overflow).toBe("hidden");

    await escape();
    expect(screen.queryByTestId("settings-panel")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(_stackDepth()).toBe(0);
    mounted.unmount();
  });

  it("raises a panel on pointer-down so Escape dismisses it first", async () => {
    const panels = await loadPanelsModule();
    const { _stackDepth } = await import("../overlayManager");

    const mounted = render(() => <panels.PanelRoot />);
    panels.showPanel("help");
    panels.showPanel("settings");
    await Promise.resolve();

    screen
      .getByTestId("help-panel")
      .dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await Promise.resolve();

    expect(_stackDepth()).toBe(2);
    expect(screen.getByTestId("help-chrome").dataset.stack).toBe("1");
    expect(screen.getByTestId("settings-chrome").dataset.stack).toBe("0");
    expect(document.body.style.overflow).toBe("hidden");

    await escape();
    expect(screen.queryByTestId("help-panel")).toBeNull();
    expect(screen.getByTestId("settings-panel")).toBeTruthy();
    mounted.unmount();
  });

  it("showPanel on an open panel raises it instead of reopening", async () => {
    const panels = await loadPanelsModule();

    const mounted = render(() => <panels.PanelRoot />);
    panels.showPanel("help");
    panels.showPanel("settings");
    await Promise.resolve();
    panels.showPanel("help");
    await Promise.resolve();

    expect(screen.getByTestId("settings-panel")).toBeTruthy();
    await escape();
    expect(screen.queryByTestId("help-panel")).toBeNull();
    mounted.unmount();
  });

  it("a third panel replaces the occupant of its preferred side", async () => {
    const panels = await loadPanelsModule();

    const mounted = render(() => <panels.PanelRoot />);
    panels.showPanel("settings");
    panels.showPanel("help");
    await Promise.resolve();

    panels.togglePanelVisibility("machine");
    await Promise.resolve();

    expect(screen.getByTestId("machine-panel")).toBeTruthy();
    expect(screen.getByTestId("machine-chrome").dataset.side).toBe("right");
    expect(screen.queryByTestId("settings-panel")).toBeNull();
    expect(screen.getByTestId("help-panel")).toBeTruthy();
    mounted.unmount();
  });

  it("machine takes the free side next to a single open panel", async () => {
    const panels = await loadPanelsModule();

    const mounted = render(() => <panels.PanelRoot />);
    panels.showPanel("settings");
    panels.toggleMachinePanel();
    await Promise.resolve();

    expect(screen.getByTestId("settings-panel")).toBeTruthy();
    expect(screen.getByTestId("machine-chrome").dataset.side).toBe("left");
    mounted.unmount();
  });

  it("keeps one chrome panel at a time on narrow viewports", async () => {
    window.innerWidth = 600;
    const panels = await loadPanelsModule();

    const mounted = render(() => <panels.PanelRoot />);
    panels.showPanel("help");
    await Promise.resolve();
    panels.showPanel("settings");
    await Promise.resolve();

    expect(screen.queryByTestId("help-panel")).toBeNull();
    expect(screen.getByTestId("settings-panel")).toBeTruthy();
    expect(document.body.style.overflow).toBe("hidden");
    mounted.unmount();
  });

  it("hideAllPanels closes every chrome panel and releases scroll lock", async () => {
    const panels = await loadPanelsModule();

    const mounted = render(() => <panels.PanelRoot />);
    panels.showPanel("help");
    panels.showPanel("settings");
    await Promise.resolve();

    panels.hideAllPanels();
    await Promise.resolve();

    expect(screen.queryByTestId("help-panel")).toBeNull();
    expect(screen.queryByTestId("settings-panel")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    mounted.unmount();
  });
});
