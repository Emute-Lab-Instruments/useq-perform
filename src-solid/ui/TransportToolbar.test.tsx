import { render } from "@solidjs/testing-library";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Effect } from "effect";
import { TransportToolbar } from "./TransportToolbar";
import {
  resolveTransportMode,
  extractTransportStateFromMeta,
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
});
