/**
 * Regression test for the serial-buffer-not-cleared-on-reconnect bug.
 *
 * `resetProtocolState()` (json-protocol.ts:125-143) clears the protocol
 * routing tables, pending requests, and heartbeat — but it does NOT clear
 * the per-channel circular buffers in stream-parser.ts (`serialBuffers`,
 * 9 buffers of 400 samples each).
 *
 * Disconnect path:
 *   connector.ts setConnectedToModule(false) → resetProtocolState()
 *
 * Reconnect path:
 *   connector.ts setupConnectedPort() → resetProtocolState()
 *
 * Either way, samples from the previous session leak into the new one.
 * Visualisation will render up to ~400 stale samples (≥40s of stale
 * waveform on a 10Hz stream) before the new device's data fills the ring.
 *
 * Test expectations:
 *  - After resetProtocolState(), every buffer in `serialBuffers` should be
 *    drained (length 0).
 *  - After a fix, this test should pass without modification.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { serialBuffers } from "./stream-parser.ts";
import { resetProtocolState } from "./json-protocol.ts";

beforeEach(() => {
  for (const buf of serialBuffers) {
    buf.clear();
  }
});

describe("serial buffer lifecycle on protocol reset", () => {
  it("clears every per-channel sample buffer when protocol state resets", () => {
    // Seed every channel with sample data, mimicking an active hardware
    // session about to be disconnected.
    for (let i = 0; i < serialBuffers.length; i += 1) {
      const buf = serialBuffers[i]!;
      for (let n = 0; n < 50; n += 1) {
        buf.push(i + n * 0.1);
      }
    }

    // Sanity: the seed actually populated the buffers.
    for (const buf of serialBuffers) {
      expect(buf.length).toBeGreaterThan(0);
    }

    // Disconnect path runs this. After it, no stale data should remain
    // for the next session to render.
    resetProtocolState();

    for (let i = 0; i < serialBuffers.length; i += 1) {
      const buf = serialBuffers[i]!;
      expect(buf.length, `serialBuffers[${i}] should be empty after reset`).toBe(0);
    }
  });
});
