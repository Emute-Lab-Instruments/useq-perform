import { ReadableStream, WritableStream } from "node:stream/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONNECTION_CHANGED_EVENT,
  JSON_META_EVENT,
  PROTOCOL_READY_EVENT,
} from "../../contracts/runtimeEvents";

const postMock = vi.fn();
const upgradeCheckMock = vi.fn();
const handleExternalTimeUpdateMock = vi.fn(() => Promise.resolve());
const publishRuntimeDiagnosticsMock = vi.fn();

vi.mock("../../utils/consoleStore.ts", () => ({
  post: postMock,
}));

vi.mock("../utils/upgradeCheck.ts", () => ({
  currentVersion: { major: 1, minor: 2, patch: 0 },
  upgradeCheck: upgradeCheckMock,
}));

vi.mock("../ui/serialVis/visualisationController.ts", () => ({
  handleExternalTimeUpdate: handleExternalTimeUpdateMock,
}));

vi.mock("../utils/persistentUserSettings.ts", () => ({
  activeUserSettings: {
    runtime: { autoReconnect: true },
    wasm: { enabled: true },
  },
}));

vi.mock("../urlParams.ts", () => ({
  readStartupFlags: () => ({
    debug: false,
    devmode: false,
    disableWebSerial: false,
    noModuleMode: false,
    nosave: false,
    params: {},
  }),
}));

vi.mock("../../runtime/runtimeDiagnostics.ts", async () => {
  const actual = await vi.importActual<typeof import("../../runtime/runtimeDiagnostics.ts")>(
    "../../runtime/runtimeDiagnostics.ts"
  );

  return {
    ...actual,
    publishRuntimeDiagnostics: publishRuntimeDiagnosticsMock,
  };
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MESSAGE_START_MARKER = 31;
const JSON_MESSAGE_TYPE = 101;
const TEXT_MESSAGE_TYPE = 1;
const STREAM_MESSAGE_TYPE = 0;

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

function encodeStreamPacket(channel: number, value: number): Uint8Array {
  const packet = new Uint8Array(11);
  packet[0] = MESSAGE_START_MARKER;
  packet[1] = STREAM_MESSAGE_TYPE;
  packet[2] = channel;
  new DataView(packet.buffer).setFloat64(3, value, true);
  return packet;
}

class FakeSerialPort {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  readonly writes: string[] = [];
  readonly jsonRequests: Array<Record<string, unknown>> = [];
  readonly openCalls: number[] = [];
  closeCalls = 0;
  disableResponses = new Set<string>();
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  async open(options: { baudRate: number }): Promise<void> {
    this.openCalls.push(options.baudRate);
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
    try {
      this.controller?.close();
    } catch (_error) {
      // ignore duplicate close from reader cancellation during disconnect
    }
    this.controller = null;
    this.readable = null;
    this.writable = null;
  }

  getInfo(): Record<string, number> {
    return {
      usbVendorId: 0x1234,
      usbProductId: 0x5678,
    };
  }

  enqueueText(text: string): void {
    this.controller?.enqueue(encodeTextPacket(text));
  }

  enqueueJson(payload: Record<string, unknown>): void {
    this.controller?.enqueue(encodeJsonPacket(payload));
  }

  enqueueStream(channel: number, value: number): void {
    this.controller?.enqueue(encodeStreamPacket(channel, value));
  }

  private handleWrite(chunk: Uint8Array): void {
    const text = decoder.decode(chunk);
    this.writes.push(text);

    if (text === "@(useq-report-firmware-info)") {
      setTimeout(() => this.enqueueText("uSEQ Firmware 1.2.0"), 0);
      return;
    }

    if (!text.endsWith("\n")) {
      return;
    }

    const request = JSON.parse(text) as Record<string, unknown>;
    this.jsonRequests.push(request);

    const requestType = String(request.type ?? "eval");
    if (this.disableResponses.has(requestType)) {
      return;
    }

    if (requestType === "hello") {
      setTimeout(() =>
        this.enqueueJson({
          requestId: request.requestId,
          success: true,
          type: "hello",
          mode: "json",
          fw: "1.2.0",
          config: {
            inputs: [{ index: 1, name: "ssin1" }],
            outputs: [
              { index: 1, name: "time" },
              { index: 2, name: "s1" },
            ],
          },
        })
      , 0);
      return;
    }

    if (requestType === "stream-config" || requestType === "ping") {
      setTimeout(() =>
        this.enqueueJson({
          requestId: request.requestId,
          success: true,
          type: requestType,
        })
      , 0);
    }
  }
}

async function loadSerialComms() {
  vi.resetModules();
  return import("./serialComms.ts");
}

async function flushProtocolWork(): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
  }
}

describe("serialComms fake host harness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const storage = new Map<string, string>();
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
    publishRuntimeDiagnosticsMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("proves connect -> firmware info -> hello -> stream-config -> meta/time routing -> disconnect", async () => {
    const serialComms = await loadSerialComms();
    const port = new FakeSerialPort();
    const connectionEvents: Array<Record<string, unknown>> = [];
    const protocolEvents: Array<Record<string, unknown>> = [];
    const metaEvents: Array<Record<string, unknown>> = [];

    window.addEventListener(CONNECTION_CHANGED_EVENT, (event) => {
      connectionEvents.push((event as CustomEvent<Record<string, unknown>>).detail);
    });
    window.addEventListener(PROTOCOL_READY_EVENT, (event) => {
      protocolEvents.push((event as CustomEvent<Record<string, unknown>>).detail);
    });
    window.addEventListener(JSON_META_EVENT, (event) => {
      metaEvents.push((event as CustomEvent<Record<string, unknown>>).detail);
    });

    const connectPromise = serialComms.connectToSerialPort(
      port as unknown as SerialPort
    );

    await vi.advanceTimersByTimeAsync(3500);
    expect(await connectPromise).toBe(true);
    await flushProtocolWork();

    expect(upgradeCheckMock).toHaveBeenCalledWith("uSEQ Firmware 1.2.0");
    expect(port.jsonRequests.map((request) => request.type)).toEqual([
      "hello",
      "stream-config",
    ]);
    expect(serialComms.getProtocolMode()).toBe("json");
    expect(protocolEvents).toContainEqual({ protocolMode: "json" });
    expect(connectionEvents.some((event) => event.connected === true)).toBe(true);
    expect(connectionEvents.at(-1)?.protocolMode).toBe("json");

    port.enqueueJson({
      type: "meta",
      meta: { transport: "playing" },
    });
    port.enqueueStream(1, 12.5);
    await flushProtocolWork();

    expect(metaEvents).toContainEqual({
      response: {
        type: "meta",
        meta: { transport: "playing" },
      },
    });
    expect(handleExternalTimeUpdateMock).toHaveBeenCalledWith(12.5);

    await serialComms.disconnect();

    expect(serialComms.isConnectedToModule()).toBe(false);
    expect(port.closeCalls).toBe(1);
    expect(connectionEvents.at(-1)?.connected).toBe(false);
  });

  it("surfaces request timeouts on the fake serial harness", async () => {
    const serialComms = await loadSerialComms();
    const port = new FakeSerialPort();

    const connectPromise = serialComms.connectToSerialPort(
      port as unknown as SerialPort
    );

    await vi.advanceTimersByTimeAsync(3500);
    expect(await connectPromise).toBe(true);
    await flushProtocolWork();

    port.disableResponses.add("stream-config");

    let requestError: unknown = null;
    serialComms.sendStreamConfig(
      [{ id: 1, name: "time", direction: "output", enabled: true, maxRateHz: 30 }],
      30
    ).catch((error) => {
      requestError = error;
      return null;
    });

    await vi.advanceTimersByTimeAsync(5000);
    await Promise.resolve();

    expect(requestError).toBeInstanceOf(Error);
    expect((requestError as Error).message).toMatch(/timed out/);

    await serialComms.disconnect();
  });

  it("falls back to legacy mode when hello negotiation times out", async () => {
    const serialComms = await loadSerialComms();
    const port = new FakeSerialPort();
    port.disableResponses.add("hello");

    const protocolEvents: Array<Record<string, unknown>> = [];
    window.addEventListener(PROTOCOL_READY_EVENT, (event) => {
      protocolEvents.push((event as CustomEvent<Record<string, unknown>>).detail);
    });

    const connectPromise = serialComms.connectToSerialPort(
      port as unknown as SerialPort
    );

    // Boot wait (3500 ms fixed delay before firmware-info probe)
    await vi.advanceTimersByTimeAsync(3500);
    expect(await connectPromise).toBe(true);
    // Flush: processes firmware-info text response, sends hello (no response)
    await flushProtocolWork();

    // Hello has a 5000 ms timeout; advance past it so the request rejects
    await vi.advanceTimersByTimeAsync(5000);
    await flushProtocolWork();

    expect(serialComms.getProtocolMode()).toBe("legacy");
    expect(postMock).toHaveBeenCalledWith(
      "**Warning**: Unable to switch to JSON protocol, staying in legacy mode."
    );
    expect(protocolEvents.some((e) => e.protocolMode === "legacy")).toBe(true);

    await serialComms.disconnect();
  });

  it("heartbeat failure posts a warning and stops the heartbeat", async () => {
    const serialComms = await loadSerialComms();
    const port = new FakeSerialPort();

    const connectPromise = serialComms.connectToSerialPort(
      port as unknown as SerialPort
    );
    await vi.advanceTimersByTimeAsync(3500);
    expect(await connectPromise).toBe(true);
    await flushProtocolWork();
    expect(serialComms.getProtocolMode()).toBe("json");

    // Suppress heartbeat (ping) responses so the request times out
    port.disableResponses.add("ping");

    // Advance to heartbeat interval (60 s), let the ping be written
    await vi.advanceTimersByTimeAsync(60000);
    await flushProtocolWork();
    // Advance past heartbeat timeout (10 s) to trigger the rejection
    await vi.advanceTimersByTimeAsync(10000);
    await flushProtocolWork();

    expect(postMock).toHaveBeenCalledWith(
      "**Warning**: Heartbeat timeout - connection may be lost. Reconnect if needed."
    );

    // Heartbeat stopped: no further pings after another full interval
    const pingCountBefore = port.jsonRequests.filter((r) => r.type === "ping").length;
    await vi.advanceTimersByTimeAsync(60000 + 10000);
    await flushProtocolWork();
    expect(port.jsonRequests.filter((r) => r.type === "ping").length).toBe(pingCountBefore);

    await serialComms.disconnect();
  });
});
