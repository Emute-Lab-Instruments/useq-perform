import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  port: {
    producerReadTelemetry: vi.fn(async () => ({ audioFrame: 123n })),
    producerTransportUpdate: vi.fn(async (_options: unknown) => 1),
    sendTransportCommand: vi.fn(async () => {}),
  },
  lifecycle: {
    pauseForTransport: vi.fn(async () => {}),
    resumeForTransport: vi.fn(async () => {}),
    stopForTransport: vi.fn(),
  },
  mode: "wasm" as "wasm" | "none",
}));

vi.mock("../runtime/runtimeCoordinator", () => ({
  getActiveWasmRuntimePort: () => mocks.port,
  getRuntimeSessionState: () => ({ session: { transportMode: mocks.mode } }),
  subscribeRuntimeSessionState: () => () => {},
}));
vi.mock("../runtime/runtimeSession", () => ({
  supportsHardwareTransport: () => false,
  supportsWasmTransport: () => mocks.mode === "wasm",
}));
vi.mock("../runtime/activeSynthesisService", () => ({
  getActiveSynthesisService: () => mocks.lifecycle,
}));
vi.mock("../transport/webSerialHostPort", () => ({ webSerialHostPort: {} }));
vi.mock("./transportClock", () => ({
  applyClockPolicy: () => {},
  listenForHardwareOverride: () => () => {},
  restoreClockAfterHardwareDisconnect: () => {},
}));

import { createTransportOrchestrator } from "./transportOrchestrator";

describe("transportOrchestrator audio transport glue", () => {
  afterEach(() => {
    mocks.port.producerReadTelemetry.mockClear();
    mocks.port.producerTransportUpdate.mockClear();
    mocks.lifecycle.pauseForTransport.mockClear();
    mocks.lifecycle.resumeForTransport.mockClear();
    mocks.lifecycle.stopForTransport.mockClear();
    mocks.mode = "wasm";
  });

  it("routes play, pause, resume, and stop through the producer port using its audio frame", async () => {
    const orchestrator = createTransportOrchestrator();
    orchestrator.send({ type: "PLAY" });
    orchestrator.send({ type: "PAUSE" });
    orchestrator.send({ type: "PLAY" });
    orchestrator.send({ type: "STOP" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.port.producerTransportUpdate.mock.calls.map(([options]) => options)).toEqual([
      { transition: "resume", atFrame: 123n },
      { transition: "pause", atFrame: 123n },
      { transition: "resume", atFrame: 123n },
      { transition: "stop", atFrame: 123n },
    ]);
    expect(mocks.port.producerReadTelemetry).toHaveBeenCalledTimes(4);
    expect(mocks.lifecycle.resumeForTransport).toHaveBeenCalledTimes(2);
    expect(mocks.lifecycle.pauseForTransport).toHaveBeenCalledTimes(1);
    expect(mocks.lifecycle.stopForTransport).toHaveBeenCalledTimes(1);
    orchestrator.dispose();
  });
});
