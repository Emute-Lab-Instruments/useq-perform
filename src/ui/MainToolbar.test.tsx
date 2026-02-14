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
    vi.stubGlobal("lucide", { createIcons: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders all toolbar buttons", () => {
    const { container } = render(() => <MainToolbar />);

    expect(container.querySelector("#button-connect")).toBeTruthy();
    expect(container.querySelector("#button-graph")).toBeTruthy();
    expect(container.querySelector("#button-load")).toBeTruthy();
    expect(container.querySelector("#button-save")).toBeTruthy();
    expect(container.querySelector("#button-decrease-font")).toBeTruthy();
    expect(container.querySelector("#button-increase-font")).toBeTruthy();
    expect(container.querySelector("#button-help")).toBeTruthy();
    expect(container.querySelector("#button-settings")).toBeTruthy();
  });

  it("renders connect button with disconnected class when not connected", () => {
    const { container } = render(() => <MainToolbar />);

    const connectBtn = container.querySelector("#button-connect");
    expect(connectBtn?.classList.contains("disconnected")).toBe(true);
    expect(connectBtn?.classList.contains("connected")).toBe(false);
  });

  it("renders connect button with connected class when connected", () => {
    mockedIsConnected.mockReturnValue(true);

    const { container } = render(() => <MainToolbar />);

    const connectBtn = container.querySelector("#button-connect");
    expect(connectBtn?.classList.contains("connected")).toBe(true);
    expect(connectBtn?.classList.contains("disconnected")).toBe(false);
  });

  it("updates connect button class on useq-connection-changed event", () => {
    const { container } = render(() => <MainToolbar />);

    const connectBtn = container.querySelector("#button-connect");
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

    expect(container.querySelector("#button-devmode")).toBeNull();
  });

  it("renders devmode button when devmode is true", async () => {
    const urlParams = await import("../legacy/urlParams.ts");
    Object.defineProperty(urlParams, "devmode", {
      value: true,
      writable: true,
      configurable: true,
    });

    const { container } = render(() => <MainToolbar />);

    expect(container.querySelector("#button-devmode")).toBeTruthy();

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

  it("calls lucide.createIcons on mount", () => {
    render(() => <MainToolbar />);

    expect(lucide.createIcons).toHaveBeenCalled();
  });
});
