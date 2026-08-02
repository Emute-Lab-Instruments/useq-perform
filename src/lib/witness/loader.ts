/**
 * Loader for the bundled witness index and language spec corpus.
 *
 * Spec: `docs/specs/witnesses.md` §3, `docs/specs/engine-ledger.md` §2.1.
 *
 * Both assets are emitted at build time (`scripts/harvest-witnesses.mjs`,
 * `scripts/harvest-specs.mjs`) and ship unconditionally; only the UI that
 * renders them is devmode-gated (engine-ledger.md §1.3). They are fetched
 * lazily and memoised for the session.
 *
 * Foundation layer: the fetch implementation is injectable so this module has
 * no hard dependency on a browser global and stays testable.
 */

import {
  SUPPORTED_WITNESS_INDEX_VERSION,
  type Witness,
  type WitnessIndex,
} from "./types.ts";

export const WITNESS_INDEX_URL = "assets/witness-index.json";
export const SPEC_CORPUS_URL = "assets/spec-corpus.json";

/** Minimal fetch seam — anything that resolves a URL to JSON. */
export type JsonFetcher = (url: string) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Spec corpus shapes (emitted by scripts/harvest-specs.mjs)
// ---------------------------------------------------------------------------

export interface SpecBlock {
  readonly kind: "heading" | "prose" | "code" | "table" | "rule";
  /** Clause this block belongs to, e.g. `3.1`. `null` outside any clause. */
  readonly clause: string | null;
  /** Anchor id — present on headings and clause-opening paragraphs. */
  readonly id?: string;
  readonly depth?: number;
  readonly text?: string;
  readonly html?: string;
  readonly lang?: string;
  readonly code?: string;
  /** True on the paragraph that introduces a clause. */
  readonly clauseOpener?: boolean;
}

export interface SpecDocument {
  readonly file: string;
  readonly title: string;
  readonly blocks: readonly SpecBlock[];
  /** Every clause and section number the document defines, in document order. */
  readonly clauses: readonly string[];
}

export interface SpecIndexEntry {
  readonly file: string;
  readonly title: string;
  /** MAIN.md §6 sub-spec number, when the entry document indexes this file. */
  readonly number: string | null;
  readonly description: string;
  /** True when MAIN.md §6 does not index this file — a visible corpus gap. */
  readonly unindexed?: boolean;
}

export interface SpecCorpus {
  readonly version: number;
  readonly sourceDir: string;
  readonly entryFile: string;
  readonly index: readonly SpecIndexEntry[];
  readonly documents: Readonly<Record<string, SpecDocument>>;
}

export const SUPPORTED_SPEC_CORPUS_VERSION = 1;

// ---------------------------------------------------------------------------
// Parsing / validation
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a raw witness-index payload.
 * Throws on a shape the app cannot trust — a malformed index would produce
 * silently wrong badges, which is worse than no Ledger.
 */
export function parseWitnessIndex(raw: unknown): WitnessIndex {
  if (!isRecord(raw)) throw new Error("witness index: payload is not an object");
  if (raw.version !== SUPPORTED_WITNESS_INDEX_VERSION) {
    throw new Error(
      `witness index: unsupported schema version ${String(raw.version)} (expected ${SUPPORTED_WITNESS_INDEX_VERSION})`,
    );
  }
  if (!Array.isArray(raw.witnesses)) throw new Error("witness index: 'witnesses' must be an array");
  if (!isRecord(raw.bySpecFile)) throw new Error("witness index: 'bySpecFile' must be an object");

  const seen = new Set<string>();
  for (const w of raw.witnesses) {
    if (!isRecord(w) || typeof w.name !== "string" || w.name === "") {
      throw new Error("witness index: every witness needs a non-empty 'name'");
    }
    if (seen.has(w.name)) throw new Error(`witness index: duplicate witness name '${w.name}'`);
    seen.add(w.name);
    if (!Array.isArray(w.steps) || w.steps.length === 0) {
      throw new Error(`witness index: '${w.name}' has no steps`);
    }
    if (!Array.isArray(w.specRefs)) {
      throw new Error(`witness index: '${w.name}' has no 'specRefs' array`);
    }
  }

  return raw as unknown as WitnessIndex;
}

export function parseSpecCorpus(raw: unknown): SpecCorpus {
  if (!isRecord(raw)) throw new Error("spec corpus: payload is not an object");
  if (raw.version !== SUPPORTED_SPEC_CORPUS_VERSION) {
    throw new Error(
      `spec corpus: unsupported schema version ${String(raw.version)} (expected ${SUPPORTED_SPEC_CORPUS_VERSION})`,
    );
  }
  if (!Array.isArray(raw.index)) throw new Error("spec corpus: 'index' must be an array");
  if (!isRecord(raw.documents)) throw new Error("spec corpus: 'documents' must be an object");
  return raw as unknown as SpecCorpus;
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Index witnesses by name for O(1) result joins. */
export function witnessesByName(index: WitnessIndex): Map<string, Witness> {
  return new Map(index.witnesses.map((w) => [w.name, w]));
}

/**
 * Witness names citing a given clause of a given spec file.
 * Falls back to the empty list when nothing cites it — a coverage gap the
 * Ledger renders explicitly (engine-ledger.md §2.4).
 */
export function witnessNamesForClause(
  index: WitnessIndex,
  specFile: string,
  clause: string,
): readonly string[] {
  return index.bySpecFile[specFile]?.clauses[clause] ?? [];
}

/** Every witness name citing a spec file, clause-level and document-level. */
export function witnessNamesForFile(index: WitnessIndex, specFile: string): readonly string[] {
  const bucket = index.bySpecFile[specFile];
  if (!bucket) return [];
  const names = new Set<string>(bucket.documentWitnesses);
  for (const list of Object.values(bucket.clauses)) for (const n of list) names.add(n);
  return [...names];
}

// ---------------------------------------------------------------------------
// Fetching (memoised per session)
// ---------------------------------------------------------------------------

const defaultFetcher: JsonFetcher = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
};

let witnessIndexPromise: Promise<WitnessIndex> | null = null;
let specCorpusPromise: Promise<SpecCorpus> | null = null;

export function loadWitnessIndex(fetcher: JsonFetcher = defaultFetcher): Promise<WitnessIndex> {
  witnessIndexPromise ??= fetcher(WITNESS_INDEX_URL)
    .then(parseWitnessIndex)
    .catch((e) => {
      witnessIndexPromise = null;
      throw e;
    });
  return witnessIndexPromise;
}

export function loadSpecCorpus(fetcher: JsonFetcher = defaultFetcher): Promise<SpecCorpus> {
  specCorpusPromise ??= fetcher(SPEC_CORPUS_URL)
    .then(parseSpecCorpus)
    .catch((e) => {
      specCorpusPromise = null;
      throw e;
    });
  return specCorpusPromise;
}

/** Drop memoised payloads. Test seam. */
export function resetWitnessLoaderCache(): void {
  witnessIndexPromise = null;
  specCorpusPromise = null;
}
