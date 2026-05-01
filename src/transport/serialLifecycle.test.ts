/**
 * Hardware-mode lifecycle tests.
 *
 * These tests exercise transport behaviours that have historically required
 * hardware-in-loop debugging — Web Serial event wiring, auto-reconnect on
 * cable replug, saved-port matching across sessions, bootloader-mode handoff,
 * firmware-version gating (legacy vs JSON 1.2+), and the post-handshake flow.
 *
 * Path 7 (timing-sensitive paths around the 3500 ms post-open boot wait at
 * `connector.ts:238`) is intentionally **not** covered here — Stream D-serial
 * (bead `useq-perform-vig`) is replacing that hardcoded delay with an
 * observed-readiness signal. Tests added here would lock in timing that is
 * about to change. They should be added in a follow-up bead against the new
 * observed-readiness contract once `vig` lands.
 *
 * The fake-Serial harness pattern used here mirrors `serialComms.test.ts`.
 */

import { ReadableStream, WritableStream } from "node:stream/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PERSISTENCE_KEYS } from "../lib/persistence";

// ── Mocks (must mirror serialComms.test.ts shape) ────────────────────

const postMock = vi.fn();
const upgradeCheckMock = vi.fn();
const handleExternalTimeUpdateMock = vi.fn(() => Promise.resolve());
const reportTransportConnectionChangedMock = vi.fn(() => ({
  connected: false,
  protocolMode: "legacy",
  session: {
    hasHardwareConnection: false,
    noModuleMode: false,
    wasmEnabled: true,
    connectionMode: "none",
    transportMode: "none",
  },
}));
const reportProtocolModeChangedMock = vi.fn();
const announceRuntimeSessionMock = vi.fn();

// Mutable so individual tests can swap the firmware version that `currentVersion`
// would represent under real-world flow.
let currentVersionMock: { major: number; minor: number; patch: number } | null = {
  major: 1,
  minor: 2,
  patch: 0,
};

vi.mock("../utils/consoleStore.ts", () => ({
  post: postMock,
}));

vi.mock("./upgradeCheck.ts", () => ({
  get currentVersion() {
    return currentVersionMock;
  },
  upgradeCheck: upgradeCheckMock,
}));

vi.mock("../effects/visualisationSampler.ts", () => ({
  handleExternalTimeUpdate: handleExternalTimeUpdateMock,
}));

vi.mock("../runtime/appSettingsRepository.ts", () => ({
  getAppSettings: () => ({
    runtime: { autoReconnect: true },
    wasm: { enabled: true },
  }),
}));

vi.mock("../runtime/startupContext.ts", () => ({
  getStartupFlagsSnapshot: () => ({
    debug: false,
    devmode: false,
    disableWebSerial: false,
    noModuleMode: false,
    nosave: false,
    params: {},
  }),
  isLocalStorageBypassedInStartupContext: () => false,
}));

vi.mock("../runtime/runtimeService.ts", () => ({
  reportTransportConnectionChanged: reportTransportConnectionChangedMock,
  reportProtocolModeChanged: reportProtocolModeChangedMock,
  announceRuntimeSession: announceRuntimeSessionMock,
}));

// ── Wire-format helpers (copied from serialComms.test.ts) ────────────

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MESSAGE_START_MARKER = 31;
const JSON_MESSAGE_TYPE = 101;
const TEXT_MESSAGE_TYPE = 1;

function encodeTextPacket(text: string): Uint8Array {
  const payload = encoder.encode(text);
  const packet = new Uint8Array(payload.length + 4);
  packet[0] = MESSAGE_START_MARKER;
  packet[1] = TEXT_MESSAGE_TYPE;
  packet.set(payload, 2);
  packet[packet.length - 2] = 13;
  packet[packet.length - 1] = 10;
  return packet;
}

function encodeJsonPacket(payload: Record<string, unknown>): Uint8Array {
  const body = encoder.encode(JSON.stringify(payload));
  const packet = new Uint8Array(body.length + 4);
  packet[0] = MESSAGE_START_MARKER;
  packet[1] = JSON_MESSAGE_TYPE;
  packet.set(body, 2);
  packet[packet.length - 2] = 13;
  packet[packet.length - 1] = 10;
  return packet;
}

// ── Fake Serial port + navigator.serial harness ──────────────────────

interface FakePortOptions {
  /** USB VID/PID returned from getInfo(). Defaults match the firmware. */
  vendorId?: number;
  productId?: number;
  /** When set, calling open() will reject with this error. */
  failOpenWith?: Error;
  /** When set, the close() call will reject with this error. */
  failCloseWith?: Error;
  /** Firmware version string echoed in response to the firmware-info probe. */
  firmwareString?: string;
  /** When true, the hello response is suppressed (simulates timeout). */
  suppressHello?: boolean;
  /** Override hello-response firmware version. */
  helloFw?: string;
}

class FakeSerialPort {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  readonly writes: string[] = [];
  readonly jsonRequests: Array<Record<string, unknown>> = [];
  readonly openCalls: number[] = [];
  closeCalls = 0;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private opts: FakePortOptions;

  constructor(opts: FakePortOptions = {}) {
    this.opts = opts;
  }

  async open(options: { baudRate: number }): Promise<void> {
    this.openCalls.push(options.baudRate);
    if (this.opts.failOpenWith) {
      throw this.opts.failOpenWith;
    }
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        this.handleWrite(chunk);
      },
    });
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    if (this.opts.failCloseWith) {
      throw this.opts.failCloseWith;
    }
    try {
      this.controller?.close();
    } catch (_e) {
      // Ignore duplicate close from cancellation
    }
    this.controller = null;
    this.readable = null;
    this.writable = null;
  }

  getInfo(): Record<string, number> {
    return {
      usbVendorId: this.opts.vendorId ?? 0x1234,
      usbProductId: this.opts.productId ?? 0x5678,
    };
  }

  enqueueText(text: string): void {
    this.controller?.enqueue(encodeTextPacket(text));
  }

  enqueueJson(payload: Record<string, unknown>): void {
    this.controller?.enqueue(encodeJsonPacket(payload));
  }

  private handleWrite(chunk: Uint8Array): void {
    const text = decoder.decode(chunk);
    this.writes.push(text);

    if (text === "@(useq-report-firmware-info)") {
      const fw = this.opts.firmwareString ?? "uSEQ Firmware 1.2.0";
      setTimeout(() => this.enqueueText(fw), 0);
      return;
    }

    if (!text.endsWith("\n")) return;

    let request: Record<string, unknown>;
    try {
      request = JSON.parse(text);
    } catch {
      return;
    }
    this.jsonRequests.push(request);

    const requestType = String(request.type ?? "eval");

    if (requestType === "hello") {
      if (this.opts.suppressHello) return;
      setTimeout(() =>
        this.enqueueJson({
          requestId: request.requestId,
          success: true,
          type: "hello",
          mode: "json",
          fw: this.opts.helloFw ?? "1.2.0",
          config: {
            inputs: [{ index: 1, name: "ssin1" }],
            outputs: [
              { index: 1, name: "time" },
              { index: 2, name: "s1" },
            ],
          },
        }), 0);
      return;
    }

    if (
      requestType === "stream-config" ||
      requestType === "ping" ||
      requestType === "eval"
    ) {
      setTimeout(() =>
        this.enqueueJson({
          requestId: request.requestId,
          success: true,
          type: requestType,
        }), 0);
    }
  }
}

interface FakeNavigatorSerial {
  ports: FakeSerialPort[];
  requestPort: ReturnType<typeof vi.fn>;
  getPorts: ReturnType<typeof vi.fn>;
  addEventListener: (
    event: "connect" | "disconnect",
    handler: (e: { port: SerialPort } | Event) => void
  ) => void;
  /** Synthesise a connect event from outside the SUT. */
  fireConnect(port: FakeSerialPort): void;
  /** Synthesise a disconnect event. */
  fireDisconnect(port: FakeSerialPort): void;
}

function createFakeNavigatorSerial(initialPorts: FakeSerialPort[] = []): FakeNavigatorSerial {
  const listeners = new Map<string, Array<(e: any) => void>>();

  const requestPort = vi.fn(async () => initialPorts[0]);
  const getPorts = vi.fn(async () => initialPorts);

  return {
    ports: initialPorts,
    requestPort,
    getPorts,
    addEventListener: (event, handler) => {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
    },
    fireConnect(port) {
      for (const handler of listeners.get("connect") ?? []) {
        handler({ port } as any);
      }
    },
    fireDisconnect(port) {
      for (const handler of listeners.get("disconnect") ?? []) {
        handler({ port } as any);
      }
    },
  };
}

// ── Module loader (resets vi.modules + re-imports transport) ─────────

async function loadTransport() {
  vi.resetModules();
  const transport = await import("./index.ts");
  const channels = await import("../contracts/runtimeChannels");
  return { ...transport, channels };
}

async function flushProtocolWork(): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
  }
}

/**
 * Drive the transport past the post-open boot wait that precedes the
 * firmware-info probe. Currently this is a hardcoded 3500 ms `setTimeout`
 * in `connector.ts`; bead `useq-perform-vig` (Stream D-serial) replaces it
 * with an observed-readiness signal. We advance well past the current value
 * and add explicit microtask flushes so this helper continues to work after
 * `vig` lands without locking in the literal 3500 ms.
 */
async function advancePastPostOpenBootWait(): Promise<void> {
  await vi.advanceTimersByTimeAsync(5000);
  await flushProtocolWork();
}

// ── Test setup ───────────────────────────────────────────────────────

describe("hardware transport lifecycle", () => {
  let storage: Map<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    currentVersionMock = { major: 1, minor: 2, patch: 0 };

    storage = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, String(value));
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
        clear: () => {
          storage.clear();
        },
      },
    });

    postMock.mockReset();
    upgradeCheckMock.mockReset();
    handleExternalTimeUpdateMock.mockReset();
    handleExternalTimeUpdateMock.mockImplementation(() => Promise.resolve());
    reportTransportConnectionChangedMock.mockReset();
    reportTransportConnectionChangedMock.mockReturnValue({
      connected: false,
      protocolMode: "legacy",
      session: {
        hasHardwareConnection: false,
        noModuleMode: false,
        wasmEnabled: true,
        connectionMode: "none",
        transportMode: "none",
      },
    });
    reportProtocolModeChangedMock.mockReset();
    announceRuntimeSessionMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Remove any installed navigator.serial.
    delete (globalThis.navigator as any).serial;
  });

  // ── Path 1: Web Serial event wiring ──────────────────────────────

  describe("Web Serial event wiring", () => {
    it("returns false and posts a warning when navigator.serial is unavailable", async () => {
      const transport = await loadTransport();
      // Browser-mock navigator without serial.
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {},
      });

      expect(transport.checkForWebserialSupport()).toBe(false);
      expect(postMock).toHaveBeenCalledWith(
        expect.stringContaining("Web Serial requires"),
        "warn"
      );
    });

    it("registers connect and disconnect listeners on navigator.serial", async () => {
      const transport = await loadTransport();
      const fakeSerial = createFakeNavigatorSerial();
      const addEventListenerSpy = vi.spyOn(fakeSerial, "addEventListener");
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { serial: fakeSerial },
      });

      expect(transport.checkForWebserialSupport()).toBe(true);
      const eventNames = addEventListenerSpy.mock.calls.map((c) => c[0]);
      expect(eventNames).toEqual(expect.arrayContaining(["connect", "disconnect"]));
    });

    it("disconnect event clears the connected flag and posts a notice", async () => {
      const transport = await loadTransport();
      const port = new FakeSerialPort();
      const fakeSerial = createFakeNavigatorSerial([port]);
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { serial: fakeSerial },
      });

      transport.checkForWebserialSupport();

      // Establish a connection first so disconnect has something to clear.
      const connectPromise = transport.connectToSerialPort(port as unknown as SerialPort);
      await advancePastPostOpenBootWait();
      expect(await connectPromise).toBe(true);
      expect(transport.isConnectedToModule()).toBe(true);

      postMock.mockClear();
      fakeSerial.fireDisconnect(port);

      expect(transport.isConnectedToModule()).toBe(false);
      expect(postMock).toHaveBeenCalledWith("uSEQ disconnected");
    });
  });

  // ── Path 2: Auto-reconnect on cable replug ───────────────────────

  describe("auto-reconnect on cable replug", () => {
    it("reconnects when the user replugs the same physical port", async () => {
      const transport = await loadTransport();
      const port = new FakeSerialPort();
      const fakeSerial = createFakeNavigatorSerial([port]);
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { serial: fakeSerial },
      });

      transport.checkForWebserialSupport();

      // First, establish + then disconnect, which leaves serialport tracking the same port.
      const connectPromise = transport.connectToSerialPort(port as unknown as SerialPort);
      await advancePastPostOpenBootWait();
      expect(await connectPromise).toBe(true);

      await transport.disconnect();
      expect(transport.isConnectedToModule()).toBe(false);

      // Simulate Web Serial firing 'connect' for the SAME tracked port.
      // Because connector tracks `serialport` and re-connects when the event
      // matches, we expect the port to re-open.
      const openCallsBefore = port.openCalls.length;
      fakeSerial.fireConnect(port);
      // toggleConnect is async; let it run.
      await vi.advanceTimersByTimeAsync(3500);
      await flushProtocolWork();

      expect(port.openCalls.length).toBeGreaterThan(openCallsBefore);
      expect(transport.isConnectedToModule()).toBe(true);
    });

    it("ignores connect events for ports the editor is not tracking", async () => {
      const transport = await loadTransport();
      const trackedPort = new FakeSerialPort();
      const otherPort = new FakeSerialPort({ vendorId: 0xdead });
      const fakeSerial = createFakeNavigatorSerial([trackedPort]);
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { serial: fakeSerial },
      });
      transport.checkForWebserialSupport();

      // Track `trackedPort` but do not establish a current connection.
      transport.setSerialPort(trackedPort as unknown as SerialPort);

      // Fire connect for an unrelated port — must not toggle connect.
      const openCallsBefore = otherPort.openCalls.length;
      fakeSerial.fireConnect(otherPort);
      await flushProtocolWork();

      expect(otherPort.openCalls.length).toBe(openCallsBefore);
      expect(transport.isConnectedToModule()).toBe(false);
    });

    it("publishes the device-plugged-in channel when the tracked port reappears", async () => {
      const { channels, ...transport } = await loadTransport();
      const port = new FakeSerialPort();
      const fakeSerial = createFakeNavigatorSerial([port]);
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { serial: fakeSerial },
      });
      transport.checkForWebserialSupport();

      const events: Array<unknown> = [];
      channels.devicePluggedIn.subscribe((detail) => events.push(detail));

      transport.setSerialPort(port as unknown as SerialPort);
      fakeSerial.fireConnect(port);
      await flushProtocolWork();

      expect(events.length).toBeGreaterThan(0);
    });
  });

  // ── Path 3: Saved-port matching across sessions ──────────────────

  describe("saved-port matching across sessions", () => {
    it("auto-connects to the saved port when VID/PID match", async () => {
      const transport = await loadTransport();

      // Pre-populate localStorage with port info, as if a prior session saved it.
      storage.set(
        PERSISTENCE_KEYS.serialPortInfo,
        JSON.stringify({ usbVendorId: 0x1234, usbProductId: 0x5678 })
      );

      const port = new FakeSerialPort({ vendorId: 0x1234, productId: 0x5678 });
      const fakeSerial = createFakeNavigatorSerial([port]);
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { serial: fakeSerial },
      });

      const result = await transport.checkForSavedPortAndMaybeConnect();
      // The saved port should have been returned + connect kicked off.
      expect(result).toBe(port);

      // Drive the post-open boot wait and protocol negotiation.
      await vi.advanceTimersByTimeAsync(3500);
      await flushProtocolWork();

      expect(port.openCalls).toEqual([115200]);
      expect(transport.isConnectedToModule()).toBe(true);
    });

    it("returns null and prompts the user when no saved port matches", async () => {
      const transport = await loadTransport();
      // Saved info points at a different device.
      storage.set(
        PERSISTENCE_KEYS.serialPortInfo,
        JSON.stringify({ usbVendorId: 0xaaaa, usbProductId: 0xbbbb })
      );

      const wrongPort = new FakeSerialPort({ vendorId: 0x1234, productId: 0x5678 });
      const fakeSerial = createFakeNavigatorSerial([wrongPort]);
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { serial: fakeSerial },
      });

      const result = await transport.checkForSavedPortAndMaybeConnect();
      expect(result).toBeNull();
      expect(postMock).toHaveBeenCalledWith(
        expect.stringContaining("Make sure that your uSEQ is switched on")
      );
    });

    it("persists port info on connect so the next session can re-open it", async () => {
      const transport = await loadTransport();
      const port = new FakeSerialPort({ vendorId: 0x4242, productId: 0x9999 });
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { serial: createFakeNavigatorSerial([port]) },
      });

      const connectPromise = transport.connectToSerialPort(port as unknown as SerialPort);
      await advancePastPostOpenBootWait();
      expect(await connectPromise).toBe(true);

      const persisted = storage.get(PERSISTENCE_KEYS.serialPortInfo);
      expect(persisted).toBeDefined();
      const parsed = JSON.parse(persisted!);
      expect(parsed).toEqual({ usbVendorId: 0x4242, usbProductId: 0x9999 });
    });
  });

  // ── Path 4: Bootloader-mode handoff ──────────────────────────────

  describe("bootloader-mode handoff", () => {
    it("opens at 1200 baud, closes immediately, and resolves true on success", async () => {
      const transport = await loadTransport();
      const port = new FakeSerialPort();

      const result = transport.enterBootloaderMode(port as unknown as SerialPort);
      // The 1 s wait inside enterBootloaderMode needs to elapse.
      await vi.advanceTimersByTimeAsync(1000);
      await flushProtocolWork();

      expect(await result).toBe(true);
      expect(port.openCalls).toEqual([1200]);
      expect(port.closeCalls).toBeGreaterThanOrEqual(1);
      // It also posts an informative message.
      expect(postMock).toHaveBeenCalledWith(
        expect.stringContaining("bootloader")
      );
    });

    it("disconnects an already-open port before re-opening at 1200", async () => {
      const transport = await loadTransport();
      const port = new FakeSerialPort();

      // Open as a normal connection first.
      const connectPromise = transport.connectToSerialPort(port as unknown as SerialPort);
      await advancePastPostOpenBootWait();
      expect(await connectPromise).toBe(true);
      expect(port.openCalls).toEqual([115200]);

      // Now request bootloader on the same port. Should disconnect, then re-open at 1200.
      const result = transport.enterBootloaderMode(port as unknown as SerialPort);
      await vi.advanceTimersByTimeAsync(1000);
      await flushProtocolWork();

      expect(await result).toBe(true);
      // 115200 then 1200 — both baud rates appear in order.
      expect(port.openCalls[0]).toBe(115200);
      expect(port.openCalls).toContain(1200);
    });

    it("returns false and posts an error when no port is available", async () => {
      const transport = await loadTransport();

      const result = await transport.enterBootloaderMode(null);

      expect(result).toBe(false);
      expect(postMock).toHaveBeenCalledWith(
        expect.stringContaining("No serial port available"),
        "error"
      );
    });

    it("suppresses the navigator-disconnect notice while triggering bootloader", async () => {
      // The connector tracks `flag_triggeringBootloader` to suppress *only* the
      // navigator.serial 'disconnect' event handler's post. We verify that by
      // letting the explicit `disconnect()` post settle, *then* firing a
      // navigator.serial disconnect event during the 1 s waiting-for-USB sleep
      // and asserting no extra "uSEQ disconnected" post is added during that
      // window.
      const transport = await loadTransport();
      const port = new FakeSerialPort();
      const fakeSerial = createFakeNavigatorSerial([port]);
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { serial: fakeSerial },
      });
      transport.checkForWebserialSupport();

      const connectPromise = transport.connectToSerialPort(port as unknown as SerialPort);
      await advancePastPostOpenBootWait();
      expect(await connectPromise).toBe(true);

      // Kick off bootloader handoff. Internally:
      //   1. disconnect(port) closes the 115200 connection (posts "uSEQ disconnected")
      //   2. open(1200), close()
      //   3. await 1s waiting-for-USB-drive
      // We advance enough timers/microtasks for steps 1-2 to settle, then
      // reset the post mock and fire the navigator.serial disconnect during step 3.
      const bootloaderPromise = transport.enterBootloaderMode(port as unknown as SerialPort);
      await flushProtocolWork();
      // After the post-disconnect settle, postMock has captured the explicit
      // "uSEQ disconnected" — clear it so we observe only what happens next.
      postMock.mockClear();

      // Now while still inside the bootloader's 1 s wait window, fire navigator.serial.disconnect.
      fakeSerial.fireDisconnect(port);
      await flushProtocolWork();
      await vi.advanceTimersByTimeAsync(1000);
      await flushProtocolWork();
      await bootloaderPromise;

      // The navigator.serial disconnect handler must NOT have posted a notice
      // because flag_triggeringBootloader was true while it fired.
      const navDisconnectPosts = postMock.mock.calls.filter(
        (c) => typeof c[0] === "string" && c[0] === "uSEQ disconnected"
      );
      expect(navDisconnectPosts.length).toBe(0);
    });
  });

  // ── Path 5: Hello-on-connect (spec §4.2) ─────────────────────────
  //
  // Per wire-protocol.md §1.1 and §4.2, hello is sent immediately on every
  // port open. There is no firmware-version gate and no legacy text mode.
  // The version reported in the hello response's `fw` field is used only for
  // upgrade checking — it does not affect the protocol path.

  describe("hello-on-connect (spec §4.2)", () => {
    it("sends hello immediately on port open and enters JSON mode", async () => {
      const { channels, ...transport } = await loadTransport();
      const port = new FakeSerialPort();

      const protocolEvents: Array<{ protocolMode: string }> = [];
      channels.protocolReady.subscribe((detail) =>
        protocolEvents.push(detail as { protocolMode: string })
      );

      const connectPromise = transport.connectToSerialPort(port as unknown as SerialPort);
      await advancePastPostOpenBootWait();
      expect(await connectPromise).toBe(true);

      // Hello is always the first request, regardless of firmware version.
      const helloRequests = port.jsonRequests.filter((r) => r.type === "hello");
      expect(helloRequests).toHaveLength(1);
      expect(transport.getProtocolMode()).toBe("json");
      expect(protocolEvents).toContainEqual({ protocolMode: "json" });
    });

    it("hello request carries client=editor and a version string", async () => {
      const transport = await loadTransport();
      const port = new FakeSerialPort();

      const connectPromise = transport.connectToSerialPort(port as unknown as SerialPort);
      await advancePastPostOpenBootWait();
      await connectPromise;

      const hello = port.jsonRequests.find((r) => r.type === "hello");
      expect(hello).toBeDefined();
      expect(hello).toMatchObject({
        type: "hello",
        client: "editor",
        version: expect.any(String),
        requestId: expect.any(String),
      });
    });

    it("sends hello + stream-config after successful handshake", async () => {
      const transport = await loadTransport();
      const port = new FakeSerialPort();

      const connectPromise = transport.connectToSerialPort(port as unknown as SerialPort);
      await advancePastPostOpenBootWait();
      expect(await connectPromise).toBe(true);

      expect(port.jsonRequests.map((r) => r.type)).toEqual([
        "hello",
        "stream-config",
      ]);
      expect(transport.getProtocolMode()).toBe("json");
    });
  });

  // ── Path 6: Post-handshake flow (hello -> stream-config -> eval) ─

  describe("post-handshake flow", () => {
    it("sends an eval request and resolves the promise on response", async () => {
      const transport = await loadTransport();
      const port = new FakeSerialPort();

      const connectPromise = transport.connectToSerialPort(port as unknown as SerialPort);
      await advancePastPostOpenBootWait();
      expect(await connectPromise).toBe(true);
      expect(transport.getProtocolMode()).toBe("json");

      // After handshake the editor can send eval requests.
      const evalPromise = transport.sendTouSEQ("(+ 1 2)");
      await flushProtocolWork();
      const result = await evalPromise;

      expect(result).toMatchObject({ success: true, type: "eval" });
      // Assert wire ordering: hello, stream-config, then eval.
      expect(port.jsonRequests.map((r) => r.type)).toEqual([
        "hello",
        "stream-config",
        "eval",
      ]);
    });

    it("populates the IO config from the hello response", async () => {
      const transport = await loadTransport();
      const port = new FakeSerialPort();

      const connectPromise = transport.connectToSerialPort(port as unknown as SerialPort);
      await advancePastPostOpenBootWait();
      expect(await connectPromise).toBe(true);

      const ioConfig = transport.getIoConfig();
      expect(ioConfig).toBeTruthy();
      expect(ioConfig?.outputs).toEqual([
        { index: 1, name: "time" },
        { index: 2, name: "s1" },
      ]);
      expect(ioConfig?.inputs).toEqual([{ index: 1, name: "ssin1" }]);
    });

    it("sends stream-config with all advertised channels enabled by default", async () => {
      const transport = await loadTransport();
      const port = new FakeSerialPort();

      const connectPromise = transport.connectToSerialPort(port as unknown as SerialPort);
      await advancePastPostOpenBootWait();
      expect(await connectPromise).toBe(true);

      const streamConfig = port.jsonRequests.find(
        (r) => r.type === "stream-config"
      );
      expect(streamConfig).toBeDefined();
      const channels = streamConfig!.channels as Array<Record<string, unknown>>;
      // Should include the input + both outputs from hello.config.
      expect(channels).toHaveLength(3);
      expect(channels.every((c) => c.enabled === true)).toBe(true);
      expect(channels.find((c) => c.name === "time" && c.direction === "output")).toBeTruthy();
      expect(channels.find((c) => c.name === "s1" && c.direction === "output")).toBeTruthy();
      expect(channels.find((c) => c.name === "ssin1" && c.direction === "input")).toBeTruthy();
    });

    it("refuses sendStreamConfig when hello handshake did not complete", async () => {
      // Use suppressHello to prevent the device from replying, so the editor
      // exhausts all retry attempts and never reaches JSON mode.
      const transport = await loadTransport();
      const port = new FakeSerialPort({ suppressHello: true });

      // Don't await connectPromise — the handshake retries take time.
      transport.connectToSerialPort(port as unknown as SerialPort);

      // Advance past a single retry budget but do NOT complete the handshake.
      await vi.advanceTimersByTimeAsync(700);
      await flushProtocolWork();

      await expect(
        transport.sendStreamConfig(
          [{ id: 1, name: "time", direction: "output", enabled: true, maxRateHz: 30 }],
          30
        )
      ).rejects.toThrow(/JSON protocol not active/);
    });
  });

  // ── Connection-failure resilience ────────────────────────────────

  describe("connection failure handling", () => {
    it("reports an error and resolves false when port.open() throws", async () => {
      const transport = await loadTransport();
      const port = new FakeSerialPort({
        failOpenWith: new Error("Permission denied"),
      });

      const result = await transport.connectToSerialPort(port as unknown as SerialPort);
      expect(result).toBe(false);
      expect(transport.isConnectedToModule()).toBe(false);
      expect(postMock).toHaveBeenCalledWith(
        expect.stringContaining("Connection failed"),
        "error"
      );
    });

    it("disconnect tolerates port.close() rejecting", async () => {
      const transport = await loadTransport();
      const port = new FakeSerialPort();

      const connectPromise = transport.connectToSerialPort(port as unknown as SerialPort);
      await advancePastPostOpenBootWait();
      expect(await connectPromise).toBe(true);

      // Make close() reject from this point on.
      (port as any).opts = { failCloseWith: new Error("close failed") };

      await transport.disconnect();
      // Connection state cleared regardless of error.
      expect(transport.isConnectedToModule()).toBe(false);
      // A warning was posted.
      const warnCalls = postMock.mock.calls.filter((c) => c[1] === "warn");
      expect(warnCalls.some((c) => /errors/.test(String(c[0])))).toBe(true);
    });
  });
});
