// src/contracts/runtimeTypes.ts
//
// Shared type definitions for runtime session and diagnostics.
// These types live in contracts/ so that both contracts/ and runtime/
// can import them without creating upward dependency violations.

import { findNodeDefDescriptor } from "./nodeDefRegistry";
import {
  DEFAULT_BLOCK_RATE_COUNT,
  DEFAULT_FAST_RATE_COUNT,
  MAX_SYNTH_NODES,
  controlChannelKey,
} from "./synthesisControlAbi";
import type { NodeDefDescriptor } from "./nodeDefRegistry";

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

/** Limits imposed by the C++ ABI fields serialised into the payload. */
const SYNTH_ARTIFACT_UINT16_MAX = 0xffff;
const SYNTH_ARTIFACT_UINT32_MAX = 0xffff_ffff;
/** C++ stores these strings in 32-byte, NUL-terminated arrays. */
const SYNTH_ARTIFACT_STRING_MAX = 31;

export type SynthArtifactsValidationCode =
  | "not-an-object"
  | "abi-error-envelope"
  | "abi-mismatch"
  | "invalid-field"
  | "resource-limit"
  | "unknown-nodedef"
  | "duplicate-identity"
  | "unknown-control-owner"
  | "unknown-control-param"
  | "duplicate-control-key"
  | "control-contract-mismatch"
  | "unknown-connection-endpoint"
  | "invalid-connection-port"
  | "duplicate-connection-port"
  | "cyclic-routing";

export type SynthArtifactsValidationResult =
  | { readonly ok: true; readonly payload: SynthArtifactsPayload }
  | {
      readonly ok: false;
      readonly code: SynthArtifactsValidationCode;
      readonly reason: string;
    };

export interface SynthArtifactsValidationOptions {
  /** Expected wire ABI. Defaults to the editor's canonical ABI. */
  readonly expectedAbi?: number;
  /**
   * Resolve a NodeDef known to the consuming engine. The synthesis service
   * supplies its configured registry; other consumers use the static one.
   */
  readonly findDescriptor?: (
    name: string,
    version: number,
  ) => NodeDefDescriptor | null;
  /** Maximum declaration rows accepted by this host session. */
  readonly maxDeclarations?: number;
  /** Maximum block-rate rows accepted by this host session. */
  readonly maxBlockRateControls?: number;
  /** Maximum fast-rate rows accepted by this host session. */
  readonly maxFastRateControls?: number;
}

function invalidSynthArtifacts(
  code: SynthArtifactsValidationCode,
  reason: string,
): SynthArtifactsValidationResult {
  return { ok: false, code, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedUint(value: unknown, max: number, min = 0): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  );
}

function isArtifactString(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > SYNTH_ARTIFACT_STRING_MAX
  ) {
    return false;
  }
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    // NUL would collide in the composite control key; all C0 controls and
    // DEL are outside the compiler's serialised identifier surface.
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/**
 * Exhaustively validate the untrusted Worker-to-host synth artefact boundary.
 *
 * Validation covers the nested row shapes, C++ integer/string bounds,
 * resource limits, unique declaration identities and control keys, NodeDef
 * ownership/metadata, connection endpoints/ports, and routing acyclicity.
 * Callers MUST run this before building a commit plan or posting messages.
 */
export function validateSynthArtifactsPayload(
  payload: unknown,
  options: SynthArtifactsValidationOptions = {},
): SynthArtifactsValidationResult {
  if (!isRecord(payload)) {
    return invalidSynthArtifacts("not-an-object", "payload is not an object");
  }
  if (payload.abi_error === true) {
    return invalidSynthArtifacts(
      "abi-error-envelope",
      "payload is an ABI error envelope",
    );
  }

  const expectedAbi = options.expectedAbi ?? SYNTH_ARTIFACT_ABI_VERSION;
  if (!isBoundedUint(payload.abi, SYNTH_ARTIFACT_UINT16_MAX, 1)) {
    return invalidSynthArtifacts(
      "invalid-field",
      "abi must be a finite positive uint16",
    );
  }
  if (payload.abi !== expectedAbi) {
    return invalidSynthArtifacts(
      "abi-mismatch",
      `abi ${payload.abi} does not match consumer ABI ${expectedAbi}`,
    );
  }
  if (!isBoundedUint(payload.revision, SYNTH_ARTIFACT_UINT32_MAX)) {
    return invalidSynthArtifacts(
      "invalid-field",
      "revision must be a finite uint32",
    );
  }
  if (!Array.isArray(payload.declarations)) {
    return invalidSynthArtifacts(
      "invalid-field",
      "declarations must be an array",
    );
  }
  if (!Array.isArray(payload.controls)) {
    return invalidSynthArtifacts("invalid-field", "controls must be an array");
  }
  if (
    payload.connections !== undefined &&
    !Array.isArray(payload.connections)
  ) {
    return invalidSynthArtifacts(
      "invalid-field",
      "connections must be an array when present",
    );
  }

  const maxDeclarations = options.maxDeclarations ?? MAX_SYNTH_NODES;
  if (payload.declarations.length > maxDeclarations) {
    return invalidSynthArtifacts(
      "resource-limit",
      `declarations length ${payload.declarations.length} exceeds ${maxDeclarations}`,
    );
  }

  const descriptorFor = options.findDescriptor ?? findNodeDefDescriptor;
  const declarations = new Map<
    string,
    { row: SynthDeclarationArtefact; descriptor: NodeDefDescriptor }
  >();
  let totalAudioInputs = 0;

  for (let i = 0; i < payload.declarations.length; i += 1) {
    const value = payload.declarations[i];
    if (!isRecord(value)) {
      return invalidSynthArtifacts(
        "invalid-field",
        `declarations[${i}] must be an object`,
      );
    }
    if (!isArtifactString(value.identity)) {
      return invalidSynthArtifacts(
        "invalid-field",
        `declarations[${i}].identity is invalid`,
      );
    }
    if (!isArtifactString(value.def)) {
      return invalidSynthArtifacts(
        "invalid-field",
        `declarations[${i}].def is invalid`,
      );
    }
    if (!isBoundedUint(value.version, SYNTH_ARTIFACT_UINT16_MAX, 1)) {
      return invalidSynthArtifacts(
        "invalid-field",
        `declarations[${i}].version must be a finite positive uint16`,
      );
    }
    if (!isBoundedUint(value.audio_inputs, SYNTH_ARTIFACT_UINT16_MAX)) {
      return invalidSynthArtifacts(
        "invalid-field",
        `declarations[${i}].audio_inputs must be a finite uint16`,
      );
    }
    if (!isBoundedUint(value.audio_outputs, SYNTH_ARTIFACT_UINT16_MAX)) {
      return invalidSynthArtifacts(
        "invalid-field",
        `declarations[${i}].audio_outputs must be a finite uint16`,
      );
    }
    if (declarations.has(value.identity)) {
      return invalidSynthArtifacts(
        "duplicate-identity",
        `duplicate declaration identity ${JSON.stringify(value.identity)}`,
      );
    }
    const descriptor = descriptorFor(value.def, value.version);
    if (descriptor === null) {
      return invalidSynthArtifacts(
        "unknown-nodedef",
        `unknown NodeDef ${value.def} v${value.version}`,
      );
    }
    if (
      value.audio_inputs !== descriptor.audioInputs ||
      value.audio_outputs !== descriptor.audioOutputs
    ) {
      return invalidSynthArtifacts(
        "invalid-field",
        `declaration ${value.identity} port counts do not match ${value.def} v${value.version}`,
      );
    }
    const row = value as unknown as SynthDeclarationArtefact;
    declarations.set(value.identity, { row, descriptor });
    totalAudioInputs += descriptor.audioInputs;
  }

  const maxBlockRateControls =
    options.maxBlockRateControls ?? DEFAULT_BLOCK_RATE_COUNT;
  const maxFastRateControls =
    options.maxFastRateControls ?? DEFAULT_FAST_RATE_COUNT;
  if (payload.controls.length > maxBlockRateControls + maxFastRateControls) {
    return invalidSynthArtifacts(
      "resource-limit",
      `controls length ${payload.controls.length} exceeds available control channels ${maxBlockRateControls + maxFastRateControls}`,
    );
  }
  let blockRateControls = 0;
  let fastRateControls = 0;
  const controlKeys = new Set<string>();

  for (let i = 0; i < payload.controls.length; i += 1) {
    const value = payload.controls[i];
    if (!isRecord(value)) {
      return invalidSynthArtifacts(
        "invalid-field",
        `controls[${i}] must be an object`,
      );
    }
    if (!isArtifactString(value.identity) || !isArtifactString(value.param)) {
      return invalidSynthArtifacts(
        "invalid-field",
        `controls[${i}] identity/param is invalid`,
      );
    }
    if (value.rate !== "block" && value.rate !== "fast") {
      return invalidSynthArtifacts(
        "invalid-field",
        `controls[${i}].rate is invalid`,
      );
    }
    if (
      value.smoothing !== "step" &&
      value.smoothing !== "linear" &&
      value.smoothing !== "slew" &&
      value.smoothing !== "latch"
    ) {
      return invalidSynthArtifacts(
        "invalid-field",
        `controls[${i}].smoothing is invalid`,
      );
    }

    const owner = declarations.get(value.identity);
    if (!owner) {
      return invalidSynthArtifacts(
        "unknown-control-owner",
        `control ${value.identity}/${value.param} has no declaration`,
      );
    }
    const param = owner.descriptor.params.find((p) => p.name === value.param);
    if (!param) {
      return invalidSynthArtifacts(
        "unknown-control-param",
        `control ${value.identity}/${value.param} is not declared by ${owner.descriptor.name}`,
      );
    }
    if (param.rate !== value.rate || param.smoothing !== value.smoothing) {
      return invalidSynthArtifacts(
        "control-contract-mismatch",
        `control ${value.identity}/${value.param} rate or smoothing does not match its NodeDef`,
      );
    }
    const key = controlChannelKey(value.identity, value.param);
    if (controlKeys.has(key)) {
      return invalidSynthArtifacts(
        "duplicate-control-key",
        `duplicate control key ${value.identity}/${value.param}`,
      );
    }
    controlKeys.add(key);

    if (value.rate === "block") {
      blockRateControls += 1;
      if (blockRateControls > maxBlockRateControls) {
        return invalidSynthArtifacts(
          "resource-limit",
          `block-rate controls exceed ${maxBlockRateControls}`,
        );
      }
    } else {
      fastRateControls += 1;
      if (fastRateControls > maxFastRateControls) {
        return invalidSynthArtifacts(
          "resource-limit",
          `fast-rate controls exceed ${maxFastRateControls}`,
        );
      }
    }
  }

  const connections = payload.connections ?? [];
  if (connections.length > totalAudioInputs) {
    return invalidSynthArtifacts(
      "resource-limit",
      `connections length ${connections.length} exceeds available input ports ${totalAudioInputs}`,
    );
  }

  const occupiedInputs = new Set<string>();
  const routing = new Map<string, string[]>();
  for (const identity of declarations.keys()) routing.set(identity, []);

  for (let i = 0; i < connections.length; i += 1) {
    const value = connections[i];
    if (!isRecord(value)) {
      return invalidSynthArtifacts(
        "invalid-field",
        `connections[${i}] must be an object`,
      );
    }
    if (
      !isArtifactString(value.from) ||
      !isArtifactString(value.to) ||
      !isArtifactString(value.port)
    ) {
      return invalidSynthArtifacts(
        "invalid-field",
        `connections[${i}] endpoint/port is invalid`,
      );
    }
    if (!isBoundedUint(value.port_index, SYNTH_ARTIFACT_UINT16_MAX)) {
      return invalidSynthArtifacts(
        "invalid-connection-port",
        `connections[${i}].port_index must be a finite uint16`,
      );
    }
    const source = declarations.get(value.from);
    const destination = declarations.get(value.to);
    if (!source || !destination) {
      return invalidSynthArtifacts(
        "unknown-connection-endpoint",
        `connection ${value.from} -> ${value.to} has an unknown endpoint`,
      );
    }
    if (
      source.descriptor.audioOutputs < 1 ||
      value.port_index >= destination.descriptor.audioInputs
    ) {
      return invalidSynthArtifacts(
        "invalid-connection-port",
        `connection ${value.from} -> ${value.to} addresses an unavailable port`,
      );
    }
    const inputKey = `${value.to}\u0000${value.port_index}`;
    if (occupiedInputs.has(inputKey)) {
      return invalidSynthArtifacts(
        "duplicate-connection-port",
        `multiple connections drive ${value.to} input ${value.port_index}`,
      );
    }
    occupiedInputs.add(inputKey);
    routing.get(value.from)!.push(value.to);
  }

  const visitState = new Map<string, 0 | 1 | 2>();
  const visit = (identity: string): boolean => {
    const state = visitState.get(identity) ?? 0;
    if (state === 1) return false;
    if (state === 2) return true;
    visitState.set(identity, 1);
    for (const destination of routing.get(identity) ?? []) {
      if (!visit(destination)) return false;
    }
    visitState.set(identity, 2);
    return true;
  };
  for (const identity of declarations.keys()) {
    if (!visit(identity)) {
      return invalidSynthArtifacts(
        "cyclic-routing",
        "audio routing graph contains a cycle",
      );
    }
  }

  return { ok: true, payload: payload as unknown as SynthArtifactsPayload };
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
 * Type guard that narrows an untrusted parsed value only after exhaustive
 * validation against the canonical ABI, static NodeDef registry, resource
 * limits, ownership rules, port bounds, and acyclic-routing contract.
 * Services with an injected NodeDef registry should call
 * {@link validateSynthArtifactsPayload} with their own resolver.
 */
export function isSynthArtifactsPayload(
  payload: unknown,
): payload is SynthArtifactsPayload {
  return validateSynthArtifactsPayload(payload).ok;
}
