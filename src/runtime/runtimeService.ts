/**
 * runtimeService — the public runtime-service facade.
 *
 * This is the canonical import surface for runtime operations (settings
 * mutation, session/connection state, transport orchestration). All consumers
 * import from here; it is not a legacy shim and has no parallel code path.
 *
 * The implementation is split into domain-specific service files for internal
 * organisation only:
 *   - runtimeSessionService.ts   — session/connection state management
 *   - runtimeSettingsService.ts  — settings persistence (sole settings mutation)
 *   - runtimeTransportService.ts — transport orchestration & protocol negotiation
 *
 * Per docs/specs/settings.md §1.2, settings mutations go through
 * `runtimeService.updateSettings(patch)` (re-exported below).
 */

// ── Session service ────────────────────────────────────────────
export type { RuntimeSessionState } from "./runtimeSessionService";
export {
  bootstrapRuntimeSession,
  refreshRuntimeSession,
  announceRuntimeSession,
  reportTransportConnectionChanged,
  updateRuntimeSettingsEffect,
  getRuntimeServiceSnapshot,
  subscribeRuntimeService,
  isRuntimeHardwareConnected,
  isRuntimeWasmEnabled,
  resetRuntimeServiceForTests,
} from "./runtimeSessionService";

// ── Settings service ───────────────────────────────────────────
export {
  replaceSettings,
  updateSettings,
  resetSettings,
  loadSettings,
  deletePersistedSettings,
  getSettings,
} from "./runtimeSettingsService";

// ── Transport service ──────────────────────────────────────────
export {
  toggleRuntimeConnection,
  resolveRuntimeTransportMode,
  reportProtocolModeChanged,
  sendRuntimeTransportCommand,
  queryRuntimeHardwareTransportState,
  syncRuntimeWasmTransportState,
} from "./runtimeTransportService";
