import { render } from "@solidjs/testing-library";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect } from "effect";

import { TransportToolbar } from "./TransportToolbar";
import {
  play,
  pause,
  stop,
  rewind,
  clear,
  extractTransportStateFromMeta,
  queryHardwareTransportState,
  syncWasmTransportState,
} from "../effects/transport";
import {
  startMockTimeGenerator,
  stopMockTimeGenerator,
  resetMockTimeGenerator,
} from "../legacy/io/mockTimeGenerator.ts";

const runtimeServiceState = vi.hoisted(() => {
  const listeners = new Set<(snapshot: any) => void>();
  let snapshot = {
    connected: false,
    protocolMode: "legacy",
    session: {
      hasHardwareConnection: false,
      noModuleMode: false,
      wasmEnabled: false,
      connectionMode: "none",
      transportMode: "none",
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
          wasmEnabled: false,
          connectionMode: "none",
          transportMode: "none",
        },
      };
    },
  };
});

vi.mock("../effects/transport", () => ({
  play: vi.fn(() => Effect.succeed(undefined)),
  pause: vi.fn(() => Effect.succeed(undefined)),
  stop: vi.fn(() => Effect.succeed(undefined)),
  rewind: vi.fn(() => Effect.succeed(undefined)),
  clear: vi.fn(() => Effect.succeed(undefined)),
  queryHardwareTransportState: vi.fn(() => Effect.succeed(null)),
  extractTransportStateFromMeta: vi.fn(() => null),
  syncWasmTransportState: vi.fn(() => Effect.succeed(undefined)),
}));

vi.mock("../runtime/runtimeService", () => ({
  getRuntimeServiceSnapshot: vi.fn(() => runtimeServiceState.getSnapshot()),
  subscribeRuntimeService: vi.fn((listener: (nextSnapshot: unknown) => void) =>
    runtimeServiceState.subscribe(listener as (nextSnapshot: any) => void)
  ),
}));

vi.mock("../legacy/io/mockTimeGenerator.ts", () => ({
  startMockTimeGenerator: vi.fn(),
  stopMockTimeGenerator: vi.fn(),
  resumeMockTimeGenerator: vi.fn(),
  resetMockTimeGenerator: vi.fn(),
}));

function setRuntimeSnapshot(mode: "none" | "wasm" | "both", connected = false) {
  if (mode === "both") {
    runtimeServiceState.setSnapshot({
      connected,
      protocolMode: "json",
      session: {
        hasHardwareConnection: true,
        noModuleMode: false,
        wasmEnabled: true,
        connectionMode: "hardware",
        transportMode: "both",
      },
    });
    return;
  }

  if (mode === "wasm") {
    runtimeServiceState.setSnapshot({
      connected,
      protocolMode: "legacy",
      session: {
        hasHardwareConnection: false,
        noModuleMode: false,
        wasmEnabled: true,
        connectionMode: "browser",
        transportMode: "wasm",
      },
    });
    return;
  }

  runtimeServiceState.setSnapshot({
    connected: false,
    protocolMode: "legacy",
    session: {
      hasHardwareConnection: false,
      noModuleMode: false,
      wasmEnabled: false,
      connectionMode: "none",
      transportMode: "none",
    },
  });
}

describe("TransportToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeServiceState.reset();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows all transport buttons as disabled in none mode with stop as primary", () => {
    const { container } = render(() => <TransportToolbar />);

    const play = container.querySelector("[title='Play']");
    const pause = container.querySelector("[title='Pause']");
    const stop = container.querySelector("[title='Stop']");
    const rewind = container.querySelector("[title='Rewind']");
    const clear = container.querySelector("[title='Clear']");

    expect(play?.classList.contains("disabled")).toBe(true);
    expect(pause?.classList.contains("disabled")).toBe(true);
    expect(stop?.classList.contains("disabled")).toBe(true);
    expect(rewind?.classList.contains("disabled")).toBe(true);
    expect(clear?.classList.contains("disabled")).toBe(true);
    expect(stop?.classList.contains("primary")).toBe(true);
  });

  it("shows correct button CSS in playing state when runtime service reports wasm mode", () => {
    setRuntimeSnapshot("wasm");

    const { container } = render(() => <TransportToolbar />);

    const playBtn = container.querySelector("[title='Play']");
    const pauseBtn = container.querySelector("[title='Pause']");
    const stopBtn = container.querySelector("[title='Stop']");

    expect(playBtn?.classList.contains("primary")).toBe(true);
    expect(playBtn?.classList.contains("disabled")).toBe(true);
    expect(pauseBtn?.classList.contains("disabled")).toBe(false);
    expect(stopBtn?.classList.contains("disabled")).toBe(false);
  });

  it("syncs state from useq-json-meta CustomEvent", async () => {
    setRuntimeSnapshot("wasm");
    vi.mocked(extractTransportStateFromMeta).mockReturnValue("paused");

    const { container } = render(() => <TransportToolbar />);

    window.dispatchEvent(
      new CustomEvent("useq-json-meta", {
        detail: { response: { meta: { transport: "paused" } } },
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const playBtn = container.querySelector("[title='Play']");
    const pauseBtn = container.querySelector("[title='Pause']");

    expect(pauseBtn?.classList.contains("primary")).toBe(true);
    expect(pauseBtn?.classList.contains("disabled")).toBe(true);
    expect(playBtn?.classList.contains("disabled")).toBe(false);
  });

  it("updates mode when runtime service snapshot changes", async () => {
    const { container } = render(() => <TransportToolbar />);

    const rewindBtn = container.querySelector("[title='Rewind']");
    expect(rewindBtn?.classList.contains("disabled")).toBe(true);

    setRuntimeSnapshot("wasm");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rewindBtn?.classList.contains("disabled")).toBe(false);
  });

  describe("mock time generator lifecycle (wasm-only mode)", () => {
    beforeEach(() => {
      setRuntimeSnapshot("wasm");
    });

    it("calls startMockTimeGenerator in playing state on STOP->PLAY", async () => {
      vi.mocked(extractTransportStateFromMeta).mockReturnValue("stopped");

      const { container } = render(() => <TransportToolbar />);

      window.dispatchEvent(
        new CustomEvent("useq-json-meta", {
          detail: { response: { meta: { transport: "stopped" } } },
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      vi.mocked(startMockTimeGenerator).mockClear();
      vi.mocked(stopMockTimeGenerator).mockClear();
      vi.mocked(resetMockTimeGenerator).mockClear();

      const playBtn = container.querySelector("[title='Play']") as HTMLElement;
      playBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(startMockTimeGenerator).toHaveBeenCalled();
    });

    it("calls stopMockTimeGenerator on PAUSE transition", async () => {
      const { container } = render(() => <TransportToolbar />);

      const pauseBtn = container.querySelector("[title='Pause']") as HTMLElement;
      pauseBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(stopMockTimeGenerator).toHaveBeenCalled();
    });

    it("calls stopMockTimeGenerator and resetMockTimeGenerator on STOP transition", async () => {
      const { container } = render(() => <TransportToolbar />);

      const stopBtn = container.querySelector("[title='Stop']") as HTMLElement;
      stopBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(stopMockTimeGenerator).toHaveBeenCalled();
      expect(resetMockTimeGenerator).toHaveBeenCalled();
    });
  });

  it("does not throw when events or runtime updates happen after unmount", () => {
    setRuntimeSnapshot("wasm");

    const { unmount } = render(() => <TransportToolbar />);

    unmount();

    expect(() => {
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
      window.dispatchEvent(new CustomEvent("useq-json-meta"));
      window.dispatchEvent(new CustomEvent("useq-protocol-ready"));
    }).not.toThrow();
  });

  describe("acceptance: buttons send transport commands to all active targets", () => {
    beforeEach(() => {
      setRuntimeSnapshot("wasm");
    });

    it("pause button calls pause() effect", async () => {
      const { container } = render(() => <TransportToolbar />);

      const pauseBtn = container.querySelector("[title='Pause']") as HTMLElement;
      pauseBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(pause).toHaveBeenCalled();
    });

    it("stop button calls stop() effect", async () => {
      const { container } = render(() => <TransportToolbar />);

      const stopBtn = container.querySelector("[title='Stop']") as HTMLElement;
      stopBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(stop).toHaveBeenCalled();
    });

    it("play button calls play() effect from paused state", async () => {
      vi.mocked(extractTransportStateFromMeta).mockReturnValue("paused");

      const { container } = render(() => <TransportToolbar />);

      window.dispatchEvent(
        new CustomEvent("useq-json-meta", {
          detail: { response: { meta: { transport: "paused" } } },
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      vi.mocked(play).mockClear();
      const playBtn = container.querySelector("[title='Play']") as HTMLElement;
      playBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(play).toHaveBeenCalled();
    });

    it("rewind button calls rewind() effect", async () => {
      const { container } = render(() => <TransportToolbar />);

      const rewindBtn = container.querySelector("[title='Rewind']") as HTMLElement;
      rewindBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(rewind).toHaveBeenCalled();
    });

    it("clear button calls clear() effect", async () => {
      const { container } = render(() => <TransportToolbar />);

      const clearBtn = container.querySelector("[title='Clear']") as HTMLElement;
      clearBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(clear).toHaveBeenCalled();
    });
  });

  describe("acceptance: connect to paused module syncs UI and WASM", () => {
    it("protocol-ready queries hardware state and SYNC sets paused + syncs WASM", async () => {
      setRuntimeSnapshot("both", true);
      vi.mocked(queryHardwareTransportState).mockReturnValue(
        Effect.succeed("paused" as const)
      );

      const { container } = render(() => <TransportToolbar />);

      window.dispatchEvent(new CustomEvent("useq-protocol-ready"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(queryHardwareTransportState).toHaveBeenCalled();
      expect(syncWasmTransportState).toHaveBeenCalledWith("paused");

      const pauseBtn = container.querySelector("[title='Pause']");
      expect(pauseBtn?.classList.contains("primary")).toBe(true);
      expect(pauseBtn?.classList.contains("disabled")).toBe(true);
    });
  });

  describe("acceptance: runtime settings updates flow through the runtime service store", () => {
    it("disabling WASM with no hardware switches to none mode and disables buttons", async () => {
      setRuntimeSnapshot("wasm");

      const { container } = render(() => <TransportToolbar />);

      const rewindBtn = container.querySelector("[title='Rewind']");
      expect(rewindBtn?.classList.contains("disabled")).toBe(false);

      setRuntimeSnapshot("none");
      await new Promise((resolve) => setTimeout(resolve, 0));

      const clearBtn = container.querySelector("[title='Clear']");
      expect(rewindBtn?.classList.contains("disabled")).toBe(true);
      expect(clearBtn?.classList.contains("disabled")).toBe(true);
    });
  });

  describe("acceptance: meta.transport pushes sync WASM via SYNC event", () => {
    it("useq-json-meta with transport:stopped triggers syncWasmTransportState(stopped)", async () => {
      setRuntimeSnapshot("both", true);
      vi.mocked(extractTransportStateFromMeta).mockReturnValue("stopped");

      render(() => <TransportToolbar />);

      window.dispatchEvent(
        new CustomEvent("useq-json-meta", {
          detail: { response: { meta: { transport: "stopped" } } },
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(syncWasmTransportState).toHaveBeenCalledWith("stopped");
    });

    it("useq-json-meta with transport:playing triggers syncWasmTransportState(playing)", async () => {
      setRuntimeSnapshot("both", true);
      vi.mocked(extractTransportStateFromMeta).mockReturnValue("paused");

      render(() => <TransportToolbar />);

      window.dispatchEvent(
        new CustomEvent("useq-json-meta", {
          detail: { response: { meta: { transport: "paused" } } },
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      vi.mocked(syncWasmTransportState).mockClear();
      vi.mocked(extractTransportStateFromMeta).mockReturnValue("playing");

      window.dispatchEvent(
        new CustomEvent("useq-json-meta", {
          detail: { response: { meta: { transport: "playing" } } },
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(syncWasmTransportState).toHaveBeenCalledWith("playing");
    });
  });
});
