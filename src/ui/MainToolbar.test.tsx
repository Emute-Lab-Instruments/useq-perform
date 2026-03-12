import { render, cleanup } from "@solidjs/testing-library";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isConnectedToModule } from "../legacy/io/serialComms.ts";
import { MainToolbar } from "./MainToolbar";
import { getRuntimeSessionSnapshot } from "../effects/transport";

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

vi.mock("../effects/transport", () => ({
  getRuntimeSessionSnapshot: vi.fn(() => ({
    hasHardwareConnection: false,
    noModuleMode: false,
    wasmEnabled: true,
    connectionMode: "browser",
    transportMode: "wasm",
  })),
}));

vi.mock("../legacy/io/serialComms.ts", () => ({
  isConnectedToModule: vi.fn(() => false),
}));

const mockedIsConnected = vi.mocked(isConnectedToModule);
const mockedGetRuntimeSessionSnapshot = vi.mocked(getRuntimeSessionSnapshot);

describe("MainToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedIsConnected.mockReturnValue(false);
    mockedGetRuntimeSessionSnapshot.mockReturnValue({
      hasHardwareConnection: false,
      noModuleMode: false,
      wasmEnabled: true,
      connectionMode: "browser",
      transportMode: "wasm",
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders all toolbar buttons", () => {
    const { container } = render(() => <MainToolbar />);

    expect(container.querySelector(`[title="Connect (Browser-local)"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Graph"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Load Code"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Save Code"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Font size--"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Font size++"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Help!"]`)).toBeTruthy();
    expect(container.querySelector(`[title="Settings"]`)).toBeTruthy();
    expect(container.textContent).toContain("Browser-local");
  });

  it("renders connect button with disconnected class when not connected", () => {
    const { container } = render(() => <MainToolbar />);

    const connectBtn = container.querySelector(`[title="Connect (Browser-local)"]`);
    expect(connectBtn?.classList.contains("disconnected")).toBe(true);
    expect(connectBtn?.classList.contains("connected")).toBe(false);
    expect(connectBtn?.classList.contains("runtime-browser")).toBe(true);
  });

  it("renders connect button with connected class when connected", () => {
    mockedIsConnected.mockReturnValue(true);
    mockedGetRuntimeSessionSnapshot.mockReturnValue({
      hasHardwareConnection: true,
      noModuleMode: false,
      wasmEnabled: true,
      connectionMode: "hardware",
      transportMode: "both",
    });

    const { container } = render(() => <MainToolbar />);

    const connectBtn = container.querySelector(".toolbar-row .toolbar-button");
    expect(connectBtn?.classList.contains("connected")).toBe(true);
    expect(connectBtn?.classList.contains("disconnected")).toBe(false);
    expect(container.textContent).toContain("Hardware + WASM");
  });

  it("updates connect button class on useq-connection-changed event", () => {
    const { container } = render(() => <MainToolbar />);

    const connectBtn = container.querySelector(`[title="Connect (Browser-local)"]`);
    expect(connectBtn?.classList.contains("disconnected")).toBe(true);

    window.dispatchEvent(
      new CustomEvent("useq-connection-changed", {
        detail: { connected: true, connectionMode: "hardware", transportMode: "both" },
      })
    );

    expect(connectBtn?.classList.contains("connected")).toBe(true);
    expect(connectBtn?.classList.contains("disconnected")).toBe(false);
    expect(connectBtn?.getAttribute("title")).toBe("Connect (Hardware + WASM)");

    window.dispatchEvent(
      new CustomEvent("useq-connection-changed", {
        detail: { connected: false, connectionMode: "browser", transportMode: "wasm" },
      })
    );

    expect(connectBtn?.classList.contains("disconnected")).toBe(true);
    expect(connectBtn?.classList.contains("connected")).toBe(false);
    expect(connectBtn?.getAttribute("title")).toBe("Connect (Browser-local)");
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
