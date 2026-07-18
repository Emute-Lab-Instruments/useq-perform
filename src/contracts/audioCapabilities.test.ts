/**
 * Contract tests for the bootstrap audio-capability snapshot.
 *
 * Covers:
 *   VAL-HOST-005 — snapshot is complete and immutable
 *   VAL-HOST-006 — each missing capability disables audio and names itself
 *   VAL-HOST-011 — capability telemetry is read-only
 *
 * The capability detector is dependency-light and side-effect free so it
 * can run during bootstrap (in `runtime/`) and in tests without a DOM.
 * The detector takes a probe object describing the environment; real
 * wiring calls it with `globalThis`-derived probes.
 */
import { describe, expect, it } from "vitest";

import {
  AUDIO_CAPABILITY_REASONS,
  AUDIO_CAPABILITY_SCHEMA_VERSION,
  detectAudioCapabilities,
  freezeAudioCapabilitySnapshot,
  isAudioCapabilitySnapshot,
  type AudioCapabilityProbe,
  type AudioCapabilitySnapshot,
} from "./audioCapabilities";

/** A fully-capable probe used as the baseline for individual overrides. */
function fullyCapableProbe(): AudioCapabilityProbe {
  return {
    crossOriginIsolated: true,
    sharedArrayBufferAvailable: true,
    audioWorkletAvailable: true,
    workerAvailable: true,
    sharedWebAssemblyMemoryAvailable: true,
  };
}

describe("audioCapabilities — schema", () => {
  it("exposes a frozen schema version", () => {
    expect(typeof AUDIO_CAPABILITY_SCHEMA_VERSION).toBe("number");
    expect(AUDIO_CAPABILITY_SCHEMA_VERSION).toBeGreaterThan(0);
    expect(Object.isFrozen(AUDIO_CAPABILITY_REASONS)).toBe(true);
  });

  it("names every capability reason that can disable audio", () => {
    // VAL-HOST-006: actionable reasons must be machine-readable keys.
    expect(AUDIO_CAPABILITY_REASONS).toMatchObject({
      NOT_CROSS_ORIGIN_ISOLATED: expect.any(String),
      NO_SHARED_ARRAY_BUFFER: expect.any(String),
      NO_AUDIO_WORKLET: expect.any(String),
      NO_WORKER: expect.any(String),
      NO_SHARED_WASM_MEMORY: expect.any(String),
    });
  });
});

describe("audioCapabilities — completeness (VAL-HOST-005)", () => {
  it("reports every required capability field on a capable probe", () => {
    const snapshot = detectAudioCapabilities(fullyCapableProbe());

    expect(snapshot).toMatchObject({
      schemaVersion: AUDIO_CAPABILITY_SCHEMA_VERSION,
      crossOriginIsolated: true,
      sharedArrayBufferAvailable: true,
      audioWorkletAvailable: true,
      workerAvailable: true,
      sharedWebAssemblyMemoryAvailable: true,
      audioCapable: true,
      reasons: [],
    });
    // CapturedAt is a monotonic-ish timestamp string; just check shape.
    expect(typeof snapshot.capturedAt).toBe("number");
  });

  it("is recognised by its type guard", () => {
    const snapshot = detectAudioCapabilities(fullyCapableProbe());
    expect(isAudioCapabilitySnapshot(snapshot)).toBe(true);
  });
});

describe("audioCapabilities — missing capabilities (VAL-HOST-006)", () => {
  const cases: Array<{
    name: keyof AudioCapabilityProbe;
    reason: keyof typeof AUDIO_CAPABILITY_REASONS;
  }> = [
    { name: "crossOriginIsolated", reason: "NOT_CROSS_ORIGIN_ISOLATED" },
    { name: "sharedArrayBufferAvailable", reason: "NO_SHARED_ARRAY_BUFFER" },
    { name: "audioWorkletAvailable", reason: "NO_AUDIO_WORKLET" },
    { name: "workerAvailable", reason: "NO_WORKER" },
    { name: "sharedWebAssemblyMemoryAvailable", reason: "NO_SHARED_WASM_MEMORY" },
  ];

  for (const { name, reason } of cases) {
    it(`disables audio and names the missing capability: ${name}`, () => {
      const probe = fullyCapableProbe();
      (probe[name] as unknown) = false;
      const snapshot = detectAudioCapabilities(probe);

      expect(snapshot.audioCapable).toBe(false);
      expect(snapshot.reasons).toContain(AUDIO_CAPABILITY_REASONS[reason]);
      // The capability itself is reported as false.
      expect(snapshot[name]).toBe(false);
    });
  }

  it("accumulates every missing reason without deduplication loss", () => {
    const snapshot = detectAudioCapabilities({
      crossOriginIsolated: false,
      sharedArrayBufferAvailable: false,
      audioWorkletAvailable: false,
      workerAvailable: false,
      sharedWebAssemblyMemoryAvailable: false,
    });

    expect(snapshot.audioCapable).toBe(false);
    expect(snapshot.reasons).toHaveLength(5);
    expect(new Set(snapshot.reasons).size).toBe(5);
  });

  it("keeps derived audio capability true when every probe is true", () => {
    const snapshot = detectAudioCapabilities(fullyCapableProbe());
    expect(snapshot.audioCapable).toBe(true);
    expect(snapshot.reasons).toEqual([]);
  });
});

describe("audioCapabilities — immutability (VAL-HOST-005 / VAL-HOST-011)", () => {
  it("returns a snapshot that rejects mutation in strict mode", () => {
    const snapshot = detectAudioCapabilities(fullyCapableProbe());

    expect(() => {
      // Strict-mode mutation of a frozen object must throw.
      (snapshot as AudioCapabilitySnapshot).audioCapable = false;
    }).toThrow();

    expect(() => {
      (snapshot as AudioCapabilitySnapshot).reasons.push("mutated");
    }).toThrow();
  });

  it("freezeAudioCapabilitySnapshot deeply freezes nested arrays", () => {
    const snapshot = freezeAudioCapabilitySnapshot({
      schemaVersion: AUDIO_CAPABILITY_SCHEMA_VERSION,
      crossOriginIsolated: false,
      sharedArrayBufferAvailable: false,
      audioWorkletAvailable: false,
      workerAvailable: false,
      sharedWebAssemblyMemoryAvailable: false,
      audioCapable: false,
      reasons: ["a", "b"],
      capturedAt: 1,
    });

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.reasons)).toBe(true);
  });

  it("detectAudioCapabilities returns an independent object each call", () => {
    const a = detectAudioCapabilities(fullyCapableProbe());
    const b = detectAudioCapabilities(fullyCapableProbe());
    expect(a).not.toBe(b);
    expect(a.reasons).not.toBe(b.reasons);
    expect(a).toEqual(b);
  });
});

describe("audioCapabilities — type guard robustness", () => {
  it("rejects null and non-objects", () => {
    expect(isAudioCapabilitySnapshot(null)).toBe(false);
    expect(isAudioCapabilitySnapshot(undefined)).toBe(false);
    expect(isAudioCapabilitySnapshot("snapshot")).toBe(false);
    expect(isAudioCapabilitySnapshot({})).toBe(false);
  });

  it("rejects snapshots with the wrong schema version", () => {
    const snapshot = detectAudioCapabilities(fullyCapableProbe());
    const bad = { ...snapshot, schemaVersion: snapshot.schemaVersion + 1 };
    expect(isAudioCapabilitySnapshot(bad)).toBe(false);
  });
});
