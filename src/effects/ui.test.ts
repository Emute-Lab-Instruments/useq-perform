import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect } from "effect";

const { hideChromePanels, toggleChromePanel, toggleVisualisationPanel } = vi.hoisted(() => ({
  hideChromePanels: vi.fn(),
  toggleChromePanel: vi.fn(() => false),
  toggleVisualisationPanel: vi.fn(() => true),
}));

// Mock runtime and typed adapters
vi.mock("../runtime/runtimeService", () => ({
  toggleRuntimeConnection: vi.fn(() => Promise.resolve()),
}));
vi.mock("../ui/adapters/panels", () => ({
  hideChromePanels,
  toggleChromePanel,
}));
vi.mock("../ui/adapters/visualisationPanel", () => ({
  toggleVisualisationPanel,
}));

import { toggleConnection, toggleGraph, togglePanel } from "./ui";
import { toggleRuntimeConnection } from "../runtime/runtimeService";

describe("toggleConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an Effect that calls toggleRuntimeConnection()", async () => {
    await Effect.runPromise(toggleConnection());
    expect(toggleRuntimeConnection).toHaveBeenCalledOnce();
  });
});

describe("toggleGraph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes graph toggles through the named visualisation panel adapter", () => {
    toggleVisualisationPanel
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    expect(Effect.runSync(toggleGraph())).toBe(true);
    expect(Effect.runSync(toggleGraph())).toBe(false);
    expect(toggleVisualisationPanel).toHaveBeenCalledTimes(2);
  });
});

describe("togglePanel", () => {
  let panelEl: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    // Set up DOM
    document.body.innerHTML = '';
    panelEl = document.createElement('div');
    panelEl.id = 'my-panel';
    panelEl.className = 'panel-aux';
    panelEl.style.display = 'none';
    document.body.appendChild(panelEl);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it("routes all panel toggles through the chrome adapter bridge", () => {
    Effect.runSync(togglePanel("#my-panel"));

    expect(toggleChromePanel).toHaveBeenCalledWith("#my-panel");
    // DOM is not manipulated directly — display stays unchanged
    expect(panelEl.style.display).toBe("none");
  });

  it("strips #panel- prefix when routing through chrome adapter bridge", () => {
    toggleChromePanel.mockReturnValueOnce(true);

    Effect.runSync(togglePanel("#panel-settings"));

    expect(toggleChromePanel).toHaveBeenCalledWith("settings");
    expect(panelEl.style.display).toBe("none");
  });

  it("does not crash when panel does not exist", () => {
    expect(() => {
      Effect.runSync(togglePanel("#nonexistent-panel"));
    }).not.toThrow();
  });
});
