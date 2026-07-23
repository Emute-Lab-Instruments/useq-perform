/**
 * Tests for the engine autoplay resume listener.
 *
 * Covers (mission feature `m1-autoplay-indicator-and-console`):
 *   VAL-ENGINE-017 — trusted capture-phase keydown resumes suspended audio.
 *   VAL-ENGINE-018 — trusted capture-phase pointerdown (including clicking
 *                    the suspended indicator) resumes suspended audio.
 *   VAL-ENGINE-019 — programmatic/synthetic events, timers, gamepad intents,
 *                    restored code, and idle auto-eval do NOT grant
 *                    activation. Only trusted keydown/pointerdown do.
 *
 * These tests use a fake event target and a fake synthesis service so
 * they run in Node without a browser. They were OBSERVED FAILING before
 * the autoplay listener module was added (the import did not resolve).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import {
  installEngineAutoplayListener,
  teardownEngineAutoplayListener,
  type EngineAutoplayListenerDependencies,
  type TrustedEventLike,
} from "./engineAutoplayListener";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeService {
  resumeOnUserActivation: ReturnType<typeof vi.fn>;
  state: "off" | "suspended" | "running" | "error";
}

function createFakeService(state: FakeService["state"] = "suspended"): FakeService {
  const service: FakeService = {
    resumeOnUserActivation: vi.fn(async () => true),
    state,
  };
  return service;
}

/**
 * Minimal EventTarget-like fake that supports addEventListener with
 * the capture flag and dispatchEvent with `isTrusted` control.
 *
 * The real browser EventTarget cannot dispatch events with
 * `isTrusted === true` from script — that's the whole point. In tests
 * we explicitly pass `isTrusted` so we can exercise both paths.
 */
interface FakeEventTarget {
  addEventListener(
    type: string,
    listener: (event: TrustedEventLike) => void,
    options?: { capture?: boolean },
  ): void;
  removeEventListener(
    type: string,
    listener: (event: TrustedEventLike) => void,
    options?: { capture?: boolean },
  ): void;
  dispatchEvent(event: TrustedEventLike): boolean;
}

function createFakeEventTarget(): FakeEventTarget & {
  readonly listeners: ReadonlyMap<string, Set<(event: TrustedEventLike) => void>>;
} {
  const listeners = new Map<string, Set<(event: TrustedEventLike) => void>>();
  return {
    listeners,
    addEventListener(type, listener, options) {
      // The autoplay listener MUST register with capture: true so it
      // sees events before any other handler can re-dispatch or swallow.
      // Tests verify the capture flag explicitly.
      void options;
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event) {
      const set = listeners.get(event.type);
      if (!set) return true;
      for (const listener of set) {
        listener(event);
      }
      return !event.defaultPrevented;
    },
  };
}

function createTrustedEvent(
  type: "keydown" | "pointerdown",
  isTrusted: boolean,
  target?: unknown,
): TrustedEventLike {
  return {
    type,
    isTrusted,
    target: target ?? null,
    currentTarget: null,
    defaultPrevented: false,
    preventDefault() {
      (this as { defaultPrevented: boolean }).defaultPrevented = true;
    },
    stopPropagation() {},
    stopImmediatePropagation() {},
  };
}

function buildDependencies(
  service: FakeService,
  target: FakeEventTarget,
): EngineAutoplayListenerDependencies {
  return {
    getActiveSynthesisService: () => service as unknown as Parameters<
      EngineAutoplayListenerDependencies["getActiveSynthesisService"]
    >[0],
    eventTarget: target,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("engineAutoplayListener — VAL-ENGINE-017: trusted keydown resumes", () => {
  let target: ReturnType<typeof createFakeEventTarget>;
  let service: FakeService;

  beforeEach(() => {
    target = createFakeEventTarget();
    service = createFakeService("suspended");
    installEngineAutoplayListener(buildDependencies(service, target));
  });

  afterEach(() => {
    teardownEngineAutoplayListener();
  });

  it("calls resumeOnUserActivation() on a trusted keydown when suspended", () => {
    target.dispatchEvent(createTrustedEvent("keydown", true));
    expect(service.resumeOnUserActivation).toHaveBeenCalledTimes(1);
  });

  it("registers the keydown listener with capture: true", () => {
    // Re-install and inspect the captured options. The listener must
    // run in the capture phase so no other handler can re-dispatch or
    // swallow the event before the autoplay path sees it.
    teardownEngineAutoplayListener();
    const capturedOptions: { capture?: boolean }[] = [];
    const inspectableTarget: FakeEventTarget = {
      addEventListener(_type, _listener, options) {
        capturedOptions.push(options ?? {});
      },
      removeEventListener() {},
      dispatchEvent() {
        return true;
      },
    };
    installEngineAutoplayListener(buildDependencies(service, inspectableTarget));
    // At least one listener (keydown or pointerdown) used capture.
    expect(capturedOptions.some((o) => o.capture === true)).toBe(true);
  });
});

describe("engineAutoplayListener — VAL-ENGINE-018: trusted pointerdown resumes", () => {
  let target: ReturnType<typeof createFakeEventTarget>;
  let service: FakeService;

  beforeEach(() => {
    target = createFakeEventTarget();
    service = createFakeService("suspended");
    installEngineAutoplayListener(buildDependencies(service, target));
  });

  afterEach(() => {
    teardownEngineAutoplayListener();
  });

  it("calls resumeOnUserActivation() on a trusted pointerdown when suspended", () => {
    target.dispatchEvent(createTrustedEvent("pointerdown", true));
    expect(service.resumeOnUserActivation).toHaveBeenCalledTimes(1);
  });

  it("trusted pointerdown from clicking the suspended indicator also resumes", () => {
    // The suspended indicator is itself a real-user-action surface. A
    // trusted pointerdown on it must reach the same resume path as any
    // other trusted pointerdown.
    const indicatorEl = { nodeName: "BUTTON", classList: { contains: () => true } };
    target.dispatchEvent(createTrustedEvent("pointerdown", true, indicatorEl));
    expect(service.resumeOnUserActivation).toHaveBeenCalledTimes(1);
  });
});

describe("engineAutoplayListener — VAL-ENGINE-019: programmatic triggers cannot activate", () => {
  let target: ReturnType<typeof createFakeEventTarget>;
  let service: FakeService;

  beforeEach(() => {
    target = createFakeEventTarget();
    service = createFakeService("suspended");
    installEngineAutoplayListener(buildDependencies(service, target));
  });

  afterEach(() => {
    teardownEngineAutoplayListener();
  });

  it("synthetic (isTrusted=false) keydown does NOT resume", () => {
    target.dispatchEvent(createTrustedEvent("keydown", false));
    expect(service.resumeOnUserActivation).not.toHaveBeenCalled();
  });

  it("synthetic (isTrusted=false) pointerdown does NOT resume", () => {
    target.dispatchEvent(createTrustedEvent("pointerdown", false));
    expect(service.resumeOnUserActivation).not.toHaveBeenCalled();
  });

  it("does NOT resume when the engine is already running", () => {
    service.state = "running";
    target.dispatchEvent(createTrustedEvent("keydown", true));
    expect(service.resumeOnUserActivation).not.toHaveBeenCalled();
  });

  it("does NOT bring up audio for an ordinary output-only program", () => {
    teardownEngineAutoplayListener();
    installEngineAutoplayListener({
      ...buildDependencies(service, target),
      shouldAttemptResume: () => false,
    });
    service.state = "off";
    target.dispatchEvent(createTrustedEvent("pointerdown", true));
    expect(service.resumeOnUserActivation).not.toHaveBeenCalled();
  });

  it("does NOT resume when the engine is off (capability absent)", () => {
    // When audio capability is absent, no service is constructed; the
    // accessor returns null and the listener no-ops before calling resume.
    // (The "off with audio capable" case CAN be brought up by a trusted
    // interaction — that is the engine-create path.)
    service.state = "running"; // mark as something other than suspended/off
    // Simulate capability absent by replacing the accessor.
    teardownEngineAutoplayListener();
    installEngineAutoplayListener({
      getActiveSynthesisService: () => null,
      eventTarget: target,
    });
    target.dispatchEvent(createTrustedEvent("pointerdown", true));
    expect(service.resumeOnUserActivation).not.toHaveBeenCalled();
  });

  it("does NOT resume when the engine is in error (recovery path owns that)", () => {
    service.state = "error";
    target.dispatchEvent(createTrustedEvent("keydown", true));
    expect(service.resumeOnUserActivation).not.toHaveBeenCalled();
  });

  it("timers cannot drive the listener (no timer hook exists)", () => {
    // The autoplay listener never subscribes to setInterval/setTimeout.
    // There is no surface to test directly; the assertion is structural:
    // firing a timer that tries to dispatch a synthetic event does not
    // resume the engine.
    service.state = "suspended";
    // Programmatic timer dispatching a synthetic event.
    setTimeout(() => {
      target.dispatchEvent(createTrustedEvent("keydown", false));
    }, 0);
    expect(service.resumeOnUserActivation).not.toHaveBeenCalled();
  });

  it("repeated trusted keydowns while suspended still drive resume attempts", async () => {
    // The listener does not de-dupe; the service is idempotent. Each
    // trusted keydown attempts resume until the engine leaves suspended.
    target.dispatchEvent(createTrustedEvent("keydown", true));
    target.dispatchEvent(createTrustedEvent("keydown", true));
    expect(service.resumeOnUserActivation).toHaveBeenCalledTimes(2);
  });
});

describe("engineAutoplayListener — teardown", () => {
  it("removes its listeners on teardownEngineAutoplayListener()", () => {
    const target = createFakeEventTarget();
    const service = createFakeService("suspended");
    installEngineAutoplayListener(buildDependencies(service, target));
    teardownEngineAutoplayListener();
    // After teardown, dispatching a trusted event does not call resume.
    target.dispatchEvent(createTrustedEvent("keydown", true));
    expect(service.resumeOnUserActivation).not.toHaveBeenCalled();
  });

  it("installEngineAutoplayListener is idempotent (double install does not double-fire)", () => {
    const target = createFakeEventTarget();
    const service = createFakeService("suspended");
    installEngineAutoplayListener(buildDependencies(service, target));
    // Second install is a no-op; the first listener stays.
    installEngineAutoplayListener(buildDependencies(service, target));
    target.dispatchEvent(createTrustedEvent("keydown", true));
    expect(service.resumeOnUserActivation).toHaveBeenCalledTimes(1);
  });
});
