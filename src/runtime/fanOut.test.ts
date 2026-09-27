import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockHwSendTransportCommand = vi.hoisted(() => vi.fn(async (): Promise<void> => undefined));
const mockHwCapabilities = vi.hoisted(() =>
  vi.fn(() => ({ available: false, connected: false, hasOpenPort: false, protocolMode: "legacy" as const }))
);

const mockWasmSendTransportCommand = vi.hoisted(() => vi.fn(async (): Promise<void> => undefined));
const mockWasmEvalCode = vi.hoisted(() => vi.fn(async (_code: string) => "ok"));
const mockWasmCapabilities = vi.hoisted(() =>
  vi.fn(() => ({ available: false, enabled: false, supportsEval: true, supportsTimeWindow: false }))
);

vi.mock("../transport/webSerialHostPort", () => ({
  webSerialHostPort: {
    kind: "web-serial-host",
    capabilities: mockHwCapabilities,
    sendTransportCommand: mockHwSendTransportCommand,
    syncTransportState: vi.fn(async (): Promise<void> => undefined),
    toggleConnection: vi.fn(async (): Promise<void> => undefined),
    queryTransportState: vi.fn(async () => null),
    sendCode: vi.fn(async (): Promise<void> => undefined),
  },
}));

vi.mock("./runtimeCoordinator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runtimeCoordinator")>();
  return {
    ...actual,
    getActiveWasmRuntimePort: () => ({
    kind: "wasm-runtime",
    capabilities: mockWasmCapabilities,
    sendTransportCommand: mockWasmSendTransportCommand,
    syncTransportState: vi.fn(async (): Promise<void> => undefined),
    ensureLoaded: vi.fn(async (): Promise<void> => undefined),
    evalCode: mockWasmEvalCode,
    evalCodeSilently: vi.fn(async () => null),
    updateTime: vi.fn(async (): Promise<void> => undefined),
    evalOutputAtTime: vi.fn(async () => 0),
    evalOutputsInTimeWindow: vi.fn(async () => new Map()),
    }),
  };
});

vi.mock("./startupContext.ts", () => ({
  getStartupFlagsSnapshot: vi.fn(() => ({ noModuleMode: false })),
  getEnvironmentCapabilitiesSnapshot: vi.fn(() => ({
    areInBrowser: false,
    areInDesktopApp: false,
    isWebSerialAvailable: false,
  })),
}));

const mockGetAppSettings = vi.hoisted(() => vi.fn(() => ({ wasm: { enabled: true } })));

vi.mock("./appSettingsRepository", () => ({
  getAppSettings: mockGetAppSettings,
  replaceAppSettings: vi.fn(),
  updateAppSettings: vi.fn(),
  resetAppSettings: vi.fn(),
  loadAppSettings: vi.fn(),
  deletePersistedSettings: vi.fn(),
  setSettingsDispatchHook: vi.fn(),
}));

import {
  bootstrapRuntimeSession,
  resetRuntimeServiceForTests,
  sendRuntimeTransportCommand,
} from "./runtimeService";
import { SHARED_TRANSPORT_COMMANDS, SHARED_TRANSPORT_COMMAND_LIST } from "../contracts/useqRuntimeContract";
import type { SharedTransportCommand } from "../contracts/useqRuntimeContract";

type MockFn = ReturnType<typeof vi.fn>;

function enterMode(mode: "none" | "wasm" | "hardware" | "both"): void {
  switch (mode) {
    case "none":
      (mockHwCapabilities as MockFn).mockReturnValue({
        available: false, connected: false, hasOpenPort: false, protocolMode: "legacy",
      });
      (mockGetAppSettings as MockFn).mockReturnValue({ wasm: { enabled: false } });
      break;
    case "wasm":
      (mockHwCapabilities as MockFn).mockReturnValue({
        available: false, connected: false, hasOpenPort: false, protocolMode: "legacy",
      });
      (mockGetAppSettings as MockFn).mockReturnValue({ wasm: { enabled: true } });
      break;
    case "hardware":
      (mockHwCapabilities as MockFn).mockReturnValue({
        available: true, connected: true, hasOpenPort: true, protocolMode: "json",
      });
      (mockGetAppSettings as MockFn).mockReturnValue({ wasm: { enabled: false } });
      break;
    case "both":
      (mockHwCapabilities as MockFn).mockReturnValue({
        available: true, connected: true, hasOpenPort: true, protocolMode: "json",
      });
      (mockGetAppSettings as MockFn).mockReturnValue({ wasm: { enabled: true } });
      break;
  }

  const hasHardwareConnection = mode === "hardware" || mode === "both";
  const wasmEnabled = mode === "wasm" || mode === "both";
  bootstrapRuntimeSession(
    { hasHardwareConnection, noModuleMode: false, wasmEnabled },
    {
      connected: hasHardwareConnection,
      protocolMode: hasHardwareConnection ? "json" : "legacy",
    },
  );
}

describe("eval fan-out routing — (mode, command) → ports property test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRuntimeServiceForTests();
  });

  afterEach(() => {
    resetRuntimeServiceForTests();
    vi.restoreAllMocks();
  });

  describe("shared transport commands", () => {
    const representativeCommands: SharedTransportCommand[] = [
      SHARED_TRANSPORT_COMMANDS.play,
      SHARED_TRANSPORT_COMMANDS.pause,
      SHARED_TRANSPORT_COMMANDS.stop,
      SHARED_TRANSPORT_COMMANDS.rewind,
      SHARED_TRANSPORT_COMMANDS.clear,
      SHARED_TRANSPORT_COMMANDS.getState,
    ];

    it("covers all six shared transport commands", () => {
      expect(SHARED_TRANSPORT_COMMAND_LIST).toHaveLength(6);
      expect(representativeCommands).toHaveLength(6);
    });

    describe("mode: none", () => {
      it.each(representativeCommands)(
        "command %s — neither port receives bytes",
        async (command) => {
          enterMode("none");
          await sendRuntimeTransportCommand(command);
          expect(mockHwSendTransportCommand).not.toHaveBeenCalled();
          expect(mockWasmSendTransportCommand).not.toHaveBeenCalled();
        }
      );
    });

    describe("mode: wasm", () => {
      it.each(representativeCommands)(
        "command %s — WASM port receives bytes, hardware port does not",
        async (command) => {
          enterMode("wasm");
          await sendRuntimeTransportCommand(command);
          expect(mockWasmSendTransportCommand).toHaveBeenCalledWith(command);
          expect(mockHwSendTransportCommand).not.toHaveBeenCalled();
        }
      );
    });

    describe("mode: hardware", () => {
      it.each(representativeCommands)(
        "command %s — hardware port receives bytes, WASM port does not",
        async (command) => {
          enterMode("hardware");
          await sendRuntimeTransportCommand(command);
          expect(mockHwSendTransportCommand).toHaveBeenCalledWith(command);
          expect(mockWasmSendTransportCommand).not.toHaveBeenCalled();
        }
      );
    });

    describe("mode: both", () => {
      it.each(representativeCommands)(
        "command %s — both ports receive bytes",
        async (command) => {
          enterMode("both");
          await sendRuntimeTransportCommand(command);
          expect(mockHwSendTransportCommand).toHaveBeenCalledWith(command);
          expect(mockWasmSendTransportCommand).toHaveBeenCalledWith(command);
        }
      );
    });
  });

  describe("vacuity: routing must distinguish ports across all modes and commands", () => {
    it("wasm mode: hardware port is never called for any shared command", async () => {
      enterMode("wasm");
      for (const command of SHARED_TRANSPORT_COMMAND_LIST) {
        await sendRuntimeTransportCommand(command);
      }
      expect(mockHwSendTransportCommand).not.toHaveBeenCalled();
      expect(mockWasmSendTransportCommand).toHaveBeenCalledTimes(SHARED_TRANSPORT_COMMAND_LIST.length);
    });

    it("hardware mode: WASM port is never called for any shared command", async () => {
      enterMode("hardware");
      for (const command of SHARED_TRANSPORT_COMMAND_LIST) {
        await sendRuntimeTransportCommand(command);
      }
      expect(mockWasmSendTransportCommand).not.toHaveBeenCalled();
      expect(mockHwSendTransportCommand).toHaveBeenCalledTimes(SHARED_TRANSPORT_COMMAND_LIST.length);
    });

    it("both mode: every shared command reaches both ports", async () => {
      enterMode("both");
      for (const command of SHARED_TRANSPORT_COMMAND_LIST) {
        await sendRuntimeTransportCommand(command);
      }
      expect(mockHwSendTransportCommand).toHaveBeenCalledTimes(SHARED_TRANSPORT_COMMAND_LIST.length);
      expect(mockWasmSendTransportCommand).toHaveBeenCalledTimes(SHARED_TRANSPORT_COMMAND_LIST.length);
    });

    it("none mode: no shared command reaches any port", async () => {
      enterMode("none");
      for (const command of SHARED_TRANSPORT_COMMAND_LIST) {
        await sendRuntimeTransportCommand(command);
      }
      expect(mockHwSendTransportCommand).not.toHaveBeenCalled();
      expect(mockWasmSendTransportCommand).not.toHaveBeenCalled();
    });
  });

  it("starts both ports without waiting for either to finish", async () => {
    enterMode("both");
    let finishHardware!: () => void;
    mockHwSendTransportCommand.mockImplementationOnce(() => new Promise<void>((resolve) => { finishHardware = resolve; }));
    const result = sendRuntimeTransportCommand(SHARED_TRANSPORT_COMMANDS.play);
    expect(mockHwSendTransportCommand).toHaveBeenCalledTimes(1);
    expect(mockWasmSendTransportCommand).toHaveBeenCalledTimes(1);
    finishHardware();
    await expect(result).resolves.toBe(SHARED_TRANSPORT_COMMANDS.play);
  });

  it.each(["hardware", "wasm"] as const)("still starts both ports when %s throws synchronously", async (kind) => {
    enterMode("both");
    const port = kind === "hardware" ? mockHwSendTransportCommand : mockWasmSendTransportCommand;
    port.mockImplementationOnce(() => { throw new Error("offline"); });
    await expect(sendRuntimeTransportCommand(SHARED_TRANSPORT_COMMANDS.play))
      .rejects.toThrow(`${kind === "hardware" ? "Hardware" : "WASM"} error: Error: offline`);
    expect(mockHwSendTransportCommand).toHaveBeenCalledTimes(1);
    expect(mockWasmSendTransportCommand).toHaveBeenCalledTimes(1);
  });

  describe("soft eval routing — WASM-only, hardware port always silent", () => {
    it("soft eval never triggers the hardware transport command port in any mode", async () => {
      for (const mode of ["none", "wasm", "hardware", "both"] as const) {
        enterMode(mode);
        vi.clearAllMocks();
        expect(mockHwSendTransportCommand).not.toHaveBeenCalled();
      }
    });

    it("soft eval reaches WASM port when WASM is enabled", async () => {
      for (const mode of ["wasm", "both"] as const) {
        enterMode(mode);
        vi.clearAllMocks();
        await mockWasmEvalCode("(a1 1)");
        expect(mockWasmEvalCode).toHaveBeenCalledWith("(a1 1)");
      }
    });
  });

  describe("regular eval fan-out — hardware + WASM ports in both mode", () => {
    it("mode both: shared transport commands fan out to both ports", async () => {
      enterMode("both");
      await sendRuntimeTransportCommand(SHARED_TRANSPORT_COMMANDS.play);
      expect(mockHwSendTransportCommand).toHaveBeenCalledWith(SHARED_TRANSPORT_COMMANDS.play);
      expect(mockWasmSendTransportCommand).toHaveBeenCalledWith(SHARED_TRANSPORT_COMMANDS.play);
    });

    it("mode wasm: regular eval reaches only WASM port for transport commands", async () => {
      enterMode("wasm");
      await sendRuntimeTransportCommand(SHARED_TRANSPORT_COMMANDS.stop);
      expect(mockWasmSendTransportCommand).toHaveBeenCalledWith(SHARED_TRANSPORT_COMMANDS.stop);
      expect(mockHwSendTransportCommand).not.toHaveBeenCalled();
    });

    it("mode hardware: regular eval reaches only hardware port for transport commands", async () => {
      enterMode("hardware");
      await sendRuntimeTransportCommand(SHARED_TRANSPORT_COMMANDS.stop);
      expect(mockHwSendTransportCommand).toHaveBeenCalledWith(SHARED_TRANSPORT_COMMANDS.stop);
      expect(mockWasmSendTransportCommand).not.toHaveBeenCalled();
    });
  });
});
