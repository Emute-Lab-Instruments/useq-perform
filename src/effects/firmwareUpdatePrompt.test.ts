import { describe, expect, it } from "vitest";
import { parseFirmwareManifest } from "../firmware/firmwareManifest.ts";
import { buildFirmwareUpdateOffer } from "./firmwareUpdatePrompt.ts";

const manifest = parseFirmwareManifest({
  schemaVersion: 1,
  channel: "beta",
  version: "1.2.0-beta.2",
  publishedAt: "2026-08-05T12:00:00Z",
  artifacts: [{
    target: "hardware_v1_0",
    label: "uSEQ hardware v1.0",
    url: "/firmware/beta/1.2.0-beta.2/hardware_v1_0.uf2",
    sha256: "b".repeat(64),
    size: 100,
  }],
}, "https://useq.emutelabinstruments.co.uk/");

describe("firmware update offer", () => {
  it("selects an exact advertised target", () => {
    const offer = buildFirmwareUpdateOffer({
      protocolMode: "json",
      firmwareVersion: "1.2.0-beta.1",
      protocolVersion: 1,
      hardwareTarget: "hardware_v1_0",
      capabilities: ["json-v1"],
    }, manifest);
    expect(offer?.message).toContain("uSEQ hardware v1.0");
  });

  it("requires manual hardware selection for legacy firmware", () => {
    const offer = buildFirmwareUpdateOffer({
      protocolMode: "legacy",
      firmwareVersion: "1.1.1",
      protocolVersion: 0,
      hardwareTarget: null,
      capabilities: ["legacy-text-v1"],
    }, manifest);
    expect(offer?.message).toContain("ask which hardware variant");
  });

  it("does not guess when a known target has no artifact", () => {
    const offer = buildFirmwareUpdateOffer({
      protocolMode: "json",
      firmwareVersion: "1.1.1",
      protocolVersion: 1,
      hardwareTarget: "musicthing",
      capabilities: ["json-v1"],
    }, manifest);
    expect(offer).toBeNull();
  });
});
