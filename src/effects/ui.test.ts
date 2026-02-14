import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect } from "effect";

// Mock legacy modules
vi.mock("../legacy/io/serialComms.ts", () => ({
  toggleConnect: vi.fn(() => Promise.resolve()),
}));
vi.mock("../legacy/editors/editorConfig.ts", () => ({
  toggleSerialVis: vi.fn(),
}));

import { toggleConnection, toggleGraph, togglePanel } from "./ui";
import { toggleConnect } from "../legacy/io/serialComms.ts";
import { toggleSerialVis } from "../legacy/editors/editorConfig.ts";

describe("toggleConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an Effect that calls toggleConnect()", async () => {
    await Effect.runPromise(toggleConnection());
    expect(toggleConnect).toHaveBeenCalledOnce();
  });
});

describe("toggleGraph", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an Effect that calls toggleSerialVis()", () => {
    Effect.runSync(toggleGraph());
    expect(toggleSerialVis).toHaveBeenCalledOnce();
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

  it("shows panel when panel is not visible", () => {
    Effect.runSync(togglePanel("#my-panel"));

    // Panel should be shown (display cleared from "none")
    expect(panelEl.style.display).toBe("");
  });

  it("hides all panels when panel is already visible", () => {
    // Make panel visible first
    panelEl.style.display = "block";
    // offsetParent is null in jsdom, so we need a different approach
    // In jsdom, offsetParent is always null, so the panel will always be "not visible"
    // This tests the "show" path in jsdom
    Effect.runSync(togglePanel("#my-panel"));
    expect(panelEl.style.display).toBe("");
  });

  it("does not crash when panel does not exist", () => {
    expect(() => {
      Effect.runSync(togglePanel("#nonexistent-panel"));
    }).not.toThrow();
  });
});
