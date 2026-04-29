/**
 * WebSerialHostPort — runtime-port adapter over `connector.ts` + `json-protocol.ts`.
 *
 * This module is a thin façade. It does NOT re-implement transport logic; it
 * simply exposes the existing transport functions through the typed
 * {@link WebSerialHostPort} surface defined in `src/contracts/runtimePorts.ts`.
 *
 * The runtime layer should depend on the port (or its interface) rather than
 * importing connector/json-protocol directly. That gives us:
 *
 *   - One place to mock the hardware side in tests.
 *   - One place to swap the implementation if the wire format ever changes.
 *   - A clean seam against which the WASM-mode JSON-protocol parity work
 *     (`useq-perform-pcx`, Stream F's other bead) can layer in a virtual
 *     transport that speaks the same protocol.
 *
 * @see docs/RUNTIME_CONTRACT.md
 */

import type { TransportState } from "../machines/transport.machine";
import type {
  WebSerialHostCapabilities,
  WebSerialHostPort,
} from "../contracts/runtimePorts";
import { SHARED_TRANSPORT_COMMANDS } from "../contracts/useqRuntimeContract";
import type { SharedTransportCommand } from "../contracts/useqRuntimeContract";

import {
  getProtocolMode,
  sendTouSEQ,
} from "./json-protocol.ts";
import {
  getSerialPort,
  isConnectedToModule,
  toggleConnect,
} from "./connector.ts";

// ── State parsing ─────────────────────────────────────────────────────────

function parseTransportState(raw: string): TransportState | null {
  const cleaned = raw.trim().replace(/"/g, "");
  switch (cleaned) {
    case "playing":
    case "paused":
    case "stopped":
      return cleaned;
    default:
      return null;
  }
}

// ── Port implementation ───────────────────────────────────────────────────

/**
 * Singleton hardware-port instance. The underlying transport modules already
 * own all mutable state; this object is just a typed view onto them.
 */
export const webSerialHostPort: WebSerialHostPort = {
  kind: "web-serial-host",

  capabilities(): WebSerialHostCapabilities {
    const connected = isConnectedToModule();
    return {
      available: connected,
      connected,
      hasOpenPort: !!getSerialPort(),
      protocolMode: getProtocolMode(),
    };
  },

  async sendTransportCommand(command: SharedTransportCommand): Promise<void> {
    await sendTouSEQ(command);
  },

  async syncTransportState(state: TransportState): Promise<void> {
    // Mirror the {playing, paused, stopped} states onto their shared
    // transport builtins. `clear` and `rewind` aren't part of the
    // playing/paused/stopped triple so they stay caller-driven.
    let command: SharedTransportCommand | null = null;
    switch (state) {
      case "playing":
        command = SHARED_TRANSPORT_COMMANDS.play;
        break;
      case "paused":
        command = SHARED_TRANSPORT_COMMANDS.pause;
        break;
      case "stopped":
        command = SHARED_TRANSPORT_COMMANDS.stop;
        break;
    }
    if (command) {
      await sendTouSEQ(command);
    }
  },

  async toggleConnection(): Promise<void> {
    await toggleConnect();
  },

  queryTransportState(): Promise<TransportState | null> {
    return new Promise<TransportState | null>((resolve, reject) => {
      sendTouSEQ(
        SHARED_TRANSPORT_COMMANDS.getState,
        (text: string) => {
          resolve(parseTransportState(text));
        }
      ).catch(reject);
    });
  },

  async sendCode(
    code: string,
    capture: ((response: string) => void) | null = null
  ): Promise<void> {
    await sendTouSEQ(code, capture);
  },
};
