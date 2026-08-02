/**
 * Harvest the conformance corpus into a bundled witness index.
 *
 * Spec: docs/specs/witnesses.md §3 (harvest and bundling).
 *
 * Reads every `src-useq/test/conformance/**\/*.yaml` case, validates its
 * shape, and emits `public/assets/witness-index.json` containing:
 *   - `witnesses`: one entry per case (§3.1)
 *   - `bySpecFile`: per-spec-file clause -> witness names aggregation (§3.3)
 *
 * Failure policy (§3.2, as scoped by the M1 brief):
 *   - fail loudly: YAML parse error, non-list document, case without a name,
 *     duplicate case name, empty/absent steps, malformed `spec:` reference
 *   - warn only:   missing `spec:` reference
 *
 * (witnesses.md §1.3 calls a missing `spec:` a warning while §3.2 lists it
 * among the loud failures. The corpus currently has none, so the softer
 * reading is used and the contradiction is recorded in the spec.)
 *
 * Usage:
 *   node scripts/harvest-witnesses.mjs            # write the index
 *   node scripts/harvest-witnesses.mjs --check    # validate only, no write
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export const CORPUS_DIR = path.join('src-useq', 'test', 'conformance');
export const WITNESS_INDEX_PATH = path.join('public', 'assets', 'witness-index.json');

/** Schema version of the emitted index. Bump on breaking shape changes. */
export const WITNESS_INDEX_VERSION = 1;

/**
 * A `spec:` reference is `<file>.md` optionally followed by `§<clause>`.
 * Multiple references are comma-separated (witnesses.md §1.3). Some corpus
 * entries cite a whole document with no clause (e.g. `outputs.md,
 * failure-model.md §5`), so the clause is optional.
 */
const SPEC_REF_RE = /^([A-Za-z0-9._-]+\.md)(?:\s*§\s*(\d+(?:\.\d+)*))?$/;

/** Recursively collect `*.yaml` / `*.yml` files under `dir`, sorted. */
export function collectCorpusFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectCorpusFiles(full));
    else if (/\.ya?ml$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Parse a `spec:` field into structured references.
 * @returns {{refs: {file: string, clause: string|null}[], errors: string[]}}
 */
export function parseSpecRefs(raw) {
  const refs = [];
  const errors = [];
  for (const piece of String(raw).split(',')) {
    const text = piece.trim();
    if (!text) continue;
    const m = SPEC_REF_RE.exec(text);
    if (!m) {
      errors.push(`malformed spec reference '${text}' (expected '<file>.md §<clause>')`);
      continue;
    }
    refs.push({ file: m[1], clause: m[2] ?? null });
  }
  if (refs.length === 0 && errors.length === 0) {
    errors.push('empty spec reference');
  }
  return { refs, errors };
}

/**
 * Build the witness index from the corpus on disk.
 * @returns {{index: object, errors: string[], warnings: string[]}}
 */
export function harvestWitnesses({ corpusDir = CORPUS_DIR } = {}) {
  const errors = [];
  const warnings = [];
  const witnesses = [];
  const seenNames = new Map();

  const files = collectCorpusFiles(corpusDir);
  if (files.length === 0) {
    errors.push(`No conformance fixtures found under ${corpusDir}. Is the src-useq submodule checked out?`);
  }

  for (const file of files) {
    const sourcePath = file.split(path.sep).join('/');
    let doc;
    try {
      doc = yaml.load(fs.readFileSync(file, 'utf-8'));
    } catch (e) {
      errors.push(`${sourcePath}: YAML parse error: ${e.message}`);
      continue;
    }
    if (doc === null || doc === undefined) continue;
    if (!Array.isArray(doc)) {
      errors.push(`${sourcePath}: top level must be a list of cases`);
      continue;
    }

    for (const [i, kase] of doc.entries()) {
      const where = `${sourcePath}[${i}]`;
      if (kase === null || typeof kase !== 'object' || Array.isArray(kase)) {
        errors.push(`${where}: case is not a mapping`);
        continue;
      }
      const name = kase.name;
      if (typeof name !== 'string' || name.trim() === '') {
        errors.push(`${where}: case is missing a 'name'`);
        continue;
      }
      const loc = `${sourcePath}::${name}`;
      if (seenNames.has(name)) {
        errors.push(`${loc}: duplicate case name (also in ${seenNames.get(name)})`);
        continue;
      }
      seenNames.set(name, sourcePath);

      const steps = kase.steps;
      if (!Array.isArray(steps) || steps.length === 0) {
        errors.push(`${loc}: 'steps' must be a non-empty list`);
        continue;
      }

      let specRefs = [];
      if (kase.spec === undefined || kase.spec === null || String(kase.spec).trim() === '') {
        warnings.push(`${loc}: missing 'spec:' clause reference`);
      } else {
        const parsed = parseSpecRefs(kase.spec);
        for (const err of parsed.errors) errors.push(`${loc}: ${err}`);
        specRefs = parsed.refs;
      }

      const tags = Array.isArray(kase.tags) ? kase.tags.filter((t) => typeof t === 'string') : [];

      witnesses.push({
        name,
        specFile: specRefs[0]?.file ?? null,
        clause: specRefs[0]?.clause ?? null,
        specRefs,
        tags,
        ...(typeof kase.guide === 'string' ? { guide: kase.guide } : {}),
        steps,
        sourcePath,
      });
    }
  }

  // §3.3 — per-spec-file aggregation so the Ledger can badge clauses without
  // re-scanning the corpus. `documentWitnesses` holds refs that cite a whole
  // file with no clause.
  const bySpecFile = {};
  for (const w of witnesses) {
    for (const ref of w.specRefs) {
      const bucket = (bySpecFile[ref.file] ??= { clauses: {}, documentWitnesses: [] });
      if (ref.clause === null) {
        if (!bucket.documentWitnesses.includes(w.name)) bucket.documentWitnesses.push(w.name);
      } else {
        const list = (bucket.clauses[ref.clause] ??= []);
        if (!list.includes(w.name)) list.push(w.name);
      }
    }
  }

  return {
    index: {
      version: WITNESS_INDEX_VERSION,
      corpusDir: corpusDir.split(path.sep).join('/'),
      fileCount: files.length,
      witnessCount: witnesses.length,
      witnesses,
      bySpecFile,
    },
    errors,
    warnings,
  };
}

export function writeWitnessIndex(index, destPath = WITNESS_INDEX_PATH) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, `${JSON.stringify(index, null, 2)}\n`);
  return destPath;
}

/** Build + validate + write. Throws on validation errors (§3.2). */
export function buildWitnessIndex({ corpusDir = CORPUS_DIR, dest = WITNESS_INDEX_PATH, write = true } = {}) {
  const { index, errors, warnings } = harvestWitnesses({ corpusDir });

  for (const w of warnings) console.warn(`  ! ${w}`);

  if (errors.length > 0) {
    const detail = errors.map((e) => `  ✗ ${e}`).join('\n');
    throw new Error(
      `Witness harvest failed with ${errors.length} error(s) — a witness that cannot be indexed is drift by definition (witnesses.md §3.2):\n${detail}`,
    );
  }

  if (write) {
    writeWitnessIndex(index, dest);
    console.log(
      `Harvested ${index.witnessCount} witnesses from ${index.fileCount} corpus file(s) -> ${dest}`,
    );
  } else {
    console.log(`Witness harvest OK: ${index.witnessCount} witnesses in ${index.fileCount} file(s)`);
  }
  return index;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (invokedDirectly) {
  try {
    buildWitnessIndex({ write: !process.argv.includes('--check') });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
