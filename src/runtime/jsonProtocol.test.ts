import { describe, expect, it } from "vitest";

import {
  DEFAULT_STREAM_MAX_RATE_HZ,
  buildDefaultStreamConfig,
  buildHeartbeatRequest,
  buildHelloRequest,
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

  it("maps firmware inputs into the default stream-config request", () => {
    expect(
      buildDefaultStreamConfig({
        inputs: [
          { index: 1, name: "ssin1" },
          { index: 4, name: "ssin4" },
        ],
      })
    ).toEqual({
      type: "stream-config",
      maxRateHz: DEFAULT_STREAM_MAX_RATE_HZ,
      channels: [
        { id: 1, name: "ssin1", enabled: true, maxRateHz: 30 },
        { id: 4, name: "ssin4", enabled: true, maxRateHz: 30 },
      ],
    });
  });
});
