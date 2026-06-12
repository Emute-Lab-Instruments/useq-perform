/**
 * Wire Protocol Contract Tests — editor side.
 *
 * These tests encode the contract defined in
 *   src-useq/docs/specs/wire-protocol.md
 *
 * Most tests are now active and assert real behaviour. A test may still be
 * skipped (`it.skip`) when it represents editor-side work the implementation
 * hasn't done yet. Implementing agents:
 *   1. Pick the bd issue for this delta (search "wire-protocol" labels).
 *   2. Remove `.skip` from the relevant test (or replace with `it`).
 *   3. Implement until the test passes.
 *   4. Land the change.
 *
 * The cross-references in each test's title point to the spec section
 * that the test covers. Read the spec before implementing.
 *
 * The test harness is intentionally lightweight: a FakeSerialPort that
 * speaks the *new* spec (no legacy text mode, no 0x65 prefix on JSON,
 * etc.). When the editor matches the spec, these tests pass.
 */

import { ReadableStream, WritableStream } from "node:stream/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Minimal mock surface (mirrors serialComms.test.ts) ───────────────────

const postMock = vi.fn();

vi.mock("../utils/consoleStore.ts", () => ({
  post: postMock,
}));

vi.mock("./upgradeCheck.ts", () => ({
  // Pre-populated as if the editor already knows the device is JSON-eligible.
  // The new spec drops the version-text-probe path, so this should not be
  // populated by a probe — it should be set from the hello response.
  currentVersion: null,
  upgradeCheck: vi.fn(),
}));

vi.mock("../effects/visualisationRuntime.ts", () => ({
  notifyExternalTimeUpdate: vi.fn(),
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
  reportTransportConnectionChanged: vi.fn(() => ({
    connected: false,
    protocolMode: "json",
    session: {
      hasHardwareConnection: false,
      noModuleMode: false,
      wasmEnabled: true,
      connectionMode: "none",
      transportMode: "none",
    },
  })),
  reportProtocolModeChanged: vi.fn(),
  announceRuntimeSession: vi.fn(),
}));

// ── Spec-compliant fake device ──────────────────────────────────────────
//
// This fake device speaks the NEW spec, not the current implementation.
// It accepts bare JSON `{...}\n` editor → device, and emits bare JSON
// `{...}\n` device → editor (no 0x1F/0x65 prefix). It emits binary stream
// frames with 11-byte layout for outputs.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class SpecCompliantFakeDevice {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  readonly writes: Uint8Array[] = [];
  readonly jsonRequests: Array<Record<string, unknown>> = [];
  /** When true, the device defers replying to the next hello so the editor must retry. */
  defersFirstHello = false;
  private firstHelloSeen = false;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  async open(_options: { baudRate: number }): Promise<void> {
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => { this.controller = controller; },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: async (chunk) => { this.handleWrite(chunk); },
    });
  }

  async close(): Promise<void> {
    try { this.controller?.close(); } catch { /* ignore */ }
    this.controller = null;
    this.readable = null;
    this.writable = null;
  }

  getInfo(): Record<string, number> {
    return { usbVendorId: 0x1234, usbProductId: 0x5678 };
  }

  /** Push a JSON message to the editor as a bare `{...}\n` frame (no 0x1F prefix). */
  pushJson(payload: Record<string, unknown>): void {
    const text = JSON.stringify(payload) + "\n";
    this.controller?.enqueue(encoder.encode(text));
  }

  /** Push a binary stream frame (11 bytes, [0x1F][0x00][channel][f64-LE]). */
  pushStreamFrame(channel: number, value: number): void {
    const packet = new Uint8Array(11);
    packet[0] = 0x1f;
    packet[1] = 0x00;
    packet[2] = channel;
    new DataView(packet.buffer).setFloat64(3, value, true);
    this.controller?.enqueue(packet);
  }

  /** Push the unsolicited boot ready frame (spec §5.5). */
  pushReady(version = "1.2.0"): void {
    this.pushJson({ type: "ready", version });
  }

  private handleWrite(chunk: Uint8Array): void {
    this.writes.push(chunk);

    // Spec §3.3: editor → device JSON is bare `{...}\n` (no 0x1F prefix).
    // The first byte should be `{` (ASCII 0x7b), not 0x1f.
    const firstByte = chunk[0];
    if (firstByte !== 0x7b) {
      // Implementation hasn't migrated yet; record but don't reply so the
      // test surfaces the violation explicitly via `writes[0][0]`.
      return;
    }

    let request: Record<string, unknown>;
    try {
      request = JSON.parse(decoder.decode(chunk).trim());
    } catch {
      return;
    }
    this.jsonRequests.push(request);

    const reqType = String(request.type ?? "");
    const requestId = request.requestId;

    if (reqType === "hello") {
      if (this.defersFirstHello && !this.firstHelloSeen) {
        this.firstHelloSeen = true;
        // Don't reply. The editor should retry on its own (or on a `ready`
        // frame the test pushes manually).
        return;
      }
      // Spec §5.2 hello response shape.
      setTimeout(() =>
        this.pushJson({
          type: "response",
          requestId,
          success: true,
          mode: "json",
          fw: "1.2.0",
          config: {
            inputs: [{ index: 1, name: "ssin1" }],
            outputs: [
              { index: 1, name: "time" },
              { index: 2, name: "s1" },
            ],
          },
        }),
      0);
      return;
    }

    if (reqType === "stream-config" || reqType === "ping") {
      setTimeout(() =>
        this.pushJson({ type: "response", requestId, success: true }),
      0);
      return;
    }

    if (reqType === "eval") {
      // Spec §5.7 eval response — text + console + diagnostics + meta.
      setTimeout(() =>
        this.pushJson({
          type: "response",
          requestId,
          success: true,
          text: "ok",
          console: "",
          diagnostics: [],
          meta: null,
        }),
      0);
      return;
    }

    if (reqType === "set-live-inputs") {
      // Spec §5.8 — fire-and-forget if requestId absent; ack with applied count if present.
      if (requestId) {
        setTimeout(() =>
          this.pushJson({ type: "response", requestId, success: true, applied: 1 }),
        0);
      }
      return;
    }
  }
}

async function loadTransport() {
  vi.resetModules();
  return await import("./index.ts");
}

async function flush(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await vi.advanceTimersByTimeAsync(10);
    await Promise.resolve();
  }
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("wire protocol contract — editor side", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => { storage.set(k, String(v)); },
        removeItem: (k: string) => { storage.delete(k); },
        clear: () => storage.clear(),
      },
    });
    postMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // §4.2 — Editor sends hello immediately on port open.
  // Replaces the legacy text probe `@(useq-report-firmware-info)`.
  it("T1 [§4.2] sends hello on port-open, no text probe", async () => {
    const transport = await loadTransport();
    const port = new SpecCompliantFakeDevice();

    await transport.connectToSerialPort(port as unknown as SerialPort);
    await flush();

    expect(port.writes.length).toBeGreaterThan(0);
    const firstWrite = decoder.decode(port.writes[0]);

    // Must NOT be the legacy text probe.
    expect(firstWrite).not.toContain("useq-report-firmware-info");

    // Must be a hello JSON request.
    const firstReq = port.jsonRequests[0];
    expect(firstReq?.type).toBe("hello");
    expect(firstReq).toMatchObject({
      type: "hello",
      client: "editor",
      version: expect.any(String),
      requestId: expect.any(String),
    });
  });

  // §4.2 — Editor retries hello when it sees an unsolicited `ready`.
  // Covers the boot-race scenario where the editor's first hello arrives
  // before the device's tick loop is up.
  it("T2 [§4.2] re-sends hello on receiving unsolicited ready", async () => {
    const transport = await loadTransport();
    const port = new SpecCompliantFakeDevice();
    port.defersFirstHello = true;

    const connectPromise = transport.connectToSerialPort(port as unknown as SerialPort);
    await flush(); // Editor sends first hello; device defers reply.

    expect(port.jsonRequests.filter((r) => r.type === "hello").length).toBe(1);

    // Device finishes booting and sends ready.
    port.pushReady("1.2.0");
    await flush();

    // Editor should have re-sent hello; device replies on the second one.
    const helloCount = port.jsonRequests.filter((r) => r.type === "hello").length;
    expect(helloCount).toBeGreaterThanOrEqual(2);

    await connectPromise;
  });

  // §3.3 — Editor accepts bare `{...}\n` JSON without 0x1F/0x65 prefix.
  // The fake device only emits bare JSON (the new spec); the editor must
  // dispatch eval responses correctly without the legacy prefix.
  it("T3 [§3.3] accepts bare JSON without 0x65 prefix", async () => {
    const transport = await loadTransport();
    const port = new SpecCompliantFakeDevice();
    await transport.connectToSerialPort(port as unknown as SerialPort);
    await flush();

    // Send an eval; the device replies with a bare JSON response.
    // Note: with fake timers we must start the eval, advance the clock to let
    // the device's setTimeout(0) fire the response, then await the result.
    const resultPromise = transport.sendTouSEQ("(a1 0.5)");
    await flush();
    const result = await resultPromise;

    expect(result).toMatchObject({ success: true, text: "ok" });
  });

  // §5.6 — Unsolicited {type:"log",level,text} envelopes are routed to console.
  // Replaces the legacy framed TEXT (0x20) and MSG_TO_EDITOR (0x64) types.
  it("T4 [§5.6] handles {type:\"log\",level,text} envelope", async () => {
    const transport = await loadTransport();
    const port = new SpecCompliantFakeDevice();
    await transport.connectToSerialPort(port as unknown as SerialPort);
    await flush();

    port.pushJson({ type: "log", level: "info", text: "Hello from uSEQ" });
    await flush();

    // Editor's console post should have received the message.
    const calls = postMock.mock.calls.flat();
    expect(calls.some((c) => typeof c === "string" && c.includes("Hello from uSEQ"))).toBe(true);
  });

  // §5.9 — Standalone {type:"diagnostics",diagnostics:[...]} frames are dispatched.
  // The editor should route these to the diagnostics handler the same way
  // it routes diagnostics embedded in eval responses.
  it("T5 [§5.9] handles standalone diagnostics frames", async () => {
    const transport = await loadTransport();
    // Import the channel from the SAME (reset) module graph as the transport
    // so we observe the instance json-protocol.ts publishes to.
    const { standaloneDiagnostics } = await import(
      "../contracts/runtimeChannels.ts"
    );
    const received: Array<{ diagnostics: unknown[] }> = [];
    const unsub = standaloneDiagnostics.subscribe((d: { diagnostics: unknown[] }) =>
      received.push(d),
    );

    const port = new SpecCompliantFakeDevice();
    await transport.connectToSerialPort(port as unknown as SerialPort);
    await flush();

    port.pushJson({
      type: "diagnostics",
      diagnostics: [
        {
          severity: "warning",
          category: "live-edit",
          start: 0,
          end: 0,
          message: "slot 'knob1' received non-finite value, retaining previous",
        },
      ],
    });
    await flush();
    unsub();

    // The §5.9 frame must be dispatched on the standaloneDiagnostics channel
    // exactly once, carrying the device-supplied diagnostics array verbatim.
    expect(received.length).toBe(1);
    expect(received[0].diagnostics).toHaveLength(1);
    expect((received[0].diagnostics[0] as { message: string }).message).toContain(
      "knob1",
    );
  });

  // §5.7 — Editor parses `diagnostics` field from eval responses.
  // Currently the editor reads diagnostics ONLY from WASM exports
  // (src/runtime/wasmInterpreter.ts). For hardware mode it must also
  // parse them out of the JsonResponse and route them to inline annotations.
  it("T6 [§5.7] parses embedded diagnostics from eval responses", async () => {
    const transport = await loadTransport();
    const port = new SpecCompliantFakeDevice();

    // Override the eval handler to embed a non-empty diagnostics array.
    const originalHandle = (port as any).handleWrite.bind(port);
    (port as any).handleWrite = (chunk: Uint8Array) => {
      const text = decoder.decode(chunk);
      if (text.startsWith("{") && text.includes('"type":"eval"')) {
        const req = JSON.parse(text.trim());
        setTimeout(() =>
          port.pushJson({
            type: "response",
            requestId: req.requestId,
            success: false,
            text: "",
            console: "",
            diagnostics: [
              {
                severity: "error",
                category: "unbound",
                start: 7,
                end: 11,
                message: "unknown name 'nope'",
                suggestion: "did you mean 'note'?",
              },
            ],
            meta: null,
          }),
        0);
        return;
      }
      originalHandle(chunk);
    };

    await transport.connectToSerialPort(port as unknown as SerialPort);
    await flush();

    // Note: with fake timers we must start the eval, advance the clock to let
    // the device's setTimeout(0) fire the response, then await the result.
    const resultPromise = transport.sendTouSEQ("(a1 nope)") as Promise<{
      success: boolean;
      diagnostics?: unknown[];
    }>;
    await flush();
    const result = await resultPromise;

    expect(result).toMatchObject({ success: false });
    expect(Array.isArray(result.diagnostics)).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    // Implementer must also wire the diagnostics into the editor's inline
    // annotation pipeline (src/editors/extensions/diagnostics.ts) for the
    // hardware path, mirroring how WASM diagnostics already flow.
  });

  // §5.7 — Editor's JsonEvalRequest does NOT include `exec`.
  // firmware.md §6.2 removed queued/immediate-on-wire; the editor's typed
  // request shape must follow.
  it("T7 [§5.7] eval request omits exec field", async () => {
    const transport = await loadTransport();
    const port = new SpecCompliantFakeDevice();
    await transport.connectToSerialPort(port as unknown as SerialPort);
    await flush();

    // Note: with fake timers we must start the eval, advance the clock to let
    // the device's setTimeout(0) fire the response, then await the result.
    const evalPromise = transport.sendTouSEQ("(a1 0.5)");
    await flush();
    await evalPromise;

    const evalReq = port.jsonRequests.find((r) => r.type === "eval");
    expect(evalReq).toBeDefined();
    expect(evalReq).not.toHaveProperty("exec");
  });

  // §5.8 — set-live-inputs request shape.
  // Editor must expose an API that emits exactly this shape.
  it("T8 [§5.8] set-live-inputs request shape", async () => {
    const transport = await loadTransport();
    const port = new SpecCompliantFakeDevice();
    await transport.connectToSerialPort(port as unknown as SerialPort);
    await flush();

    // The editor should expose a sendSetLiveInputs (or similar) entry point
    // that builds a `{type:"set-live-inputs", slots:{...}}` request.
    // This call is illustrative — the exact name lives with the implementer.
    const sendSetLiveInputs = (transport as unknown as {
      sendSetLiveInputs?: (slots: Record<string, number | boolean | string>) => Promise<unknown>;
    }).sendSetLiveInputs;
    expect(sendSetLiveInputs).toBeDefined();

    if (!sendSetLiveInputs) return;

    await sendSetLiveInputs({ knob1: 0.5, toggle1: true, mode1: "forward" });
    await flush();

    const req = port.jsonRequests.find((r) => r.type === "set-live-inputs");
    expect(req).toBeDefined();
    expect(req).toMatchObject({
      type: "set-live-inputs",
      slots: { knob1: 0.5, toggle1: true, mode1: "forward" },
    });
  });
});
