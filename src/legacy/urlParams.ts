/**
 * Re-export from canonical location.
 * Legacy code should migrate to import from src/runtime/urlParams.ts directly.
 */
export {
  readStartupFlags,
  applyStartupFlags,
  getStartupFlags,
  resetStartupFlagsForTests,
} from "../runtime/urlParams.ts";
