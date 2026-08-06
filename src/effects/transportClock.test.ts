import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let localTimeActive = false;
  let runtimeSnapshot = {
    connected: false,
    session: { hasHardwareConnection: false, wasmEnabled: true },
  };
  let runtimeSubscriber: ((state: typeof runtimeSnapshot) => void) | null = null;

  return {
    get localTimeActive() {
      return localTimeActive;
    },
    set localTimeActive(value: boolean) {
      localTimeActive = value;
    },
    get runtimeSnapshot() {
      return runtimeSnapshot;
    },
    set runtimeSnapshot(value: typeof runtimeSnapshot) {
      runtimeSnapshot = value;
    },
    get runtimeSubscriber() {
      return runtimeSubscriber;
    },
    set runtimeSubscriber(value: ((state: typeof runtimeSnapshot) => void) | null) {
      runtimeSubscriber = value;
    },
    resetLocalTime: vi.fn(),
    startVisualisationRuntime: vi.fn(),
    setLocalTimeMode: vi.fn((active: boolean) => {
      localTimeActive = active;
    }),
    unsubscribe: vi.fn(),
  };
});

vi.mock("./visualisationRuntime.ts", () => ({
  isLocalTimeActive: () => mocks.localTimeActive,
  resetLocalTime: mocks.resetLocalTime,
  setLocalTimeMode: mocks.setLocalTimeMode,
  startVisualisationRuntime: mocks.startVisualisationRuntime,
}));

vi.mock("../runtime/runtimeService", () => ({
  getRuntimeServiceSnapshot: () => mocks.runtimeSnapshot,
  subscribeRuntimeService: (subscriber: (state: typeof mocks.runtimeSnapshot) => void) => {
    mocks.runtimeSubscriber = subscriber;
    return mocks.unsubscribe;
  },
}));

import {
  applyClockPolicy,
  listenForHardwareOverride,
  shouldUseLocalClock,
  startInternalClock,
} from "./transportClock.ts";

describe("transport clock ownership", () => {
  beforeEach(() => {
    mocks.localTimeActive = false;
    mocks.runtimeSnapshot = {
      connected: false,
      session: { hasHardwareConnection: false, wasmEnabled: true },
    };
    mocks.runtimeSubscriber = null;
    vi.clearAllMocks();
  });

  it("starts local time from zero exactly once", () => {
    expect(startInternalClock()).toBe(true);
    expect(mocks.resetLocalTime).toHaveBeenCalledOnce();
    expect(mocks.startVisualisationRuntime).toHaveBeenCalledOnce();
    expect(mocks.setLocalTimeMode).toHaveBeenCalledWith(true);

    expect(startInternalClock()).toBe(false);
    expect(mocks.resetLocalTime).toHaveBeenCalledOnce();
  });

  it("resumes after pause without resetting elapsed time", () => {
    applyClockPolicy("playing", "paused");

    expect(mocks.resetLocalTime).not.toHaveBeenCalled();
    expect(mocks.startVisualisationRuntime).toHaveBeenCalledOnce();
    expect(mocks.localTimeActive).toBe(true);
  });

  it("stops and resets local time", () => {
    mocks.localTimeActive = true;

    applyClockPolicy("stopped", "playing");

    expect(mocks.setLocalTimeMode).toHaveBeenNthCalledWith(1, false);
    expect(mocks.resetLocalTime).toHaveBeenCalledOnce();
    expect(mocks.localTimeActive).toBe(false);
  });

  it("does not apply local-clock transitions while hardware owns time", () => {
    mocks.runtimeSnapshot = {
      connected: true,
      session: { hasHardwareConnection: true, wasmEnabled: true },
    };

    expect(shouldUseLocalClock()).toBe(false);
    applyClockPolicy("playing", "paused");

    expect(mocks.startVisualisationRuntime).not.toHaveBeenCalled();
    expect(mocks.setLocalTimeMode).not.toHaveBeenCalled();
  });

  it("stops local time when a hardware session takes ownership", () => {
    mocks.localTimeActive = true;
    const unsubscribe = listenForHardwareOverride();

    mocks.runtimeSubscriber?.({
      connected: true,
      session: { hasHardwareConnection: true, wasmEnabled: true },
    });

    expect(mocks.setLocalTimeMode).toHaveBeenCalledWith(false);
    expect(unsubscribe).toBe(mocks.unsubscribe);
  });
});
