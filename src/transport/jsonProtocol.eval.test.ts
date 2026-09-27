/**
 * Focused regression tests for the JSON eval request lifecycle.
 *
 * Covers errata cluster "serial":
 * - eval-r-no-serial-timeout / overview-r-hw-eval-timeout /
 *   wire-r-eval-no-timeout: a JSON eval used to have NO response timeout, so
 *   a connected-but-silent device left the request in `pendingRequests`
 *   forever (blocking the runtime Promise.all fan-out and every heartbeat
 *   tick until disconnect). sendJsonEval now applies EVAL_TIMEOUT_MS.
 * - wire-r-eval-oversize: a request line longer than the device's 2048-byte
 *   RX ring is dropped by the firmware with an unsolicited log that carries
 *   no requestId; the editor now rejects it locally instead.
 * - eval-r-negotiating-drop: an eval issued while the protocol handshake is
 *   still in progress is rejected AND surfaced on the console instead of
 *   vanishing silently.
 * - eval-r-legacy-success (case 2): sendTouSEQ with no writable port
 *   resolves an explicit { success: false } envelope, never `undefined`.
 * - wire-r-manual-bypass: set-live-inputs / binary INPUT_SET senders gate on
 *   the JSON protocol being active, so raw bytes can never reach legacy
 *   firmware's ModuLisp interpreter.
 */

import { WritableStream } from "node:stream/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EVAL_TIMEOUT_MS, MAX_REQUEST_LINE_BYTES } from "./types.ts";

// ── Mocks (mirror serialLifecycle.test.ts) ───────────────────────────

const postMock = vi.fn();
const upgradeCheckMock = vi.fn();

vi.mock("../utils/consoleStore.ts", () => ({
  post: postMock,
}));

vi.mock("./upgradeCheck.ts", () => ({
  upgradeCheck: upgradeCheckMock,
}));

vi.mock("../effects/visualisationSession.ts", () => ({
  visualisationSession: {
    clock: { acceptHardwareTime: vi.fn(() => Promise.resolve()) },
  },
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

vi.mock("../runtime/runtimeSessionService.ts", () => ({
  reportProtocolModeChanged: vi.fn(),
  reportTransportConnectionChanged: vi.fn(),
}));

// ── Fake port harness ────────────────────────────────────────────────

const decoder = new TextDecoder();

interface FakePort {
  port: SerialPort;
  /** Raw bytes written to the port (copies). */
  writes: Uint8Array[];
}

function createFakePort(opts: { writable?: boolean } = {}): FakePort {
  const writes: Uint8Array[] = [];
  const writable =
    opts.writable === false
      ? null
      : new WritableStream<Uint8Array>({
          write(chunk) {
            writes.push(chunk.slice());
          },
        });
  const port = {
    readable: null,
    writable,
    getInfo: () => ({ usbVendorId: 0x1234, usbProductId: 0x5678 }),
  } as unknown as SerialPort;
  return { port, writes };
}

async function loadModule() {
  vi.resetModules();
  return import("./json-protocol.ts");
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(1);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.resolve();
  }
}

// ── Tests ────────────────────────────────────────────────────────────

describe("json-protocol eval lifecycle", () => {
  beforeEach(() => {
    postMock.mockReset();
    upgradeCheckMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("times out a JSON eval when the device never answers", async () => {
    const mod = await loadModule();
    const { port } = createFakePort(); // accepts writes, never responds
    mod.initProtocol({
      getSerialPort: () => port,
      emitConnectionChanged: () => {},
    });
    mod.protocolState.mode = "json";

    vi.useFakeTimers();
    const evaluation = mod.sendJsonEval("(+ 1 2)");
    const expectation = expect(evaluation).rejects.toThrow(/timed out/);

    await vi.advanceTimersByTimeAsync(EVAL_TIMEOUT_MS - 1);
    await flushMicrotasks();
    expect(postMock).not.toHaveBeenCalled(); // surfaced by sendTouSEQ's catch, not here

    await vi.advanceTimersByTimeAsync(1);
    await expectation;

    // The pending entry drained, so the heartbeat is not blocked forever.
    expect(mod.protocolState.pendingRequests.size).toBe(0);
  });

  it("still resolves a JSON eval when the device answers in time", async () => {
    const mod = await loadModule();
    const { port, writes } = createFakePort();
    mod.initProtocol({
      getSerialPort: () => port,
      emitConnectionChanged: () => {},
    });
    mod.protocolState.mode = "json";

    const evaluation = mod.sendJsonEval("(+ 1 2)");
    await flushMicrotasks();

    // Reply out-of-band with the requestId the driver put on the wire.
    const sent = JSON.parse(decoder.decode(writes[0]));
    mod.handleJsonMessage(
      JSON.stringify({
        type: "response",
        requestId: sent.requestId,
        success: true,
        text: "3",
      }),
    );

    const response = await evaluation;
    expect(response.success).toBe(true);
    expect(response.text).toBe("3");
    expect(mod.protocolState.pendingRequests.size).toBe(0);
  });

  it("rejects an oversized eval locally instead of pending forever", async () => {
    const mod = await loadModule();
    const { port, writes } = createFakePort();
    mod.initProtocol({
      getSerialPort: () => port,
      emitConnectionChanged: () => {},
    });
    mod.protocolState.mode = "json";

    const bigCode = `(+ 1 ${"2".repeat(4000)})`;
    await expect(mod.sendJsonEval(bigCode)).rejects.toThrow(
      /receive buffer/,
    );
    // Nothing reached the wire — the firmware would have dropped it anyway.
    expect(writes.length).toBe(0);
  }, 10_000);

  it("accepts an eval just under the device line limit", async () => {
    const mod = await loadModule();
    const { port, writes } = createFakePort();
    mod.initProtocol({
      getSerialPort: () => port,
      emitConnectionChanged: () => {},
    });
    mod.protocolState.mode = "json";

    // Pad so the full serialised line (requestId included) lands within the
    // device's line budget.
    let code = "x".repeat(3000);
    const lineLength = (c: string): number =>
      encoderByteLength(
        JSON.stringify({ type: "eval", code: c, requestId: "req-1" }),
      ) + 1; // + trailing newline
    while (lineLength(code) > MAX_REQUEST_LINE_BYTES) {
      code = code.slice(0, -1);
    }
    // The device never answers in this harness; only assert the bytes made
    // it onto the wire (the guard did not reject) and swallow the eventual
    // timeout rejection.
    const evaluation = mod.sendJsonEval(code);
    evaluation.catch(() => {});
    await flushMicrotasks();
    expect(writes.length).toBe(1);
  }, 10_000);

  it("surfaces a console warning when eval fires during negotiation", async () => {
    const mod = await loadModule();
    const { port } = createFakePort();
    mod.initProtocol({
      getSerialPort: () => port,
      emitConnectionChanged: () => {},
    });
    // Fresh protocol state is "negotiating" until the handshake completes.
    mod.protocolState.mode = "negotiating";

    await expect(mod.sendTouSEQ("(+ 1 2)")).rejects.toThrow(
      /negotiation is still in progress/,
    );
    expect(postMock).toHaveBeenCalledWith(
      expect.stringContaining("still connecting"),
      "warn",
    );
  });

  it("resolves an explicit failure envelope when no port is writable", async () => {
    const mod = await loadModule();
    const { port } = createFakePort({ writable: false });
    mod.initProtocol({
      getSerialPort: () => port,
      emitConnectionChanged: () => {},
    });

    const result = await mod.sendTouSEQ("(+ 1 2)");
    expect(result).toEqual({ success: false, error: "uSEQ not connected" });
    expect(postMock).toHaveBeenCalledWith(
      expect.stringContaining("not connected"),
      "warn",
    );
  });

  it("gates set-live-inputs and binary INPUT_SET on JSON protocol mode", async () => {
    const mod = await loadModule();
    const { port, writes } = createFakePort();
    mod.initProtocol({
      getSerialPort: () => port,
      emitConnectionChanged: () => {},
    });

    for (const mode of ["negotiating", "legacy"] as const) {
      mod.protocolState.mode = mode;
      await expect(mod.sendSetLiveInputs({ ssin1: 0.5 })).rejects.toThrow(
        "JSON protocol not active",
      );
      await expect(
        mod.sendBinaryInputSet([{ slotIndex: 0, value: 1 }]),
      ).rejects.toThrow("JSON protocol not active");
    }
    expect(writes.length).toBe(0);

    // In JSON mode both paths still deliver (legacy interpreter untouched).
    mod.protocolState.mode = "json";
    await mod.sendSetLiveInputs({ ssin1: 0.5 });
    expect(decoder.decode(writes[0])).toContain('"type":"set-live-inputs"');
    await mod.sendBinaryInputSet([{ slotIndex: 0, value: 1 }]);
    expect(writes[1][0]).toBe(0x1f); // §6.5 message_begin_marker
  });
});

/** UTF-8 byte length of a string (the device buffer counts bytes, not chars). */
function encoderByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
