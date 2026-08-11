import { readFile, readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const INTERNAL_IMPORT = /(?:from\s+|import\(\s*)["'][^"']*(visualisationRuntime|visualisationSampler|visualisationBuffers|visualisationStore|stateSyncOrchestrator)[^"']*["']/;

function isVisualisationImplementation(path: string): boolean {
  return path.startsWith("effects/visualisation")
    || path === "effects/stateSyncOrchestrator.ts"
    || path === "utils/visualisationStore.ts";
}

describe("visualisation session boundary", () => {
  it("is the only production entry point to visualisation internals", async () => {
    const paths = (await readdir("src", { recursive: true }))
      .filter((path) => /\.(ts|tsx)$/.test(path))
      .filter((path) => !/\.test\.(ts|tsx)$/.test(path))
      .filter((path) => !isVisualisationImplementation(path));

    const offenders: string[] = [];
    for (const path of paths) {
      const source = await readFile(`src/${path}`, "utf8");
      if (INTERNAL_IMPORT.test(source)) offenders.push(path);
    }

    expect(offenders).toEqual([]);
  });

  it("routes visual probe consumers through the session seam", async () => {
    const consumers = [
      "editors/extensions/probes.ts",
      "ui/help/guide/LiveProbe.tsx",
      "ui/help/SnippetOscilloscope.tsx",
    ];
    const offenders: string[] = [];
    for (const path of consumers) {
      const source = await readFile(`src/${path}`, "utf8");
      if (/activeWasmRuntimePort|getActiveWasmRuntimePort/.test(source)) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });
});
