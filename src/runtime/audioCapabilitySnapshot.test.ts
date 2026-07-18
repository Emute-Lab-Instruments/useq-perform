/**
 * Integration tests for the audio-capability snapshot captured during
 * bootstrap via `applyStartupContext`.
 *
 * Verifies the wiring between:
 *   - `probeAudioCapabilities` (browser-global probe)
 *   - `detectAudioCapabilities` (pure detector in contracts/)
 *   - `applyStartupContext` / `getAudioCapabilitySnapshot` (frozen bootstrap state)
 *
 * Covers VAL-HOST-005 (snapshot captured and frozen) and VAL-HOST-006
 * (missing capability disables audio with a named reason).
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  applyStartupContext,
  getAudioCapabilitySnapshot,
  resetStartupContextForTests,
} from "./startupContext";
import { probeAudioCapabilities } from "./audioCapabilityProbe";
import {
  AUDIO_CAPABILITY_REASONS,
  AUDIO_CAPABILITY_SCHEMA_VERSION,
  detectAudioCapabilities,
  isAudioCapabilitySnapshot,
} from "../contracts/audioCapabilities";

afterEach(() => {
  resetStartupContextForTests();
});

describe("applyStartupContext — audio capability capture", () => {
  it("captures an immutable snapshot from the injected probe", () => {
    applyStartupContext({
      startupFlags: {
        debug: false,
        devmode: false,
        disableWebSerial: false,
        noModuleMode: false,
        nosave: false,
        params: {},
      },
      capabilities: {
        areInBrowser: true,
        areInDesktopApp: false,
        isWebSerialAvailable: false,
      },
      audioCapabilityProbe: {
        crossOriginIsolated: true,
        sharedArrayBufferAvailable: true,
        audioWorkletAvailable: true,
        workerAvailable: true,
        sharedWebAssemblyMemoryAvailable: true,
      },
    });

    const snapshot = getAudioCapabilitySnapshot();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.audioCapable).toBe(true);
    expect(snapshot?.schemaVersion).toBe(AUDIO_CAPABILITY_SCHEMA_VERSION);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(isAudioCapabilitySnapshot(snapshot)).toBe(true);
  });

  it("reports the missing capability when the probe is not isolated", () => {
    applyStartupContext({
      startupFlags: {
        debug: false,
        devmode: false,
        disableWebSerial: false,
        noModuleMode: false,
        nosave: false,
        params: {},
      },
      capabilities: {
        areInBrowser: true,
        areInDesktopApp: false,
        isWebSerialAvailable: false,
      },
      audioCapabilityProbe: {
        crossOriginIsolated: false,
        sharedArrayBufferAvailable: false,
        audioWorkletAvailable: true,
        workerAvailable: true,
        sharedWebAssemblyMemoryAvailable: true,
      },
    });

    const snapshot = getAudioCapabilitySnapshot();
    expect(snapshot?.audioCapable).toBe(false);
    expect(snapshot?.crossOriginIsolated).toBe(false);
    expect(snapshot?.sharedArrayBufferAvailable).toBe(false);
    expect(snapshot?.reasons).toContain(
      AUDIO_CAPABILITY_REASONS.NOT_CROSS_ORIGIN_ISOLATED,
    );
    expect(snapshot?.reasons).toContain(
      AUDIO_CAPABILITY_REASONS.NO_SHARED_ARRAY_BUFFER,
    );
  });

  it("returns null before applyStartupContext has run", () => {
    expect(getAudioCapabilitySnapshot()).toBeNull();
  });
});

describe("probeAudioCapabilities — non-browser environment", () => {
  it("returns a probe with audioCapable=false in a Node-like environment", () => {
    // Node lacks crossOriginIsolated and the browser-only constructors.
    const probe = probeAudioCapabilities({
      // Intentionally minimal — none of the required globals.
    });

    const snapshot = detectAudioCapabilities(probe);
    expect(snapshot.audioCapable).toBe(false);
    expect(snapshot.crossOriginIsolated).toBe(false);
    expect(snapshot.reasons.length).toBeGreaterThan(0);
  });

  it("returns audioCapable=true when every required global is present", () => {
    // Synthetic browser-like global scope.
    function FakeWorker() {}
    function FakeAudioWorkletNode() {}
    const fakeAudioContextProto = { audioWorklet: {} };
    function FakeAudioContext() {}
    FakeAudioContext.prototype = fakeAudioContextProto;

    const probe = probeAudioCapabilities({
      crossOriginIsolated: true,
      SharedArrayBuffer: function SharedArrayBuffer() {},
      AudioWorkletNode: FakeAudioWorkletNode,
      AudioContext: FakeAudioContext,
      Worker: FakeWorker,
      WebAssembly: {
        Memory: function Memory() {
          // Constructor body intentionally empty; the probe only checks it
          // can be invoked with shared: true.
        },
      },
    });

    const snapshot = detectAudioCapabilities(probe);
    expect(snapshot.audioCapable).toBe(true);
    expect(snapshot.reasons).toEqual([]);
  });
});
