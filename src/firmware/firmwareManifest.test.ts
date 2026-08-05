import { describe, expect, it } from "vitest";
import {
  artifactForTarget,
  parseFirmwareManifest,
  shouldOfferFirmwareUpdate,
} from "./firmwareManifest.ts";

const manifestValue = {
  schemaVersion: 1,
  channel: "beta",
  version: "1.2.0-beta.2",
  publishedAt: "2026-08-05T12:00:00Z",
  notesUrl: "/firmware/beta/1.2.0-beta.2/notes.html",
  artifacts: [
    {
      target: "hardware_v1_0",
      label: "uSEQ hardware v1.0",
      url: "/firmware/beta/1.2.0-beta.2/hardware_v1_0.uf2",
      sha256: "a".repeat(64),
      size: 123456,
    },
  ],
};

describe("firmware beta manifest", () => {
  it("accepts a canonical beta release with same-origin artifacts", () => {
    const manifest = parseFirmwareManifest(
      manifestValue,
      "https://useq.emutelabinstruments.co.uk/",
    );
    expect(manifest.version).toBe("1.2.0-beta.2");
    expect(artifactForTarget(manifest, "hardware_v1_0")?.size).toBe(123456);
  });

  it("rejects cross-origin artifact URLs and non-canonical beta versions", () => {
    expect(() => parseFirmwareManifest({
      ...manifestValue,
      artifacts: [{ ...manifestValue.artifacts[0], url: "https://example.com/x.uf2" }],
    }, "https://useq.emutelabinstruments.co.uk/")).toThrow(/same-origin/);
    expect(() => parseFirmwareManifest({
      ...manifestValue,
      version: "1.2.0.b2",
    }, "https://useq.emutelabinstruments.co.uk/")).toThrow(/SemVer/);
  });

  it("offers successive betas and stable, but never downgrades", () => {
    const manifest = parseFirmwareManifest(
      manifestValue,
      "https://useq.emutelabinstruments.co.uk/",
    );
    expect(shouldOfferFirmwareUpdate("1.1.1", manifest)).toBe(true);
    expect(shouldOfferFirmwareUpdate("1.2.0-beta.1", manifest)).toBe(true);
    expect(shouldOfferFirmwareUpdate("1.2.0-beta.2", manifest)).toBe(false);
    expect(shouldOfferFirmwareUpdate("1.2.0", manifest)).toBe(false);
  });
});
