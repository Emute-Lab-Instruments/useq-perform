import { describe, expect, it, vi } from "vitest";

import { createEngineIndicatorResumeHandler } from "./engineIndicatorRecovery";

describe("engine indicator recovery wiring", () => {
  it("recovers before resuming on error, while suspended clicks only resume", async () => {
    const calls: string[] = [];
    let state: "error" | "suspended" = "error";
    const service = {
      get state() {
        return state;
      },
      recoverFromError: vi.fn(async () => {
        calls.push("recover");
        return true;
      }),
      resumeOnUserActivation: vi.fn(async () => {
        calls.push("resume");
        return true;
      }),
    };
    const handler = createEngineIndicatorResumeHandler(
      () => ({ state, reasonKey: null, reasonMessage: null, transitionCount: 1, transitionedAt: 1 }),
      () => service as never,
    );

    handler();
    await Promise.resolve();
    expect(calls).toEqual(["recover", "resume"]);

    state = "suspended";
    handler();
    expect(calls).toEqual(["recover", "resume", "resume"]);
    expect(service.recoverFromError).toHaveBeenCalledTimes(1);
  });
});
