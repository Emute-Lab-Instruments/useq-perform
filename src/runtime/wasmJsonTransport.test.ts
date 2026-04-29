import { describe, expect, it, vi } from "vitest";

import {
  JsonProtocolEngine,
} from "./wasmJsonTransport.ts";
import type { WasmJsonBackend } from "./wasmJsonHandlers.ts";
import {
  buildEvalRequest,
  buildHeartbeatRequest,
  buildHelloRequest,
} from "./jsonProtocol.ts";

function createBackend(
  overrides: Partial<WasmJsonBackend> = {}
): WasmJsonBackend & {
  evalCode: ReturnType<typeof vi.fn>;
  evalCodeSilently: ReturnType<typeof vi.fn>;
} {
  return {
    evalCode: vi.fn(async (code: string) => `evaled:${code}`),
    evalCodeSilently: vi.fn(async (code: string) => `silently:${code}`),
    ...overrides,
  } as any;
}

describe("JsonProtocolEngine — WASM-mode JSON parity", () => {
  it("performs the hello handshake before the first non-hello request", async () => {
    const backend = createBackend();
    const engine = new JsonProtocolEngine(backend);

    expect(engine.snapshot().negotiated).toBe(false);
    expect(engine.snapshot().mode).toBe("negotiating");

    const response = await engine.sendEval("(useq-play)");

    expect(engine.snapshot().negotiated).toBe(true);
    expect(engine.snapshot().mode).toBe("json");
    expect(response.success).toBe(true);
    expect(backend.evalCode).toHaveBeenCalledWith("(useq-play)");
  });

  it("hello response advertises an IoConfig with time + s1..s8", async () => {
    const backend = createBackend();
    const engine = new JsonProtocolEngine(backend);

    const response = await engine.sendRequest(buildHelloRequest("1.2.0"));

    expect(response.success).toBe(true);
    expect(response.mode).toBe("json");
    expect(response.fw).toBeTruthy();
    expect(response.config?.outputs).toEqual([
      { index: 1, name: "time" },
      { index: 2, name: "s1" },
      { index: 3, name: "s2" },
      { index: 4, name: "s3" },
      { index: 5, name: "s4" },
      { index: 6, name: "s5" },
      { index: 7, name: "s6" },
      { index: 8, name: "s7" },
      { index: 9, name: "s8" },
    ]);
    expect(response.config?.inputs?.length).toBe(8);
  });

  it("emits stream-config implicitly after the handshake (no explicit ack required from caller)", async () => {
    const backend = createBackend();
    const engine = new JsonProtocolEngine(backend);

    await engine.ensureHandshake();
    const snapshot = engine.snapshot();

    expect(snapshot.negotiated).toBe(true);
    expect(snapshot.ioConfig?.outputs?.[0]?.name).toBe("time");
  });

  it("ping requests succeed without invoking the eval backend", async () => {
    const backend = createBackend();
    const engine = new JsonProtocolEngine(backend);

    const response = await engine.sendRequest(buildHeartbeatRequest());

    expect(response.success).toBe(true);
    expect(backend.evalCode).not.toHaveBeenCalled();
    expect(backend.evalCodeSilently).not.toHaveBeenCalled();
  });

  it("eval requests forward to backend.evalCode and surface the text result", async () => {
    const backend = createBackend({
      evalCode: vi.fn(async (code: string) => `result-of:${code}`),
    });
    const engine = new JsonProtocolEngine(backend);

    const response = await engine.sendRequest(
      buildEvalRequest("(+ 1 2)")
    );

    expect(response.success).toBe(true);
    expect(response.text).toBe("result-of:(+ 1 2)");
    expect(backend.evalCode).toHaveBeenCalledTimes(1);
  });

  it("silent eval requests route through evalCodeSilently", async () => {
    const backend = createBackend();
    const engine = new JsonProtocolEngine(backend);

    await engine.sendEval("(quiet-call)", { silent: true });

    expect(backend.evalCodeSilently).toHaveBeenCalledWith("(quiet-call)");
    expect(backend.evalCode).not.toHaveBeenCalled();
  });

  it("eval failures are surfaced as success: false with the error text", async () => {
    const backend = createBackend({
      evalCode: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const engine = new JsonProtocolEngine(backend);

    const response = await engine.sendEval("(crash)");

    expect(response.success).toBe(false);
    expect(response.text).toBe("boom");
  });

  it("concurrent first-call races share a single negotiation", async () => {
    const backend = createBackend();
    const engine = new JsonProtocolEngine(backend);

    // Fire three eval calls in parallel before any handshake has run.
    const results = await Promise.all([
      engine.sendEval("(a)"),
      engine.sendEval("(b)"),
      engine.sendEval("(c)"),
    ]);

    for (const r of results) {
      expect(r.success).toBe(true);
    }
    expect(engine.snapshot().negotiated).toBe(true);
    expect(backend.evalCode).toHaveBeenCalledTimes(3);
  });

  it("includes a unique requestId on each dispatch", async () => {
    const backend = createBackend();
    const engine = new JsonProtocolEngine(backend);

    const r1 = await engine.sendEval("(one)");
    const r2 = await engine.sendEval("(two)");

    expect(r1.requestId).toBeTruthy();
    expect(r2.requestId).toBeTruthy();
    expect(r1.requestId).not.toBe(r2.requestId);
  });

  it("snapshot pendingRequests goes back to zero after dispatch resolves", async () => {
    const backend = createBackend();
    const engine = new JsonProtocolEngine(backend);

    await engine.sendEval("(work)");
    expect(engine.snapshot().pendingRequests).toBe(0);
  });

  it("reset() clears handshake state so it re-negotiates on next use", async () => {
    const backend = createBackend();
    const engine = new JsonProtocolEngine(backend);

    await engine.sendEval("(a)");
    expect(engine.snapshot().negotiated).toBe(true);

    engine.reset();
    expect(engine.snapshot().negotiated).toBe(false);
    expect(engine.snapshot().mode).toBe("negotiating");

    await engine.sendEval("(b)");
    expect(engine.snapshot().negotiated).toBe(true);
  });
});
