/**
 * Regression test for the probe-extension duplication (atlas erratum
 * editor-r-probe-dup): `createMainEditorExtensions` used to install the
 * production probe set AND, via `baseExtensions`, a second ephemeral probe
 * set. CodeMirror dedupes the shared state fields/plugins, but the
 * `probeConfig` facet then received two values and its `combine` read only
 * `configs[0]` — so which config won depended on array order.
 *
 * The main editor must carry the production probe set exactly once; the
 * ephemeral set stays reserved for secondary documents (guide/snippet
 * editors via `baseExtensions`).
 */
import { describe, expect, it } from "vitest";

import {
  baseExtensions,
  createMainEditorExtensions,
} from "./extensions.ts";
import {
  probeExtensions,
  probeField,
  probeHighlightField,
  probeViewPlugin,
} from "./extensions/probes.ts";

function countOccurrences(haystack: readonly unknown[], needle: unknown): number {
  return haystack.filter((item) => item === needle).length;
}

describe("probe extension installation", () => {
  it("installs the production probe set exactly once in the main editor", () => {
    const exts = createMainEditorExtensions({
      identityExtensions: [],
      sessionExtensions: [],
    });

    // Every member of the production probe set appears exactly once — the
    // old stacking produced two entries for the shared singletons.
    for (const member of probeExtensions) {
      expect(countOccurrences(exts, member)).toBe(1);
    }
  });

  it("keeps exactly one ephemeral probe set in baseExtensions for secondary editors", () => {
    // The ephemeral set's probeConfig wrapper is rebuilt per call, so pin
    // the count on the shared singletons it contains.
    const sharedSingletons = [probeField, probeHighlightField, probeViewPlugin];
    for (const singleton of sharedSingletons) {
      expect(countOccurrences(baseExtensions, singleton)).toBe(1);
    }
  });
});
