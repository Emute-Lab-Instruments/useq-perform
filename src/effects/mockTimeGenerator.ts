/**
 * @deprecated Use localClock.ts instead. This file re-exports for backward
 * compatibility and will be removed in a future cleanup.
 */
export {
  startLocalClock as startMockTimeGenerator,
  stopLocalClock as stopMockTimeGenerator,
  resumeLocalClock as resumeMockTimeGenerator,
  resetLocalClock as resetMockTimeGenerator,
  isLocalClockRunning as isMockTimeGeneratorRunning,
  getLocalClockTime as getCurrentMockTime,
} from './localClock.ts';
