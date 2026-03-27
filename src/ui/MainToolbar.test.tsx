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

    expect(container.querySelector(`[title="Connect (Browser-local)"]`)).toBeTruthy();
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

    const connectBtn = container.querySelector(`[title="Connect (Browser-local)"]`);
    expect(connectBtn?.classList.contains("transport-wasm")).toBe(true);
  });

  it("renders connect button with transport-both class for both connection", () => {
    const { container } = render(() => <MainToolbar {...defaultProps({ connectionState: "both" })} />);

    const connectBtn = container.querySelector(".toolbar-row .toolbar-button");
    expect(connectBtn?.classList.contains("transport-both")).toBe(true);
  });

  it("renders connect button with transport-none class when disconnected", () => {
    const { container } = render(() => <MainToolbar {...defaultProps({ connectionState: "none" })} />);

    const connectBtn = container.querySelector(`[title="Connect (Disconnected)"]`);
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

    const connectBtn = container.querySelector(`[title="Connect (Disconnected)"]`) as HTMLButtonElement;
    connectBtn.click();
    expect(onConnect).toHaveBeenCalledOnce();
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

  it("subscribes to animate connect on mount and cleans up on unmount", () => {
    const unsubscribe = vi.fn();
    const onAnimateConnect = vi.fn(() => unsubscribe);

    const { unmount } = render(() => <MainToolbar {...defaultProps({ onAnimateConnect })} />);
    expect(onAnimateConnect).toHaveBeenCalledOnce();

    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
