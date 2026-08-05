import { describe, expect, it } from "vitest";
import { parseFirmwareManifest } from "../firmware/firmwareManifest.ts";
import {
  buildExpanderFirmwareUpdateOffer,
  buildFirmwareUpdateOffer,
  firmwareChannelEnabled,
} from "./firmwareUpdatePrompt.ts";

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
  it("defaults beta on, permits permanent beta opt-out, and keeps stable enabled", () => {
    expect(firmwareChannelEnabled("beta", undefined)).toBe(true);
    expect(firmwareChannelEnabled("beta", false)).toBe(false);
    expect(firmwareChannelEnabled("stable", false)).toBe(true);
  });
  it("selects an exact advertised target", () => {
    const offer = buildFirmwareUpdateOffer({
      protocolMode: "json",
      firmwareVersion: "1.2.0-beta.1",
      protocolVersion: 1,
      hardwareTarget: "hardware_v1_0",
      capabilities: ["json-v1"],
      modules: [],
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
      modules: [],
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
      modules: [],
    }, manifest);
    expect(offer).toBeNull();
  });

  it("offers an I2C-discovered expander update only as a direct manual update", () => {
    const expandedManifest = parseFirmwareManifest({
      ...manifest,
      artifacts: [{
        target: "expander_aout08_v0_1",
        label: "uSEQ 8-output expander v0.1",
        url: "/firmware/beta/1.2.0-beta.2/expander_aout08_v0_1.uf2",
        sha256: "c".repeat(64),
        size: 200,
      }],
    }, "https://useq.emutelabinstruments.co.uk/");
    const offer = buildExpanderFirmwareUpdateOffer({
      protocolMode: "json",
      firmwareVersion: "1.2.0-beta.2",
      protocolVersion: 1,
      hardwareTarget: "hardware_v1_0",
      capabilities: ["json-v1"],
      modules: [{
        kind: "output-expander",
        address: 0x2a,
        identityStatus: "verified",
        product: "useq-exp-aout08",
        target: "expander_aout08_v0_1",
        firmware: "1.2.0-beta.1",
        updateTransport: "i2c-only",
        autoUpdateSafe: false,
      }],
    }, expandedManifest);
    expect(offer?.manualReset).toBe(true);
    expect(offer?.message).toContain("cannot relay firmware over I²C");
  });
});
