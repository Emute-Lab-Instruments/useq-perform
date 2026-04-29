/**
 * WASM JSON-protocol transport.
 *
 * In-memory virtual transport that lets the in-process WASM runtime speak
 * the same JSON protocol as the firmware. The hardware path uses
 * `transport/json-protocol.ts` to drive bytes over Web Serial; this module
 * is the structural mirror for the WASM port.
 *
 * Architecture:
 *
 *     [editor / runtime layer]
 *               │
 *               ▼
 *     [WasmRuntimePort (contract)]            ◄── unchanged surface
 *               │
 *               ▼
 *     [JsonProtocolEngine] ──── (this file) ───── speaks the same
 *               │                                    JSON shapes that
 *               │                                    the firmware does
 *               ▼
 *     [WasmJsonBackend (wasmInterpreter functions)]
 *
 * Why an engine, not a byte-level transport:
 *
 *   The hardware driver has to deal with framing (start markers, CRLF,
 *   stream-vs-text-vs-json mode switching). For an in-process transport
 *   none of that is observable: nobody reads the bytes between us and the
 *   handler. Faithfully framing them only to immediately re-parse them on
 *   the other side adds plumbing without testing anything that isn't
 *   already covered by the byte-level parser tests in
 *   `serialComms.test.ts`.
 *
 *   So this engine works at the structured-message level: it drives the
 *   same {@link JsonRequest} / {@link JsonResponseBody} shapes through a
 *   pair of in-memory queues, with the same handshake → ack → request
 *   lifecycle the wire driver implements.
 *
 *   When the worker move (`useq-perform-nri`, parallel work) lands, the
 *   engine boundary becomes the postMessage boundary: the same shapes go
 *   over the worker channel, with the same handshake. If the worker port
 *   needs byte-level framing later we can plug a framer in here without
 *   re-shaping callers.
 *
 * @see docs/PROTOCOL.md
 * @see docs/RUNTIME_CONTRACT.md
 * @see src/transport/json-protocol.ts (the bytes-over-Web-Serial sibling)
 */

import {
  EDITOR_VERSION,
} from "../transport/types.ts";
import {
  buildEvalRequest,
  buildHelloRequest,
  buildHeartbeatRequest,
  type IoConfig,
  type JsonEvalExec,
  type JsonRequest,
  type JsonResponseBody,
} from "./jsonProtocol.ts";
import {
  dispatchWasmJsonRequest,
  type WasmJsonBackend,
} from "./wasmJsonHandlers.ts";

/** Operational mode of the engine. Mirrors {@link ProtocolState} but for the
 *  WASM-side path, which has no legacy text fallback. */
export type WasmProtocolMode = "negotiating" | "json";

export interface JsonProtocolEngineSnapshot {
  readonly mode: WasmProtocolMode;
  readonly negotiated: boolean;
  readonly ioConfig: IoConfig | null;
  readonly fw: string | null;
  readonly pendingRequests: number;
}

/**
 * Options for {@link JsonProtocolEngine.sendEval}. Keeps the call site
 * symmetric with {@link transport/json-protocol.ts#sendJsonEval}.
 */
export interface SendWasmEvalOptions {
  /** Pass to skip publishing the `codeEvaluated` channel. */
  silent?: boolean;
  /** "immediate" maps to the firmware `@`-prefix bypass. WASM ignores. */
  exec?: JsonEvalExec | null;
}

/**
 * The protocol-driving piece. One instance is created per WASM port (in
 * practice, one global instance — the WASM module is a singleton).
 *
 * Lifecycle:
 *
 *   1. First call to {@link sendRequest} (or any of the typed wrappers)
 *      triggers a `hello` exchange if it hasn't happened yet, just like
 *      the wire driver does after the firmware-info probe.
 *   2. The engine caches the negotiated `IoConfig` and emits a
 *      `stream-config` request once, mirroring
 *      {@link sendDefaultStreamConfig} on the wire side.
 *   3. Subsequent requests dispatch directly through the handlers.
 *
 * Concurrency: the dispatch path is `await`-based. If two callers race the
 * handshake, the second one waits on the first's promise — there's a
 * single negotiation in flight at any time.
 */
export class JsonProtocolEngine {
  private mode: WasmProtocolMode = "negotiating";
  private negotiationPromise: Promise<void> | null = null;
  private negotiated = false;
  private ioConfig: IoConfig | null = null;
  private fw: string | null = null;
  private requestIdCounter = 0;
  /** Tracks outstanding dispatches for diagnostics-only purposes. */
  private pendingRequests = new Set<string>();
  /** Whether the engine has emitted its post-handshake `stream-config`. */
  private streamConfigSent = false;

  constructor(private readonly backend: WasmJsonBackend) {}

  /**
   * Snapshot for diagnostics / tests. Plain values only — no live
   * references into engine state.
   */
  snapshot(): JsonProtocolEngineSnapshot {
    return {
      mode: this.mode,
      negotiated: this.negotiated,
      ioConfig: this.ioConfig,
      fw: this.fw,
      pendingRequests: this.pendingRequests.size,
    };
  }

  /** Reset to pre-handshake state. Used by tests; not exposed at the port surface. */
  reset(): void {
    this.mode = "negotiating";
    this.negotiationPromise = null;
    this.negotiated = false;
    this.ioConfig = null;
    this.fw = null;
    this.requestIdCounter = 0;
    this.pendingRequests.clear();
    this.streamConfigSent = false;
  }

  private nextRequestId(): string {
    this.requestIdCounter += 1;
    return `wasm-req-${this.requestIdCounter}`;
  }

  /**
   * Send a typed request through the engine. The hello/stream-config
   * pre-roll is implicit — every public entry point goes through here
   * after `ensureHandshake()` has resolved.
   */
  async sendRequest(
    request: JsonRequest,
    options: { silent?: boolean } = {}
  ): Promise<JsonResponseBody> {
    if (request.type !== "hello") {
      await this.ensureHandshake();
    }

    const requestId = this.nextRequestId();
    const stamped = { ...request, requestId } as JsonRequest & {
      requestId: string;
    };

    this.pendingRequests.add(requestId);
    try {
      return await dispatchWasmJsonRequest(stamped, this.backend, options);
    } finally {
      this.pendingRequests.delete(requestId);
    }
  }

  /** Convenience wrapper mirroring the firmware-eval shape. */
  async sendEval(
    code: string,
    options: SendWasmEvalOptions = {}
  ): Promise<JsonResponseBody> {
    const exec = options.exec === "immediate" ? "immediate" : undefined;
    return this.sendRequest(buildEvalRequest(code, { exec }), {
      silent: !!options.silent,
    });
  }

  /** Send a heartbeat. Always succeeds; provided so callers can probe liveness. */
  async sendHeartbeat(): Promise<JsonResponseBody> {
    return this.sendRequest(buildHeartbeatRequest());
  }

  /**
   * Run the `hello` handshake (and its follow-up `stream-config`) if it
   * hasn't been done yet. Idempotent and concurrency-safe — concurrent
   * callers share one in-flight negotiation.
   */
  ensureHandshake(): Promise<void> {
    if (this.negotiated) return Promise.resolve();
    if (this.negotiationPromise) return this.negotiationPromise;

    this.negotiationPromise = this.runHandshake().finally(() => {
      // Keep negotiationPromise non-null so concurrent callers see the
      // resolved promise; clear only on reset().
    });
    return this.negotiationPromise;
  }

  private async runHandshake(): Promise<void> {
    const helloRequestId = this.nextRequestId();
    const helloRequest = {
      ...buildHelloRequest(EDITOR_VERSION),
      requestId: helloRequestId,
    };

    this.pendingRequests.add(helloRequestId);
    let helloResponse: JsonResponseBody;
    try {
      helloResponse = await dispatchWasmJsonRequest(helloRequest, this.backend);
    } finally {
      this.pendingRequests.delete(helloRequestId);
    }

    if (!helloResponse.success || helloResponse.mode !== "json") {
      // The WASM-side handler always succeeds; this branch is
      // defensive against a mocked backend in tests.
      throw new Error(
        `WASM JSON handshake failed: ${helloResponse.text ?? "unknown"}`
      );
    }

    this.mode = "json";
    this.fw = helloResponse.fw ?? null;
    this.ioConfig = helloResponse.config ?? null;
    this.negotiated = true;

    if (!this.streamConfigSent && this.ioConfig) {
      this.streamConfigSent = true;
      // Use a low-level send to avoid recursing through ensureHandshake.
      const requestId = this.nextRequestId();
      const cfg = {
        type: "stream-config" as const,
        maxRateHz: 30,
        channels: [
          ...(this.ioConfig.inputs ?? []).map((c) => ({
            id: c.index,
            name: c.name,
            direction: "input" as const,
            enabled: true,
            maxRateHz: 30,
          })),
          ...(this.ioConfig.outputs ?? []).map((c) => ({
            id: c.index,
            name: c.name,
            direction: "output" as const,
            enabled: true,
            maxRateHz: 30,
          })),
        ],
        requestId,
      };
      this.pendingRequests.add(requestId);
      try {
        await dispatchWasmJsonRequest(cfg, this.backend);
      } finally {
        this.pendingRequests.delete(requestId);
      }
    }
  }
}
