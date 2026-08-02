/**
 * Harvest the ModuLisp language spec corpus into a bundled asset.
 *
 * Spec: docs/specs/engine-ledger.md §2 (spec rendering).
 *
 * Copies `src-useq/docs/specs/*.md` into `public/assets/spec-corpus.json` so
 * the Engine Ledger renders the corpus without fetching the submodule at
 * runtime. Markdown is pre-tokenised into a block model at build time:
 *
 *   - `heading` — section headings, with a stable anchor id
 *   - `prose`   — paragraphs / lists / blockquotes, pre-rendered to HTML
 *   - `table`   — pre-rendered HTML tables
 *   - `code`    — fenced code, kept as raw source so the app can mount it as a
 *                 read-only secondary editor (editor.md §1.14 — no probes)
 *   - `rule`    — horizontal rules
 *
 * Every block carries the `N.N` clause it belongs to (engine-ledger.md §2.2),
 * so clause anchors and witness badges need no runtime markdown parsing.
 * Intra-corpus links are rewritten to in-Ledger navigation (§2.3); links that
 * point outside the corpus are defused so they cannot navigate the SPA away.
 *
 * The document order of the index mirrors the sub-spec list in the corpus
 * MAIN.md §6 (§2.1).
 *
 * Usage:
 *   node scripts/harvest-specs.mjs            # write the asset
 *   node scripts/harvest-specs.mjs --check    # validate only, no write
 */

import fs from 'fs';
import path from 'path';
import { Marked } from 'marked';

export const SPECS_DIR = path.join('src-useq', 'docs', 'specs');
export const SPEC_CORPUS_PATH = path.join('public', 'assets', 'spec-corpus.json');
export const SPEC_CORPUS_VERSION = 1;

/** Entry document; also the source of the sub-spec ordering (§2.1). */
const MAIN_FILE = 'MAIN.md';

/** A clause opener: a paragraph starting `1.2 `, `6.6.1 `, `10.1 ` … */
const CLAUSE_RE = /^(\d+(?:\.\d+)+)(?=[\s.,:—-])/;
/** A numbered section heading: `## 3. Sugars` */
const SECTION_HEADING_RE = /^(\d+(?:\.\d+)*)\.?\s+/;
/** MAIN.md §6 sub-spec entry: `6.5 [time-warps.md](time-warps.md) — …` */
const SUBSPEC_RE = /^(\d+(?:\.\d+)*)\s+\[([^\]]+)\]\(([^)]+)\)\s*(?:—|--)?\s*([\s\S]*)$/;

function listSpecFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b));
}

function slugify(text) {
  return text
    .replace(/<[^>]*>/g, '')
    .toLowerCase()
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Rewrite links inside rendered HTML.
 *  - `foo.md` / `foo.md#x` where `foo.md` is in the corpus -> in-Ledger nav
 *  - anything else that is not an absolute http(s) link -> defused
 */
export function rewriteLinks(html, corpusFiles) {
  return html.replace(/<a href="([^"]*)"/g, (whole, href) => {
    if (/^https?:\/\//i.test(href)) {
      return `<a href="${href}" target="_blank" rel="noreferrer noopener"`;
    }
    if (href.startsWith('#')) {
      return `<a href="${href}"`;
    }
    const [target, fragment] = href.split('#');
    const base = target.split('/').pop() ?? '';
    if (corpusFiles.includes(base)) {
      const clauseAttr = fragment ? ` data-ledger-clause="${fragment}"` : '';
      return `<a href="#" data-ledger-spec="${base}"${clauseAttr}`;
    }
    return `<a href="#" data-ledger-unresolved="${href}" title="Outside the language spec corpus: ${href}"`;
  });
}

/** Tokenise one spec markdown file into the Ledger block model. */
export function parseSpecMarkdown(source, { file, corpusFiles = [] } = {}) {
  const marked = new Marked({ gfm: true });
  const tokens = marked.lexer(source);

  const render = (md) => rewriteLinks(marked.parse(md, { async: false }), corpusFiles);

  const blocks = [];
  const clauses = [];
  const usedIds = new Set();
  let title = file ?? '';
  let currentClause = null;
  let currentSection = null;

  const uniqueId = (base) => {
    let id = base || 'section';
    let n = 1;
    while (usedIds.has(id)) id = `${base}-${n++}`;
    usedIds.add(id);
    return id;
  };

  for (const token of tokens) {
    switch (token.type) {
      case 'space':
        break;
      case 'heading': {
        const text = token.text.replace(/<[^>]*>/g, '').trim();
        if (token.depth === 1) {
          title = text;
          blocks.push({ kind: 'heading', depth: 1, text, id: uniqueId(slugify(text)), clause: null });
          currentClause = null;
          currentSection = null;
          break;
        }
        const sec = SECTION_HEADING_RE.exec(text);
        currentSection = sec ? sec[1] : null;
        // A numbered heading closes the previous clause; the section number
        // itself is a legitimate badge target for whole-section citations
        // like `failure-model.md §7`.
        currentClause = currentSection;
        const id = uniqueId(currentSection ? `clause-${currentSection}` : slugify(text));
        blocks.push({ kind: 'heading', depth: token.depth, text, id, clause: currentSection });
        if (currentSection && !clauses.includes(currentSection)) clauses.push(currentSection);
        break;
      }
      case 'code':
        blocks.push({
          kind: 'code',
          lang: token.lang || '',
          code: token.text,
          clause: currentClause,
        });
        break;
      case 'table':
        blocks.push({ kind: 'table', html: render(token.raw), clause: currentClause });
        break;
      case 'hr':
        blocks.push({ kind: 'rule', clause: null });
        break;
      case 'paragraph': {
        const m = CLAUSE_RE.exec(token.text.trim());
        if (m) {
          currentClause = m[1];
          if (!clauses.includes(currentClause)) clauses.push(currentClause);
          blocks.push({
            kind: 'prose',
            html: render(token.raw),
            clause: currentClause,
            clauseOpener: true,
            id: uniqueId(`clause-${currentClause}`),
          });
        } else {
          blocks.push({ kind: 'prose', html: render(token.raw), clause: currentClause });
        }
        break;
      }
      default:
        blocks.push({ kind: 'prose', html: render(token.raw), clause: currentClause });
        break;
    }
  }

  return { title, blocks, clauses };
}

/** Extract the ordered sub-spec index from MAIN.md §6 (engine-ledger.md §2.1). */
export function parseSubSpecOrder(mainSource) {
  const lines = mainSource.split('\n');
  const start = lines.findIndex((l) => /^##\s+6\./.test(l));
  if (start === -1) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start + 1, end).join('\n');
  const order = [];
  for (const para of body.split(/\n\s*\n/)) {
    const m = SUBSPEC_RE.exec(para.trim().replace(/\n/g, ' '));
    if (!m) continue;
    const target = m[3].split('#')[0].split('/').pop();
    if (!target || !target.endsWith('.md')) continue;
    order.push({
      number: m[1],
      file: target,
      label: m[2],
      description: m[4].trim(),
    });
  }
  return order;
}

/** Build the bundled spec-corpus payload. */
export function harvestSpecs({ specsDir = SPECS_DIR } = {}) {
  const errors = [];
  const corpusFiles = listSpecFiles(specsDir);
  if (corpusFiles.length === 0) {
    errors.push(`No spec markdown found under ${specsDir}. Is the src-useq submodule checked out?`);
    return { corpus: null, errors };
  }
  if (!corpusFiles.includes(MAIN_FILE)) {
    errors.push(`${specsDir}: entry document ${MAIN_FILE} is missing`);
  }

  const documents = {};
  for (const file of corpusFiles) {
    const source = fs.readFileSync(path.join(specsDir, file), 'utf-8');
    const parsed = parseSpecMarkdown(source, { file, corpusFiles });
    documents[file] = { file, ...parsed };
  }

  const subSpecOrder = corpusFiles.includes(MAIN_FILE)
    ? parseSubSpecOrder(fs.readFileSync(path.join(specsDir, MAIN_FILE), 'utf-8'))
    : [];

  // Index order: MAIN.md first, then the MAIN §6 sub-spec order, then any
  // corpus file MAIN.md does not index (a visible gap, not a silent drop).
  const seen = new Set();
  const index = [];
  const push = (file, extra = {}) => {
    if (seen.has(file) || !documents[file]) return;
    seen.add(file);
    index.push({ file, title: documents[file].title, ...extra });
  };
  push(MAIN_FILE, { number: null, description: 'Entry document — frame, contracts, sub-spec index.' });
  for (const entry of subSpecOrder) push(entry.file, { number: entry.number, description: entry.description });
  for (const file of corpusFiles) push(file, { number: null, description: '', unindexed: true });

  return {
    corpus: {
      version: SPEC_CORPUS_VERSION,
      sourceDir: specsDir.split(path.sep).join('/'),
      entryFile: MAIN_FILE,
      index,
      documents,
    },
    errors,
  };
}

export function buildSpecCorpus({ specsDir = SPECS_DIR, dest = SPEC_CORPUS_PATH, write = true } = {}) {
  const { corpus, errors } = harvestSpecs({ specsDir });
  if (errors.length > 0) {
    throw new Error(`Spec harvest failed:\n${errors.map((e) => `  ✗ ${e}`).join('\n')}`);
  }
  if (write) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, `${JSON.stringify(corpus)}\n`);
    console.log(`Harvested ${corpus.index.length} spec document(s) -> ${dest}`);
  } else {
    console.log(`Spec harvest OK: ${corpus.index.length} document(s)`);
  }
  return corpus;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);

if (invokedDirectly) {
  try {
    buildSpecCorpus({ write: !process.argv.includes('--check') });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
