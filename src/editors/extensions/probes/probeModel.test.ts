import { describe, expect, it, vi } from "vitest";

import {
  persistProbes,
  probeSignature,
  readPersistedProbes,
  updateProbeRender,
} from "./probeModel.ts";
import type { PersistedProbeSpec, ProbeConfig } from "./probeTypes.ts";

const validProbe: PersistedProbeSpec = {
  id: "probe-1",
  from: 1,
  to: 4,
  mode: "contextual",
  depth: 2,
  maxDepth: 3,
  cachedCode: "bar",
  canvasWidth: 138,
  canvasHeight: 46,
  windowDurationMs: 1000,
};

function persistence(
  loaded: unknown[],
): Pick<ProbeConfig, "loadPersistedProbes" | "savePersistedProbes" | "removePersistedProbes"> {
  return {
    loadPersistedProbes: () => loaded,
    savePersistedProbes: vi.fn(),
    removePersistedProbes: vi.fn(),
  };
}

describe("probe persistence model", () => {
  it("filters invalid rows and normalises optional dimensions", () => {
    const restored = readPersistedProbes(persistence([
      { ...validProbe, depth: 2.8, canvasWidth: 0, windowDurationMs: 99_000 },
      { id: "invalid" },
    ]));

    expect(restored).toEqual([
      {
        ...validProbe,
        depth: 2,
        canvasWidth: 138,
        windowDurationMs: 1000,
      },
    ]);
  });

  it("removes empty persistence and saves non-empty state", () => {
    const port = persistence([]);
    persistProbes(port, []);
    expect(port.removePersistedProbes).toHaveBeenCalledOnce();
    expect(port.savePersistedProbes).not.toHaveBeenCalled();

    persistProbes(port, [validProbe]);
    expect(port.savePersistedProbes).toHaveBeenCalledWith([validProbe]);
  });

  it("signs only fields that require persistence refresh", () => {
    const signature = probeSignature([validProbe]);
    expect(probeSignature([{ ...validProbe, cachedCode: "changed" }])).toBe(signature);
    expect(probeSignature([{ ...validProbe, depth: 1 }])).not.toBe(signature);
  });

  it("reuses identical renders and revisions changed renders", () => {
    const first = updateProbeRender(undefined, {
      kind: "text",
      text: "1",
      samples: [],
      currentTime: 1,
      windowStart: 0,
      windowDuration: 1,
      depth: 0,
      maxDepth: 0,
    });
    expect(first.revision).toBe(1);
    expect(updateProbeRender(first, { ...first })).toBe(first);
    expect(updateProbeRender(first, { ...first, text: "2" }).revision).toBe(2);
  });
});
