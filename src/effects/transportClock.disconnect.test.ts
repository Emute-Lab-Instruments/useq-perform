import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isLocal: false,
  reset: vi.fn(),
  startRuntime: vi.fn(),
  setLocal: vi.fn((value: boolean) => { mocks.isLocal = value; }),
  runtime: { connected: false, session: { hasHardwareConnection: false, wasmEnabled: true } },
}));

vi.mock("./visualisationSession.ts", () => ({
  visualisationSession: { clock: {
    isLocal: () => mocks.isLocal,
    reset: mocks.reset,
    startRuntime: mocks.startRuntime,
    setLocal: mocks.setLocal,
  } },
}));
vi.mock("../runtime/runtimeService", () => ({
  getRuntimeServiceSnapshot: () => mocks.runtime,
}));

import { restoreClockAfterHardwareDisconnect } from "./transportClock";

describe("clock after hardware disconnect", () => {
  beforeEach(() => {
    mocks.isLocal = false;
    mocks.runtime = { connected: false, session: { hasHardwareConnection: false, wasmEnabled: true } };
    vi.clearAllMocks();
  });

  it("resumes the local clock when playing continues in WASM mode", () => {
    restoreClockAfterHardwareDisconnect("wasm", "playing");
    expect(mocks.startRuntime).toHaveBeenCalledOnce();
    expect(mocks.setLocal).toHaveBeenCalledWith(true);
  });

  it("keeps a paused transport frozen after disconnect", () => {
    restoreClockAfterHardwareDisconnect("wasm", "paused");
    expect(mocks.startRuntime).not.toHaveBeenCalled();
  });
});
