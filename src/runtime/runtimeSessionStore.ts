/**
 * Compatibility import surface. Runtime state is owned by
 * `runtimeCoordinator.ts`; this file contains no mutable state.
 */
export type { RuntimeSessionState } from "./runtimeCoordinator.ts";
export {
  getRuntimeSessionState,
  resetRuntimeSessionState,
  runtimeSessionState,
  subscribeRuntimeSessionState,
  teardownRuntimeSessionState,
  updateRuntimeSessionState,
} from "./runtimeCoordinator.ts";
