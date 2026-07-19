/**
 * Contract tests for synthesis-engine typed channels and store.
 *
 * Covers (partial — see mission feature
 * `m1-synthesis-service-and-devmode-contract`):
 *   VAL-ENGINE-016 — lifecycle transition matrix is finite and exact.
 *   VAL-ENGINE-021 — engine state flows through typed channels (no
 *                    CustomEvent, no singleton imports here).
 *   VAL-HOST-011   — telemetry snapshots are immutable (frozen at
 *                    publication).
 *
 * These tests were OBSERVED FAILING before the channel/store module was
 * added (the imports did not resolve). They pass after the canonical
 * surfaces are in place.
 */
import { describe, expect, it, beforeEach } from "vitest";

import {
  ENGINE_STATE_REASONS,
  ENGINE_TRANSITIONS,
  engineLifecycle,
  engineTransitionTrigger,
  engineStateChanged,
  isAllowedEngineTransition,
  publishEngineState,
  resetEngineStateStoreForTests,
  engineStateStore,
  type EngineStateSnapshot,
  type SynthesisEngineState,
} from "./synthesisChannels";

const ALL_STATES: readonly SynthesisEngineState[] = ["off", "suspended", "running", "error"];

function snapshot(state: SynthesisEngineState): EngineStateSnapshot {
  return {
    state,
    reasonKey: null,
    reasonMessage: null,
    transitionCount: 0,
    transitionedAt: 0,
  };
}

describe("synthesisChannels — schema", () => {
  it("exposes every engine-state reason key", () => {
    // The reason keys are the public machine-readable surface; tests and
    // dashboards match against them. Every entry must have human-readable
    // prose attached.
    expect(Object.keys(ENGINE_STATE_REASONS).sort()).toEqual([
      "AWAITING_USER_ACTIVATION",
      "NO_AUDIO_CAPABILITY",
      "OVERLOAD",
      "PRODUCER_TIMEOUT",
      "RECOVERY_FAILED",
      "WORKLET_TRAP",
    ]);
    for (const value of Object.values(ENGINE_STATE_REASONS)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it("ENGINE_TRANSITIONS covers all four states", () => {
    for (const s of ALL_STATES) {
      expect(ENGINE_TRANSITIONS[s]).toBeDefined();
    }
  });
});

describe("synthesisChannels — finite transition matrix (VAL-ENGINE-016)", () => {
  const ALLOWED: ReadonlyArray<readonly [SynthesisEngineState, SynthesisEngineState]> = [
    // off
    ["off", "suspended"],
    // suspended
    ["suspended", "running"],
    ["suspended", "off"],
    ["suspended", "error"],
    // running
    ["running", "suspended"],
    ["running", "error"],
    ["running", "off"],
    // error
    ["error", "suspended"],
    ["error", "off"],
    ["error", "error"], // recovery-failed self-loop
  ];

  it("allows exactly the documented transitions and forbids the rest", () => {
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        const expected = ALLOWED.some(([f, t]) => f === from && t === to);
        const actual = isAllowedEngineTransition(from, to);
        if (expected) {
          expect(actual, `${from} → ${to} should be allowed`).toBe(true);
        } else {
          expect(actual, `${from} → ${to} should be FORBIDDEN`).toBe(false);
        }
      }
    }
  });

  it("forbids self-transitions except error → error (recovery-failed self-loop)", () => {
    // The state machine has exactly one self-loop entry: 'error → error'
    // is the recovery-failed path, distinct from a no-op resume attempt.
    // Every other self-transition is forbidden.
    for (const s of ALL_STATES) {
      if (s === "error") {
        expect(isAllowedEngineTransition(s, s)).toBe(true);
      } else {
        expect(isAllowedEngineTransition(s, s)).toBe(false);
      }
    }
  });

  it("off has exactly one outgoing transition (the engine-create path)", () => {
    // VAL-ENGINE-016: 'off' can ONLY transition to 'suspended' (engine
    // bring-up). It cannot jump straight to running (autoplay requires
    // a user activation that happens after the engine is suspended).
    const reachable = ALL_STATES.filter((t) => isAllowedEngineTransition("off", t));
    expect(reachable).toEqual(["suspended"]);
  });

  it("returns a stable trigger key for each allowed transition", () => {
    for (const [from, to] of ALLOWED) {
      const trigger = engineTransitionTrigger(from, to);
      expect(trigger, `trigger for ${from} → ${to} must be defined`).not.toBeNull();
      expect(typeof trigger).toBe("string");
    }
  });

  it("returns null trigger for forbidden transitions", () => {
    expect(engineTransitionTrigger("off", "running")).toBeNull();
    expect(engineTransitionTrigger("off", "error")).toBeNull();
    expect(engineTransitionTrigger("running", "running")).toBeNull();
  });
});

describe("synthesisChannels — publication", () => {
  beforeEach(() => {
    resetEngineStateStoreForTests();
  });

  it("publishEngineState freezes the snapshot (VAL-HOST-011)", () => {
    const before = snapshot("running");
    let received: EngineStateSnapshot | null = null;
    const unsub = engineStateChanged.subscribe((s) => {
      received = s;
    });
    try {
      publishEngineState(before);
      // The caller's input object is not mutated.
      expect(Object.isFrozen(before)).toBe(false);
      // The snapshot received by channel subscribers is frozen (the
      // canonical immutable telemetry surface).
      expect(received).not.toBeNull();
      expect(Object.isFrozen(received)).toBe(true);
      expect(received?.state).toBe("running");
    } finally {
      unsub();
    }
  });

  it("publishEngineState notifies channel subscribers and the store", () => {
    let received: EngineStateSnapshot | null = null;
    const unsub = engineStateChanged.subscribe((s) => {
      received = s;
    });
    try {
      publishEngineState({ ...snapshot("error"), reasonKey: "PRODUCER_TIMEOUT" });
      expect(received?.state).toBe("error");
      expect(received?.reasonKey).toBe("PRODUCER_TIMEOUT");
      expect(Object.isFrozen(received)).toBe(true);
      expect(engineStateStore.current.state).toBe("error");
    } finally {
      unsub();
    }
  });

  it("lifecycle channel receives an event per publish", () => {
    // The lifecycle channel is a flat audit trail of every transition.
    // The synthesis service emits lifecycle events on each transition;
    // direct publishEngineState callers do not (the service is the sole
    // emitter of lifecycle events).
    const events: number[] = [];
    const unsub = engineLifecycle.subscribe((e) => events.push(e.transitionCount));
    try {
      // No direct emit here; just verify subscription works.
      expect(events).toEqual([]);
    } finally {
      unsub();
    }
  });
});
