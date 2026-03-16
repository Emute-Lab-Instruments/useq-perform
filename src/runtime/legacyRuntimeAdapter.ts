import {
  getProtocolMode,
} from "../transport/json-protocol.ts";
import {
  getSerialPort,
  isConnectedToModule,
  toggleConnect,
} from "../transport/connector.ts";
import {
  sendTouSEQ,
} from "../transport/legacy-text-protocol.ts";
import {
  evalInUseqWasm,
  syncWasmTransportState as syncWasmTransportStateInInterpreter,
} from "../legacy/io/useqWasmInterpreter.ts";
import type { TransportState } from "../machines/transport.machine";
import type { RuntimeProtocolMode } from "./runtimeDiagnostics";
import type { RuntimeSessionInputs } from "./runtimeSession";
import { getAppSettings } from "./appSettingsRepository.ts";
import { getStartupFlagsSnapshot } from "./startupContext.ts";

export interface LegacyRuntimeState {
  connected: boolean;
  protocolMode: RuntimeProtocolMode;
  sessionInputs: RuntimeSessionInputs;
}

export interface LegacyRuntimeAdapter {
  readState(): LegacyRuntimeState;
  toggleConnection(): Promise<void>;
  sendHardwareCommand(
    command: string,
    capture?: ((response: string) => void) | null
  ): Promise<unknown>;
  evalInWasm(command: string): Promise<string | null>;
  syncWasmTransportState(state: TransportState): Promise<string | null>;
}

function readState(): LegacyRuntimeState {
  const connected = isConnectedToModule();
  const startupFlags = getStartupFlagsSnapshot();
  const settings = getAppSettings();

  return {
    connected,
    protocolMode: getProtocolMode(),
    sessionInputs: {
      hasHardwareConnection: connected && !!getSerialPort(),
      noModuleMode: startupFlags.noModuleMode,
      wasmEnabled: settings.wasm.enabled,
    },
  };
}

export const legacyRuntimeAdapter: LegacyRuntimeAdapter = {
  readState,
  toggleConnection: () => toggleConnect(),
  sendHardwareCommand: (command, capture = null) => sendTouSEQ(command, capture),
  evalInWasm: (command) => evalInUseqWasm(command),
  syncWasmTransportState: (state) => syncWasmTransportStateInInterpreter(state),
};
