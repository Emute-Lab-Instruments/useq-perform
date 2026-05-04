// src/lib/menu/templates.ts
//
// Pure parser for snippet-template source: tiny Clojure-flavoured surface
// (lists, vectors, maps, strings, numbers, atoms) extended with two hole
// notations from docs/specs/structural-editing.md §2.9 / §2.9.1:
//
//   $name              — a hole *reference* (the same hole name appearing
//                        elsewhere in the same template; resolution is the
//                        consumer's job — this parser only emits the leaf).
//   ($ name :type)     — a hole *declaration* with a `:type` keyword drawn
//                        from the structural HoleType union.
//
// Bead: useq-perform-4zt.69.15. Spec: docs/specs/radial-menu.md §11.1, §8.4.
// Consumed by `src/lib/menu/verbs.ts` (separate task) which lifts the parsed
// fragment into a structural-editing `Tree` fragment.
//
// Pure: no DOM, no IO, no globals. Errors accumulate (multiple bad atoms in
// one source produce multiple errors). No imports from src/ui, src/runtime,
// src/effects, src/editors.

import type { HoleType } from "./types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * One node in a parsed template fragment. Compounds (list/vector/map) carry
 * children; atoms / strings / numbers / holes are leaves.
 *
 * Shape mirrors the structural-editing kind set (§2.2) without the
 * AST-internal fields (`id`, `metas`) — this is a parse-time intermediate
 * representation, not a structural tree.
 */
export type TemplateNode =
  | { readonly kind: "list"; readonly children: readonly TemplateNode[] }
  | { readonly kind: "vector"; readonly children: readonly TemplateNode[] }
  | { readonly kind: "map"; readonly children: readonly TemplateNode[] }
  | { readonly kind: "atom"; readonly value: string }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "number"; readonly value: number }
  | {
      readonly kind: "hole";
      readonly name: string;
      readonly type: HoleType | null;
      readonly holeKind: "reference" | "declaration";
    };

/** Top-level parse output: zero or more sibling forms. */
export type ParsedTemplate = readonly TemplateNode[];

/**
 * A single parse failure. `path` is a slash-joined breadcrumb identifying
 * the form-in-progress at the moment the error was recorded (e.g. `"0/1"` =
 * the second child of the first top-level form). Empty string = top level.
 */
export interface TemplateParseError {
  readonly path: string;
  readonly message: string;
}

/**
 * Result idiom matches `src/lib/keybindings/profiles.ts`'s discriminated
 * union (`{ ok: true, value } | { ok: false, errors }`). Errors accumulate
 * rather than throwing, so a single parse pass surfaces every defect at
 * once instead of bisecting through edits to find the next one.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly E[] };

// ---------------------------------------------------------------------------
// HoleType validation
// ---------------------------------------------------------------------------

const HOLE_TYPES: readonly HoleType[] = [
  "number",
  "symbol",
  "keyword",
  "expr",
  "string",
];

function isHoleType(s: string): s is HoleType {
  return (HOLE_TYPES as readonly string[]).includes(s);
}

// ---------------------------------------------------------------------------
// Tokeniser
// ---------------------------------------------------------------------------
//
// Tokens are minimal: open / close brackets, strings, and bare atoms. Numbers
// are parsed at the atom layer (an atom that looks numeric becomes a number
// node). This keeps the lexer trivial and pushes the type decision into one
// place.

type Token =
  | { kind: "lparen"; pos: number }
  | { kind: "rparen"; pos: number }
  | { kind: "lbracket"; pos: number }
  | { kind: "rbracket"; pos: number }
  | { kind: "lbrace"; pos: number }
  | { kind: "rbrace"; pos: number }
  | { kind: "string"; value: string; pos: number }
  | { kind: "atom"; value: string; pos: number };

interface TokenResult {
  readonly tokens: readonly Token[];
  readonly errors: readonly TemplateParseError[];
}

const ATOM_TERMINATORS = new Set([
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  '"',
]);

function isWhitespace(ch: string): boolean {
  // Treat commas as whitespace per Clojure convention. Comments aren't
  // supported in templates (they're short, hand-authored strings).
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === ",";
}

function tokenise(src: string): TokenResult {
  const tokens: Token[] = [];
  const errors: TemplateParseError[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (isWhitespace(ch)) {
      i += 1;
      continue;
    }
    if (ch === "(") { tokens.push({ kind: "lparen", pos: i }); i += 1; continue; }
    if (ch === ")") { tokens.push({ kind: "rparen", pos: i }); i += 1; continue; }
    if (ch === "[") { tokens.push({ kind: "lbracket", pos: i }); i += 1; continue; }
    if (ch === "]") { tokens.push({ kind: "rbracket", pos: i }); i += 1; continue; }
    if (ch === "{") { tokens.push({ kind: "lbrace", pos: i }); i += 1; continue; }
    if (ch === "}") { tokens.push({ kind: "rbrace", pos: i }); i += 1; continue; }
    if (ch === '"') {
      // Minimal string: backslash escapes the next character, no other
      // processing. Sufficient for snippet templates which rarely contain
      // strings at all (templates are mostly `(head $hole ...)` shapes).
      const start = i;
      i += 1;
      let value = "";
      let closed = false;
      while (i < src.length) {
        const c = src[i]!;
        if (c === "\\" && i + 1 < src.length) {
          value += src[i + 1]!;
          i += 2;
          continue;
        }
        if (c === '"') {
          closed = true;
          i += 1;
          break;
        }
        value += c;
        i += 1;
      }
      if (!closed) {
        errors.push({ path: "", message: `unterminated string starting at ${start}` });
        // Stop tokenising — the rest of the source is unreliable.
        return { tokens, errors };
      }
      tokens.push({ kind: "string", value, pos: start });
      continue;
    }
    // Atom: greedy run of non-terminator, non-whitespace characters.
    const start = i;
    let value = "";
    while (i < src.length) {
      const c = src[i]!;
      if (isWhitespace(c) || ATOM_TERMINATORS.has(c)) break;
      value += c;
      i += 1;
    }
    if (value.length === 0) {
      // Defensive: should be unreachable given the dispatch above.
      errors.push({ path: "", message: `unexpected character ${JSON.stringify(ch)} at ${i}` });
      i += 1;
      continue;
    }
    tokens.push({ kind: "atom", value, pos: start });
  }
  return { tokens, errors };
}

// ---------------------------------------------------------------------------
// Number recognition
// ---------------------------------------------------------------------------
//
// Accepts integers (`100`, `-3`), decimals (`1.5`, `-0.25`), and scientific
// notation (`1e3`, `2.5E-4`). Anything else stays an atom.
const NUMBER_RE = /^-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?$/;

function tryParseNumber(text: string): number | null {
  if (!NUMBER_RE.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

interface ParserState {
  readonly tokens: readonly Token[];
  index: number;
  readonly errors: TemplateParseError[];
}

/**
 * Parse a snippet-template source string into a sequence of top-level
 * `TemplateNode`s. Errors accumulate; on any error the result is `ok: false`.
 */
export function parseTemplate(
  src: string,
): Result<ParsedTemplate, TemplateParseError> {
  const { tokens, errors: lexErrors } = tokenise(src);
  const state: ParserState = {
    tokens,
    index: 0,
    errors: [...lexErrors],
  };

  const forms: TemplateNode[] = [];
  let topIdx = 0;
  while (state.index < state.tokens.length) {
    const node = parseNode(state, String(topIdx));
    if (node !== null) forms.push(node);
    topIdx += 1;
  }

  if (state.errors.length > 0) {
    return { ok: false, errors: state.errors };
  }
  return { ok: true, value: forms };
}

/**
 * Parse one node. Returns `null` when the parser bailed on this position
 * (error already recorded; caller should not advance further). The `path`
 * is the breadcrumb string for the *current* node, used to scope errors.
 */
function parseNode(state: ParserState, path: string): TemplateNode | null {
  const tok = state.tokens[state.index];
  if (tok === undefined) {
    state.errors.push({ path, message: "unexpected end of input" });
    return null;
  }
  switch (tok.kind) {
    case "lparen":
      return parseCompound(state, path, "list", "rparen", "(", ")");
    case "lbracket":
      return parseCompound(state, path, "vector", "rbracket", "[", "]");
    case "lbrace":
      return parseCompound(state, path, "map", "rbrace", "{", "}");
    case "rparen":
    case "rbracket":
    case "rbrace": {
      state.errors.push({
        path,
        message: `unexpected closing bracket at ${tok.pos}`,
      });
      state.index += 1;
      return null;
    }
    case "string":
      state.index += 1;
      return { kind: "string", value: tok.value };
    case "atom":
      state.index += 1;
      return atomToNode(tok.value, path, state);
  }
}

function parseCompound(
  state: ParserState,
  path: string,
  kind: "list" | "vector" | "map",
  closer: "rparen" | "rbracket" | "rbrace",
  openGlyph: string,
  closeGlyph: string,
): TemplateNode | null {
  // Consume the opener.
  state.index += 1;
  const children: TemplateNode[] = [];
  let childIdx = 0;
  while (state.index < state.tokens.length) {
    const tok = state.tokens[state.index]!;
    if (tok.kind === closer) {
      state.index += 1;
      // For lists, attempt the hole-declaration recognition before returning.
      if (kind === "list") {
        const folded = tryFoldHoleDeclaration(children, path, state);
        if (folded !== undefined) return folded;
      }
      return { kind, children };
    }
    // A wrong closer at this depth is an unrecoverable mismatch — record
    // and stop, rather than risk infinite recursion on a stuck token.
    if (tok.kind === "rparen" || tok.kind === "rbracket" || tok.kind === "rbrace") {
      state.errors.push({
        path,
        message: `expected '${closeGlyph}' to close '${openGlyph}', got '${closeGlyphFor(tok.kind)}' at ${tok.pos}`,
      });
      state.index += 1;
      return null;
    }
    const child = parseNode(state, joinPath(path, childIdx));
    if (child !== null) children.push(child);
    childIdx += 1;
  }
  state.errors.push({
    path,
    message: `unterminated '${openGlyph}' — expected '${closeGlyph}'`,
  });
  return null;
}

function closeGlyphFor(k: "rparen" | "rbracket" | "rbrace"): string {
  if (k === "rparen") return ")";
  if (k === "rbracket") return "]";
  return "}";
}

/**
 * If `children` matches `[$ <symbol-atom> <:keyword-atom>]`, return a folded
 * `hole` declaration node. If the head is `$` but the rest of the shape is
 * wrong, record an error and return `null` (parser already advanced past
 * the closer; caller treats `null` as "this form failed"). If the head is
 * not `$`, return `undefined` — the caller falls through to the plain list.
 *
 * Spec §2.9.1 says malformed `($...)` lists become regular lists with a
 * structural-warning diagnostic; we can't emit warnings from a pure parser,
 * so we use the unknown-hole-type error case (per the bead's constraint)
 * and treat any other shape mismatch as the same class of error. This is
 * stricter than the editor's tree-construction step, which is right for a
 * template parser: snippet authors should not be able to ship malformed
 * `($ ...)` forms.
 */
function tryFoldHoleDeclaration(
  children: readonly TemplateNode[],
  path: string,
  state: ParserState,
): TemplateNode | null | undefined {
  const head = children[0];
  if (head === undefined) return undefined;
  if (head.kind !== "atom" || head.value !== "$") return undefined;

  if (children.length !== 3) {
    state.errors.push({
      path,
      message: `malformed hole declaration: expected ($ <name> :<type>), got ${children.length} element(s)`,
    });
    return null;
  }
  const nameNode = children[1]!;
  const typeNode = children[2]!;
  if (nameNode.kind !== "atom") {
    state.errors.push({
      path,
      message: `malformed hole declaration: expected a symbol name, got ${nameNode.kind}`,
    });
    return null;
  }
  if (typeNode.kind !== "atom" || !typeNode.value.startsWith(":")) {
    state.errors.push({
      path,
      message: `malformed hole declaration: expected a :keyword type, got ${typeNode.kind === "atom" ? typeNode.value : typeNode.kind}`,
    });
    return null;
  }
  const typeStr = typeNode.value.slice(1);
  if (!isHoleType(typeStr)) {
    state.errors.push({
      path,
      message: `unknown-hole-type: '${typeStr}' (expected one of ${HOLE_TYPES.map((t) => `:${t}`).join(", ")})`,
    });
    return null;
  }
  return {
    kind: "hole",
    name: nameNode.value,
    type: typeStr,
    holeKind: "declaration",
  };
}

/**
 * Atom-layer dispatch: numbers, hole references, or bare atoms.
 *
 * - `$name` (where `name` is non-empty) → hole reference, untyped.
 * - `$` alone is left as an atom — it's the reserved head for hole
 *   declarations and only meaningful inside `(...)`. The compound parser
 *   handles the declaration shape.
 * - Anything else with a numeric form becomes a `number` node.
 * - Otherwise: `atom`.
 */
function atomToNode(
  text: string,
  _path: string,
  _state: ParserState,
): TemplateNode {
  if (text.length > 1 && text[0] === "$") {
    return {
      kind: "hole",
      name: text.slice(1),
      type: null,
      holeKind: "reference",
    };
  }
  const num = tryParseNumber(text);
  if (num !== null) {
    return { kind: "number", value: num };
  }
  return { kind: "atom", value: text };
}

function joinPath(parent: string, childIdx: number): string {
  return parent === "" ? String(childIdx) : `${parent}/${childIdx}`;
}
