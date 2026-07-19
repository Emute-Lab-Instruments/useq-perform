/**
 * Contract tests for the pure transport frame map.
 *
 * Covers (see mission feature `m1-audio-clocked-worker-producer`):
 *   VAL-ENGINE-003 — Transport mapping is deterministic across start,
 *                    pause, resume, stop, and re-anchor transitions.
 *
 * The frame map is a pure, dependency-free function of:
 *   - anchor frame (irreversible counter set when the transport last
 *     started, resumed, or re-anchored);
 *   - anchor ModuLisp time (the ModuLisp time at the anchor frame);
 *   - sample rate;
 *   - transport state (one of "playing" | "paused" | "stopped");
 *   - revision (monotonic counter that increments on every transport
 *     transition).
 *
 * These tests were observed failing before the module existed (the
 * import did not resolve) and pass after the canonical pure mapping
 * lands.
 */
import { describe, expect, it } from "vitest";

import {
  createTransportFrameMap,
  TRANSPORT_FRAME_MAP_REVISION_INITIAL,
  type TransportFrameMap,
  type TransportFrameMapSnapshot,
  type TransportFrameMapState,
} from "./transportFrameMap";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SR = 48000;

function frames(seconds: number): bigint {
  return BigInt(Math.round(seconds * SR));
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

describe("transportFrameMap / deterministic mapping (VAL-ENGINE-003)", () => {
  it("maps a frame to ModuLisp time linearly while playing", () => {
    const map = createTransportFrameMap({ sampleRate: SR });
    map.start({ atFrame: 0n, atTime: 0 });
    // After exactly one second of audio at 48 kHz, ModuLisp time should be 1.0.
    expect(map.sample(frames(1))).toBeCloseTo(1.0, 10);
    expect(map.sample(frames(0.5))).toBeCloseTo(0.5, 10);
  });

  it("preserves time across start with a non-zero anchor", () => {
    const map = createTransportFrameMap({ sampleRate: SR });
    map.start({ atFrame: 1000n, atTime: 2.0 });
    expect(map.sample(1000n)).toBeCloseTo(2.0, 10);
    expect(map.sample(1000n + frames(0.25))).toBeCloseTo(2.25, 10);
  });

  it("is deterministic: same inputs produce same outputs", () => {
    const a = createTransportFrameMap({ sampleRate: SR });
    const b = createTransportFrameMap({ sampleRate: SR });
    a.start({ atFrame: 256n, atTime: 1.0 });
    b.start({ atFrame: 256n, atTime: 1.0 });
    for (const t of [0.1, 0.25, 1.0, 3.14159]) {
      const f = 256n + frames(t);
      expect(a.sample(f)).toBeCloseTo(b.sample(f), 12);
    }
  });
});

describe("transportFrameMap / pause and resume (VAL-ENGINE-003)", () => {
  it("freezes ModuLisp time at the pause point while paused", () => {
    const map = createTransportFrameMap({ sampleRate: SR });
    map.start({ atFrame: 0n, atTime: 0 });
    map.pause({ atFrame: frames(1.0), atTime: 1.0 });
    // Frame continues to advance while paused; ModuLisp time does not.
    expect(map.sample(frames(2))).toBeCloseTo(1.0, 10);
    expect(map.sample(frames(10))).toBeCloseTo(1.0, 10);
  });

  it("resumes by re-anchoring at the resume frame and accumulated time", () => {
    const map = createTransportFrameMap({ sampleRate: SR });
    map.start({ atFrame: 0n, atTime: 0 });
    map.pause({ atFrame: frames(1.0), atTime: 1.0 });
    map.resume({ atFrame: frames(2.0), atTime: 1.0 });
    // 0.5 seconds after the resume frame → 1.5 seconds ModuLisp time.
    expect(map.sample(frames(2.0) + frames(0.5))).toBeCloseTo(1.5, 10);
  });
});

describe("transportFrameMap / stop (VAL-ENGINE-003)", () => {
  it("returns to the initial state on stop", () => {
    const map = createTransportFrameMap({ sampleRate: SR });
    map.start({ atFrame: 0n, atTime: 0 });
    map.pause({ atFrame: frames(1.0), atTime: 1.0 });
    map.stop({ atFrame: frames(2.0) });
    // After stop, sample returns 0 (the initial time) regardless of frame.
    expect(map.sample(frames(3))).toBeCloseTo(0, 10);
    expect(map.state()).toBe("stopped");
  });

  it("does not mutate a stopped map by sampling", () => {
    const map = createTransportFrameMap({ sampleRate: SR });
    map.stop({ atFrame: 0n });
    expect(map.sample(frames(1))).toBeCloseTo(0, 10);
    expect(map.sample(frames(2))).toBeCloseTo(0, 10);
  });
});

describe("transportFrameMap / re-anchor (VAL-ENGINE-003)", () => {
  it("re-anchors without changing the visible transport state", () => {
    const map = createTransportFrameMap({ sampleRate: SR });
    map.start({ atFrame: 0n, atTime: 0 });
    map.reanchor({ atFrame: frames(2), atTime: 7.0 });
    expect(map.state()).toBe("playing");
    expect(map.sample(frames(2))).toBeCloseTo(7.0, 10);
    expect(map.sample(frames(3))).toBeCloseTo(8.0, 10);
  });

  it("bumps the revision on every transition", () => {
    const map = createTransportFrameMap({ sampleRate: SR });
    expect(map.revision()).toBe(TRANSPORT_FRAME_MAP_REVISION_INITIAL);
    map.start({ atFrame: 0n, atTime: 0 });
    const afterStart = map.revision();
    map.pause({ atFrame: frames(1), atTime: 1.0 });
    const afterPause = map.revision();
    map.resume({ atFrame: frames(2), atTime: 1.0 });
    const afterResume = map.revision();
    map.stop({ atFrame: frames(3) });
    const afterStop = map.revision();
    expect(afterStart).toBeGreaterThan(TRANSPORT_FRAME_MAP_REVISION_INITIAL);
    expect(afterPause).toBeGreaterThan(afterStart);
    expect(afterResume).toBeGreaterThan(afterPause);
    expect(afterStop).toBeGreaterThan(afterResume);
  });
});

describe("transportFrameMap / snapshot and restore", () => {
  it("snapshots an immutable view of the mapping state", () => {
    const map = createTransportFrameMap({ sampleRate: SR });
    map.start({ atFrame: 100n, atTime: 5.0 });
    const snap = map.snapshot();
    expect(snap.state).toBe("playing");
    expect(snap.anchorFrame).toBe(100n);
    expect(snap.anchorTime).toBeCloseTo(5.0, 10);
    expect(snap.sampleRate).toBe(SR);
    expect(snap.revision).toBeGreaterThan(TRANSPORT_FRAME_MAP_REVISION_INITIAL);
    expect(Object.isFrozen(snap)).toBe(true);
  });

  it("restores from a snapshot deterministically", () => {
    const a = createTransportFrameMap({ sampleRate: SR });
    a.start({ atFrame: 0n, atTime: 0 });
    a.pause({ atFrame: frames(1), atTime: 1.0 });
    const snap = a.snapshot();

    const b = createTransportFrameMap({ sampleRate: SR });
    b.restore(snap);
    expect(b.sample(frames(5))).toBeCloseTo(1.0, 10);
    expect(b.state()).toBe("paused");
    expect(b.revision()).toBe(snap.revision);
  });
});

describe("transportFrameMap / input validation", () => {
  it("rejects non-positive sample rates", () => {
    expect(() => createTransportFrameMap({ sampleRate: 0 })).toThrow();
    expect(() => createTransportFrameMap({ sampleRate: -1 })).toThrow();
  });

  it("rejects non-finite anchor times", () => {
    const map = createTransportFrameMap({ sampleRate: SR });
    expect(() => map.start({ atFrame: 0n, atTime: Number.NaN })).toThrow();
    expect(() => map.start({ atFrame: 0n, atTime: Number.POSITIVE_INFINITY })).toThrow();
  });

  it("returns frozen snapshot shape", () => {
    const map = createTransportFrameMap({ sampleRate: SR });
    const snap = map.snapshot();
    expect(() => {
      (snap as mutable<TransportFrameMapSnapshot>).state = "stopped";
    }).toThrow();
  });
});

describe("transportFrameMap / lookahead block windows (VAL-ENGINE-004)", () => {
  it("computes a frame horizon for a given block lookahead", () => {
    const map = createTransportFrameMap({ sampleRate: SR });
    map.start({ atFrame: 0n, atTime: 0 });
    const horizonFrame = map.lookaheadFrame({
      fromFrame: 1000n,
      blockCount: 6,
      renderQuantumFrames: 128,
    });
    expect(horizonFrame).toBe(1000n + BigInt(6 * 128));
  });

  it("samples the ModuLisp time at a horizon frame", () => {
    const map = createTransportFrameMap({ sampleRate: SR });
    map.start({ atFrame: 0n, atTime: 0 });
    const horizon = map.lookaheadFrame({
      fromFrame: 0n,
      blockCount: 6,
      renderQuantumFrames: 128,
    });
    const expectedSeconds = Number(horizon) / SR;
    expect(map.sample(horizon)).toBeCloseTo(expectedSeconds, 10);
  });
});

describe("transportFrameMap / re-anchor flushes stale blocks (VAL-ENGINE-032)", () => {
  it("a stale block published before the re-anchor maps to the new time", () => {
    // Producer publishes block N at frame F1 with the old anchor.
    // Re-anchor moves the anchor. A block already published at F1 but
    // consumed after the re-anchor MUST map to the new time, never the
    // old one. The pure map reflects this by being a pure function of
    // (frame, latest snapshot) — it has no hidden old-anchor state.
    const map = createTransportFrameMap({ sampleRate: SR });
    map.start({ atFrame: 0n, atTime: 0 });
    const stale = frames(1);
    const oldTime = map.sample(stale);
    map.reanchor({ atFrame: stale, atTime: 100.0 });
    const newTime = map.sample(stale);
    expect(newTime).toBeCloseTo(100.0, 10);
    expect(newTime).not.toBeCloseTo(oldTime, 5);
  });
});

// Utility type: forces a readonly shape to mutable for negative tests.
type mutable<T> = { -readonly [K in keyof T]: T[K] };

// Touch the public types so they are exercised by the type-checker.
function _typeCheck(snap: TransportFrameMapSnapshot): TransportFrameMapState {
  return snap;
}
void _typeCheck;
