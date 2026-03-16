/**
 * Re-export from canonical location.
 * Legacy code should migrate to import from src/effects/mockTimeGenerator.ts directly.
 */
export {
  startMockTimeGenerator,
  stopMockTimeGenerator,
  isMockTimeGeneratorRunning,
  getCurrentMockTime,
  resetMockTimeGenerator,
  resumeMockTimeGenerator,
} from "../../effects/mockTimeGenerator.ts";
