import { render, cleanup } from "@solidjs/testing-library";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isConnectedToModule } from "../legacy/io/serialComms.ts";
import { MainToolbar } from "./MainToolbar";

vi.mock("../effects/ui", () => ({
  toggleConnection: vi.fn(() => ({ _tag: "Effect" })),
  toggleGraph: vi.fn(() => ({ _tag: "Effect" })),
  togglePanel: vi.fn(() => ({ _tag: "Effect" })),
}));

vi.mock("../effects/editor", () => ({
  adjustFontSize: vi.fn(() => ({ _tag: "Effect" })),
  loadCode: vi.fn(() => ({ _tag: "Effect" })),
  saveCode: vi.fn(() => ({ _tag: "Effect" })),
}));

vi.mock("../legacy/urlParams.ts", () => ({ devmode: false }));

vi.mock("../legacy/io/serialComms.ts", () => ({
  isConnectedToModule: vi.fn(() => false),
}));

const mockedIsConnected = vi.mocked(isConnectedToModule);

describe("MainToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedIsConnected.mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders all toolbar buttons", () => {
    const { container } = render(() => <MainToolbar />);

    expect(container.querySelector(`[title="Connect"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Graph"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Load Code"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Save Code"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Font size--"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Font size++"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Help!"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Settings"]`)).toBeTruthy();
  });

  it("renders connect button with disconnected class when not connected", () => {
    const { container } = render(() => <MainToolbar />);

    const connectBtn = container.querySelector(`[title="Connect"]`);
    expect(connectBtn?.classList.contains("disconnected")).toBe(true);
    expect(connectBtn?.classList.contains("connected")).toBe(false);
  });

  it("renders connect button with connected class when connected", () => {
    mockedIsConnected.mockReturnValue(true);

    const { container } = render(() => <MainToolbar />);

    const connectBtn = container.querySelector(`[title="Connect"]`);
    expect(connectBtn?.classList.contains("connected")).toBe(true);
    expect(connectBtn?.classList.contains("disconnected")).toBe(false);
  });

  it("updates connect button class on useq-connection-changed event", () => {
    const { container } = render(() => <MainToolbar />);

    const connectBtn = container.querySelector(`[title="Connect"]`);
    expect(connectBtn?.classList.contains("disconnected")).toBe(true);

    window.dispatchEvent(
      new CustomEvent("useq-connection-changed", {
        detail: { connected: true },
      })
    );

    expect(connectBtn?.classList.contains("connected")).toBe(true);
    expect(connectBtn?.classList.contains("disconnected")).toBe(false);

    window.dispatchEvent(
      new CustomEvent("useq-connection-changed", {
        detail: { connected: false },
      })
    );

    expect(connectBtn?.classList.contains("disconnected")).toBe(true);
    expect(connectBtn?.classList.contains("connected")).toBe(false);
  });

  it("does not render devmode button when devmode is false", () => {
    const { container } = render(() => <MainToolbar />);

    expect(container.querySelector(`[title="Dev Mode Tools"]`)).toBeNull();
  });

  it("renders devmode button when devmode is true", async () => {
    const urlParams = await import("../legacy/urlParams.ts");
    Object.defineProperty(urlParams, "devmode", {
      value: true,
      writable: true,
      configurable: true,
    });

    const { container } = render(() => <MainToolbar />);

    expect(container.querySelector(`[title="Dev Mode Tools"]`)).toBeTruthy();

    // restore
    Object.defineProperty(urlParams, "devmode", {
      value: false,
      writable: true,
      configurable: true,
    });
  });

  it("removes event listener on cleanup", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = render(() => <MainToolbar />);

    unmount();

    expect(removeSpy).toHaveBeenCalledWith(
      "useq-connection-changed",
      expect.any(Function)
    );

    removeSpy.mockRestore();
  });

});
