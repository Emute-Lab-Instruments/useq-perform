import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LegacyRuntimeAdapter } from "./legacyRuntimeAdapter";
import {
  getRuntimeServiceSnapshot,
  queryRuntimeHardwareTransportState,
  refreshRuntimeSession,
  resetRuntimeServiceForTests,
  sendRuntimeTransportCommand,
  setRuntimeAdapterForTests,
  syncRuntimeWasmTransportState,
} from "./runtimeService";

function createAdapter(
  overrides: Partial<LegacyRuntimeAdapter> & {
    readState: LegacyRuntimeAdapter["readState"];
  }
): LegacyRuntimeAdapter {
  return {
    toggleConnection: vi.fn(async () => undefined),
    sendHardwareCommand: vi.fn(async () => undefined),
    evalInWasm: vi.fn(async () => "ok"),
    syncWasmTransportState: vi.fn(async () => "ok"),
    ...overrides,
  };
}

describe("runtimeService", () => {
  beforeEach(() => {
    resetRuntimeServiceForTests();
  });

  afterEach(() => {
    resetRuntimeServiceForTests();
  });

  it("treats real hardware as authoritative even when browser-local flags are also set", () => {
    setRuntimeAdapterForTests(
      createAdapter({
        readState: () => ({
          connected: true,
          protocolMode: "json",
          sessionInputs: {
            hasHardwareConnection: true,
            noModuleMode: true,
            wasmEnabled: true,
          },
        }),
      })
    );

    const snapshot = refreshRuntimeSession();

    expect(snapshot.session.connectionMode).toBe("hardware");
    expect(snapshot.session.transportMode).toBe("both");
    expect(snapshot.protocolMode).toBe("json");
    expect(getRuntimeServiceSnapshot().session.connectionMode).toBe("hardware");
  });

  it("fans out shared transport commands to both hardware and wasm when both are active", async () => {
    const adapter = createAdapter({
      readState: () => ({
        connected: true,
        protocolMode: "json",
        sessionInputs: {
          hasHardwareConnection: true,
          noModuleMode: false,
          wasmEnabled: true,
        },
      }),
    });

    setRuntimeAdapterForTests(adapter);

    await Effect.runPromise(sendRuntimeTransportCommand("(useq-stop)"));

    expect(adapter.sendHardwareCommand).toHaveBeenCalledWith("(useq-stop)");
    expect(adapter.evalInWasm).toHaveBeenCalledWith("(useq-stop)");
  });

  it("keeps browser-local transport wasm-only when hardware is absent", async () => {
    const adapter = createAdapter({
      readState: () => ({
        connected: false,
        protocolMode: "legacy",
        sessionInputs: {
          hasHardwareConnection: false,
          noModuleMode: false,
          wasmEnabled: true,
        },
      }),
    });

    setRuntimeAdapterForTests(adapter);

    await Effect.runPromise(sendRuntimeTransportCommand("(useq-pause)"));

    expect(adapter.sendHardwareCommand).not.toHaveBeenCalled();
    expect(adapter.evalInWasm).toHaveBeenCalledWith("(useq-pause)");
  });

  it("parses hardware query results and keeps wasm sync delegated through the adapter", async () => {
    const adapter = createAdapter({
      readState: () => ({
        connected: true,
        protocolMode: "json",
        sessionInputs: {
          hasHardwareConnection: true,
          noModuleMode: false,
          wasmEnabled: true,
        },
      }),
      sendHardwareCommand: vi.fn(async (_command, capture) => {
        capture?.(' "paused" ');
        return undefined;
      }),
      syncWasmTransportState: vi.fn(async () => "synced"),
    });

    setRuntimeAdapterForTests(adapter);
    refreshRuntimeSession();

    await expect(
      Effect.runPromise(queryRuntimeHardwareTransportState())
    ).resolves.toBe("paused");
    await expect(
      Effect.runPromise(syncRuntimeWasmTransportState("paused"))
    ).resolves.toBe("synced");

    expect(adapter.sendHardwareCommand).toHaveBeenCalledWith(
      "(useq-get-transport-state)",
      expect.any(Function)
    );
    expect(adapter.syncWasmTransportState).toHaveBeenCalledWith("paused");
  });
});
