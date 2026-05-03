/**
 * Folds a Lezer parse tree into a structural-editing core Tree.
 *
 * Round-2 simplifications (documented in the brief and the run report):
 *   - Fresh ids minted on every parse. Cursor stability across re-parses is
 *     handled separately by `cursorPath.ts` (structural path, not id).
 *   - Comments and strings of structural-token cruft are skipped per the
 *     existing `iterateLogicalChildren` rules in `new-structure.ts`.
 *
 * Hole recognition (§2.9.1, §2.10):
 *   - A list whose logical children are exactly `[$ <symbol> <:keyword>]`
 *     (the literal symbol `$`, a symbol name, a keyword type) is folded to a
 *     `hole{name, type}` leaf.
 *   - A list whose head is the literal symbol `$` but whose shape is malformed
 *     (wrong arity, non-symbol name, non-keyword type, invalid type value)
 *     becomes a regular list with a structural-warning diagnostic.
 *
 * Builds an `idIndex: Map<NodeId, {from, to}>` alongside the tree so the
 * decoration extension can paint halos and the apply layer can replace the
 * source range of a top-level form.
 */
import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

import {
  defaultIdGen,
  isHoleType,
  makeHole,
  makeTree,
  type DocumentNode,
  type HoleType,
  type IdGen,
  type Meta,
  type Node,
  type NodeId,
  type Tree,
} from "../core/index.ts";

// ─── Wrapper Meta payloads ────────────────────────────────────────────────

/** Payload for a `live-edit` Meta (§6.2, live-edit.md §2.2). */
export interface LiveEditMetaPayload {
  id?: string;
  min?: number;
  max?: number;
  name?: string;
  options?: string[];
  step?: number;
  precision?: number;
}

/** Source range for an id, used for halos and text replacement. */
export interface SourceRange {
  readonly from: number;
  readonly to: number;
}

export type IdIndex = ReadonlyMap<NodeId, SourceRange>;

/**
 * A structural-warning diagnostic emitted when the tree-construction step
 * detects a malformed pattern (e.g. `($ ...)` with wrong shape). Per §2.10.
 */
export interface StructuralWarning {
  readonly from: number;
  readonly to: number;
  readonly message: string;
}

export interface ParseResult {
  readonly tree: Tree;
  readonly idIndex: IdIndex;
  readonly warnings: ReadonlyArray<StructuralWarning>;
}

// Names skipped when building child arrays — they're punctuation/comments.
const STRUCTURAL_TOKEN_NAMES = new Set([
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "Brace",
  "Bracket",
  "Paren",
  "#",
  "'",
  "LineComment",
  "BlockComment",
  "Comment",
]);

function isStructuralToken(node: SyntaxNode): boolean {
  return STRUCTURAL_TOKEN_NAMES.has(node.type.name);
}

function isWithinParent(parent: SyntaxNode, child: SyntaxNode): boolean {
  return child.from >= parent.from && child.to <= parent.to;
}

/**
 * Collect the logical (non-structural-token) children of a Lezer node.
 * Used for hole-pattern detection before minting ids.
 */
function logicalChildren(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  let cur = node.firstChild;
  while (cur) {
    if (!isStructuralToken(cur) && isWithinParent(node, cur)) out.push(cur);
    cur = cur.nextSibling;
  }
  return out;
}

/**
 * Detect whether a List node matches the hole pattern `($ <symbol> <:keyword>)`
 * per §2.9.1 / §2.10. Returns the folded HoleNode if valid, pushes a
 * structural-warning and returns null if the head is `$` but the shape is
 * malformed, or returns null (no warning) if the head is not `$`.
 */
function tryHoleRecognition(
  node: SyntaxNode,
  state: EditorState,
  ids: IdGen,
  idIndex: Map<NodeId, SourceRange>,
  warnings: StructuralWarning[],
): Node | null {
  const children = logicalChildren(node);

  // Quick exit: must have at least one child whose text is "$".
  if (children.length === 0) return null;
  const headText = state.doc.sliceString(children[0].from, children[0].to);
  if (headText !== "$") return null;

  // Head is `$` — this is a hole pattern attempt. Validate shape.

  // Must have exactly 3 logical children: $, name, :type
  if (children.length !== 3) {
    warnings.push({
      from: node.from,
      to: node.to,
      message: `Malformed hole: expected ($ name :type) but got ${children.length} element(s)`,
    });
    return null;
  }

  const nameNode = children[1];
  const typeNode = children[2];

  // Name must be a symbol (not a number, keyword, string, or compound)
  const nameTypeName = nameNode.type.name;
  const nameText = state.doc.sliceString(nameNode.from, nameNode.to);
  // Symbols in clojure-mode can be "Symbol" or similar; numbers are "Number",
  // keywords start with ":"
  if (nameTypeName === "Number" || nameTypeName === "Keyword" || nameTypeName === "String" ||
      nameTypeName === "List" || nameTypeName === "Vector" || nameTypeName === "Map" || nameTypeName === "Set") {
    warnings.push({
      from: node.from,
      to: node.to,
      message: `Malformed hole: name must be a symbol, got ${nameTypeName.toLowerCase()} "${nameText}"`,
    });
    return null;
  }

  // Type must be a keyword
  const typeTypeName = typeNode.type.name;
  const typeText = state.doc.sliceString(typeNode.from, typeNode.to);
  if (typeTypeName !== "Keyword") {
    warnings.push({
      from: node.from,
      to: node.to,
      message: `Malformed hole: type must be a keyword, got ${typeTypeName.toLowerCase()} "${typeText}"`,
    });
    return null;
  }

  // Validate the type value (strip leading colon)
  const typeValue = typeText.slice(1); // remove leading ":"
  if (!isHoleType(typeValue)) {
    warnings.push({
      from: node.from,
      to: node.to,
      message: `Malformed hole: unknown type "${typeText}", expected one of :number, :symbol, :keyword, :expr, :string`,
    });
    return null;
  }

  // Valid hole pattern — fold to a hole leaf.
  const holeNode = makeHole(nameText, typeValue as HoleType, ids);
  idIndex.set(holeNode.id, { from: node.from, to: node.to });
  return holeNode;
}

// ─── Wrapper recognition ──────────────────────────────────────────────────

/** Known keyword args for `live-edit` wrappers and their expected value types. */
const LIVE_EDIT_KEYWORD_ARGS = new Set([
  ":id",
  ":min",
  ":max",
  ":name",
  ":options",
  ":step",
  ":precision",
]);

/** Numeric keyword args that should be parsed as numbers. */
const NUMERIC_ARGS = new Set([":min", ":max", ":step", ":precision"]);

/** String keyword args (value should have quotes stripped). */
const STRING_ARGS = new Set([":id", ":name"]);

/**
 * Parse keyword args from a slice of Lezer children into a LiveEditMetaPayload.
 * Iterates children in pairs: keyword then value. Unrecognized keywords are
 * silently ignored (forwards-compatible).
 */
function parseKeywordArgs(
  children: SyntaxNode[],
  state: EditorState,
): LiveEditMetaPayload {
  const payload: LiveEditMetaPayload = {};
  let i = 0;
  while (i < children.length - 1) {
    const kwNode = children[i]!;
    const valNode = children[i + 1]!;
    const kwText = state.doc.sliceString(kwNode.from, kwNode.to);

    if (!LIVE_EDIT_KEYWORD_ARGS.has(kwText)) {
      // Unknown keyword — skip pair
      i += 2;
      continue;
    }

    const valText = state.doc.sliceString(valNode.from, valNode.to);
    const key = kwText.slice(1) as keyof LiveEditMetaPayload; // strip leading ":"

    if (NUMERIC_ARGS.has(kwText)) {
      (payload as Record<string, unknown>)[key] = Number(valText);
    } else if (STRING_ARGS.has(kwText)) {
      // Strip surrounding quotes from string values
      const unquoted =
        valText.startsWith('"') && valText.endsWith('"')
          ? valText.slice(1, -1)
          : valText;
      (payload as Record<string, unknown>)[key] = unquoted;
    } else if (kwText === ":options") {
      // Options is a vector of keywords: [:up :down] → ["up", "down"]
      // The valNode should be a Vector. Parse its logical children.
      const opts: string[] = [];
      if (valNode.type.name === "Vector") {
        let cur = valNode.firstChild;
        while (cur) {
          if (!isStructuralToken(cur)) {
            const t = state.doc.sliceString(cur.from, cur.to);
            // Strip leading colon from keywords, keep other values as-is.
            opts.push(t.startsWith(":") ? t.slice(1) : t);
          }
          cur = cur.nextSibling;
        }
      }
      payload.options = opts;
    }

    i += 2;
  }
  return payload;
}

/**
 * Detect whether a List node matches a recognized wrapper pattern (§6.2).
 * Currently recognizes `(live-edit <host> <keyword-args...>)`.
 *
 * Returns the host node with a Meta prepended if valid, or null if the list's
 * head is not a recognized wrapper name. Pushes a structural warning if the
 * head matches but the shape is malformed (e.g. no host node).
 */
function tryWrapperRecognition(
  node: SyntaxNode,
  state: EditorState,
  ids: IdGen,
  idIndex: Map<NodeId, SourceRange>,
  warnings: StructuralWarning[],
): Node | null {
  const children = logicalChildren(node);
  if (children.length === 0) return null;

  const headText = state.doc.sliceString(children[0]!.from, children[0]!.to);
  if (headText !== "live-edit") return null;

  // Head is `live-edit` — this is a wrapper attempt.

  if (children.length < 2) {
    warnings.push({
      from: node.from,
      to: node.to,
      message: `Malformed live-edit wrapper: expected (live-edit <host> ...) but got no host node`,
    });
    return null;
  }

  // Convert the host (children[1]) recursively
  const host = convert(children[1]!, state, ids, idIndex, warnings);
  if (!host) return null;

  // Parse keyword args from children[2..]
  const payload = parseKeywordArgs(children.slice(2), state);

  // Attach Meta to host
  const meta: Meta = { kind: "live-edit", payload };
  const hostMetas = "metas" in host ? host.metas : [];
  const withMeta = { ...host, metas: [meta, ...hostMetas] };

  // The host's id should map to the full wrapper range for decoration replacement
  idIndex.set(host.id, { from: node.from, to: node.to });

  return withMeta;
}

/**
 * Convert a Lezer SyntaxNode into a core Node, recursively. Returns null when
 * the lezer node is structural (skip it).
 */
function convert(
  node: SyntaxNode,
  state: EditorState,
  ids: IdGen,
  idIndex: Map<NodeId, SourceRange>,
  warnings: StructuralWarning[],
): Node | null {
  if (isStructuralToken(node)) return null;

  const name = node.type.name;

  // Compounds: List / Vector / Map / Set
  if (name === "List" || name === "Vector" || name === "Map" || name === "Set") {
    // §2.10: hole recognition runs on List nodes before general conversion.
    if (name === "List") {
      const holeResult = tryHoleRecognition(node, state, ids, idIndex, warnings);
      if (holeResult !== null) return holeResult;

      // §6.2: wrapper recognition (live-edit, etc.)
      const wrapperResult = tryWrapperRecognition(node, state, ids, idIndex, warnings);
      if (wrapperResult !== null) return wrapperResult;
    }

    const id = ids.next();
    idIndex.set(id, { from: node.from, to: node.to });

    const children: Node[] = [];
    let cur = node.firstChild;
    while (cur) {
      if (!isWithinParent(node, cur)) {
        cur = cur.nextSibling;
        continue;
      }
      // §iterateLogicalChildren parity: Set wraps a Map in clojure-mode.
      // Flatten the Map's children directly into the Set's children.
      if (name === "Set" && cur.type.name === "Map") {
        let inner = cur.firstChild;
        while (inner) {
          const child = isWithinParent(node, inner)
            ? convert(inner, state, ids, idIndex, warnings)
            : null;
          if (child !== null) children.push(child);
          inner = inner.nextSibling;
        }
      } else {
        const child = convert(cur, state, ids, idIndex, warnings);
        if (child !== null) children.push(child);
      }
      cur = cur.nextSibling;
    }
    const kind: "list" | "vector" | "map" | "set" =
      name === "List" ? "list"
      : name === "Vector" ? "vector"
      : name === "Map" ? "map"
      : "set";
    return { id, kind, metas: [], children };
  }

  // Leaves
  const id = ids.next();
  idIndex.set(id, { from: node.from, to: node.to });

  const text = state.doc.sliceString(node.from, node.to);
  if (name === "Number") {
    return { id, kind: "number", metas: [], text };
  }
  if (name === "Keyword") {
    return { id, kind: "keyword", metas: [], text };
  }
  if (name === "String") {
    return { id, kind: "string", metas: [], text };
  }
  // Default: treat as a symbol. Operator/Symbol/etc all collapse to symbol
  // for round-2 purposes — the printer round-trips by raw text.
  return { id, kind: "symbol", metas: [], text };
}

/**
 * Fold the Lezer parse tree into a core Tree. The Lezer root in clojure-mode
 * is "Program"; its top-level children become the document's children.
 */
export function treeFromLezer(state: EditorState): ParseResult {
  const ids = defaultIdGen();
  const idIndex = new Map<NodeId, SourceRange>();
  const warnings: StructuralWarning[] = [];
  const lezerRoot = syntaxTree(state).topNode;

  const docId = ids.next();
  // Document range covers the whole doc.
  idIndex.set(docId, { from: 0, to: state.doc.length });

  const children: Node[] = [];
  let cur = lezerRoot.firstChild;
  while (cur) {
    const child = convert(cur, state, ids, idIndex, warnings);
    if (child !== null) children.push(child);
    cur = cur.nextSibling;
  }

  const root: DocumentNode = { id: docId, kind: "document", children };
  return { tree: makeTree(root), idIndex, warnings };
}
