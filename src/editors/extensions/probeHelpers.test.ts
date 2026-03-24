import { describe, expect, it } from "vitest";

import { createStructuralEditor } from "./structure/new-structure.ts";
import {
  buildProbeExpression,
  collectVisibleIndexedForms,
  computeFromListIndex,
  type ProbeRange,
} from "./probeHelpers.ts";

function rangeOf(source: string, snippet: string): ProbeRange {
  const from = source.indexOf(snippet);
  if (from < 0) {
    throw new Error(`Snippet not found: ${snippet}`);
  }
  return { from, to: from + snippet.length };
}

describe("probeHelpers", () => {
  it("builds a raw probe expression from the selected node text", () => {
    const source = "(slow 2 (from-list [1 2 3 4] (slow 2 bar)))";
    const state = createStructuralEditor(source);

    const expression = buildProbeExpression(
      state,
      rangeOf(source, "(slow 2 bar)"),
      "raw",
    );

    expect(expression).toEqual({
      code: "(slow 2 bar)",
      maxDepth: 1,
      appliedDepth: 0,
    });
  });

  it("builds a contextual probe expression including outer temporal wrappers", () => {
    const source = "(slow 2 (from-list [1 2 (fast 3 bar) 4] (slow 2 bar)))";
    const state = createStructuralEditor(source);

    const expression = buildProbeExpression(
      state,
      rangeOf(source, "(slow 2 bar)"),
      "contextual",
    );

    expect(expression).toEqual({
      code: "(slow 2 (slow 2 bar))",
      maxDepth: 1,
      appliedDepth: 1,
    });
  });

  it("respects explicit contextual depth overrides", () => {
    const source = "(slow 2 (offset 0.5 (fast 3 bar)))";
    const state = createStructuralEditor(source);

    const expression = buildProbeExpression(
      state,
      rangeOf(source, "bar"),
      "contextual",
      2,
    );

    expect(expression).toEqual({
      code: "(offset 0.5 (fast 3 bar))",
      maxDepth: 3,
      appliedDepth: 2,
    });
  });

  it("collects visible indexed forms for from-list and shorthand vector calls", () => {
    const source = [
      "(from-list [1 2 3] bar)",
      "([4 5 (fast 2 bar)] (slow 2 bar))",
    ].join("\n");
    const state = createStructuralEditor(source);

    const forms = collectVisibleIndexedForms(state, [{ from: 0, to: source.length }]);

    expect(forms).toHaveLength(2);
    expect(forms[0]?.kind).toBe("call");
    expect(forms[0]?.operatorName).toBe("from-list");
    expect(forms[0]?.elementRanges).toHaveLength(3);
    expect(forms[1]?.kind).toBe("shorthand");
    expect(forms[1]?.elementRanges).toHaveLength(3);
  });

  it("matches the interpreter's from-list index calculation", () => {
    expect(computeFromListIndex(4, -1)).toBe(0);
    expect(computeFromListIndex(4, 0)).toBe(0);
    expect(computeFromListIndex(4, 0.24)).toBe(0);
    expect(computeFromListIndex(4, 0.25)).toBe(1);
    expect(computeFromListIndex(4, 0.99)).toBe(3);
    expect(computeFromListIndex(4, 1)).toBe(3);
    expect(computeFromListIndex(0, 0.5)).toBeNull();
  });
});
