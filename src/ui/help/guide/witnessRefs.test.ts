/**
 * Witness coupling — every `witnessRef` in the guide resolves to a real
 * conformance case.
 *
 * Spec: docs/specs/witnesses.md §4.1 ("A repo test asserts every
 * `witnessRef` resolves to a corpus case") and the-machine.md §4.1, §6.2.
 *
 * This test reads `src-useq/test/conformance/**\/*.yaml` directly with
 * js-yaml. It deliberately does **not** go through any harvested index: the
 * corpus is the single source (witnesses.md §1.1), and a test that trusted a
 * generated artefact could pass while the corpus said otherwise.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import yaml from "js-yaml";

import { chapters } from "./guideData";
import type { Chapter, ContentBlock, Playground } from "./guideTypes";

// ---------------------------------------------------------------------------
// Corpus
// ---------------------------------------------------------------------------

const CORPUS_DIR = join(process.cwd(), "src-useq", "test", "conformance");

function yamlFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...yamlFilesUnder(full));
    else if (entry.endsWith(".yaml") || entry.endsWith(".yml")) out.push(full);
  }
  return out.sort();
}

interface CorpusCase {
  name?: unknown;
  spec?: unknown;
}

/** Case name → the corpus file it lives in. */
function loadCorpus(): Map<string, string> {
  const cases = new Map<string, string>();
  for (const file of yamlFilesUnder(CORPUS_DIR)) {
    const parsed = yaml.load(readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) continue;
    for (const entry of parsed as CorpusCase[]) {
      if (entry && typeof entry.name === "string") {
        cases.set(entry.name, relative(process.cwd(), file));
      }
    }
  }
  return cases;
}

// ---------------------------------------------------------------------------
// Guide-side refs
// ---------------------------------------------------------------------------

interface GuideRef {
  chapterId: string;
  sectionId: string;
  witnessRef: string;
  code: string;
}

function walkBlocks(
  blocks: readonly ContentBlock[],
  visit: (playground: Playground) => void,
): void {
  for (const block of blocks) {
    if (block.type === "playground") visit(block.playground);
    else if (block.type === "deep-dive") walkBlocks(block.content, visit);
  }
}

function collectRefs(all: readonly Chapter[]): GuideRef[] {
  const refs: GuideRef[] = [];
  for (const chapter of all) {
    const push = (sectionId: string) => (playground: Playground) => {
      if (playground.witnessRef) {
        refs.push({
          chapterId: chapter.id,
          sectionId,
          witnessRef: playground.witnessRef,
          code: playground.code,
        });
      }
    };
    if (chapter.intro) walkBlocks(chapter.intro, push("<intro>"));
    for (const section of chapter.sections) {
      walkBlocks(section.content, push(section.id));
    }
  }
  return refs;
}

// ---------------------------------------------------------------------------

describe("guide witnessRefs (witnesses.md §4)", () => {
  it("finds the conformance corpus in the pinned src-useq submodule", () => {
    expect(
      existsSync(CORPUS_DIR),
      `Conformance corpus not found at ${CORPUS_DIR}. ` +
        "Run `git submodule update --init --recursive src-useq`.",
    ).toBe(true);
  });

  it("parses every corpus file and finds uniquely-named cases", () => {
    const files = yamlFilesUnder(CORPUS_DIR);
    expect(files.length).toBeGreaterThan(0);

    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const file of files) {
      const parsed = yaml.load(readFileSync(file, "utf8"));
      expect(Array.isArray(parsed), `${file} should be a list of cases`).toBe(
        true,
      );
      for (const entry of parsed as CorpusCase[]) {
        if (!entry || typeof entry.name !== "string") continue;
        const prev = seen.get(entry.name);
        if (prev) duplicates.push(`${entry.name} (${prev} + ${file})`);
        seen.set(entry.name, file);
      }
    }
    expect(duplicates).toEqual([]);
    expect(seen.size).toBeGreaterThan(0);
  });

  it("resolves every witnessRef in the guide to a corpus case", () => {
    const corpus = loadCorpus();
    const refs = collectRefs(chapters);
    const unresolved = refs
      .filter((ref) => !corpus.has(ref.witnessRef))
      .map((ref) => `${ref.chapterId}/${ref.sectionId} -> "${ref.witnessRef}"`);

    expect(
      unresolved,
      "Guide playgrounds reference conformance cases that do not exist. " +
        "Either fix the ref, or promote the example into a new corpus case " +
        "(witnesses.md §5.3).",
    ).toEqual([]);
  });

  it("carries at least four resolving witnessRefs in chapter 0 (the-machine.md §6.2)", () => {
    const corpus = loadCorpus();
    const ch0Refs = collectRefs(chapters).filter((r) => r.chapterId === "machine");
    const resolving = ch0Refs.filter((ref) => corpus.has(ref.witnessRef));
    expect(resolving.length).toBeGreaterThanOrEqual(4);
  });

  it("teaches the same code the referenced case evaluates (witnesses.md §4.2)", () => {
    // A weaker but non-vacuous form of the pedagogical contract: the top-level
    // form the playground shows must appear as an `eval` step of the case it
    // claims to be backed by. Guards against a ref that silently drifts onto
    // an unrelated case.
    const raw = new Map<string, CorpusCase & { steps?: unknown }>();
    for (const file of yamlFilesUnder(CORPUS_DIR)) {
      const parsed = yaml.load(readFileSync(file, "utf8"));
      if (!Array.isArray(parsed)) continue;
      for (const entry of parsed as Array<CorpusCase & { steps?: unknown }>) {
        if (entry && typeof entry.name === "string") raw.set(entry.name, entry);
      }
    }

    const mismatches: string[] = [];
    for (const ref of collectRefs(chapters)) {
      const kase = raw.get(ref.witnessRef);
      if (!kase || !Array.isArray(kase.steps)) continue;
      const evals = (kase.steps as Array<{ eval?: unknown }>)
        .map((step) => (typeof step?.eval === "string" ? step.eval.trim() : null))
        .filter((s): s is string => s !== null);
      const firstLine = ref.code.split("\n")[0].trim();
      if (!evals.includes(firstLine)) {
        mismatches.push(
          `${ref.chapterId}/${ref.sectionId}: playground "${firstLine}" is not ` +
            `an eval step of witness "${ref.witnessRef}" (steps: ${evals.join(", ")})`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });
});
