// src/contracts/runtimeChannels.ts
//
// Typed pub/sub channels for runtime events.  Replaces the browser
// CustomEvent-based event bus in runtimeEvents.ts with direct subscriptions
// that give consumers compile-time type safety and make event flow visible
// through imports.

import { createChannel, type TypedChannel } from "../lib/typedChannel";

import type {
  ConnectionChangedDetail,
  ProtocolReadyDetail,
  JsonMetaEventDetail,
  CodeEvaluatedDetail,
  AnimateConnectDetail,
  DevicePluggedInDetail,
} from "./runtimeEvents";

import type {
  RuntimeDiagnosticsSnapshot,
  RuntimeBootstrapFailure,
} from "../runtime/runtimeDiagnostics";

import type { AppSettings } from "../lib/appSettings";

// ── Channels ────────────────────────────────────────────────────

/** Transport connection state changed (connected / disconnected / mode change). */
export const connectionChanged = createChannel<ConnectionChangedDetail>();

/** Protocol negotiation completed (JSON or legacy). */
export const protocolReady = createChannel<ProtocolReadyDetail>();

/** JSON meta response received from firmware. */
export const jsonMeta = createChannel<JsonMetaEventDetail>();

/** Runtime diagnostics snapshot updated. */
export const runtimeDiagnostics = createChannel<RuntimeDiagnosticsSnapshot>();

/** A bootstrap failure was recorded. */
export const bootstrapFailure = createChannel<RuntimeBootstrapFailure>();

/** Code was evaluated (WASM or hardware). */
export const codeEvaluated = createChannel<CodeEvaluatedDetail>();

/** UI should animate the connect button (e.g. device not connected yet). */
export const animateConnect = createChannel<AnimateConnectDetail>();

/** A previously-saved serial device was physically plugged in. */
export const devicePluggedIn = createChannel<DevicePluggedInDetail>();

/** App settings changed (published by runtimeService after any mutation). */
export const settingsChanged = createChannel<AppSettings>();

// ── Re-export the channel type for convenience ──────────────────

export type { TypedChannel };
