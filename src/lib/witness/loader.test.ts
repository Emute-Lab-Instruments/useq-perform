/**
 * Witness/spec asset loader tests (witnesses.md §3, engine-ledger.md §2.1).
 *
 * A malformed index would produce silently wrong clause badges, which is
 * strictly worse than no Ledger — so parsing rejects rather than coerces.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  SUPPORTED_SPEC_CORPUS_VERSION,
  WITNESS_INDEX_URL,
  SPEC_CORPUS_URL,
  loadSpecCorpus,
  loadWitnessIndex,
  parseSpecCorpus,
  parseWitnessIndex,
  resetWitnessLoaderCache,
  witnessNamesForClause,
  witnessNamesForFile,
  witnessesByName,
} from "./loader.ts";
import { SUPPORTED_WITNESS_INDEX_VERSION, type WitnessIndex } from "./types.ts";

function validIndex(): unknown {
  return {
    version: SUPPORTED_WITNESS_INDEX_VERSION,
    corpusDir: "src-useq/test/conformance",
    fileCount: 1,
    witnessCount: 2,
    witnesses: [
      {
        name: "alpha",
        specFile: "time.md",
        clause: "1.1",
        specRefs: [{ file: "time.md", clause: "1.1" }],
        tags: ["smoke"],
        steps: [{ eval: "(a1 t)" }],
        sourcePath: "src-useq/test/conformance/time/basics.yaml",
      },
      {
        name: "beta",
        specFile: "time.md",
        clause: null,
        specRefs: [{ file: "time.md", clause: null }],
        tags: [],
        steps: [{ eval: "(a1 1)" }],
        sourcePath: "src-useq/test/conformance/time/basics.yaml",
      },
    ],
    bySpecFile: {
      "time.md": { clauses: { "1.1": ["alpha"] }, documentWitnesses: ["beta"] },
    },
  };
}

describe("parseWitnessIndex", () => {
  it("accepts a well-formed index", () => {
    expect(parseWitnessIndex(validIndex()).witnessCount).toBe(2);
  });

  it("rejects a non-object payload", () => {
    expect(() => parseWitnessIndex([])).toThrow(/not an object/);
  });

  it("rejects an unsupported schema version rather than guessing", () => {
    expect(() => parseWitnessIndex({ ...(validIndex() as object), version: 99 })).toThrow(/unsupported schema version/);
  });

  it("rejects a witness with no name", () => {
    const bad = validIndex() as { witnesses: unknown[] };
    bad.witnesses[0] = { steps: [{ eval: "x" }], specRefs: [] };
    expect(() => parseWitnessIndex(bad)).toThrow(/non-empty 'name'/);
  });

  it("rejects duplicate witness names", () => {
    const bad = validIndex() as { witnesses: { name: string }[] };
    bad.witnesses[1].name = "alpha";
    expect(() => parseWitnessIndex(bad)).toThrow(/duplicate witness name/);
  });

  it("rejects a witness with no steps", () => {
    const bad = validIndex() as { witnesses: { steps: unknown[] }[] };
    bad.witnesses[0].steps = [];
    expect(() => parseWitnessIndex(bad)).toThrow(/no steps/);
  });

  it("rejects a missing bySpecFile aggregation (witnesses.md §3.3)", () => {
    const bad = validIndex() as Record<string, unknown>;
    delete bad.bySpecFile;
    expect(() => parseWitnessIndex(bad)).toThrow(/bySpecFile/);
  });
});

describe("parseSpecCorpus", () => {
  const valid = {
    version: SUPPORTED_SPEC_CORPUS_VERSION,
    sourceDir: "src-useq/docs/specs",
    entryFile: "MAIN.md",
    index: [{ file: "MAIN.md", title: "ModuLisp Semantics", number: null, description: "" }],
    documents: { "MAIN.md": { file: "MAIN.md", title: "ModuLisp Semantics", blocks: [], clauses: [] } },
  };

  it("accepts a well-formed corpus", () => {
    expect(parseSpecCorpus(valid).entryFile).toBe("MAIN.md");
  });

  it("rejects an unsupported schema version", () => {
    expect(() => parseSpecCorpus({ ...valid, version: 42 })).toThrow(/unsupported schema version/);
  });

  it("rejects a corpus with no documents map", () => {
    expect(() => parseSpecCorpus({ ...valid, documents: [] })).toThrow(/'documents'/);
  });
});

describe("lookup helpers", () => {
  const index = parseWitnessIndex(validIndex()) as WitnessIndex;

  it("indexes witnesses by name", () => {
    expect(witnessesByName(index).get("alpha")?.tags).toEqual(["smoke"]);
  });

  it("finds the witnesses citing a clause", () => {
    expect(witnessNamesForClause(index, "time.md", "1.1")).toEqual(["alpha"]);
  });

  it("returns an empty list for an uncited clause — a coverage gap, not an error", () => {
    expect(witnessNamesForClause(index, "time.md", "9.9")).toEqual([]);
    expect(witnessNamesForClause(index, "no-such.md", "1.1")).toEqual([]);
  });

  it("merges clause-level and document-level citations per file", () => {
    expect(witnessNamesForFile(index, "time.md").sort()).toEqual(["alpha", "beta"]);
  });
});

describe("asset fetching", () => {
  beforeEach(() => resetWitnessLoaderCache());

  it("loads and validates the witness index from the bundled asset path", async () => {
    const seen: string[] = [];
    const index = await loadWitnessIndex(async (url) => {
      seen.push(url);
      return validIndex();
    });
    expect(seen).toEqual([WITNESS_INDEX_URL]);
    expect(index.witnessCount).toBe(2);
  });

  it("memoises the index for the session", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return validIndex();
    };
    await loadWitnessIndex(fetcher);
    await loadWitnessIndex(fetcher);
    expect(calls).toBe(1);
  });

  it("does not memoise a failure — a retry can succeed", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      if (calls === 1) throw new Error("network down");
      return validIndex();
    };
    await expect(loadWitnessIndex(fetcher)).rejects.toThrow(/network down/);
    await expect(loadWitnessIndex(fetcher)).resolves.toBeDefined();
    expect(calls).toBe(2);
  });

  it("loads the spec corpus from its own asset path", async () => {
    const seen: string[] = [];
    await loadSpecCorpus(async (url) => {
      seen.push(url);
      return {
        version: SUPPORTED_SPEC_CORPUS_VERSION,
        sourceDir: "s",
        entryFile: "MAIN.md",
        index: [],
        documents: {},
      };
    });
    expect(seen).toEqual([SPEC_CORPUS_URL]);
  });
});
