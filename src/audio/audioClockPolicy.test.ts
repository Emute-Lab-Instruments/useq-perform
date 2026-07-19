/**
 * Contract tests for the audio clock policy.
 *
 * Covers (see mission feature `m1-audio-clocked-worker-producer`):
 *   VAL-ENGINE-002 — Audio frames become the live master clock while
 *                    rAF remains presentation-only. Pausing or
 *                    throttling rAF neither stops the audio timeline
 *                    nor advances a second timeline.
 *
 * The tests exercise every engine state and confirm that:
 *   - rAF's local-time mode is allowed when audio is `off` or `error`;
 *   - rAF's local-time mode is forbidden when audio is `running` or
 *     `suspended` (audio owns the timeline);
 *   - the helper reads the typed engine state store, so it tracks
 *     engine transitions deterministically.
 */
import { describe, expect, it, beforeEach } from "vitest";

import {
  resetEngineStateStoreForTests,
  setEngineStateStore,
  type EngineStateSnapshot,
} from "../contracts/synthesisChannels";
import {
  shouldAdvanceLocalTime,
  audioIsMasterClock,
} from "./audioClockPolicy";

function snapshot(state: EngineStateSnapshot["state"]): EngineStateSnapshot {
  return Object.freeze({
    state,
    reasonKey: null,
    reasonMessage: null,
    transitionCount: 0,
    transitionedAt: 0,
  });
}

function publish(state: EngineStateSnapshot["state"]): void {
  setEngineStateStore({ current: snapshot(state) });
}

describe("audioClockPolicy / VAL-ENGINE-002", () => {
  beforeEach(() => {
    resetEngineStateStoreForTests();
  });

  it("allows local-time advancement when engine is off", () => {
    publish("off");
    expect(shouldAdvanceLocalTime()).toBe(true);
    expect(audioIsMasterClock()).toBe(false);
  });

  it("forbids local-time advancement when engine is running", () => {
    publish("running");
    expect(shouldAdvanceLocalTime()).toBe(false);
    expect(audioIsMasterClock()).toBe(true);
  });

  it("forbids local-time advancement when engine is suspended", () => {
    publish("suspended");
    expect(shouldAdvanceLocalTime()).toBe(false);
    expect(audioIsMasterClock()).toBe(true);
  });

  it("allows local-time advancement when engine is in error", () => {
    // After a producer failure, the audio path is silent and the
    // producer is halted. Local-time mode may resume advancing so the
    // visualisation sampler stays responsive for diagnostics.
    publish("error");
    expect(shouldAdvanceLocalTime()).toBe(true);
    expect(audioIsMasterClock()).toBe(false);
  });

  it("tracks engine transitions deterministically", () => {
    publish("off");
    expect(shouldAdvanceLocalTime()).toBe(true);
    publish("suspended");
    expect(shouldAdvanceLocalTime()).toBe(false);
    publish("running");
    expect(shouldAdvanceLocalTime()).toBe(false);
    publish("error");
    expect(shouldAdvanceLocalTime()).toBe(true);
    publish("off");
    expect(shouldAdvanceLocalTime()).toBe(true);
  });
});
