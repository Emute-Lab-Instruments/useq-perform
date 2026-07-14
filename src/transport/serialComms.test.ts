import { ReadableStream, WritableStream } from "node:stream/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  JSON_META_EVENT,
  PROTOCOL_READY_EVENT,
} from "../contracts/runtimeChannels";

const postMock = vi.fn();
const upgradeCheckMock = vi.fn();
const notifyExternalTimeUpdateMock = vi.fn();
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
  MIN_FIRMWARE_VERSION: { major: 1, minor: 2, patch: 0 },
  meetsMinimumVersion: (v: { major: number; minor: number; patch: number }) => {
    if (v.major !== 1) return v.major > 1;
    if (v.minor !== 2) return v.minor > 2;
    return v.patch >= 0;
  },
}));

vi.mock("../effects/visualisationRuntime.ts", () => ({
  notifyExternalTimeUpdate: notifyExternalTimeUpdateMock,
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

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MESSAGE_START_MARKER = 31;
const STREAM_MESSAGE_TYPE = 0;

/** Encode a JSON message in the bare-JSON format per spec §3.3: `{...}\n`. */
function encodeJsonPacket(payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(JSON.stringify(payload) + "\n");
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

    if (
      requestType === "stream-config" ||
      requestType === "ping" ||
      requestType === "set-failure-mode"
    ) {
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
    notifyExternalTimeUpdateMock.mockReset();
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

  it("proves connect -> hello -> stream-config -> meta/time routing -> disconnect", async () => {
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

    // upgradeCheck is now called with the fw field from the hello response.
    expect(upgradeCheckMock).toHaveBeenCalledWith("1.2.0");
    expect(port.jsonRequests.map((request) => request.type)).toEqual([
      "hello",
      "stream-config",
      "set-failure-mode",
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
    expect(notifyExternalTimeUpdateMock).toHaveBeenCalledWith(12.5);

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

  it("reports error and stays in negotiating state when all hello retries time out", async () => {
    // Under the new spec (§4.2), hello is sent on port-open with 8 attempts
    // at 700 ms each. If none succeed, the editor posts an error and stays
    // in the pre-JSON mode (getProtocolMode returns "legacy" for any non-JSON state).
    const { channels, ...serialComms } = await loadSerialComms();
    const port = new FakeSerialPort();
    port.disableResponses.add("hello");

    const protocolEvents: Array<Record<string, unknown>> = [];
    channels.protocolReady.subscribe((detail) => {
      protocolEvents.push(detail as Record<string, unknown>);
    });

    // Don't await the connect promise yet — the hello retries take 5600 ms.
    const connectPromise = serialComms.connectToSerialPort(
      port as unknown as SerialPort
    );

    // Advance past the full hello retry budget: 8 attempts × 700 ms = 5600 ms.
    await vi.advanceTimersByTimeAsync(6000);
    await flushProtocolWork();

    // Now the connect promise should have resolved.
    expect(await connectPromise).toBe(true);

    expect(serialComms.getProtocolMode()).toBe("legacy");
    expect(protocolEvents.some((e) => e.protocolMode === "legacy")).toBe(true);
    // An error should have been posted to the console.
    expect(postMock).toHaveBeenCalledWith(
      expect.stringContaining("did not respond to hello"),
      "error"
    );

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
      "Heartbeat timeout — connection may be lost. Reconnect if needed.",
      "warn"
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
      "set-failure-mode",
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

    // Send bare-JSON with invalid JSON content (spec §3.3 format, malformed body)
    const badPacket = encoder.encode("{not valid json!!!\n");

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    port.enqueueRaw(badPacket);
    await flushProtocolWork();

    // Should have logged the parse error
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[json-protocol] Failed to parse JSON:",
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

    // Send a blank line — spec §3.3 requires blank lines between messages to be
    // silently skipped. Should not throw or crash the parser.
    const emptyPacket = encoder.encode("\n");

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
