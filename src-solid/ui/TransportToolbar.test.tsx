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
  resolveTransportMode,
  extractTransportStateFromMeta,
  queryHardwareTransportState,
  syncWasmTransportState,
  isWasmEnabled,
  isRealHardwareConnection,
} from "../effects/transport";
import {
  startMockTimeGenerator,
  stopMockTimeGenerator,
  resetMockTimeGenerator,
} from "../../src/io/mockTimeGenerator.mjs";

vi.mock("../effects/transport", () => ({
  play: vi.fn(() => Effect.succeed(undefined)),
  pause: vi.fn(() => Effect.succeed(undefined)),
  stop: vi.fn(() => Effect.succeed(undefined)),
  rewind: vi.fn(() => Effect.succeed(undefined)),
  clear: vi.fn(() => Effect.succeed(undefined)),
  queryHardwareTransportState: vi.fn(() => Effect.succeed(null)),
  extractTransportStateFromMeta: vi.fn(() => null),
  syncWasmTransportState: vi.fn(() => Effect.succeed(undefined)),
  resolveTransportMode: vi.fn(() => "none"),
  isRealHardwareConnection: vi.fn(() => false),
  isWasmEnabled: vi.fn(() => false),
}));

vi.mock("../../src/io/mockTimeGenerator.mjs", () => ({
  startMockTimeGenerator: vi.fn(),
  stopMockTimeGenerator: vi.fn(),
  resumeMockTimeGenerator: vi.fn(),
  resetMockTimeGenerator: vi.fn(),
}));

describe("TransportToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    const play = container.querySelector("#button-play");
    const pause = container.querySelector("#button-pause");
    const stop = container.querySelector("#button-stop");
    const rewind = container.querySelector("#button-rewind");
    const clear = container.querySelector("#button-clear");

    expect(play?.classList.contains("disabled")).toBe(true);
    expect(pause?.classList.contains("disabled")).toBe(true);
    expect(stop?.classList.contains("disabled")).toBe(true);
    expect(rewind?.classList.contains("disabled")).toBe(true);
    expect(clear?.classList.contains("disabled")).toBe(true);
    expect(stop?.classList.contains("primary")).toBe(true);
    expect(play?.classList.contains("primary")).toBe(false);
    expect(pause?.classList.contains("primary")).toBe(false);
  });

  it("shows correct button CSS in playing state when mode is wasm", () => {
    vi.mocked(resolveTransportMode).mockReturnValue("wasm");

    const { container } = render(() => <TransportToolbar />);

    const playBtn = container.querySelector("#button-play");
    const pauseBtn = container.querySelector("#button-pause");
    const stopBtn = container.querySelector("#button-stop");

    // In playing state with wasm mode: play is primary disabled
    expect(playBtn?.classList.contains("primary")).toBe(true);
    expect(playBtn?.classList.contains("disabled")).toBe(true);

    // pause is not disabled and not primary
    expect(pauseBtn?.classList.contains("disabled")).toBe(false);
    expect(pauseBtn?.classList.contains("primary")).toBe(false);

    // stop is not disabled and not primary
    expect(stopBtn?.classList.contains("disabled")).toBe(false);
    expect(stopBtn?.classList.contains("primary")).toBe(false);
  });

  it("syncs state from useq-json-meta CustomEvent", async () => {
    vi.mocked(resolveTransportMode).mockReturnValue("wasm");
    vi.mocked(extractTransportStateFromMeta).mockReturnValue("paused");

    const { container } = render(() => <TransportToolbar />);

    // Dispatch the useq-json-meta event
    window.dispatchEvent(
      new CustomEvent("useq-json-meta", {
        detail: { response: { meta: { transport: "paused" } } },
      })
    );

    // Allow reactive updates to flush
    await new Promise((r) => setTimeout(r, 0));

    const playBtn = container.querySelector("#button-play");
    const pauseBtn = container.querySelector("#button-pause");
    const stopBtn = container.querySelector("#button-stop");

    // In paused state: pause is primary disabled
    expect(pauseBtn?.classList.contains("primary")).toBe(true);
    expect(pauseBtn?.classList.contains("disabled")).toBe(true);

    // play is not disabled
    expect(playBtn?.classList.contains("disabled")).toBe(false);
    expect(playBtn?.classList.contains("primary")).toBe(false);

    // stop is not primary disabled
    expect(stopBtn?.classList.contains("primary")).toBe(false);
    expect(stopBtn?.classList.contains("disabled")).toBe(false);
  });

  it("calls resolveTransportMode when useq-connection-changed fires", () => {
    vi.mocked(resolveTransportMode).mockReturnValue("none");

    render(() => <TransportToolbar />);

    // Clear call count from the onMount refreshMode call
    vi.mocked(resolveTransportMode).mockClear();

    window.dispatchEvent(
      new CustomEvent("useq-connection-changed", {
        detail: { connected: true },
      })
    );

    expect(resolveTransportMode).toHaveBeenCalled();
  });

  describe("mock time generator lifecycle (wasm-only mode)", () => {
    beforeEach(() => {
      // Set up wasm-only mode: not real hardware, wasm enabled
      vi.mocked(resolveTransportMode).mockReturnValue("wasm");
      vi.mocked(isRealHardwareConnection).mockReturnValue(false);
      vi.mocked(isWasmEnabled).mockReturnValue(true);
    });

    it("calls startMockTimeGenerator in playing state on STOP->PLAY", async () => {
      vi.mocked(extractTransportStateFromMeta).mockReturnValue("stopped");

      const { container } = render(() => <TransportToolbar />);

      // First transition to stopped via SYNC so we can then go to playing
      window.dispatchEvent(
        new CustomEvent("useq-json-meta", {
          detail: { response: { meta: { transport: "stopped" } } },
        })
      );
      await new Promise((r) => setTimeout(r, 0));

      vi.mocked(startMockTimeGenerator).mockClear();
      vi.mocked(stopMockTimeGenerator).mockClear();
      vi.mocked(resetMockTimeGenerator).mockClear();

      // Now click play to go from stopped -> playing
      const playBtn = container.querySelector("#button-play") as HTMLElement;
      playBtn.click();
      await new Promise((r) => setTimeout(r, 0));

      expect(startMockTimeGenerator).toHaveBeenCalled();
    });

    it("calls stopMockTimeGenerator on PAUSE transition", async () => {
      const { container } = render(() => <TransportToolbar />);

      // Machine starts in playing state. Click pause to transition.
      const pauseBtn = container.querySelector("#button-pause") as HTMLElement;
      pauseBtn.click();
      await new Promise((r) => setTimeout(r, 0));

      expect(stopMockTimeGenerator).toHaveBeenCalled();
    });

    it("calls stopMockTimeGenerator and resetMockTimeGenerator on STOP transition", async () => {
      const { container } = render(() => <TransportToolbar />);

      // Machine starts in playing state. Click stop to transition.
      const stopBtn = container.querySelector("#button-stop") as HTMLElement;
      stopBtn.click();
      await new Promise((r) => setTimeout(r, 0));

      expect(stopMockTimeGenerator).toHaveBeenCalled();
      expect(resetMockTimeGenerator).toHaveBeenCalled();
    });
  });

  it("does not throw when events are dispatched after unmount", () => {
    vi.mocked(resolveTransportMode).mockReturnValue("wasm");

    const { unmount } = render(() => <TransportToolbar />);

    // Unmount the component, which should remove event listeners
    unmount();

    // Dispatching events after unmount should not cause errors
    expect(() => {
      window.dispatchEvent(
        new CustomEvent("useq-connection-changed", {
          detail: { connected: true },
        })
      );
      window.dispatchEvent(
        new CustomEvent("useq-json-meta", {
          detail: { response: { meta: { transport: "paused" } } },
        })
      );
      window.dispatchEvent(new CustomEvent("useq-protocol-ready"));
      window.dispatchEvent(new CustomEvent("useq-settings-changed"));
    }).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Acceptance criteria: button clicks invoke the correct effect functions
  // -------------------------------------------------------------------------
  describe("acceptance: buttons send transport commands to all active targets", () => {
    beforeEach(() => {
      vi.mocked(resolveTransportMode).mockReturnValue("wasm");
    });

    it("pause button calls pause() effect", async () => {
      const { container } = render(() => <TransportToolbar />);

      // Machine starts in playing -- pause is valid
      const pauseBtn = container.querySelector("#button-pause") as HTMLElement;
      pauseBtn.click();
      await new Promise((r) => setTimeout(r, 0));

      expect(pause).toHaveBeenCalled();
    });

    it("stop button calls stop() effect", async () => {
      const { container } = render(() => <TransportToolbar />);

      const stopBtn = container.querySelector("#button-stop") as HTMLElement;
      stopBtn.click();
      await new Promise((r) => setTimeout(r, 0));

      expect(stop).toHaveBeenCalled();
    });

    it("play button calls play() effect from paused state", async () => {
      vi.mocked(extractTransportStateFromMeta).mockReturnValue("paused");

      const { container } = render(() => <TransportToolbar />);

      // Transition to paused via SYNC
      window.dispatchEvent(
        new CustomEvent("useq-json-meta", {
          detail: { response: { meta: { transport: "paused" } } },
        })
      );
      await new Promise((r) => setTimeout(r, 0));

      vi.mocked(play).mockClear();
      const playBtn = container.querySelector("#button-play") as HTMLElement;
      playBtn.click();
      await new Promise((r) => setTimeout(r, 0));

      expect(play).toHaveBeenCalled();
    });

    it("rewind button calls rewind() effect", async () => {
      const { container } = render(() => <TransportToolbar />);

      const rewindBtn = container.querySelector("#button-rewind") as HTMLElement;
      rewindBtn.click();
      await new Promise((r) => setTimeout(r, 0));

      expect(rewind).toHaveBeenCalled();
    });

    it("clear button calls clear() effect", async () => {
      const { container } = render(() => <TransportToolbar />);

      const clearBtn = container.querySelector("#button-clear") as HTMLElement;
      clearBtn.click();
      await new Promise((r) => setTimeout(r, 0));

      expect(clear).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance: connecting to a paused module syncs UI AND WASM
  // -------------------------------------------------------------------------
  describe("acceptance: connect to paused module syncs UI and WASM", () => {
    it("protocol-ready queries hardware state and SYNC sets paused + syncs WASM", async () => {
      vi.mocked(resolveTransportMode).mockReturnValue("both");
      vi.mocked(queryHardwareTransportState).mockReturnValue(
        Effect.succeed("paused" as const)
      );

      const { container } = render(() => <TransportToolbar />);

      // Fire protocol-ready to simulate hardware connect handshake complete
      window.dispatchEvent(new CustomEvent("useq-protocol-ready"));
      await new Promise((r) => setTimeout(r, 0));

      // queryHardwareTransportState should have been called
      expect(queryHardwareTransportState).toHaveBeenCalled();

      // syncWasmTransportState should have been called with "paused"
      // (the SYNC event triggers syncWasmPause action which calls syncWasmTransportState)
      expect(syncWasmTransportState).toHaveBeenCalledWith("paused");

      // UI should reflect paused state
      const pauseBtn = container.querySelector("#button-pause");
      expect(pauseBtn?.classList.contains("primary")).toBe(true);
      expect(pauseBtn?.classList.contains("disabled")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance: settings-changed refreshes transport mode
  // -------------------------------------------------------------------------
  describe("acceptance: settings changes update transport mode", () => {
    it("useq-settings-changed event calls resolveTransportMode to refresh mode", () => {
      vi.mocked(resolveTransportMode).mockReturnValue("wasm");

      render(() => <TransportToolbar />);

      // Clear the onMount call
      vi.mocked(resolveTransportMode).mockClear();

      window.dispatchEvent(new CustomEvent("useq-settings-changed"));

      expect(resolveTransportMode).toHaveBeenCalled();
    });

    it("disabling WASM with no hardware switches to none mode and disables buttons", async () => {
      vi.mocked(resolveTransportMode).mockReturnValue("wasm");

      const { container } = render(() => <TransportToolbar />);

      // Verify buttons are enabled initially
      const playBtn = container.querySelector("#button-play");
      // play is primary+disabled in playing state but NOT because of none mode

      // Now simulate settings change to disable WASM
      vi.mocked(resolveTransportMode).mockReturnValue("none");
      window.dispatchEvent(new CustomEvent("useq-settings-changed"));
      await new Promise((r) => setTimeout(r, 0));

      // All buttons should now be disabled
      const rewindBtn = container.querySelector("#button-rewind");
      const clearBtn = container.querySelector("#button-clear");
      expect(rewindBtn?.classList.contains("disabled")).toBe(true);
      expect(clearBtn?.classList.contains("disabled")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Acceptance: meta.transport push syncs WASM interpreter
  // -------------------------------------------------------------------------
  describe("acceptance: meta.transport pushes sync WASM via SYNC event", () => {
    it("useq-json-meta with transport:stopped triggers syncWasmTransportState(stopped)", async () => {
      vi.mocked(resolveTransportMode).mockReturnValue("both");
      vi.mocked(extractTransportStateFromMeta).mockReturnValue("stopped");

      render(() => <TransportToolbar />);

      window.dispatchEvent(
        new CustomEvent("useq-json-meta", {
          detail: { response: { meta: { transport: "stopped" } } },
        })
      );
      await new Promise((r) => setTimeout(r, 0));

      expect(syncWasmTransportState).toHaveBeenCalledWith("stopped");
    });

    it("useq-json-meta with transport:playing triggers syncWasmTransportState(playing)", async () => {
      vi.mocked(resolveTransportMode).mockReturnValue("both");
      vi.mocked(extractTransportStateFromMeta).mockReturnValue("paused");

      render(() => <TransportToolbar />);

      // First go to paused
      window.dispatchEvent(
        new CustomEvent("useq-json-meta", {
          detail: { response: { meta: { transport: "paused" } } },
        })
      );
      await new Promise((r) => setTimeout(r, 0));

      vi.mocked(syncWasmTransportState).mockClear();
      vi.mocked(extractTransportStateFromMeta).mockReturnValue("playing");

      // Now push playing
      window.dispatchEvent(
        new CustomEvent("useq-json-meta", {
          detail: { response: { meta: { transport: "playing" } } },
        })
      );
      await new Promise((r) => setTimeout(r, 0));

      expect(syncWasmTransportState).toHaveBeenCalledWith("playing");
    });
  });
});
