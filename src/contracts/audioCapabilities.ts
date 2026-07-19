/**
 * Bootstrap audio-capability snapshot contract.
 *
 * Single source of truth for the immutable audio-capability snapshot captured
 * during bootstrap. The detector is dependency-light and side-effect free so
 * it can run during bootstrap (in `runtime/`) and in tests without a DOM.
 *
 * Fulfils:
 *   VAL-HOST-005 — capability snapshot is complete and immutable
 *   VAL-HOST-006 — each missing capability disables audio and names itself
 *   VAL-HOST-011 — capability telemetry is read-only
 *
 * Architecture note: this module deliberately has no DOM or browser-global
 * imports. Callers pass an {@link AudioCapabilityProbe}; the bootstrap layer
 * derives the probe from `globalThis`. This keeps the contract importable from
 * `src/contracts/` without violating the dependency-light import boundary.
 */

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

/**
 * Version of the capability snapshot schema. Bumped only when the field shape
 * changes. The type guard uses this to reject mismatched snapshots.
 */
export const AUDIO_CAPABILITY_SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Actionable reason strings (machine-readable keys → human-readable text)
// ---------------------------------------------------------------------------

/**
 * Stable machine-readable reason keys. Each maps to a human-readable
 * explanation of which capability is missing and (where useful) what to do
 * about it. The keys themselves are the public telemetry surface so downstream
 * dashboards/tests can match without parsing prose.
 */
export const AUDIO_CAPABILITY_REASONS = Object.freeze({
  NOT_CROSS_ORIGIN_ISOLATED:
    "Cross-origin isolation is unavailable. Serve the app with COOP=same-origin and COEP=credentialless (or require-corp) so SharedArrayBuffer is enabled.",
  NO_SHARED_ARRAY_BUFFER:
    "SharedArrayBuffer is unavailable. Cross-origin isolation is required for the synthesis control ring.",
  NO_AUDIO_WORKLET:
    "AudioWorklet is unavailable in this browser. The synthesis engine requires AudioWorklet to render audio off the main thread.",
  NO_WORKER:
    "Web Worker is unavailable. The WASM control producer must run off the main thread.",
  NO_SHARED_WASM_MEMORY:
    "Shared WebAssembly.Memory is unavailable. NodeDef DSP modules share a single host-owned memory.",
} as const);

export type AudioCapabilityReasonKey = keyof typeof AUDIO_CAPABILITY_REASONS;

// ---------------------------------------------------------------------------
// Probe and snapshot types
// ---------------------------------------------------------------------------

/**
 * Environment probe consumed by {@link detectAudioCapabilities}. Each field is
 * a plain boolean so callers can derive the values from `globalThis` features,
 * mocks, or controlled test fixtures.
 */
export interface AudioCapabilityProbe {
  /** `self.crossOriginIsolated === true`. */
  readonly crossOriginIsolated: boolean;
  /** `typeof SharedArrayBuffer !== "undefined"`. */
  readonly sharedArrayBufferAvailable: boolean;
  /** `typeof AudioWorkletNode !== "undefined"` (or feature-detect equivalent). */
  readonly audioWorkletAvailable: boolean;
  /** `typeof Worker !== "undefined"`. */
  readonly workerAvailable: boolean;
  /**
   * A shared `WebAssembly.Memory` can be constructed with `shared: true`.
   * Probed by attempting `new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true })`
   * behind try/catch in the bootstrap wiring.
   */
  readonly sharedWebAssemblyMemoryAvailable: boolean;
}

/**
 * Immutable bootstrap audio-capability snapshot.
 *
 * Frozen once captured. Telemetry consumers must never mutate this object or
 * its `reasons` array. Outside devmode the snapshot stays inert (not surfaced
 * to UI) per VAL-HOST-011.
 */
export interface AudioCapabilitySnapshot extends AudioCapabilityProbe {
  /** Schema version — see {@link AUDIO_CAPABILITY_SCHEMA_VERSION}. */
  readonly schemaVersion: typeof AUDIO_CAPABILITY_SCHEMA_VERSION;
  /** Derived: true only when every required capability is present. */
  readonly audioCapable: boolean;
  /** Human-readable actionable reasons for why audio is disabled. Empty when capable. */
  readonly reasons: readonly string[];
  /** Capture timestamp (`Date.now()` at detection time). */
  readonly capturedAt: number;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect audio capabilities from a probe and return an immutable snapshot.
 *
 * Pure: no global access, no side effects. The snapshot is frozen before
 * return so callers cannot mutate telemetry.
 */
export function detectAudioCapabilities(
  probe: AudioCapabilityProbe,
): AudioCapabilitySnapshot {
  const reasons: string[] = [];

  if (!probe.crossOriginIsolated) {
    reasons.push(AUDIO_CAPABILITY_REASONS.NOT_CROSS_ORIGIN_ISOLATED);
  }
  if (!probe.sharedArrayBufferAvailable) {
    reasons.push(AUDIO_CAPABILITY_REASONS.NO_SHARED_ARRAY_BUFFER);
  }
  if (!probe.audioWorkletAvailable) {
    reasons.push(AUDIO_CAPABILITY_REASONS.NO_AUDIO_WORKLET);
  }
  if (!probe.workerAvailable) {
    reasons.push(AUDIO_CAPABILITY_REASONS.NO_WORKER);
  }
  if (!probe.sharedWebAssemblyMemoryAvailable) {
    reasons.push(AUDIO_CAPABILITY_REASONS.NO_SHARED_WASM_MEMORY);
  }

  const audioCapable =
    probe.crossOriginIsolated &&
    probe.sharedArrayBufferAvailable &&
    probe.audioWorkletAvailable &&
    probe.workerAvailable &&
    probe.sharedWebAssemblyMemoryAvailable;

  return freezeAudioCapabilitySnapshot({
    schemaVersion: AUDIO_CAPABILITY_SCHEMA_VERSION,
    crossOriginIsolated: probe.crossOriginIsolated,
    sharedArrayBufferAvailable: probe.sharedArrayBufferAvailable,
    audioWorkletAvailable: probe.audioWorkletAvailable,
    workerAvailable: probe.workerAvailable,
    sharedWebAssemblyMemoryAvailable: probe.sharedWebAssemblyMemoryAvailable,
    audioCapable,
    reasons,
    capturedAt: Date.now(),
  });
}

/**
 * Deep-freeze a snapshot-shaped object. Exposed so callers that build a
 * snapshot from serialised state (e.g. restoring from storage) can ensure the
 * same immutability invariant as a freshly detected snapshot.
 */
export function freezeAudioCapabilitySnapshot<T extends AudioCapabilitySnapshot>(
  snapshot: T,
): T {
  // Freeze reasons first so nested immutability holds even if the outer object
  // is somehow already frozen (no-op in that case).
  Object.freeze(snapshot.reasons);
  return Object.freeze(snapshot);
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/**
 * Runtime type guard for {@link AudioCapabilitySnapshot}. Validates the schema
 * version and the presence of every required field with the expected type.
 */
export function isAudioCapabilitySnapshot(
  value: unknown,
): value is AudioCapabilitySnapshot {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const v = value as Record<string, unknown>;

  if (v.schemaVersion !== AUDIO_CAPABILITY_SCHEMA_VERSION) {
    return false;
  }

  const booleanFields: ReadonlyArray<
    keyof AudioCapabilityProbe | "audioCapable"
  > = [
    "crossOriginIsolated",
    "sharedArrayBufferAvailable",
    "audioWorkletAvailable",
    "workerAvailable",
    "sharedWebAssemblyMemoryAvailable",
    "audioCapable",
  ];

  for (const field of booleanFields) {
    if (typeof v[field] !== "boolean") {
      return false;
    }
  }

  if (!Array.isArray(v.reasons)) {
    return false;
  }
  for (const reason of v.reasons) {
    if (typeof reason !== "string") {
      return false;
    }
  }

  if (typeof v.capturedAt !== "number" || !Number.isFinite(v.capturedAt)) {
    return false;
  }

  return true;
}
