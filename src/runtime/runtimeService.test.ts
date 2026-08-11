import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getRuntimeServiceSnapshot,
  bootstrapRuntimeSession,
  queryRuntimeHardwareTransportState,
  refreshRuntimeSession,
  resetRuntimeServiceForTests,
  sendRuntimeTransportCommand,
  syncRuntimeWasmTransportState,
} from "./runtimeService";
import type { WasmRuntimePort } from "../contracts/runtimePorts.ts";
import { transitionRuntimeCoordinator } from "./runtimeCoordinator.ts";

const workerSendTransportCommand = vi.fn(async () => undefined);
const workerSyncTransportState = vi.fn(async () => undefined);
const workerPort = {
  kind: "wasm-runtime",
  sendTransportCommand: workerSendTransportCommand,
  syncTransportState: workerSyncTransportState,
} as unknown as WasmRuntimePort;

// Mock the hardware edge; the WASM edge is selected explicitly below.
vi.mock("../transport/json-protocol.ts", () => ({
  getProtocolMode: vi.fn(() => "legacy"),
  sendTouSEQ: vi.fn(async () => undefined),
}));

vi.mock("../transport/connector.ts", () => ({
  getSerialPort: vi.fn(() => null),
  isConnectedToModule: vi.fn(() => false),
  toggleConnect: vi.fn(async () => undefined),
}));

vi.mock("./startupContext.ts", () => ({
  getStartupFlagsSnapshot: vi.fn(() => ({ noModuleMode: false })),
  getEnvironmentCapabilitiesSnapshot: vi.fn(() => ({
    areInBrowser: false,
    areInDesktopApp: false,
    isWebSerialAvailable: false,
  })),
}));

vi.mock("./appSettingsRepository", () => ({
  getAppSettings: vi.fn(() => ({ wasm: { enabled: false } })),
  replaceAppSettings: vi.fn(),
  updateAppSettings: vi.fn(),
  resetAppSettings: vi.fn(),
  loadAppSettings: vi.fn(),
  deletePersistedSettings: vi.fn(),
  setSettingsDispatchHook: vi.fn(),
}));

// Import the mocked modules so we can configure them per-test
import { getProtocolMode, sendTouSEQ } from "../transport/json-protocol.ts";
import { getSerialPort, isConnectedToModule } from "../transport/connector.ts";

type MockFn = ReturnType<typeof vi.fn>;

function configureState(config: {
  connected: boolean;
  protocolMode: string;
  hasSerialPort: boolean;
  noModuleMode: boolean;
  wasmEnabled: boolean;
}) {
  (isConnectedToModule as MockFn).mockReturnValue(config.connected);
  (getProtocolMode as MockFn).mockReturnValue(config.protocolMode);
  (getSerialPort as MockFn).mockReturnValue(config.hasSerialPort ? {} : null);
  bootstrapRuntimeSession(
    {
      hasHardwareConnection: config.connected && config.hasSerialPort,
      noModuleMode: config.noModuleMode,
      wasmEnabled: config.wasmEnabled,
    },
    {
      connected: config.connected,
      protocolMode: config.protocolMode as "json" | "legacy",
    },
  );
}

describe("runtimeService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRuntimeServiceForTests();
    transitionRuntimeCoordinator({ type: "select-wasm-port", port: workerPort });
  });

  afterEach(() => {
    resetRuntimeServiceForTests();
    vi.restoreAllMocks();
  });

  it("treats real hardware as authoritative even when browser-local flags are also set", () => {
    configureState({
      connected: true,
      protocolMode: "json",
      hasSerialPort: true,
      noModuleMode: true,
      wasmEnabled: true,
    });

    const snapshot = refreshRuntimeSession();

    expect(snapshot.session.connectionMode).toBe("hardware");
    expect(snapshot.session.transportMode).toBe("both");
    expect(snapshot.protocolMode).toBe("json");
    expect(getRuntimeServiceSnapshot().session.connectionMode).toBe("hardware");
  });

  it("fans out shared transport commands to both hardware and wasm when both are active", async () => {
    configureState({
      connected: true,
      protocolMode: "json",
      hasSerialPort: true,
      noModuleMode: false,
      wasmEnabled: true,
    });

    await Effect.runPromise(sendRuntimeTransportCommand("(useq-stop)"));

    expect(sendTouSEQ).toHaveBeenCalledWith("(useq-stop)");
    expect(workerSendTransportCommand).toHaveBeenCalledWith("(useq-stop)");
  });

  it("keeps browser-local transport wasm-only when hardware is absent", async () => {
    configureState({
      connected: false,
      protocolMode: "legacy",
      hasSerialPort: false,
      noModuleMode: false,
      wasmEnabled: true,
    });

    await Effect.runPromise(sendRuntimeTransportCommand("(useq-pause)"));

    expect(sendTouSEQ).not.toHaveBeenCalled();
    expect(workerSendTransportCommand).toHaveBeenCalledWith("(useq-pause)");
  });

  it("parses hardware query results and keeps wasm sync delegated through the adapter", async () => {
    configureState({
      connected: true,
      protocolMode: "json",
      hasSerialPort: true,
      noModuleMode: false,
      wasmEnabled: true,
    });

    (sendTouSEQ as MockFn).mockImplementation(async (_command: string, capture?: ((response: string) => void) | null) => {
      capture?.(' "paused" ');
      return undefined;
    });

    refreshRuntimeSession();

    await expect(
      Effect.runPromise(queryRuntimeHardwareTransportState())
    ).resolves.toBe("paused");
    // Runtime state synchronization crosses the selected Worker port.
    await expect(
      Effect.runPromise(syncRuntimeWasmTransportState("paused"))
    ).resolves.toBe("paused");

    expect(sendTouSEQ).toHaveBeenCalledWith(
      "(useq-get-transport-state)",
      expect.any(Function)
    );
    expect(workerSyncTransportState).toHaveBeenCalledWith("paused");
  });
});
