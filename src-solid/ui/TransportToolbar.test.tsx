import { render } from "@solidjs/testing-library";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TransportToolbar } from "./TransportToolbar";

vi.mock("../effects/transport", () => ({
  play: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
  rewind: vi.fn(),
  clear: vi.fn(),
  queryHardwareTransportState: vi.fn(),
  extractTransportStateFromMeta: vi.fn(() => null),
  syncWasmTransportState: vi.fn(),
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
});
