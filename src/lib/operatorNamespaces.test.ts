import { describe, expect, it } from "vitest";
import {
  canonicalizeNamespaceSpelling,
  namespaceChoices,
  namespaceHint,
  namespaceSpans,
  operatorName,
} from "./operatorNamespaces.ts";
import type { NamespaceDefinition, ReferenceEntry } from "../utils/referenceStore.ts";

const definitions: NamespaceDefinition[] = [
  { name: "u", longName: "uni", semantics: "unipolar output" },
  { name: "b", longName: "bi", semantics: "bipolar output" },
];

const entry: ReferenceEntry = {
  name: "sin",
  description: "sine",
  aliases: [],
  tags: [],
  parameters: [],
  examples: [],
  bareIdentity: "n/sin",
  namespaceApplicability: [
    { namespace: "u", spelling: "u/sin", identity: "u/sin" },
    { namespace: "b", spelling: "b/sin", identity: "b/sin" },
  ],
  meta: { introduced: null, changed: null },
};

describe("operator namespace model", () => {
  it("derives two spans inside one symbol without treating division as a namespace", () => {
    expect(namespaceSpans("u/sin")).toEqual({
      namespace: { from: 0, to: 1 },
      operator: { from: 2, to: 5 },
    });
    expect(operatorName("u/sin")).toBe("sin");
    expect(namespaceSpans("/")).toBeNull();
    expect(namespaceSpans("n/u/sin")).toBeNull();
  });

  it("canonicalises long spellings only when the formatter asks", () => {
    expect(canonicalizeNamespaceSpelling("uni/sin")).toBe("u/sin");
    expect(canonicalizeNamespaceSpelling("once/random")).toBe("k/random");
    expect(canonicalizeNamespaceSpelling("lfo/sin")).toBe("lfo/sin");
  });

  it("builds picker rows solely from generated applicability and preserves long style", () => {
    expect(namespaceChoices("uni/sin", entry, definitions).map((choice) => choice.spelling))
      .toEqual(["sin", "uni/sin", "bi/sin"]);
    expect(namespaceChoices("sin", entry, definitions).find((choice) => choice.current)?.spelling)
      .toBe("sin");
  });

  it("resolves namespace hover semantics and operator-specific identity", () => {
    expect(namespaceHint("bi/sin", entry, definitions)).toEqual({
      title: "bi/",
      semantics: "bipolar output",
      identity: "b/sin",
    });
  });
});
