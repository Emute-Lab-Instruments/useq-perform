import { describe, expect, it } from "vitest";

import {
  DEFAULT_STREAM_MAX_RATE_HZ,
  buildDefaultStreamConfig,
  buildHeartbeatRequest,
  buildHelloRequest,
  buildInputChannelRouting,
  buildSerialOutputRouting,
  isJsonEligibleVersion,
  versionAtLeast,
} from "./jsonProtocol";

describe("jsonProtocol", () => {
  it("treats firmware 1.2.0 as JSON-capable and older builds as legacy", () => {
    expect(isJsonEligibleVersion({ major: 1, minor: 2, patch: 0 })).toBe(true);
    expect(isJsonEligibleVersion({ major: 1, minor: 1, patch: 9 })).toBe(false);
    expect(versionAtLeast({ major: 2, minor: 0, patch: 0 }, { major: 1, minor: 2, patch: 0 })).toBe(true);
  });

  it("builds the hello and heartbeat requests the editor sends during negotiation", () => {
    expect(buildHelloRequest("1.2.0")).toEqual({
      type: "hello",
      client: "editor",
      version: "1.2.0",
    });
    expect(buildHeartbeatRequest()).toEqual({ type: "ping" });
  });

  it("maps firmware inputs and serial outputs into the default stream-config request", () => {
    // The default config must subscribe both inputs AND serial outputs (s1-s8)
    // so the drift detector (state-sync.md §1.2) has hardware output values to
    // compare against. The `time` output is excluded — firmware always streams
    // it.
    expect(
      buildDefaultStreamConfig({
        inputs: [
          { index: 1, name: "ssin1" },
          { index: 4, name: "ssin4" },
        ],
        outputs: [
          { index: 1, name: "time" },
          { index: 2, name: "s1" },
          { index: 3, name: "s2" },
        ],
      })
    ).toEqual({
      type: "stream-config",
      maxRateHz: DEFAULT_STREAM_MAX_RATE_HZ,
      channels: [
        { id: 1, name: "ssin1", direction: "input", enabled: true, maxRateHz: DEFAULT_STREAM_MAX_RATE_HZ },
        { id: 4, name: "ssin4", direction: "input", enabled: true, maxRateHz: DEFAULT_STREAM_MAX_RATE_HZ },
        { id: 2, name: "s1", direction: "output", enabled: true, maxRateHz: DEFAULT_STREAM_MAX_RATE_HZ },
        { id: 3, name: "s2", direction: "output", enabled: true, maxRateHz: DEFAULT_STREAM_MAX_RATE_HZ },
      ],
    });
  });

  it("maps firmware input channels to WASM hw_input indices by wire channel", () => {
    // Wire channels are numbered by subscription order: buildDefaultStreamConfig
    // subscribes inputs first, so input j streams on wire channel j + 2
    // (wire channel 1 is time). The routing maps wire channel → WASM input.
    expect(
      buildInputChannelRouting({
        inputs: [
          { index: 1, name: "ssin1" },
          { index: 2, name: "ssin2" },
          { index: 5, name: "unknown_input" },
        ],
      })
    ).toEqual({
      2: 8,  // ssin1 → ain1 → hw_input[8], on wire channel 2
      3: 9,  // ssin2 → ain2 → hw_input[9], on wire channel 3
    });
  });

  it("builds a wire-channel routing table for streamed serial outputs", () => {
    // The firmware numbers STREAM frames' channel byte by subscription order:
    // wire 1 = time, then the stream-config entries in request order
    // (inputs first, then non-time outputs). For this config the s1 frame
    // arrives on wire channel 4 (time + 2 inputs + first output), not on
    // hello output index 3.
    expect(
      buildSerialOutputRouting({
        inputs: [
          { index: 1, name: "ssin1" },
          { index: 2, name: "ssin2" },
        ],
        outputs: [
          { index: 7, name: "time" },
          { index: 3, name: "s1" },
          { index: 4, name: "s2" },
          { index: 9, name: "unknown" },
        ],
      })
    ).toEqual({
      1: 0,  // time → buffer 0
      4: 1,  // s1 → wire channel 4 → buffer 1
      5: 2,  // s2 → wire channel 5 → buffer 2
      // "unknown" still consumes wire channel 6 but maps to no buffer.
    });
  });

  it("routes the hardware hello config so drift reads the right outputs", () => {
    // Regression: the editor previously keyed this table by each output's
    // hello-config index. With inputs subscribed first (state-sync.md §1.2),
    // ain1 frames landed in s1's buffer and the drift detector compared s1
    // against ain1. The full hardware config must route s1-s8 to buffers 1-8.
    expect(
      buildSerialOutputRouting({
        inputs: [
          { index: 1, name: "ssin1" },
          { index: 2, name: "ssin2" },
        ],
        outputs: [
          { index: 1, name: "time" },
          { index: 2, name: "s1" },
          { index: 3, name: "s2" },
          { index: 4, name: "s3" },
          { index: 5, name: "s4" },
          { index: 6, name: "s5" },
          { index: 7, name: "s6" },
          { index: 8, name: "s7" },
          { index: 9, name: "s8" },
        ],
      })
    ).toEqual({
      1: 0,
      4: 1,
      5: 2,
      6: 3,
      7: 4,
      8: 5,
      9: 6,
      10: 7,
      11: 8,
    });
  });
});
