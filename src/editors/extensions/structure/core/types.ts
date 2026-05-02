/**
 * Functional core for structural editing.
 *
 * Spec: docs/specs/structural-editing.md
 *
 * This file defines the data shapes:
 *   - Node       — a structural tree node (discriminated union by `kind`)
 *   - Hole       — a structural placeholder (§2.9)
 *   - Meta       — an ordered decoration on a host node (§6); payload is opaque
 *   - Cursor     — a stable handle on a node (§2.8) or a contiguous run of siblings
 *   - CursorSet  — non-empty list with one primary plus zero or more secondaries
 *   - Tree       — the document root + helpers
 *
 * Identity: nodes carry stable string `id`s. The cursor is an id (or a pair of
 * ids for ranges). Edits build a new tree; ids on unchanged nodes are reused.
 * Lookup is by traversal (sufficient for a probe; doc trees are small).
 *
 * No CodeMirror, no Lezer, no I/O. Pure data + pure functions.
 */

// ─── Identity ──────────────────────────────────────────────────────────────

/** A stable per-node identifier. Opaque string. */
export type NodeId = string;

/** Mints fresh ids. Replaceable in tests. Default uses a counter. */
export interface IdGen {
  next(): NodeId;
}

let __counter = 0;
export function defaultIdGen(prefix = "n"): IdGen {
  return {
    next() {
      __counter += 1;
      return `${prefix}${__counter}`;
    },
  };
}

/** Reset the module-level counter; intended for tests only. */
export function __resetIdCounterForTests(): void {
  __counter = 0;
}

// ─── Metas (§6) ────────────────────────────────────────────────────────────

/**
 * A Meta decorates a host node. Internal payload navigation is out of scope
 * for this probe (§5.1.7 deferred), so the payload type stays `unknown`.
 *
 * Stack order matches the textual surface, innermost first (§6.1).
 */
export interface Meta {
  readonly kind: string;
  readonly payload: unknown;
}

// ─── Holes (§2.9) ──────────────────────────────────────────────────────────

export type HoleType = "number" | "symbol" | "keyword" | "expr" | "string";

// ─── Node kinds (§2.2 / §2.3) ──────────────────────────────────────────────

export type LeafKind = "symbol" | "number" | "keyword" | "string" | "hole";
export type CompoundKind = "list" | "vector" | "map" | "set";
export type NodeKind = LeafKind | CompoundKind | "document";

// Common fields on all non-document nodes. Holes carry an empty meta stack
// (§2.9.6 — holes are leaves, not Meta-bearing) but the field stays present
// so all addressable nodes share a uniform shape.
interface BaseNode {
  readonly id: NodeId;
  readonly metas: ReadonlyArray<Meta>;
}

export interface SymbolNode extends BaseNode {
  readonly kind: "symbol";
  readonly text: string;
}
export interface NumberNode extends BaseNode {
  readonly kind: "number";
  readonly text: string; // keep textual form to round-trip 0xFF, 1/2, 3.0e-1, etc.
}
export interface KeywordNode extends BaseNode {
  readonly kind: "keyword";
  readonly text: string; // includes the leading colon, e.g. ":freq"
}
export interface StringNode extends BaseNode {
  readonly kind: "string";
  readonly text: string; // raw text including quotes
}
export interface HoleNode extends BaseNode {
  readonly kind: "hole";
  readonly name: string; // §2.9, e.g. "freq"
  readonly holeType: HoleType;
  // metas is required by BaseNode but always [] for holes (§2.9.6).
}
export interface ListNode extends BaseNode {
  readonly kind: "list";
  readonly children: ReadonlyArray<Node>;
}
export interface VectorNode extends BaseNode {
  readonly kind: "vector";
  readonly children: ReadonlyArray<Node>;
}
export interface MapNode extends BaseNode {
  readonly kind: "map";
  readonly children: ReadonlyArray<Node>;
}
export interface SetNode extends BaseNode {
  readonly kind: "set";
  readonly children: ReadonlyArray<Node>;
}
export interface DocumentNode {
  readonly id: NodeId;
  readonly kind: "document";
  readonly children: ReadonlyArray<Node>;
  // No metas on the document root.
}

export type Leaf = SymbolNode | NumberNode | KeywordNode | StringNode | HoleNode;
export type Compound = ListNode | VectorNode | MapNode | SetNode;
export type AddressableNode = Leaf | Compound; // anything except the document root
export type Node = AddressableNode | DocumentNode;

// ─── Cursors (§3) ──────────────────────────────────────────────────────────

/**
 * A stable handle on a single node.
 *
 * `phase` is a transient annotation used exclusively by spatial Euler-tour
 * navigation (`nav.right` / `nav.left`, §5.1.9). It records whether the cursor
 * arrived at a compound *before* its children (pre-order) or *after* them
 * (post-order). Every other operation — including all tree-level navigation
 * (`nav.next`, `nav.in`, `nav.out`, `nav.first`, `nav.last`, `nav.extend*`,
 * `nav.shrink`, `nav.*Hole`) and all mutations — must emit cursors with no
 * phase set, since arrival via a non-spatial op resets the phase to pre-order
 * (the default).
 *
 * Treat `undefined` and `"pre"` as equivalent. Tests use `nodeCursor(id)`
 * (no phase) and pre-order spatial states should compare equal to it.
 */
export interface NodeCursor {
  readonly kind: "node";
  readonly target: NodeId;
  readonly phase?: "pre" | "post";
}

/**
 * A contiguous run of ≥2 siblings under a common parent. Endpoints are node
 * ids; the order in the parent's `children` defines the run (left-to-right).
 *
 * Anchor is the end the user established first (the side §nav.shrink will
 * release from the *other* end). Maintained so `nav.shrink` removes the
 * most-recently-added end (§5.1.6).
 */
export interface RangeCursor {
  readonly kind: "range";
  readonly parent: NodeId;
  readonly start: NodeId; // first node in document order (leftmost)
  readonly end: NodeId; // last node in document order (rightmost)
  readonly anchor: "start" | "end"; // which endpoint was the original anchor
}

export type Cursor = NodeCursor | RangeCursor;

/**
 * Cursor set with explicit primary. Ordered: [primary, ...secondaries].
 * Always non-empty (§3.2). The list invariant is enforced by constructors.
 */
export interface CursorSet {
  readonly primary: Cursor;
  readonly secondaries: ReadonlyArray<Cursor>;
}

// ─── Tree wrapper ──────────────────────────────────────────────────────────

/**
 * The document. `root` is always a `DocumentNode`. Wrapper exists so we can
 * later attach metadata (parse warnings, source map) without changing call
 * sites. For now it's a thin shell.
 */
export interface Tree {
  readonly root: DocumentNode;
}

// ─── State pair (§5: ops have type (Tree, CursorSet) → (Tree, CursorSet)) ──

export interface State {
  readonly tree: Tree;
  readonly cursors: CursorSet;
}

/**
 * No-op reasons. When a precondition fails, an op returns the input state
 * unchanged plus a reason the caller may surface (e.g. flash + console toast,
 * §7.2). This is the discriminator the prompt asks for.
 */
export type NoOpReason =
  | "at-document-root"
  | "on-leaf"
  | "empty-compound"
  | "no-prev-sibling"
  | "no-next-sibling"
  | "no-other-sibling" // for raise on a top-level form (parent is document)
  | "no-children"
  | "fewer-than-two-children"
  | "no-hole"
  | "not-on-hole"
  | "range-cannot-extend"
  | "range-not-shrinkable"
  | "no-meta"
  | "atom-slurp-disabled" // when atomSlurpBehaviour = "no-op"
  | "single-top-level"; // raise/splice with the document as the only ancestor

/**
 * Result of any structural op. `state` is the new (or unchanged) state;
 * `noOps` is one entry per cursor that failed its precondition. An empty
 * `noOps` means every cursor moved/mutated successfully.
 */
export interface OpResult {
  readonly state: State;
  readonly noOps: ReadonlyArray<{ cursor: Cursor; reason: NoOpReason }>;
}

// ─── Tiny constructors ─────────────────────────────────────────────────────

export function nodeCursor(
  id: NodeId,
  phase?: "pre" | "post",
): NodeCursor {
  // Omit `phase` from the object entirely when it's the default (pre/undef).
  // This keeps the pointwise `toEqual(nodeCursor(id))` checks in tests
  // working: callers that don't care about phase get a bare cursor.
  if (phase === undefined || phase === "pre") {
    return { kind: "node", target: id };
  }
  return { kind: "node", target: id, phase };
}

export function rangeCursor(
  parent: NodeId,
  start: NodeId,
  end: NodeId,
  anchor: "start" | "end" = "start",
): RangeCursor {
  if (start === end) {
    throw new Error("range cursor requires distinct endpoints (length ≥ 2)");
  }
  return { kind: "range", parent, start, end, anchor };
}

export function singleCursor(c: Cursor): CursorSet {
  return { primary: c, secondaries: [] };
}

export function cursorList(cs: CursorSet): ReadonlyArray<Cursor> {
  return [cs.primary, ...cs.secondaries];
}

export function makeTree(root: DocumentNode): Tree {
  return { root };
}
