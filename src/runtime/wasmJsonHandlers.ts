/**
 * WASM-side JSON protocol handlers.
 *
 * These functions implement the firmware-side of the JSON protocol for the
 * in-process WASM runtime. They mirror what the C++ firmware does in
 * `src-useq/uSEQ/src/utils/serial_message.cpp` for `hello`, `ping`, `eval`,
 * and `stream-config`.
 *
 * Why this exists:
 *
 *   - Hardware mode goes through `transport/json-protocol.ts` which speaks
 *     the JSON protocol to the firmware.
 *   - WASM mode used to call `wasmInterpreter.evalCode` directly, bypassing
 *     the protocol entirely. That asymmetry — different error surfaces,
 *     different capability discovery, no heartbeat, no stream-config — was
 *     the gap between "first-class WASM" as a stated mission goal and the
 *     reality. (See `ALIGNMENT.md` defect 4 / Stream F.)
 *   - These handlers turn the WASM runtime into the *server* end of the
 *     same JSON protocol. The {@link JsonProtocolEngine} in
 *     `wasmJsonTransport.ts` is the *client* end, swapping in for the
 *     bytes-over-Web-Serial transport.
 *
 * The handlers are pure with respect to the supplied `WasmJsonBackend` —
 * they do not import the WASM module directly. That keeps them trivially
 * testable without spinning up the WASM runtime.
 *
 * @see docs/PROTOCOL.md — wire format
 * @see docs/RUNTIME_CONTRACT.md — capability split
 */

import {
  buildWasmDefaultIoConfig,
  type IoConfig,
  type JsonEvalRequest,
  type JsonHelloRequest,
  type JsonHeartbeatRequest,
  type JsonRequest,
  type JsonResponseBody,
  type JsonSetLiveInputsRequest,
  type JsonStreamConfigRequest,
} from "./jsonProtocol.ts";
import { EDITOR_VERSION } from "../transport/types.ts";

/**
 * Backend the WASM-mode JSON handlers dispatch against.
 *
 * Kept narrow on purpose: every operation here is one of the four JSON
 * request types. Operations that are *not* part of the JSON protocol
 * surface (time updates, batch sampling, ABI inspection) stay on the
 * direct {@link WasmRuntimePort} surface.
 */
export interface WasmJsonBackend {
  /** Evaluate a piece of uSEQ Lisp and return the textual result. */
  evalCode(code: string): Promise<string | null>;
  /** Like {@link evalCode} but does not publish a `codeEvaluated` event. */
  evalCodeSilently(code: string): Promise<string | null>;
}

/**
 * Snapshot of negotiated handshake state. Returned to the engine so it can
 * cache it for callers that ask "what's the protocol mode / advertised I/O
 * shape?" without re-running the handshake.
 */
export interface WasmHandshakeOutcome {
  /** Always "json" for WASM — this path doesn't have a legacy fallback. */
  readonly mode: "json";
  /** Advertised firmware version string (mirrors `hello.fw`). */
  readonly fw: string;
  /** Advertised I/O config (mirrors `hello.config`). */
  readonly config: IoConfig;
}

const WASM_FIRMWARE_VERSION = EDITOR_VERSION;

function bumpRequestId(payload: { requestId?: string }): string | undefined {
  return payload.requestId;
}

/**
 * Handle a `hello` request from the editor.
 *
 * The WASM build advertises the editor's own protocol version (since both
 * sides ship from the same repo) and a stable I/O config matching what
 * hardware advertises. Reusing the hardware shape means downstream serial
 * routing and channel-naming code paths work identically across ports.
 */
export function handleHelloRequest(
  request: JsonHelloRequest & { requestId?: string }
): JsonResponseBody {
  return {
    requestId: bumpRequestId(request),
    success: true,
    type: "response",
    mode: "json",
    fw: WASM_FIRMWARE_VERSION,
    config: buildWasmDefaultIoConfig(),
  };
}

/** Handle a `ping` heartbeat. Always succeeds. */
export function handleHeartbeatRequest(
  request: JsonHeartbeatRequest & { requestId?: string }
): JsonResponseBody {
  return {
    requestId: bumpRequestId(request),
    success: true,
    type: "response",
  };
}

/**
 * Handle a `stream-config` request.
 *
 * The WASM runtime does not currently constrain output cadence per channel
 * — sampling lives on the host side via `evalOutputsInTimeWindow`. We
 * accept and ack the config to keep the wire-protocol contract identical;
 * the supplied channels are recorded by the engine for diagnostics but do
 * not change WASM-side behaviour today. Tracked under future work in
 * `ALIGNMENT.md` if/when the WASM path grows its own per-channel rate
 * limiter.
 */
export function handleStreamConfigRequest(
  request: JsonStreamConfigRequest & { requestId?: string }
): JsonResponseBody {
  return {
    requestId: bumpRequestId(request),
    success: true,
    type: "response",
  };
}

/**
 * Handle an `eval` request by forwarding to the WASM backend.
 *
 * Mirrors the firmware's `eval` semantics:
 *   - The `code` field is required.
 *   - Wire eval is always immediate; there is no queued/immediate flag on
 *     the wire (spec §5.7, firmware.md §6.2).
 *   - Errors are returned as `success: false` with a `text` describing the
 *     failure, matching what the wire protocol would produce.
 */
export async function handleEvalRequest(
  request: JsonEvalRequest & { requestId?: string },
  backend: WasmJsonBackend,
  options: { silent?: boolean } = {}
): Promise<JsonResponseBody> {
  const requestId = bumpRequestId(request);
  if (typeof request.code !== "string") {
    return {
      requestId,
      success: false,
      type: "response",
      text: "eval request missing required 'code' field",
    };
  }

  try {
    const evalFn = options.silent
      ? backend.evalCodeSilently
      : backend.evalCode;
    const result = await evalFn(request.code);
    return {
      requestId,
      success: true,
      type: "response",
      text: typeof result === "string" ? result : "",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      requestId,
      success: false,
      type: "response",
      text: message,
    };
  }
}

/**
 * Handle a `set-live-inputs` request in WASM mode.
 *
 * Full WASM ABI integration (`useq_set_live_inputs`) ships when the live-edit
 * feature lands. For now the handler acks with `applied: 0` so the protocol
 * stays exhaustive and the editor's pending-request bookkeeping can flush.
 */
export function handleSetLiveInputsRequest(
  request: JsonSetLiveInputsRequest & { requestId?: string }
): JsonResponseBody {
  return {
    requestId: bumpRequestId(request),
    success: true,
    type: "response",
    applied: 0,
  } as JsonResponseBody & { applied: number };
}

/**
 * Single entry point for dispatching any {@link JsonRequest}.
 *
 * The engine uses this; tests call individual handlers directly when they
 * want to exercise one branch in isolation.
 */
export async function dispatchWasmJsonRequest(
  request: JsonRequest & { requestId?: string },
  backend: WasmJsonBackend,
  options: { silent?: boolean } = {}
): Promise<JsonResponseBody> {
  switch (request.type) {
    case "hello":
      return handleHelloRequest(request);
    case "ping":
      return handleHeartbeatRequest(request);
    case "stream-config":
      return handleStreamConfigRequest(request);
    case "eval":
      return handleEvalRequest(request, backend, options);
    case "set-live-inputs":
      return handleSetLiveInputsRequest(request);
    default: {
      const exhaustive: never = request;
      void exhaustive;
      return {
        requestId: (request as { requestId?: string }).requestId,
        success: false,
        type: "response",
        text: `unknown request type: ${(request as { type?: string }).type}`,
      };
    }
  }
}
