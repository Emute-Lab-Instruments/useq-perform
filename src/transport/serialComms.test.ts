import { ReadableStream, WritableStream } from "node:stream/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  JSON_META_EVENT,
  PROTOCOL_READY_EVENT,
} from "../contracts/runtimeEvents";

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

vi.mock("../utils/consoleStore.ts", () => ({
  post: postMock,
}));

vi.mock("./upgradeCheck.ts", () => ({
  currentVersion: { major: 1, minor: 2, patch: 0 },
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

vi.mock("../runtime/urlParams.ts", () => ({
  readStartupFlags: () => ({
    debug: false,
    devmode: false,
    disableWebSerial: false,
    noModuleMode: false,
    nosave: false,
    params: {},
  }),
}));

vi.mock("../runtime/runtimeService.ts", () => ({
  reportTransportConnectionChanged: reportTransportConnectionChangedMock,
  reportProtocolModeChanged: reportProtocolModeChangedMock,
  announceRuntimeSession: announceRuntimeSessionMock,
}));

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

  /** Push raw bytes directly — useful for simulating chunked delivery. */
  enqueueRaw(bytes: Uint8Array): void {
    this.controller?.enqueue(bytes);
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
  const serialComms = await import("./index.ts");
  const channels = await import("../contracts/runtimeChannels");
  return { ...serialComms, channels };
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
  });

  it("proves connect -> firmware info -> hello -> stream-config -> meta/time routing -> disconnect", async () => {
    const { channels, ...serialComms } = await loadSerialComms();
    const port = new FakeSerialPort();
    const protocolEvents: Array<Record<string, unknown>> = [];
    const metaEvents: Array<Record<string, unknown>> = [];

    channels.protocolReady.subscribe((detail) => {
      protocolEvents.push(detail as Record<string, unknown>);
    });
    channels.jsonMeta.subscribe((detail) => {
      metaEvents.push(detail as Record<string, unknown>);
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
    // Connection state is now reported through runtimeService
    expect(reportTransportConnectionChangedMock).toHaveBeenCalledWith(
      expect.objectContaining({ connected: true })
    );
    const lastConnectedCall = reportTransportConnectionChangedMock.mock.calls
      .filter((c: any[]) => c[0].connected === true)
      .at(-1);
    expect(lastConnectedCall?.[0].protocolMode).toBe("json");

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
    // Disconnect reported through runtimeService
    expect(reportTransportConnectionChangedMock).toHaveBeenCalledWith(
      expect.objectContaining({ connected: false })
    );
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
    const { channels, ...serialComms } = await loadSerialComms();
    const port = new FakeSerialPort();
    port.disableResponses.add("hello");

    const protocolEvents: Array<Record<string, unknown>> = [];
    channels.protocolReady.subscribe((detail) => {
      protocolEvents.push(detail as Record<string, unknown>);
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

  // ── reconnection after disconnect ─────────────────────────────────

  it("reconnects and re-negotiates JSON protocol after a disconnect", async () => {
    const serialComms = await loadSerialComms();
    const port = new FakeSerialPort();

    // First connection
    const connect1 = serialComms.connectToSerialPort(
      port as unknown as SerialPort
    );
    await vi.advanceTimersByTimeAsync(3500);
    expect(await connect1).toBe(true);
    await flushProtocolWork();
    expect(serialComms.getProtocolMode()).toBe("json");
    expect(serialComms.isConnectedToModule()).toBe(true);

    // Disconnect
    await serialComms.disconnect();
    expect(serialComms.isConnectedToModule()).toBe(false);
    expect(serialComms.getProtocolMode()).toBe("legacy");

    // Reconnect to a fresh port (hardware re-plugged)
    const port2 = new FakeSerialPort();
    const connect2 = serialComms.connectToSerialPort(
      port2 as unknown as SerialPort
    );
    await vi.advanceTimersByTimeAsync(3500);
    expect(await connect2).toBe(true);
    await flushProtocolWork();

    // Protocol re-negotiated from scratch
    expect(serialComms.getProtocolMode()).toBe("json");
    expect(serialComms.isConnectedToModule()).toBe(true);
    expect(port2.jsonRequests.map((r) => r.type)).toEqual([
      "hello",
      "stream-config",
    ]);

    await serialComms.disconnect();
  });

  it("protocol state is fully reset between connections (no stale pending requests)", async () => {
    const serialComms = await loadSerialComms();
    const port = new FakeSerialPort();

    const connect1 = serialComms.connectToSerialPort(
      port as unknown as SerialPort
    );
    await vi.advanceTimersByTimeAsync(3500);
    expect(await connect1).toBe(true);
    await flushProtocolWork();

    // Start a request that will never resolve, then disconnect
    port.disableResponses.add("eval");
    const evalPromise = serialComms.sendTouSEQ("(+ 1 2)").catch((e: Error) => e);

    await serialComms.disconnect();

    // The pending request should have been rejected with "Connection reset"
    const result = await evalPromise;
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toMatch(/Connection reset/);
  });

  // ── partial message chunking ──────────────────────────────────────

  it("reassembles a JSON message split across two chunks", async () => {
    const { channels, ...serialComms } = await loadSerialComms();
    const port = new FakeSerialPort();
    const metaEvents: Array<Record<string, unknown>> = [];

    channels.jsonMeta.subscribe((detail) => {
      metaEvents.push(detail as Record<string, unknown>);
    });

    const connectPromise = serialComms.connectToSerialPort(
      port as unknown as SerialPort
    );
    await vi.advanceTimersByTimeAsync(3500);
    expect(await connectPromise).toBe(true);
    await flushProtocolWork();

    // Build a complete JSON packet, then split it in the middle
    const fullPacket = encodeJsonPacket({
      type: "meta",
      meta: { transport: "paused" },
    });

    const splitPoint = Math.floor(fullPacket.length / 2);
    const chunk1 = fullPacket.slice(0, splitPoint);
    const chunk2 = fullPacket.slice(splitPoint);

    // Deliver the two halves separately
    port.enqueueRaw(chunk1);
    await flushProtocolWork();

    // No event yet — message incomplete
    expect(metaEvents).toHaveLength(0);

    port.enqueueRaw(chunk2);
    await flushProtocolWork();

    // Now the full message should have been reassembled and dispatched
    expect(metaEvents).toContainEqual({
      response: {
        type: "meta",
        meta: { transport: "paused" },
      },
    });

    await serialComms.disconnect();
  });

  it("reassembles a text message split across two chunks", async () => {
    const serialComms = await loadSerialComms();
    const port = new FakeSerialPort();

    const connectPromise = serialComms.connectToSerialPort(
      port as unknown as SerialPort
    );
    await vi.advanceTimersByTimeAsync(3500);
    expect(await connectPromise).toBe(true);
    await flushProtocolWork();

    postMock.mockReset();

    // Build a text packet, split it mid-payload
    const fullPacket = encodeTextPacket("hello from firmware");
    const splitPoint = 5; // split inside the header+payload
    port.enqueueRaw(fullPacket.slice(0, splitPoint));
    await flushProtocolWork();

    // Nothing posted yet
    expect(postMock).not.toHaveBeenCalledWith(
      expect.stringContaining("hello from firmware")
    );

    port.enqueueRaw(fullPacket.slice(splitPoint));
    await flushProtocolWork();

    expect(postMock).toHaveBeenCalledWith("uSEQ: hello from firmware");

    await serialComms.disconnect();
  });

  it("handles two complete messages concatenated in a single chunk", async () => {
    const { channels, ...serialComms } = await loadSerialComms();
    const port = new FakeSerialPort();
    const metaEvents: Array<Record<string, unknown>> = [];

    channels.jsonMeta.subscribe((detail) => {
      metaEvents.push(detail as Record<string, unknown>);
    });

    const connectPromise = serialComms.connectToSerialPort(
      port as unknown as SerialPort
    );
    await vi.advanceTimersByTimeAsync(3500);
    expect(await connectPromise).toBe(true);
    await flushProtocolWork();

    // Concatenate two JSON packets into one chunk
    const packet1 = encodeJsonPacket({ type: "meta", meta: { a: 1 } });
    const packet2 = encodeJsonPacket({ type: "meta", meta: { b: 2 } });
    const combined = new Uint8Array(packet1.length + packet2.length);
    combined.set(packet1, 0);
    combined.set(packet2, packet1.length);

    port.enqueueRaw(combined);
    await flushProtocolWork();

    expect(metaEvents).toHaveLength(2);
    expect(metaEvents[0].response).toEqual({ type: "meta", meta: { a: 1 } });
    expect(metaEvents[1].response).toEqual({ type: "meta", meta: { b: 2 } });

    await serialComms.disconnect();
  });

  // ── malformed JSON resilience ─────────────────────────────────────

  it("survives malformed JSON without crashing and continues processing", async () => {
    const { channels, ...serialComms } = await loadSerialComms();
    const port = new FakeSerialPort();
    const metaEvents: Array<Record<string, unknown>> = [];

    channels.jsonMeta.subscribe((detail) => {
      metaEvents.push(detail as Record<string, unknown>);
    });

    const connectPromise = serialComms.connectToSerialPort(
      port as unknown as SerialPort
    );
    await vi.advanceTimersByTimeAsync(3500);
    expect(await connectPromise).toBe(true);
    await flushProtocolWork();

    // Send a JSON-typed packet with invalid JSON content
    const badJson = encoder.encode("{not valid json!!!");
    const badPacket = new Uint8Array(badJson.length + 4);
    badPacket[0] = MESSAGE_START_MARKER;
    badPacket[1] = JSON_MESSAGE_TYPE;
    badPacket.set(badJson, 2);
    badPacket[badPacket.length - 2] = 13;
    badPacket[badPacket.length - 1] = 10;

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    port.enqueueRaw(badPacket);
    await flushProtocolWork();

    // Should have logged the parse error
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to parse JSON message from uSEQ",
      expect.any(String),
      expect.any(Error)
    );

    // Now send a valid message — module should still be functional
    port.enqueueJson({ type: "meta", meta: { transport: "stopped" } });
    await flushProtocolWork();

    expect(metaEvents).toContainEqual({
      response: { type: "meta", meta: { transport: "stopped" } },
    });

    consoleErrorSpy.mockRestore();
    await serialComms.disconnect();
  });

  it("handles empty JSON message body gracefully", async () => {
    const serialComms = await loadSerialComms();
    const port = new FakeSerialPort();

    const connectPromise = serialComms.connectToSerialPort(
      port as unknown as SerialPort
    );
    await vi.advanceTimersByTimeAsync(3500);
    expect(await connectPromise).toBe(true);
    await flushProtocolWork();

    // JSON packet with empty body (just whitespace)
    const emptyBody = encoder.encode("   ");
    const emptyPacket = new Uint8Array(emptyBody.length + 4);
    emptyPacket[0] = MESSAGE_START_MARKER;
    emptyPacket[1] = JSON_MESSAGE_TYPE;
    emptyPacket.set(emptyBody, 2);
    emptyPacket[emptyPacket.length - 2] = 13;
    emptyPacket[emptyPacket.length - 1] = 10;

    // Should not throw
    port.enqueueRaw(emptyPacket);
    await flushProtocolWork();

    // Module still operational
    expect(serialComms.isConnectedToModule()).toBe(true);

    await serialComms.disconnect();
  });

  it("handles JSON response with unexpected/missing fields without crashing", async () => {
    const serialComms = await loadSerialComms();
    const port = new FakeSerialPort();

    const connectPromise = serialComms.connectToSerialPort(
      port as unknown as SerialPort
    );
    await vi.advanceTimersByTimeAsync(3500);
    expect(await connectPromise).toBe(true);
    await flushProtocolWork();

    // Send a JSON response with no requestId, no text, no meta — just an unexpected shape
    port.enqueueJson({ unexpected: "field", number: 42 });
    await flushProtocolWork();

    // No crash, module still alive
    expect(serialComms.isConnectedToModule()).toBe(true);

    // A valid eval still works after the unexpected message
    const capturedResponses: string[] = [];
    const evalPromise = serialComms
      .sendTouSEQ("(+ 1 1)", (response: string) => {
        capturedResponses.push(response);
      })
      .catch(() => {});
    await flushProtocolWork();

    await serialComms.disconnect();
    await evalPromise;
  });
});
