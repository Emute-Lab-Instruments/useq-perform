// src/contracts/runtimeTypes.ts
//
// Shared type definitions for runtime session and diagnostics.
// These types live in contracts/ so that both contracts/ and runtime/
// can import them without creating upward dependency violations.

// ── Session types ──────────────────────────────────────────────

export type RuntimeConnectionMode = "hardware" | "browser" | "none";
export type TransportMode = "hardware" | "wasm" | "both" | "none";

export interface RuntimeSessionInputs {
  hasHardwareConnection: boolean;
  noModuleMode: boolean;
  wasmEnabled: boolean;
}

export interface RuntimeSessionSnapshot extends RuntimeSessionInputs {
  connectionMode: RuntimeConnectionMode;
  transportMode: TransportMode;
}

// ── Interpreter diagnostic type ───────────────────────────────
//
// Canonical type for structured diagnostics from the ModuLisp interpreter
// (errors, warnings, hints with source spans). Both the WASM and hardware
// paths produce this shape; the hardware path will emit the same JSON once
// the firmware ships it.

export interface UseqDiagnostic {
  start: number;
  end: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  suggestion?: string;
  example?: string;
  /**
   * Wire category (`src-useq/docs/specs/diagnostics.md` §2.3), e.g.
   * `"undefinedName"`, `"arity"`, `"type"`. Emitted by
   * `wasm_wrapper.cpp` on every diagnostic; declared optional because the
   * hardware path does not ship it yet.
   *
   * Consumed by the diagnostics → guide deep-link
   * (`src/lib/diagnosticGuideLinks.ts`, the-machine.md §5.1).
   */
  category?: string;
}

/**
 * Sanctioned alias for {@link UseqDiagnostic}. Used across the live
 * runtime/worker port path (runtimePorts, worker protocol, transport service).
 * Both names refer to the same diagnostic shape; prefer `UseqDiagnostic` in
 * new interpreter-facing code and `RuntimeDiagnostic` in runtime/port code.
 */
export type RuntimeDiagnostic = UseqDiagnostic;

// ── Diagnostics types ──────────────────────────────────────────

export type RuntimeProtocolMode = "legacy" | "json";
export type RuntimeSettingsSource =
  | "defaults"
  | "local-storage"
  | "url-config"
  | "url-code"
  | "nosave";
export type StartupMode =
  | "hardware"
  | "browser-local"
  | "no-module"
  | "unsupported-browser";

export interface ActiveEnvironmentSnapshot {
  areInBrowser: boolean;
  areInDesktopApp: boolean;
  isWebSerialAvailable: boolean;
  isInDevmode: boolean;
  urlParams: Record<string, string>;
}

export interface RuntimeBootstrapFailure {
  scope: string;
  message: string;
}

// ── State snapshot types (state-sync.md) ─────────────────────

export interface StateSnapshotCell {
  type: "number" | "data" | "callable" | "nil";
  value?: number;
  values?: number[];
  source?: string;
}

export interface StateSnapshotOutput {
  source: string;
  health: "idle" | "running" | "fallback" | "error";
  lkgValue: number;
}

export interface StateSnapshotSlot {
  id: string;
  value: number;
}

export interface StateSnapshotLiveSlot {
  id: string;
  value: number;
  min: number;
  max: number;
}

export interface StateSnapshot {
  transport: { playing: boolean; timeOffset: number };
  time: number;
  cells: Record<string, StateSnapshotCell>;
  outputs: Record<string, StateSnapshotOutput>;
  stateSlots: StateSnapshotSlot[];
  liveSlots: StateSnapshotLiveSlot[];
}

export interface RuntimeDiagnosticsSnapshot {
  startupMode: StartupMode;
  protocolMode: RuntimeProtocolMode;
  settingsSources: RuntimeSettingsSource[];
  activeEnvironment: ActiveEnvironmentSnapshot;
  runtimeSession: RuntimeSessionSnapshot;
  bootstrapFailures: RuntimeBootstrapFailure[];
}

// ── Synth artefact types (synth-nodes.md §7.2) ────────────────
//
// Versioned synth patch-graph and control-channel artefacts returned by
// the existing WASM Worker handler alongside the exact-eval diagnostics.
//
// The schema mirrors the C++ `synth_artifacts_render_abi_wrapper` payload
// byte-for-byte (VAL-COMP-016). Consumers MUST consult `abi` and reject
// the payload when it does not equal the canonical
// SYNTH_ARTIFACT_ABI_VERSION constant.

/**
 * Canonical ABI version the editor expects from the WASM bundle's synth
 * artefact payload. Must match `sig::SYNTH_ARTIFACT_ABI_VERSION` in
 * `src-useq/uSEQ/src/signal_engine/synth_graph.h`.
 */
export const SYNTH_ARTIFACT_ABI_VERSION = 1 as const;

/** One declared synth node instance keyed by stable editor identity. */
export interface SynthDeclarationArtefact {
  identity: string;
  def: string;
  version: number;
  audio_inputs: number;
  audio_outputs: number;
}

/** One bound synth control channel (one row per declaration × param). */
export interface SynthControlChannelArtefact {
  identity: string;
  param: string;
  rate: "block" | "fast";
  smoothing: "step" | "linear" | "slew" | "latch";
}

/**
 * One audio-port connection: the node whose output (`from`) feeds an
 * audio-input port (`port`, at `port_index` within the destination def's
 * declared input ports) on the destination node (`to`). Only committed,
 * validated edges appear — the compiler rejects unresolved sources and
 * cycles at eval commit (synth-nodes.md §4.4/§4.5, §7.2.1).
 */
export interface SynthConnectionArtefact {
  from: string;
  to: string;
  port: string;
  port_index: number;
}

/**
 * Versioned synth artefact payload returned atomically from the exact-eval
 * Worker response. The `abi` marker lets consumers reject incompatible
 * bundles up front (VAL-COMP-015).
 *
 * `revision` is the shared compiler revision that covers both the patch
 * graph and the control table for this commit (VAL-COMP-009). `declarations`
 * and `controls` are intentionally narrow public views: internal GC-remapped
 * node indices are never exposed (VAL-COMP-012).
 *
 * `connections` joined the schema additively within ABI version 1 (M2.2,
 * synth-nodes.md §7.2.2): payloads from older engine bundles may omit it,
 * which consumers treat as an empty edge set.
 */
export interface SynthArtifactsPayload {
  abi: number;
  revision: number;
  declarations: SynthDeclarationArtefact[];
  controls: SynthControlChannelArtefact[];
  connections?: SynthConnectionArtefact[];
}

/**
 * Minimal error envelope the WASM wrapper returns when a consumer built
 * against an incompatible ABI version tries to read the synth artefact
 * payload. Consumers MUST consult `synthArtifactsSupportsAbi()` before
 * interpreting the body bytes.
 */
export interface SynthArtifactsAbiError {
  abi: number;
  abi_error: true;
  engine_abi: number;
  consumer_abi: number;
}

/**
 * Return true iff a consumer built against `consumerAbiVersion` can safely
 * read a payload produced by the engine's declared ABI version. Mirrors
 * `sig::synth_artifacts_supports_abi` (VAL-COMP-015).
 */
export function synthArtifactsSupportsAbi(
  consumerAbiVersion: number,
): boolean {
  return consumerAbiVersion === SYNTH_ARTIFACT_ABI_VERSION;
}

/**
 * Type guard that narrows a parsed payload to the canonical
 * {@link SynthArtifactsPayload} shape after the caller has confirmed
 * `synthArtifactsSupportsAbi(payload.abi)` returns true.
 */
export function isSynthArtifactsPayload(
  payload: unknown,
): payload is SynthArtifactsPayload {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return (
    typeof p.abi === "number" &&
    typeof p.revision === "number" &&
    Array.isArray(p.declarations) &&
    Array.isArray(p.controls) &&
    p.abi_error !== true
  );
}
