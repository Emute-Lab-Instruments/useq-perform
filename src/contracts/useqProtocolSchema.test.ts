import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  USEQ_JSON_PROTOCOL_SCHEMA,
  currentHardwareRequestTypes,
  currentWasmRequestTypes,
  validateProtocolRequest,
  validateProtocolResponseEnvelope,
  validateProtocolUnsolicitedMessage,
} from "./useqProtocolSchema.ts";

describe("canonical uSEQ JSON protocol schema", () => {
  it("keeps generated TypeScript and C++ metadata in sync", () => {
    expect(() =>
      execFileSync(process.execPath, ["scripts/generate-protocol-schema.mjs", "--check"]),
    ).not.toThrow();
  });

  it("accepts every schema-owned request fixture", () => {
    for (const request of USEQ_JSON_PROTOCOL_SCHEMA.requests) {
      expect(validateProtocolRequest(request.example), request.type).toEqual({ ok: true });
    }
  });

  it("rejects every schema-owned invalid fixture with the same error", () => {
    for (const fixture of USEQ_JSON_PROTOCOL_SCHEMA.invalidFixtures) {
      expect(validateProtocolRequest(fixture.payload), fixture.name).toEqual({
        ok: false,
        error: fixture.error,
      });
    }
  });

  it("derives hardware and WASM request catalogs", () => {
    expect(currentHardwareRequestTypes()).toContain("set-failure-mode");
    expect(currentHardwareRequestTypes()).not.toContain("calibrate-begin");
    expect(currentWasmRequestTypes()).toEqual([
      "hello",
      "ping",
      "stream-config",
      "eval",
      "set-live-inputs",
    ]);
  });

  it("validates correlated response variants and unsolicited envelopes", () => {
    expect(validateProtocolResponseEnvelope({
      type: "response",
      requestId: "req-1",
      success: true,
    })).toEqual({ ok: true });
    expect(validateProtocolResponseEnvelope({
      type: "state-snapshot",
      requestId: "req-2",
      success: true,
      state: {},
    })).toEqual({ ok: true });
    expect(validateProtocolUnsolicitedMessage({
      type: "hw-input",
      kind: "toggle",
      id: "sw2",
      state: true,
    })).toEqual({ ok: true });
  });

  it("keeps pre-1.2 text compatibility outside the JSON-v1 catalog", () => {
    expect(USEQ_JSON_PROTOCOL_SCHEMA.legacyCompatibility).toContain("outside");
    expect(USEQ_JSON_PROTOCOL_SCHEMA.requests.some((request) =>
      request.type.includes("legacy"),
    )).toBe(false);
  });
});
