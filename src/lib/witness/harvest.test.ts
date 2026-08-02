/**
 * Harvest output schema tests (witnesses.md §3, engine-ledger.md §2.1/§5.2).
 *
 * These run the real build-time harvests against the pinned `src-useq`
 * submodule, so they double as drift detectors: a corpus edit that breaks the
 * index shape, duplicates a case name, or cites a clause that does not exist
 * fails here rather than silently mis-badging the Ledger.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  harvestWitnesses,
  parseSpecRefs,
  collectCorpusFiles,
  CORPUS_DIR,
  WITNESS_INDEX_VERSION,
  // @ts-expect-error — build script, intentionally untyped JS
} from "../../../scripts/harvest-witnesses.mjs";
import {
  harvestSpecs,
  parseSpecMarkdown,
  parseSubSpecOrder,
  rewriteLinks,
  SPECS_DIR,
  // @ts-expect-error — build script, intentionally untyped JS
} from "../../../scripts/harvest-specs.mjs";

const corpusAvailable = fs.existsSync(CORPUS_DIR) && collectCorpusFiles(CORPUS_DIR).length > 0;
const specsAvailable = fs.existsSync(SPECS_DIR);

describe("parseSpecRefs", () => {
  it("parses a single file+clause reference", () => {
    expect(parseSpecRefs("time-warps.md §3.1")).toEqual({
      refs: [{ file: "time-warps.md", clause: "3.1" }],
      errors: [],
    });
  });

  it("parses comma-separated multi-clause references (witnesses.md §1.3)", () => {
    const { refs, errors } = parseSpecRefs("time-warps.md §2.2, time.md §1.3.1");
    expect(errors).toEqual([]);
    expect(refs).toEqual([
      { file: "time-warps.md", clause: "2.2" },
      { file: "time.md", clause: "1.3.1" },
    ]);
  });

  it("accepts a whole-document citation with no clause", () => {
    const { refs, errors } = parseSpecRefs("outputs.md, failure-model.md §5");
    expect(errors).toEqual([]);
    expect(refs).toEqual([
      { file: "outputs.md", clause: null },
      { file: "failure-model.md", clause: "5" },
    ]);
  });

  it("reports malformed references instead of dropping them", () => {
    const { errors } = parseSpecRefs("not a spec ref");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("malformed spec reference");
  });
});

describe.runIf(corpusAvailable)("witness harvest", () => {
  const { index, errors, warnings } = harvestWitnesses();

  it("harvests the pinned corpus without validation errors", () => {
    expect(errors).toEqual([]);
  });

  it("finds every corpus file and case", () => {
    expect(index.fileCount).toBe(13);
    expect(index.witnessCount).toBe(85);
    expect(index.witnesses).toHaveLength(index.witnessCount);
  });

  it("emits the declared schema version", () => {
    expect(index.version).toBe(WITNESS_INDEX_VERSION);
  });

  it("gives every witness the §3.1 shape", () => {
    for (const w of index.witnesses) {
      expect(typeof w.name).toBe("string");
      expect(w.name.length).toBeGreaterThan(0);
      expect(Array.isArray(w.specRefs)).toBe(true);
      expect(Array.isArray(w.tags)).toBe(true);
      expect(Array.isArray(w.steps)).toBe(true);
      expect(w.steps.length).toBeGreaterThan(0);
      expect(w.sourcePath.startsWith("src-useq/test/conformance/")).toBe(true);
      // specFile/clause mirror the first reference
      expect(w.specFile).toBe(w.specRefs[0]?.file ?? null);
      expect(w.clause).toBe(w.specRefs[0]?.clause ?? null);
    }
  });

  it("keeps witness names unique across the corpus", () => {
    const names = index.witnesses.map((w: { name: string }) => w.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("carries a spec citation on every witness (no warnings)", () => {
    expect(warnings).toEqual([]);
  });

  it("aggregates clause -> witness names per spec file (§3.3)", () => {
    const bucket = index.bySpecFile["time-warps.md"];
    expect(bucket).toBeDefined();
    expect(bucket.clauses["3.1"]).toContain("fast-is-pointwise-time-scaling");
    expect(bucket.clauses["3.1"]).toContain("slow-is-pointwise-time-division");
  });

  it("indexes every reference of a multi-clause witness under each clause", () => {
    const w = index.witnesses.find((x: { name: string }) => x.name === "time-as-rebinds-phasors");
    expect(w.specRefs).toHaveLength(2);
    expect(index.bySpecFile["time-warps.md"].clauses["2.2"]).toContain(w.name);
    expect(index.bySpecFile["time.md"].clauses["1.3.1"]).toContain(w.name);
  });

  it("buckets clause-less citations separately from clause citations", () => {
    expect(index.bySpecFile["outputs.md"].documentWitnesses.length).toBeGreaterThan(0);
  });
});

describe("witness harvest validation", () => {
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "witness-harvest-"));

  it("fails loudly on a duplicate case name", () => {
    const dir = fs.mkdtempSync(path.join(tmp, "dup-"));
    fs.mkdirSync(path.join(dir, "area"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "area", "a.yaml"),
      `- name: dup\n  spec: time.md §1.1\n  steps: [{eval: "(a1 1)"}]\n- name: dup\n  spec: time.md §1.2\n  steps: [{eval: "(a1 2)"}]\n`,
    );
    const { errors } = harvestWitnesses({ corpusDir: dir });
    expect(errors.join("\n")).toContain("duplicate case name");
  });

  it("fails loudly on a YAML parse error", () => {
    const dir = fs.mkdtempSync(path.join(tmp, "bad-"));
    fs.mkdirSync(path.join(dir, "area"), { recursive: true });
    fs.writeFileSync(path.join(dir, "area", "a.yaml"), "- name: x\n   bad: [unclosed\n");
    const { errors } = harvestWitnesses({ corpusDir: dir });
    expect(errors.join("\n")).toContain("YAML parse error");
  });

  it("warns (does not fail) on a missing spec citation", () => {
    const dir = fs.mkdtempSync(path.join(tmp, "nospec-"));
    fs.mkdirSync(path.join(dir, "area"), { recursive: true });
    fs.writeFileSync(path.join(dir, "area", "a.yaml"), `- name: x\n  steps: [{eval: "(a1 1)"}]\n`);
    const { errors, warnings, index } = harvestWitnesses({ corpusDir: dir });
    expect(errors).toEqual([]);
    expect(warnings.join("\n")).toContain("missing 'spec:'");
    expect(index.witnesses[0].specFile).toBeNull();
  });

  it("fails loudly on a case with no steps", () => {
    const dir = fs.mkdtempSync(path.join(tmp, "nosteps-"));
    fs.mkdirSync(path.join(dir, "area"), { recursive: true });
    fs.writeFileSync(path.join(dir, "area", "a.yaml"), `- name: x\n  spec: time.md §1.1\n  steps: []\n`);
    const { errors } = harvestWitnesses({ corpusDir: dir });
    expect(errors.join("\n")).toContain("non-empty list");
  });
});

describe("spec markdown parsing", () => {
  const SOURCE = [
    "# Demo Spec",
    "",
    "## 1. Frame",
    "",
    "1.1 First clause referring to [time.md](time.md) and [outside](../../other.md).",
    "",
    "```lisp",
    "(a1 (fast 2 t))",
    "```",
    "",
    "1.2 Second clause.",
    "",
  ].join("\n");

  const parsed = parseSpecMarkdown(SOURCE, { file: "demo.md", corpusFiles: ["demo.md", "time.md"] });

  it("takes the title from the H1", () => {
    expect(parsed.title).toBe("Demo Spec");
  });

  it("records section and clause numbers in document order", () => {
    expect(parsed.clauses).toEqual(["1", "1.1", "1.2"]);
  });

  it("gives clause-opening paragraphs a stable anchor id (engine-ledger.md §2.2)", () => {
    const opener = parsed.blocks.find((b: { clauseOpener?: boolean }) => b.clauseOpener);
    expect(opener.clause).toBe("1.1");
    expect(opener.id).toBe("clause-1.1");
  });

  it("keeps code fences as raw source so the app can mount read-only editors", () => {
    const code = parsed.blocks.find((b: { kind: string }) => b.kind === "code");
    expect(code.code).toBe("(a1 (fast 2 t))");
    expect(code.lang).toBe("lisp");
    // The fence belongs to the clause that opened before it.
    expect(code.clause).toBe("1.1");
  });

  it("rewrites intra-corpus links to in-Ledger navigation (§2.3)", () => {
    const opener = parsed.blocks.find((b: { clauseOpener?: boolean }) => b.clauseOpener);
    expect(opener.html).toContain('data-ledger-spec="time.md"');
  });

  it("defuses links that point outside the corpus", () => {
    const opener = parsed.blocks.find((b: { clauseOpener?: boolean }) => b.clauseOpener);
    expect(opener.html).toContain("data-ledger-unresolved=");
    expect(opener.html).not.toContain('href="../../other.md"');
  });
});

describe("rewriteLinks", () => {
  it("leaves external http links navigable but opens them in a new tab", () => {
    const html = rewriteLinks('<a href="https://example.com">x</a>', ["time.md"]);
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
  });

  it("preserves in-page fragment links", () => {
    expect(rewriteLinks('<a href="#foo">x</a>', [])).toContain('href="#foo"');
  });

  it("carries a clause fragment through to the Ledger link", () => {
    const html = rewriteLinks('<a href="time.md#1.3">x</a>', ["time.md"]);
    expect(html).toContain('data-ledger-spec="time.md"');
    expect(html).toContain('data-ledger-clause="1.3"');
  });
});

describe.runIf(specsAvailable)("spec corpus harvest", () => {
  const { corpus, errors } = harvestSpecs();

  it("harvests the language spec corpus cleanly", () => {
    expect(errors).toEqual([]);
    expect(corpus.entryFile).toBe("MAIN.md");
    expect(Object.keys(corpus.documents).length).toBeGreaterThan(20);
  });

  it("orders the index by the MAIN.md §6 sub-spec list (engine-ledger.md §2.1)", () => {
    expect(corpus.index[0].file).toBe("MAIN.md");
    const numbered = corpus.index.filter((e: { number: string | null }) => e.number !== null);
    expect(numbered.length).toBeGreaterThan(15);
    expect(numbered[0].file).toBe("dialects.md");
    expect(numbered.map((e: { number: string }) => e.number)).toContain("6.6.1");
  });

  it("flags corpus files MAIN.md does not index rather than dropping them", () => {
    const unindexed = corpus.index.filter((e: { unindexed?: boolean }) => e.unindexed);
    for (const entry of unindexed) expect(corpus.documents[entry.file]).toBeDefined();
  });

  it("gives every document a title and a clause list", () => {
    for (const doc of Object.values<{ title: string; clauses: string[]; blocks: unknown[] }>(corpus.documents)) {
      expect(doc.title.length).toBeGreaterThan(0);
      expect(Array.isArray(doc.clauses)).toBe(true);
      expect(doc.blocks.length).toBeGreaterThan(0);
    }
  });
});

describe.runIf(corpusAvailable && specsAvailable)("witness ↔ spec clause coupling", () => {
  it("resolves every cited clause to a clause the spec corpus actually defines", () => {
    const { index } = harvestWitnesses();
    const { corpus } = harvestSpecs();
    const unresolved: string[] = [];

    for (const [file, bucket] of Object.entries<{ clauses: Record<string, string[]> }>(index.bySpecFile)) {
      const doc = corpus.documents[file];
      if (!doc) {
        unresolved.push(`${file} (no such spec document)`);
        continue;
      }
      for (const clause of Object.keys(bucket.clauses)) {
        if (!doc.clauses.includes(clause)) {
          unresolved.push(`${file} §${clause} (cited by ${bucket.clauses[clause].join(", ")})`);
        }
      }
    }

    expect(unresolved).toEqual([]);
  });
});

describe("parseSubSpecOrder", () => {
  it("stops at the next top-level section", () => {
    const order = parseSubSpecOrder(
      ["## 6. Sub-Specs", "", "6.1 [a.md](a.md) — first", "", "## 7. Other", "", "7.1 [b.md](b.md) — nope", ""].join("\n"),
    );
    expect(order).toEqual([{ number: "6.1", file: "a.md", label: "a.md", description: "first" }]);
  });
});
