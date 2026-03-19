import { render, cleanup } from "@solidjs/testing-library";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { MainToolbar } from "./MainToolbar";

const runtimeServiceState = vi.hoisted(() => {
  const listeners = new Set<(snapshot: any) => void>();
  let snapshot = {
    connected: false,
    protocolMode: "legacy",
    session: {
      hasHardwareConnection: false,
      noModuleMode: false,
      wasmEnabled: true,
      connectionMode: "browser",
      transportMode: "wasm",
    },
  };

  return {
    getSnapshot: () => snapshot,
    setSnapshot: (nextSnapshot: typeof snapshot) => {
      snapshot = nextSnapshot;
      listeners.forEach((listener) => listener(snapshot));
    },
    subscribe: (listener: (nextSnapshot: typeof snapshot) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset: () => {
      listeners.clear();
      snapshot = {
        connected: false,
        protocolMode: "legacy",
        session: {
          hasHardwareConnection: false,
          noModuleMode: false,
          wasmEnabled: true,
          connectionMode: "browser",
          transportMode: "wasm",
        },
      };
    },
  };
});

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

vi.mock("../runtime/runtimeService", () => ({
  getRuntimeServiceSnapshot: vi.fn(() => runtimeServiceState.getSnapshot()),
  subscribeRuntimeService: vi.fn((listener: (nextSnapshot: unknown) => void) =>
    runtimeServiceState.subscribe(listener as (nextSnapshot: any) => void)
  ),
}));

describe("MainToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeServiceState.reset();
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
  });

  it("renders connect button with transport-wasm class when browser-local runtime is active", () => {
    const { container } = render(() => <MainToolbar />);

    const connectBtn = container.querySelector(`[title="Connect (Browser-local)"]`);
    expect(connectBtn?.classList.contains("transport-wasm")).toBe(true);
  });

  it("renders connected hardware status from the runtime service snapshot", () => {
    runtimeServiceState.setSnapshot({
      connected: true,
      protocolMode: "json",
      session: {
        hasHardwareConnection: true,
        noModuleMode: false,
        wasmEnabled: true,
        connectionMode: "hardware",
        transportMode: "both",
      },
    });

    const { container } = render(() => <MainToolbar />);

    const connectBtn = container.querySelector(".toolbar-row .toolbar-button");
    expect(connectBtn?.classList.contains("transport-both")).toBe(true);
  });

  it("reacts to runtime service updates without reading legacy globals", async () => {
    const { container } = render(() => <MainToolbar />);

    const connectBtn = container.querySelector(`[title="Connect (Browser-local)"]`);
    expect(connectBtn?.classList.contains("transport-wasm")).toBe(true);

    runtimeServiceState.setSnapshot({
      connected: true,
      protocolMode: "json",
      session: {
        hasHardwareConnection: true,
        noModuleMode: false,
        wasmEnabled: true,
        connectionMode: "hardware",
        transportMode: "both",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(connectBtn?.classList.contains("transport-both")).toBe(true);
    expect(connectBtn?.getAttribute("title")).toBe("Connect (Hardware + WASM)");

    runtimeServiceState.setSnapshot({
      connected: false,
      protocolMode: "legacy",
      session: {
        hasHardwareConnection: false,
        noModuleMode: false,
        wasmEnabled: true,
        connectionMode: "browser",
        transportMode: "wasm",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(connectBtn?.classList.contains("transport-wasm")).toBe(true);
    expect(connectBtn?.getAttribute("title")).toBe("Connect (Browser-local)");
  });

  it("removes runtime and animation listeners on cleanup", async () => {
    const { unmount } = render(() => <MainToolbar />);

    // The component mounts and subscribes to animateConnectChannel + runtimeService.
    // After unmount, publishing should not cause errors (listeners were cleaned up).
    unmount();

    const { animateConnect: animateConnectChannel } = await import("../contracts/runtimeChannels");
    // Publishing after unmount should not throw — all listeners have been removed.
    expect(() => animateConnectChannel.publish(undefined)).not.toThrow();
  });
});
