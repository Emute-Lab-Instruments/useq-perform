import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { transportMode: "both" as "both" | "wasm" },
}));

vi.mock("../runtime/runtimeService", () => ({
  getRuntimeServiceSnapshot: () => ({ session: mocks.session }),
}));
vi.mock("../contracts/runtimeChannels", () => ({
  driftDetected: { subscribe: vi.fn(() => vi.fn()) },
  connectionChanged: { subscribe: vi.fn(() => vi.fn()) },
}));
vi.mock("./driftDetector", () => ({
  enableDriftDetection: vi.fn(),
  disableDriftDetection: vi.fn(),
  isDriftDetectionEnabled: vi.fn(() => mocks.session.transportMode === "both"),
  resetDriftScores: vi.fn(),
  startEvalCooldownListener: vi.fn(),
  stopEvalCooldownListener: vi.fn(),
}));
vi.mock("./visualisationSampler", () => ({ invalidateFutureProjections: vi.fn() }));
vi.mock("../utils/consoleStore", () => ({ post: vi.fn() }));
vi.mock("../lib/debug", () => ({ dbg: vi.fn() }));

import { initStateSyncOrchestrator, teardownStateSyncOrchestrator } from "./stateSyncOrchestrator";
import { enableDriftDetection } from "./driftDetector";

describe("state sync startup mode", () => {
  beforeEach(() => {
    teardownStateSyncOrchestrator();
    vi.clearAllMocks();
    mocks.session.transportMode = "both";
  });

  it("enables drift detection when initialized after entering both mode", () => {
    initStateSyncOrchestrator({} as never, {} as never);
    expect(enableDriftDetection).toHaveBeenCalledOnce();
    teardownStateSyncOrchestrator();
  });
});
