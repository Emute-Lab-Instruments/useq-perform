/**
 * Serial Port Connector
 *
 * Manages serial port lifecycle: opening, closing, reconnection,
 * saved-port persistence, bootloader mode, and Web Serial event wiring.
 *
 * This is the sole assembly point for the transport layer. It creates
 * the TransportContext and passes it to the protocol driver at init time.
 */

import { post } from "../utils/consoleStore.ts";
import { dbg } from "../lib/debug.ts";
import { save, load, PERSISTENCE_KEYS } from "../lib/persistence.ts";
import { setCodeHighlightColor } from "./serial-utils.ts";
import { getAppSettings } from "../runtime/appSettingsRepository.ts";
import {
  reportTransportConnectionChanged,
  announceRuntimeSession as announceFromService,
} from "../runtime/runtimeSessionService.ts";
import {
  animateConnect as animateConnectChannel,
  devicePluggedIn as devicePluggedInChannel,
} from "../contracts/runtimeChannels";
import { getStartupFlagsSnapshot } from "../runtime/startupContext.ts";

import type { TransportContext } from "./types.ts";
import {
  serialReader as startSerialReader,
  stopSerialReader,
  readingActive,
} from "./stream-parser.ts";
import {
  getProtocolMode,
  handleJsonMessage,
  handleLegacyTextMessage,
  initProtocol,
  resetProtocolState,
  sendHelloWithRetry,
  sendTouSEQ,
} from "./json-protocol.ts";

// ── Module-level state ──────────────────────────────────────────────

let serialport: SerialPort | null = null;
let connectedToModule = false;
let flag_triggeringBootloader = false;
let connectionInProgress = false;

// ── Connection state ────────────────────────────────────────────────

function emitConnectionChanged(): void {
  const startupFlags = getStartupFlagsSnapshot();
  reportTransportConnectionChanged({
    connected: connectedToModule,
    protocolMode: getProtocolMode(),
    hasHardwareConnection: connectedToModule && !!serialport,
    noModuleMode: startupFlags.noModuleMode,
    wasmEnabled: getAppSettings()?.wasm?.enabled ?? true,
  });
}

// ── TransportContext — wired once, consumed by protocol driver ───────

const transportContext: TransportContext = {
  getSerialPort: () => serialport,
  emitConnectionChanged: () => emitConnectionChanged(),
};

// Initialise the protocol driver with the context
initProtocol(transportContext);

// Initialise connection-dependent UI state.
setCodeHighlightColor(false);

// ── Public connection state API ─────────────────────────────────────

export function setConnectedToModule(connected: boolean): void {
  connectedToModule = connected;

  if (!connected) {
    resetProtocolState();
  }

  setCodeHighlightColor(connected);
  emitConnectionChanged();
}

export function isConnectedToModule(): boolean {
  return connectedToModule;
}

export function announceRuntimeSession(): void {
  announceFromService();
}

// ── Port accessors ──────────────────────────────────────────────────

export function setSerialPort(newport: SerialPort): void {
  serialport = newport;
  const portInfo = newport.getInfo();
  save(PERSISTENCE_KEYS.serialPortInfo, portInfo);
}

export function getSerialPort(): SerialPort | null {
  return serialport;
}

// ── Saved port logic ────────────────────────────────────────────────

function isAutoReconnectEnabled(): boolean {
  return getAppSettings()?.runtime?.autoReconnect !== false;
}

async function checkForSavedPort(): Promise<SerialPort | null | undefined> {
  dbg("Checking for saved port...");
  const savedInfo = load<SerialPortInfo>(PERSISTENCE_KEYS.serialPortInfo);

  if (savedInfo) {
    const ports = await navigator.serial.getPorts();
    dbg("Ports", ports);

    return ports.find((port: SerialPort) => {
      const info = port.getInfo();
      return (
        info.usbVendorId === savedInfo.usbVendorId &&
        info.usbProductId === savedInfo.usbProductId
      );
    });
  }
  return null;
}

export async function checkForSavedPortAndMaybeConnect(): Promise<SerialPort | null> {
  if (!isAutoReconnectEnabled()) {
    displayConnectInstructions();
    return null;
  }

  const savedPort = await checkForSavedPort();
  if (savedPort) {
    connectToSerialPort(savedPort);
    return savedPort;
  }

  dbg("No saved port information found");
  displayConnectInstructions();
  return null;
}

function displayConnectInstructions(): void {
  post(
    'Make sure that your uSEQ is switched on and plugged in. If it doesn\'t reconnect automatically, click the <span style="color: var(--accent-color); font-weight: bold; display: inline;">[connect]</span> button to pair.'
  );
}

// ── Toggle / ask-for-port ───────────────────────────────────────────

export async function toggleConnect(): Promise<void> {
  if (isConnectedToModule()) {
    disconnect();
  } else {
    const savedport = await checkForSavedPort();
    if (savedport) {
      await connectToSerialPort(savedport);
    } else {
      askForPortAndConnect();
    }
  }
}

export function askForPortAndConnect(): void {
  if (!isConnectedToModule()) {
    navigator.serial
      .requestPort()
      .then((port: SerialPort) => {
        connectToSerialPort(port);
      })
      .catch((err: unknown) => {
        console.log("Error requesting port:", err);
        post("Error requesting port. Please try again.", "error");
      });
  } else {
    post(
      'uSEQ is already connected - would you like to <span class="disconnect-link" style="color: red; font-weight: bold; cursor: pointer;">disconnect</span>?'
    );
    setTimeout(() => {
      const disconnectLinks = document.querySelectorAll(".disconnect-link");
      disconnectLinks.forEach((link) => {
        link.replaceWith(link.cloneNode(true));
      });
      const freshLinks = document.querySelectorAll(".disconnect-link");
      freshLinks.forEach((link) => {
        link.addEventListener("click", () => {
          disconnect();
        });
      });
    }, 0);
  }
}

// ── Connect / disconnect ────────────────────────────────────────────

export async function connectToSerialPort(port: SerialPort): Promise<boolean> {
  if (connectionInProgress) {
    dbg("connectToSerialPort: connection already in progress, skipping");
    return false;
  }

  connectionInProgress = true;
  try {
    await port.open({ baudRate: 115200 });
    await setupConnectedPort(port);
    return true;
  } catch (err: unknown) {
    console.log("Error connecting to serial:", err);
    post(
      'Connection failed. See <a href="https://www.emutelabinstruments.co.uk/useqinfo/useq-editor/#troubleshooting">troubleshooting guide</a>',
      "error"
    );
    return false;
  } finally {
    connectionInProgress = false;
  }
}

async function setupConnectedPort(port: SerialPort): Promise<void> {
  resetProtocolState();
  setSerialPort(port);
  setConnectedToModule(true);

  // Start reading with message callbacks
  startSerialReader(port, handleJsonMessage, handleLegacyTextMessage);

  // Spec §4.2: send hello immediately on port open, retry until handshake
  // completes or the attempt budget is exhausted.
  // Fire-and-forget: do not block port setup on handshake completion so the
  // stream reader can process the device's hello response concurrently.
  sendHelloWithRetry().catch((err) => {
    console.error("sendHelloWithRetry failed unexpectedly:", err);
  });
}

export async function disconnect(port?: SerialPort | null): Promise<void> {
  if (!port) {
    port = serialport;
  }

  if (port) {
    if (port === serialport && readingActive) {
      await stopSerialReader();
    }

    let disconnectError: unknown = null;
    try {
      if (port.readable || port.writable) {
        await port.close();
      }
    } catch (err) {
      console.log("Error closing port:", err);
      disconnectError = err;
    }

    if (port === serialport) {
      setConnectedToModule(false);
      if (disconnectError) {
        post("uSEQ disconnected with errors", "warn");
      } else {
        post("uSEQ disconnected");
      }
    }
  }
}

// ── Web Serial support check ────────────────────────────────────────

export function checkForWebserialSupport(): boolean {
  console.log("Checking for Web Serial API support...");
  if (typeof navigator === "undefined" || !navigator.serial) {
    post(
      'Web Serial requires Chrome, Edge, or Opera. See <a href="https://caniuse.com/web-serial">browser support</a>',
      "warn"
    );
    return false;
  }

  console.log("Web Serial API supported");

  navigator.serial.addEventListener("connect", (e: Event) => {
    const savedPort = getSerialPort();
    const connectedPort = (e as any).port as SerialPort | undefined;
    // Only react if the connected port matches the one we're tracking
    if (savedPort && connectedPort === savedPort) {
      try {
        devicePluggedInChannel.publish(undefined);
      } catch (_e) {
        // no-op
      }
      toggleConnect();
    }
  });

  navigator.serial.addEventListener("disconnect", (e: Event) => {
    const disconnectedPort = (e as any).port as SerialPort | undefined;
    // Only react if the disconnected port is the one we're tracking
    if (disconnectedPort && disconnectedPort !== getSerialPort()) {
      dbg("Ignoring disconnect event for unrelated port");
      return;
    }
    setConnectedToModule(false);
    if (!flag_triggeringBootloader) {
      post("uSEQ disconnected");
    }
  });

  return true;
}

// ── Bootloader mode ─────────────────────────────────────────────────

export async function enterBootloaderMode(
  port?: SerialPort | null
): Promise<boolean> {
  flag_triggeringBootloader = true;

  if (!port) {
    port = serialport;
  }

  try {
    if (port && (port.readable || port.writable)) {
      await disconnect(port);
    }

    if (!port) {
      post("No serial port available for bootloader mode", "error");
      return false;
    }

    post("Putting uSEQ into bootloader mode...");
    await port.open({ baudRate: 1200 });
    await port.close();

    post("Waiting for device to reappear as a USB drive...");
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
  } catch (error) {
    console.error("Error entering bootloader mode:", error);
    post(
      `Error entering bootloader mode: ${error instanceof Error ? error.message : String(error)}`,
      "error"
    );
    return false;
  } finally {
    flag_triggeringBootloader = false;
  }

  return true;
}

// Expose on window for dev console access
if (typeof window !== "undefined") {
  (window as any).enterBootloaderMode = enterBootloaderMode;
}

// Extend Window type
declare global {
  interface Window {
    enterBootloaderMode?: typeof enterBootloaderMode;
  }
}
