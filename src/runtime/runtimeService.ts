/**
 * Barrel re-export — preserves the original public API surface.
 *
 * Implementation has been split into domain-specific services:
 *   - runtimeSessionService.ts  — session/connection state management
 *   - runtimeSettingsService.ts — settings persistence
 *   - runtimeTransportService.ts — transport orchestration & protocol negotiation
 *
 * New code should import from the specific service file directly.
 * This barrel exists for backward compatibility with existing import sites.
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
