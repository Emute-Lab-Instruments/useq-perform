import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";

const runtimeServiceMocks = vi.hoisted(() => ({
  getRuntimeServiceSnapshot: vi.fn(() => ({
    connected: false,
    protocolMode: "legacy",
    session: {
      hasHardwareConnection: false,
      noModuleMode: false,
      wasmEnabled: true,
      connectionMode: "browser",
      transportMode: "wasm",
    },
  })),
  resolveRuntimeTransportMode: vi.fn(() => "wasm"),
  isRuntimeHardwareConnected: vi.fn(() => false),
  isRuntimeWasmEnabled: vi.fn(() => true),
  sendRuntimeTransportCommand: vi.fn((command: string) => Effect.succeed(command)),
  queryRuntimeHardwareTransportState: vi.fn(() => Effect.succeed(null)),
  syncRuntimeWasmTransportState: vi.fn(() => Effect.succeed("ok")),
}));

vi.mock("../runtime/runtimeService", () => runtimeServiceMocks);

import {
  clear,
  extractTransportStateFromMeta,
  getRuntimeSessionSnapshot,
  isRealHardwareConnection,
  isWasmEnabled,
  parseTransportState,
  pause,
  play,
  queryHardwareTransportState,
  resolveTransportMode,
  rewind,
  sendTransportCommand,
  stop,
  syncWasmTransportState,
} from "./transport";

describe("parseTransportState", () => {
  it("parses recognized transport states", () => {
    expect(parseTransportState("playing")).toBe("playing");
    expect(parseTransportState("  \"paused\"  ")).toBe("paused");
    expect(parseTransportState("stopped")).toBe("stopped");
  });

  it("returns null for unknown states", () => {
    expect(parseTransportState("rewinding")).toBeNull();
  });
});

describe("extractTransportStateFromMeta", () => {
  it("extracts transport state from json meta detail", () => {
    expect(
      extractTransportStateFromMeta({
        response: { meta: { transport: "playing" } },
      })
    ).toBe("playing");
  });

  it("returns null when meta transport is absent", () => {
    expect(extractTransportStateFromMeta({ response: {} })).toBeNull();
  });
});

describe("runtime service delegation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeServiceMocks.getRuntimeServiceSnapshot.mockReturnValue({
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
    runtimeServiceMocks.resolveRuntimeTransportMode.mockReturnValue("wasm");
    runtimeServiceMocks.isRuntimeHardwareConnected.mockReturnValue(false);
    runtimeServiceMocks.isRuntimeWasmEnabled.mockReturnValue(true);
    runtimeServiceMocks.sendRuntimeTransportCommand.mockImplementation((command: string) =>
      Effect.succeed(command)
    );
    runtimeServiceMocks.queryRuntimeHardwareTransportState.mockReturnValue(
      Effect.succeed("paused")
    );
    runtimeServiceMocks.syncRuntimeWasmTransportState.mockReturnValue(
      Effect.succeed("ok")
    );
  });

  it("reads runtime session and transport state from runtime service", () => {
    expect(getRuntimeSessionSnapshot().transportMode).toBe("wasm");
    expect(resolveTransportMode()).toBe("wasm");
    expect(isRealHardwareConnection()).toBe(false);
    expect(isWasmEnabled()).toBe(true);
  });

  it("delegates transport command fan-out to runtime service", async () => {
    await Effect.runPromise(sendTransportCommand("(useq-play)"));
    expect(runtimeServiceMocks.sendRuntimeTransportCommand).toHaveBeenCalledWith(
      "(useq-play)"
    );
  });

  it("delegates hardware state query and wasm sync to runtime service", async () => {
    await expect(
      Effect.runPromise(queryHardwareTransportState())
    ).resolves.toBe("paused");
    await expect(
      Effect.runPromise(syncWasmTransportState("playing"))
    ).resolves.toBe("ok");

    expect(runtimeServiceMocks.queryRuntimeHardwareTransportState).toHaveBeenCalledTimes(1);
    expect(runtimeServiceMocks.syncRuntimeWasmTransportState).toHaveBeenCalledWith(
      "playing"
    );
  });

  it("uses canonical transport helper commands", async () => {
    await Effect.runPromise(play());
    await Effect.runPromise(pause());
    await Effect.runPromise(stop());
    await Effect.runPromise(rewind());
    await Effect.runPromise(clear());

    expect(runtimeServiceMocks.sendRuntimeTransportCommand.mock.calls).toEqual([
      ["(useq-play)"],
      ["(useq-pause)"],
      ["(useq-stop)"],
      ["(useq-rewind)"],
      ["(useq-clear)"],
    ]);
  });
});
