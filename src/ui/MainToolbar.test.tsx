import { render, cleanup } from "@solidjs/testing-library";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { MainToolbar, type MainToolbarProps } from "./MainToolbar";

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

  it("renders all toolbar buttons", () => {
    const { container } = render(() => <MainToolbar {...defaultProps({ connectionState: "wasm" })} />);

    expect(container.querySelector(`[title="Connect (WASM)"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Graph"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Load Code"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Save Code"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Font size--"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Font size++"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Help!"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Settings"]`)).toBeTruthy();
  });

  it("renders connect button with transport-wasm class for wasm connection", () => {
    const { container } = render(() => <MainToolbar {...defaultProps({ connectionState: "wasm" })} />);

    const connectBtn = container.querySelector(`[title="Connect (WASM)"]`);
    expect(connectBtn?.classList.contains("transport-wasm")).toBe(true);
  });

  it("renders connect button with transport-both class for both connection", () => {
    const { container } = render(() => <MainToolbar {...defaultProps({ connectionState: "both" })} />);

    const connectBtn = container.querySelector(".toolbar-row .toolbar-button");
    expect(connectBtn?.classList.contains("transport-both")).toBe(true);
  });

  it("renders connect button with transport-none class when disconnected", () => {
    const { container } = render(() => <MainToolbar {...defaultProps({ connectionState: "none" })} />);

    const connectBtn = container.querySelector(`[title="Connect (Offline)"]`);
    expect(connectBtn?.classList.contains("transport-none")).toBe(true);
  });

  it("renders connect button with transport-hardware class for hardware connection", () => {
    const { container } = render(() => <MainToolbar {...defaultProps({ connectionState: "hardware" })} />);

    const connectBtn = container.querySelector(`[title="Connect (Hardware)"]`);
    expect(connectBtn?.classList.contains("transport-hardware")).toBe(true);
  });

  it("calls onConnect when connect button is clicked", () => {
    const onConnect = vi.fn();
    const { container } = render(() => <MainToolbar {...defaultProps({ onConnect })} />);

    const connectBtn = container.querySelector(`[title="Connect (Offline)"]`) as HTMLButtonElement;
    connectBtn.click();
    expect(onConnect).toHaveBeenCalledOnce();
  });

  it("renders connect badge with correct text for each connected state", () => {
    const states: Array<{ state: MainToolbarProps["connectionState"]; badge: string; cssClass: string }> = [
      { state: "wasm", badge: "W", cssClass: "transport-wasm" },
      { state: "hardware", badge: "HW", cssClass: "transport-hardware" },
      { state: "both", badge: "HW+W", cssClass: "transport-both" },
    ];

    for (const { state, badge, cssClass } of states) {
      const { container } = render(() => <MainToolbar {...defaultProps({ connectionState: state })} />);
      const badgeEl = container.querySelector(".connect-badge");
      expect(badgeEl).toBeTruthy();
      expect(badgeEl?.textContent).toBe(badge);
      expect(badgeEl?.classList.contains(cssClass)).toBe(true);
      cleanup();
    }
  });

  it("does not render connect badge when disconnected", () => {
    const { container } = render(() => <MainToolbar {...defaultProps({ connectionState: "none" })} />);
    const badgeEl = container.querySelector(".connect-badge");
    expect(badgeEl).toBeNull();
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

  it("registers animate connect callback on mount", () => {
    const onAnimateConnect = vi.fn();

    render(() => <MainToolbar {...defaultProps({ onAnimateConnect })} />);
    expect(onAnimateConnect).toHaveBeenCalledOnce();
    expect(typeof onAnimateConnect.mock.calls[0][0]).toBe("function");
  });
});
