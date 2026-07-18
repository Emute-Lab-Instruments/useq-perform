/**
 * Browser-global probe used to build an {@link AudioCapabilitySnapshot}.
 *
 * This module is the only place the synthesis capability detector touches
 * browser globals. Keeping the globals access here (rather than inside
 * `src/contracts/audioCapabilities.ts`) preserves the contract layer's
 * dependency-light import boundary.
 *
 * The probe is safe to call in non-browser environments: every check degrades
 * to `false` when the relevant global is absent, so `audioCapable` will be
 * `false` in Node-only tests without throwing.
 */

import type { AudioCapabilityProbe } from "../contracts/audioCapabilities";

/**
 * Probe the current global environment for the capabilities the synthesis
 * engine requires. The returned object is a plain record so callers can feed
 * it directly into `detectAudioCapabilities()`.
 *
 * Detection notes:
 *
 * - `crossOriginIsolated` is read from `globalThis.crossOriginIsolated`. Browsers
 *   set this to `true` only when COOP/COEP allow cross-origin isolation. In Node
 *   and in non-isolated contexts it is `undefined` → `false`.
 * - `sharedWebAssemblyMemoryAvailable` is probed by constructing a 1-page
 *   shared memory behind try/catch. Shared memory requires
 *   `crossOriginIsolated === true`, so in practice this returns `true` only
 *   alongside `crossOriginIsolated`. The probe is still run independently so
 *   the reason list can distinguish a browser that ships SAB but not shared
 *   WASM memory from one that lacks both.
 */
export function probeAudioCapabilities(
  globalScope: unknown = (typeof globalThis !== "undefined" ? globalThis : null),
): AudioCapabilityProbe {
  const g = (globalScope ?? {}) as Record<string, unknown>;

  const crossOriginIsolated = g.crossOriginIsolated === true;

  const sharedArrayBufferAvailable =
    typeof g.SharedArrayBuffer === "function" ||
    typeof g.SharedArrayBuffer === "object";

  const audioWorkletAvailable =
    typeof g.AudioWorkletNode === "function" ||
    (typeof g.AudioContext === "function" &&
      typeof (g.AudioContext as { prototype?: { audioWorklet?: unknown } })
        .prototype?.audioWorklet !== "undefined");

  const workerAvailable = typeof g.Worker === "function";

  const sharedWebAssemblyMemoryAvailable = probeSharedWebAssemblyMemory(g);

  return {
    crossOriginIsolated,
    sharedArrayBufferAvailable,
    audioWorkletAvailable,
    workerAvailable,
    sharedWebAssemblyMemoryAvailable,
  };
}

/**
 * Construct a minimal shared `WebAssembly.Memory` to determine whether the
 * runtime supports it. Wrapped in try/catch because some engines throw on the
 * `shared: true` option itself rather than returning a broken object.
 */
function probeSharedWebAssemblyMemory(
  g: Record<string, unknown>,
): boolean {
  const wasmNs = g.WebAssembly as
    | ({ Memory: new (descriptor: {
        initial: number;
        maximum?: number;
        shared?: boolean;
      }) => unknown })
    | undefined;

  if (typeof wasmNs?.Memory !== "function") {
    return false;
  }

  try {
    new wasmNs.Memory({ initial: 1, maximum: 1, shared: true });
    return true;
  } catch {
    return false;
  }
}
