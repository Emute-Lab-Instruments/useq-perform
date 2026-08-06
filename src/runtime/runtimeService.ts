/**
 * runtimeService — the public runtime-service facade.
 *
 * This is the canonical consumer-facing import surface for runtime operations
 * (settings mutation, session/connection state, transport orchestration).
 * Transport producers report facts directly to runtimeSessionService so they
 * do not create a cycle through this facade and its transport re-exports.
 *
 * The implementation is split into domain-specific service files for internal
 * organisation only:
 *   - runtimeSessionService.ts   — session/connection state management
 *   - runtimeSettingsService.ts  — settings persistence (sole settings mutation)
 *   - runtimeTransportService.ts — transport orchestration & protocol negotiation
 *
 * Per docs/specs/settings.md §1.2, settings mutations go through
 * `runtimeService.updateSettings(patch)` (re-exported below).
 * Mutable runtime selection/session state is owned by runtimeCoordinator.ts;
 * this facade exposes its consumer operations without becoming another owner.
 */

// ── Session service ────────────────────────────────────────────
export type { RuntimeSessionState } from "./runtimeSessionService";
export {
  bootstrapRuntimeSession,
  refreshRuntimeSession,
  announceRuntimeSession,
  reportTransportConnectionChanged,
  reportProtocolModeChanged,
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
  sendRuntimeTransportCommand,
  queryRuntimeHardwareTransportState,
  syncRuntimeWasmTransportState,
} from "./runtimeTransportService";
