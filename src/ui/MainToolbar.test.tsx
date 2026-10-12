import { render, cleanup } from "@solidjs/testing-library";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  CONNECTION_DESCRIPTIONS,
  CONNECTION_LABELS,
  MainToolbar,
  type MainToolbarProps,
} from "./MainToolbar";

const noop = () => {};

function defaultProps(overrides: Partial<MainToolbarProps> = {}): MainToolbarProps {
  return {
    connectionState: "none",
    onConnect: noop,
    onToggleGraph: noop,
    onLoadCode: noop,
    onSaveCode: noop,
    onFontSizeUp: noop,
    onFontSizeDown: noop,
    onSettings: noop,
    onHelp: noop,
    ...overrides,
  };
}

describe("MainToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const chip = (container: HTMLElement) =>
    container.querySelector(".connection-chip") as HTMLButtonElement;

  it("renders all toolbar buttons", () => {
    const { container } = render(() => <MainToolbar {...defaultProps({ connectionState: "wasm" })} />);

    expect(chip(container)).toBeTruthy();
    expect(container.querySelector(`[title="Graph"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Load Code"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Save Code"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Font size--"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Font size++"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Help!"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Settings"]`)).toBeTruthy();
  });

  it("groups actions into runtime, file, view and app groups", () => {
    const { container } = render(() => <MainToolbar {...defaultProps()} />);
    const groups = Array.from(container.querySelectorAll(".toolbar-group")).map((g) =>
      g.getAttribute("aria-label"),
    );
    expect(groups).toEqual(["Runtime", "File", "View", "App"]);
    const view = container.querySelector(".toolbar-group-view");
    expect(view?.querySelector(`[title="Graph"]`)).toBeTruthy();
    expect(view?.querySelector(".toolbar-button-pair [title='Font size++']")).toBeTruthy();
  });

  it("shows a readable label, state class and plain-language tooltip for every connection state", () => {
    const cases: Array<{ state: MainToolbarProps["connectionState"]; label: string; cssClass: string }> = [
      { state: "none", label: "Offline", cssClass: "transport-none" },
      { state: "wasm", label: "Virtual uSEQ", cssClass: "transport-wasm" },
      { state: "hardware", label: "uSEQ hardware", cssClass: "transport-hardware" },
      { state: "both", label: "Hardware + virtual", cssClass: "transport-both" },
    ];

    for (const { state, label, cssClass } of cases) {
      const { container } = render(() => <MainToolbar {...defaultProps({ connectionState: state })} />);
      const button = chip(container);
      expect(CONNECTION_LABELS[state]).toBe(label);
      expect(button.classList.contains(cssClass)).toBe(true);
      expect(button.dataset.connectionState).toBe(state);
      expect(button.getAttribute("title")).toBe(CONNECTION_DESCRIPTIONS[state]);
      expect(button.getAttribute("aria-label")).toBe(CONNECTION_DESCRIPTIONS[state]);
      const labelEl = container.querySelector(".connection-chip-label");
      expect(labelEl?.textContent).toBe(label);
      expect(labelEl?.classList.contains(cssClass)).toBe(true);
      cleanup();
    }
  });

  it("describes what a click does in each state", () => {
    expect(CONNECTION_DESCRIPTIONS.none).toMatch(/Click to connect/);
    expect(CONNECTION_DESCRIPTIONS.wasm).toMatch(/Click to connect/);
    expect(CONNECTION_DESCRIPTIONS.hardware).toMatch(/Click to disconnect/);
    expect(CONNECTION_DESCRIPTIONS.both).toMatch(/Click to disconnect/);
  });

  it("shows protocol negotiation in the connection indicator", () => {
    const { container } = render(() => (
      <MainToolbar {...defaultProps({ connectionState: "both", protocolMode: "negotiating" })} />
    ));
    const button = chip(container);
    expect(container.querySelector(".connection-chip-label")?.textContent)
      .toBe("Connecting to uSEQ…");
    expect(button.getAttribute("aria-label")).toContain("protocol handshake is in progress");
  });

  it("calls onConnect when the connection chip is clicked", () => {
    const onConnect = vi.fn();
    const { container } = render(() => <MainToolbar {...defaultProps({ onConnect })} />);

    chip(container).click();
    expect(onConnect).toHaveBeenCalledOnce();
  });

  it("appends adapter-provided shortcuts to tooltips", () => {
    const { container } = render(() => (
      <MainToolbar {...defaultProps({ shortcuts: { graph: "Alt+G", help: "Alt+/" } })} />
    ));
    expect(container.querySelector(`[title="Graph (Alt+G)"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Help! (Alt+/)"]`)).toBeTruthy();
    // Accessible names stay stable regardless of bindings.
    expect(container.querySelector(`[aria-label="Graph"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Settings"]`)).toBeTruthy();
  });

  it("calls onToggleGraph when graph button is clicked", () => {
    const onToggleGraph = vi.fn();
    const { container } = render(() => <MainToolbar {...defaultProps({ onToggleGraph })} />);

    const graphBtn = container.querySelector(`[title="Graph"]`) as HTMLButtonElement;
    graphBtn.click();
    expect(onToggleGraph).toHaveBeenCalledOnce();
  });

  it("calls onHelp when help button is clicked", () => {
    const onHelp = vi.fn();
    const { container } = render(() => <MainToolbar {...defaultProps({ onHelp })} />);

    const helpBtn = container.querySelector(`[title="Help!"]`) as HTMLButtonElement;
    helpBtn.click();
    expect(onHelp).toHaveBeenCalledOnce();
  });

  it("calls onSettings when settings button is clicked", () => {
    const onSettings = vi.fn();
    const { container } = render(() => <MainToolbar {...defaultProps({ onSettings })} />);

    const settingsBtn = container.querySelector(`[title="Settings"]`) as HTMLButtonElement;
    settingsBtn.click();
    expect(onSettings).toHaveBeenCalledOnce();
  });

  it("animates the chip with a wobble, or a motion-free flash under reduced motion", () => {
    let pulse: (() => void) | undefined;
    const animate = vi.fn();
    const original = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = animate as unknown as typeof HTMLElement.prototype.animate;
    try {
      vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q }));
      const { container } = render(() => (
        <MainToolbar {...defaultProps({ onAnimateConnect: (cb) => { pulse = cb; } })} />
      ));
      expect(chip(container)).toBeTruthy();
      pulse?.();
      const wobble = animate.mock.calls[0][0] as Keyframe[];
      expect(wobble.some((k) => String(k.transform).includes("rotate"))).toBe(true);

      vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q }));
      pulse?.();
      const flash = animate.mock.calls[1][0] as Keyframe[];
      expect(flash.every((k) => k.transform === undefined)).toBe(true);
    } finally {
      HTMLElement.prototype.animate = original;
      vi.unstubAllGlobals();
    }
  });

  it("registers animate connect callback on mount", () => {
    const onAnimateConnect = vi.fn();

    render(() => <MainToolbar {...defaultProps({ onAnimateConnect })} />);
    expect(onAnimateConnect).toHaveBeenCalledOnce();
    expect(typeof onAnimateConnect.mock.calls[0][0]).toBe("function");
  });

  // live-edit.md §5.1.5 / §5.8.2 — panel toggle and LEARN ALL sit in the View group.
  it("renders the live-edit panel toggle with LEARN ALL next to it", () => {
    const { container } = render(() => <MainToolbar {...defaultProps()} />);
    const view = container.querySelector(".toolbar-group-view");
    const buttons = Array.from(view?.querySelectorAll("button") ?? []);
    const toggle = buttons.find((b) => b.getAttribute("aria-label") === "Live-edit panel");
    const learnAll = buttons.find((b) => b.getAttribute("aria-label") === "LEARN ALL");
    expect(toggle).toBeTruthy();
    // §5.8.2: LEARN ALL is next to the panel toggle.
    expect(buttons.indexOf(learnAll!)).toBe(buttons.indexOf(toggle!) + 1);
  });

  it("clicking the live-edit toggle fires onToggleLiveEditPanel", () => {
    const onToggleLiveEditPanel = vi.fn();
    const { container } = render(() => (
      <MainToolbar {...defaultProps({ onToggleLiveEditPanel })} />
    ));

    const btn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Live-edit panel",
    ) as HTMLButtonElement;
    btn.click();
    expect(onToggleLiveEditPanel).toHaveBeenCalledOnce();
  });

  it("clicking LEARN ALL fires onStartLearnAll", () => {
    const onStartLearnAll = vi.fn();
    const { container } = render(() => (
      <MainToolbar {...defaultProps({ onStartLearnAll })} />
    ));

    const btn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "LEARN ALL",
    ) as HTMLButtonElement;
    btn.click();
    expect(onStartLearnAll).toHaveBeenCalledOnce();
  });
});
