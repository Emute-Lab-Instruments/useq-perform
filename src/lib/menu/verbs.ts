// src/lib/menu/verbs.ts
//
// Pure verb implementations for the radial menu's four apply verbs: Insert,
// Replace, WrapWith, Call. Spec: docs/specs/radial-menu.md §5 (verb semantics
// with examples; root special-cases at §5.1.1; first-hole-or-form at §5.4).
//
// PURE. No `Date.now()`, no DOM, no async, no Solid imports. All errors are
// returned as `Result.Err` with a typed `reason` — never thrown. The caller
// (the dispatcher, useq-perform-4zt.69.33 / H1) reads the previous
// `MenuStateOpen` snapshot before calling the reducer, then invokes
// `applyVerb({...})` here with explicit args. The reducer transitions to
// `closed` independently — verbs do not read or write `MenuState`.
//
// Item-kind × verb compatibility (spec §2.3 + §5):
//
//   kind ↓ / verb →   Insert  Replace  WrapWith  Call
//   function          ✓        ✓        ✓         ✓
//   symbol            ✓        ✓        ✗         ✓
//   literal           ✓        ✓        ✗         ✗
//   snippet           ✓        ✓        ✓         ✓     (currently flashes — see C2 follow-up)
//
// SnippetItem.template is currently typed as the opaque `SnippetTemplate`
// brand; the real source-string → ParsedTemplate conversion lives in C2
// (manifest loader). Until that lands, snippet items reach this module as
// opaque pass-throughs and produce a structured `no-template` error rather
// than a malformed mutation. TODO(C2): teach the manifest loader to call
// `parseTemplate(source)` (`src/lib/menu/templates.ts`) at load time and
// store the parsed fragment under a typed field on `SnippetItem` so this
// module can splice it without re-parsing.
//
// Imports from `src/editors/extensions/structure/core/` are intentional
// (per radial-menu epic): the verbs operate on the structural-editing core
// shapes directly. Imports use bare module specifiers (no `.ts` suffix) to
// keep the layered import-boundary lint advisory rather than a hard error
// in this layer; the dispatcher (H1) and chain (F1) ride on the same path.

import { findHolesInOrder, makeHole } from "../../editors/extensions/structure/core/holes";
import {
  findById,
  indexOfChild,
  makeCompound,
  parentOf,
  replaceChildren,
  replaceNode,
  setChildren,
} from "../../editors/extensions/structure/core/traversal";
import type {
  AddressableNode,
  Compound,
  Cursor,
  CursorSet,
  DocumentNode,
  HoleNode,
  IdGen,
  Node,
  NodeId,
  Tree,
} from "../../editors/extensions/structure/core/types";

import type {
  FunctionItem,
  Handedness,
  HoleSpec,
  LiteralItem,
  MenuItem,
  SymbolItem,
  Verb,
} from "./types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Result of a verb apply. `ok: true` carries the new tree and cursor set
 * (the dispatcher consumes both); `ok: false` carries a structured `reason`
 * the dispatcher uses to decide between flash, toast, or close-and-cancel.
 *
 * - `'invalid-target'` — cursor target is missing, the document root for a
 *   verb that rejects the root, or otherwise unsuitable.
 * - `'unsupported-combination'` — verb-kind × item-kind cell is `✗` per the
 *   compatibility matrix (or `hand: 'both'` in v1).
 * - `'no-template'` — the picked item has no usable template (currently
 *   the only path snippet items take; also fired when a function item
 *   needs a signature but has none).
 * - `'malformed-item'` — defensive: the item's discriminator slipped past
 *   the type guard. Should be unreachable; surfaces as a flash if it does.
 *
 * @see docs/specs/radial-menu.md §5
 */
export type ApplyResult =
  | { readonly ok: true; readonly tree: Tree; readonly cursorSet: CursorSet }
  | {
      readonly ok: false;
      readonly reason:
        | "invalid-target"
        | "unsupported-combination"
        | "no-template"
        | "malformed-item";
    };

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Single-dispatch entry point. The dispatcher calls this with the cursor
 * snapshot taken at menu-open time and the picked item from the freeze
 * snapshot. Dispatches on `verb.kind`.
 *
 * @see docs/specs/radial-menu.md §5
 */
export function applyVerb(args: {
  readonly tree: Tree;
  readonly cursorSet: CursorSet;
  readonly item: MenuItem;
  readonly verb: Verb;
  readonly ids: IdGen;
}): ApplyResult {
  const { tree, cursorSet, item, verb, ids } = args;
  switch (verb.kind) {
    case "insert":
      return applyInsert(tree, cursorSet, item, verb.hand, ids);
    case "replace":
      return applyReplace(tree, cursorSet, item, verb.hand, ids);
    case "wrapWith":
      return applyWrapWith(tree, cursorSet, item, verb.hand, ids);
    case "call":
      return applyCall(tree, cursorSet, item, verb.hand, ids);
  }
}

// ---------------------------------------------------------------------------
// Insert (spec §5.1.1)
// ---------------------------------------------------------------------------

/**
 * Insert the picked item as a sibling adjacent to the cursor target.
 * - `'left'`  → sibling-before
 * - `'right'` → sibling-after
 * - `'both'`  → reserved no-op flash → `unsupported-combination`
 *
 * Document-root special case: when the cursor target is the document root,
 * append as the last top-level child regardless of handedness
 * (structural-editing.md §2.4 / radial-menu.md §5.1.1).
 *
 * Cursor lands on the first hole inside the inserted form, or on the
 * inserted form itself if no holes (§5.4).
 *
 * @see docs/specs/radial-menu.md §5.1.1
 */
export function applyInsert(
  tree: Tree,
  cursorSet: CursorSet,
  item: MenuItem,
  hand: Handedness,
  ids: IdGen,
): ApplyResult {
  if (hand === "both") {
    return { ok: false, reason: "unsupported-combination" };
  }

  // No item kind is rejected by Insert per the compatibility matrix; snippet
  // is the only one that may bail because its template hasn't been parsed.
  const made = makeNodeFromItem(item, ids);
  if (!made.ok) return made;
  const inserted = made.value;

  const targetId = primaryTargetId(cursorSet);
  if (targetId === null) {
    return { ok: false, reason: "invalid-target" };
  }

  // Document-root special case: append as the last top-level child.
  if (targetId === tree.root.id) {
    if (!isInsertableAtRoot(inserted)) {
      return { ok: false, reason: "invalid-target" };
    }
    const newRoot = setChildren(tree.root, [
      ...tree.root.children,
      inserted,
    ]) as DocumentNode;
    return successOnInserted(newRoot, inserted);
  }

  // Sibling insertion: locate parent and index, splice the new node in.
  const parent = parentOf(tree.root, targetId);
  if (parent === null) {
    return { ok: false, reason: "invalid-target" };
  }
  const idx = indexOfChild(tree.root, targetId);
  if (idx < 0) {
    return { ok: false, reason: "invalid-target" };
  }
  const insertIdx = hand === "left" ? idx : idx + 1;
  const newKids: Node[] = [
    ...parent.children.slice(0, insertIdx),
    inserted,
    ...parent.children.slice(insertIdx),
  ];
  const newRoot = replaceChildren(tree.root, parent.id, newKids);
  return successOnInserted(newRoot, inserted);
}

// ---------------------------------------------------------------------------
// Replace (spec §5.1.2)
// ---------------------------------------------------------------------------

/**
 * Replace the cursor target wholesale with the picked item.
 *
 * Handedness is reserved in v1 (§2.3): `'both'` is no-op flash; `'left'` and
 * `'right'` behave identically.
 *
 * Replace at the document root is rejected with `invalid-target`. The spec
 * (§5.1.2) says it's accepted only "if the picked item is itself a top-level
 * form"; absent a runtime classification of "top-level form" the
 * conservative policy is reject. The dispatcher renders this as a no-op
 * flash per §12.1.
 *
 * Cursor lands on the first hole in the replacement, or on the replacement
 * itself if none (§5.4).
 *
 * @see docs/specs/radial-menu.md §5.1.2
 */
export function applyReplace(
  tree: Tree,
  cursorSet: CursorSet,
  item: MenuItem,
  hand: Handedness,
  ids: IdGen,
): ApplyResult {
  if (hand === "both") {
    return { ok: false, reason: "unsupported-combination" };
  }

  const made = makeNodeFromItem(item, ids);
  if (!made.ok) return made;
  const replacement = made.value;

  const targetId = primaryTargetId(cursorSet);
  if (targetId === null || targetId === tree.root.id) {
    return { ok: false, reason: "invalid-target" };
  }

  // Existence guard: `replaceNode` throws when the id is not in the tree.
  // The other three verbs guard via `parentOf` / `findById` before mutating.
  if (findById(tree.root, targetId) === null) {
    return { ok: false, reason: "invalid-target" };
  }

  // `replaceNode` requires an addressable node id; the document root is
  // already excluded above. The replacement is always addressable.
  const newRoot = replaceNode(tree.root, targetId, replacement);
  return successOnInserted(newRoot, replacement);
}

// ---------------------------------------------------------------------------
// WrapWith (spec §5.1.3)
// ---------------------------------------------------------------------------

/**
 * Insert a new compound around the cursor target; the target becomes a
 * child of the wrapper. Handedness disambiguates which hole position the
 * target fills:
 * - `'left'`  → wrapper extends right; target fills the **first** hole.
 * - `'right'` → wrapper extends left;  target fills the **last** hole.
 * - `'both'`  → reserved no-op flash → `unsupported-combination`.
 *
 * Compatibility (matrix above): only `function` and `snippet` items are
 * meaningful wrappers. Function items must declare a `signature` with at
 * least one hole; without one, the wrapper has nowhere to put the target
 * (`no-template`). Snippet items defer to the C2 follow-up.
 *
 * Cursor lands on the first remaining hole inside the wrapper, or on the
 * wrapper itself if no holes remain (§5.4). The hole that the target
 * consumed is replaced by the target itself; remaining holes stay typed for
 * auto-chain.
 *
 * Distinct from `edit.enclose.*` (structural-editing.md §5.2.7), which
 * wraps a target in an empty bracket pair — WrapWith always introduces a
 * picked-item participant.
 *
 * @see docs/specs/radial-menu.md §5.1.3
 */
export function applyWrapWith(
  tree: Tree,
  cursorSet: CursorSet,
  item: MenuItem,
  hand: Handedness,
  ids: IdGen,
): ApplyResult {
  if (hand === "both") {
    return { ok: false, reason: "unsupported-combination" };
  }
  if (item.kind === "symbol" || item.kind === "literal") {
    return { ok: false, reason: "unsupported-combination" };
  }
  if (item.kind === "snippet") {
    // See module-level note: snippet templates need C2 to be a real
    // ParsedTemplate before we can splice them.
    return { ok: false, reason: "no-template" };
  }
  if (item.kind !== "function") {
    return { ok: false, reason: "malformed-item" };
  }

  const targetId = primaryTargetId(cursorSet);
  if (targetId === null || targetId === tree.root.id) {
    return { ok: false, reason: "invalid-target" };
  }
  const target = findById(tree.root, targetId);
  if (target === null || target.kind === "document") {
    return { ok: false, reason: "invalid-target" };
  }

  const signature: ReadonlyArray<HoleSpec> = item.signature ?? [];
  if (signature.length === 0) {
    // No holes to fill — the wrapper would have no slot for the target.
    return { ok: false, reason: "no-template" };
  }

  // Build the holes array, then substitute the target into the appropriate
  // slot. The remaining holes stay in the wrapper for auto-chain.
  const holes: HoleNode[] = signature.map((spec) =>
    makeHole(spec.name, spec.type, ids),
  );
  const head = makeSymbol(item.head, ids);
  let children: AddressableNode[];
  if (hand === "left") {
    // wrapper extends right; target fills the first hole.
    children = [head, target as AddressableNode, ...holes.slice(1)];
  } else {
    // wrapper extends left; target fills the last hole.
    children = [
      head,
      ...holes.slice(0, holes.length - 1),
      target as AddressableNode,
    ];
  }
  const wrapper: Compound = makeCompound("list", children, ids);
  const newRoot = replaceNode(tree.root, targetId, wrapper);
  return successOnInserted(newRoot, wrapper);
}

// ---------------------------------------------------------------------------
// Call (spec §5.1.4)
// ---------------------------------------------------------------------------

/**
 * Insert a function-call form using the picked symbol as head, with the
 * cursor target consumed as either the first (left) or last (right)
 * argument. Distinct from Insert in that Call ALWAYS wraps in a call form,
 * even if the item has no signature — in which case the form is `(head)`
 * with the target consumed inside (`(head target)` or `(head target)` —
 * identical for either hand when there are no extra holes).
 *
 * Compatibility (matrix above): only `function` and `symbol` items are
 * meaningful Call heads. `literal` and `snippet` items are
 * `unsupported-combination` (literals can't be a function head; snippets
 * defer for the same C2 reason as elsewhere).
 *
 * Cursor lands on the first remaining hole inside the inserted form, or on
 * the form itself if none (§5.4).
 *
 * @see docs/specs/radial-menu.md §5.1.4
 */
export function applyCall(
  tree: Tree,
  cursorSet: CursorSet,
  item: MenuItem,
  hand: Handedness,
  ids: IdGen,
): ApplyResult {
  if (hand === "both") {
    return { ok: false, reason: "unsupported-combination" };
  }
  if (item.kind === "literal" || item.kind === "snippet") {
    return { ok: false, reason: "unsupported-combination" };
  }

  const targetId = primaryTargetId(cursorSet);
  if (targetId === null || targetId === tree.root.id) {
    return { ok: false, reason: "invalid-target" };
  }
  const target = findById(tree.root, targetId);
  if (target === null || target.kind === "document") {
    return { ok: false, reason: "invalid-target" };
  }

  // Build the call form. Per §5.1.4: `(picked target …)` for left (target
  // as first arg), `(picked … target)` for right (target as last arg).
  // For a function item with N signature holes, the target consumes one
  // hole slot and the rest become typed holes for auto-chain.
  let head: AddressableNode;
  let extraHoles: HoleNode[];
  if (item.kind === "function") {
    head = makeSymbol(item.head, ids);
    const sig = item.signature ?? [];
    if (sig.length === 0) {
      // No signature => `(head target)`. Identical for either hand.
      extraHoles = [];
    } else {
      // For 'left': target is first; remaining holes are sig[1..].
      // For 'right': target is last; remaining holes are sig[0..N-2].
      const drop =
        hand === "left" ? sig.slice(1) : sig.slice(0, sig.length - 1);
      extraHoles = drop.map((spec) =>
        makeHole(spec.name, spec.type, ids),
      );
    }
  } else {
    // Symbol item: no signature; target is the sole positional arg.
    head = makeSymbol(item.text, ids);
    extraHoles = [];
  }

  const children: AddressableNode[] =
    hand === "left"
      ? [head, target as AddressableNode, ...extraHoles]
      : [head, ...extraHoles, target as AddressableNode];

  const callForm: Compound = makeCompound("list", children, ids);
  const newRoot = replaceNode(tree.root, targetId, callForm);
  return successOnInserted(newRoot, callForm);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the primary cursor's focused node id. Range cursors are deferred
 * (radial-menu.md §13.11). For now we fall through to `start` so the
 * downstream logic can decide; in practice the dispatcher captures node
 * cursors at menu-open time so the range branch is unreachable.
 */
function primaryTargetId(cursorSet: CursorSet): NodeId | null {
  const c: Cursor | undefined = cursorSet.primary;
  if (c === undefined) return null;
  if (c.kind === "node") return c.target;
  return c.start;
}

/**
 * Mint a fresh symbol leaf with the supplied text. Lives here (rather than
 * in a test builder) because the verbs need to create heads at apply time.
 */
function makeSymbol(text: string, ids: IdGen): AddressableNode {
  return {
    id: ids.next(),
    kind: "symbol",
    text,
    metas: [],
  };
}

/** Mint a fresh number leaf (textual form preserved per types.ts §2.2). */
function makeNumber(text: string, ids: IdGen): AddressableNode {
  return {
    id: ids.next(),
    kind: "number",
    text,
    metas: [],
  };
}

/** Mint a fresh keyword leaf, including the leading colon (§7.4). */
function makeKeyword(rawName: string, ids: IdGen): AddressableNode {
  const text = rawName.startsWith(":") ? rawName : `:${rawName}`;
  return {
    id: ids.next(),
    kind: "keyword",
    text,
    metas: [],
  };
}

/**
 * Item → fresh tree fragment. Returns a Result so snippet-without-template
 * surfaces cleanly to the caller as `no-template`.
 *
 * - function: produces `(head h1 h2 … hN)` with typed holes from the
 *   signature (or `(head)` for a no-signature function).
 * - symbol: a bare symbol leaf.
 * - literal: a number / keyword leaf, or a symbol leaf for boolean (true /
 *   false are bare symbols in the language). The literal surface form is
 *   preserved verbatim — `String(literal)` for numbers and booleans; the
 *   keyword loader prefixes the colon.
 * - snippet: defers — see module-level note.
 */
function makeNodeFromItem(
  item: MenuItem,
  ids: IdGen,
):
  | { readonly ok: true; readonly value: AddressableNode }
  | { readonly ok: false; readonly reason: ApplyResultReason } {
  switch (item.kind) {
    case "function":
      return { ok: true, value: makeFunctionFormFromItem(item, ids) };
    case "symbol":
      return { ok: true, value: makeNodeFromSymbol(item, ids) };
    case "literal":
      return { ok: true, value: makeNodeFromLiteral(item, ids) };
    case "snippet":
      return { ok: false, reason: "no-template" };
  }
}

/** The error-reason variant for the local Result alias. */
type ApplyResultReason = Extract<ApplyResult, { ok: false }>["reason"];

function makeFunctionFormFromItem(
  item: FunctionItem,
  ids: IdGen,
): Compound {
  const head = makeSymbol(item.head, ids);
  const signature: ReadonlyArray<HoleSpec> = item.signature ?? [];
  const holes: HoleNode[] = signature.map((spec) =>
    makeHole(spec.name, spec.type, ids),
  );
  // Per §5.1.1: a function-item Insert produces `(head h1 h2 …)` — even
  // with no holes, the form is `(head)`. Cursor placement is handled by
  // §5.4 (first-hole-or-form) downstream.
  const children: AddressableNode[] = [head, ...holes];
  return makeCompound("list", children, ids);
}

function makeNodeFromSymbol(item: SymbolItem, ids: IdGen): AddressableNode {
  return makeSymbol(item.text, ids);
}

function makeNodeFromLiteral(
  item: LiteralItem,
  ids: IdGen,
): AddressableNode {
  switch (item.literalKind) {
    case "number": {
      // Defensive coercion: the manifest lint should guarantee that
      // literalKind=number ⇒ typeof literal === 'number', but stringify
      // either way.
      const text = String(item.literal);
      return makeNumber(text, ids);
    }
    case "boolean":
      // `true` / `false` are bare symbol leaves in the language (§7.3.3).
      return makeSymbol(String(item.literal), ids);
    case "keyword":
      return makeKeyword(String(item.literal), ids);
  }
}

/**
 * §5.1.1 doc-root special case keeps top-level inserts conservative: a hole
 * leaf at the document root is well-formed in source but unevaluable, and
 * has no auto-chain affordance to fill (no enclosing form). Reject so the
 * dispatcher flashes and closes. All other addressable kinds are
 * permitted; the manifest itself shouldn't surface anything but compounds
 * and bare symbols here in practice (§7.3).
 */
function isInsertableAtRoot(n: AddressableNode): boolean {
  return n.kind !== "hole";
}

/**
 * Build the success result for an insertion / replacement / wrap, applying
 * the §5.4 first-hole-or-form rule: cursor lands on the first hole inside
 * the new node, or on the new node itself if no holes.
 */
function successOnInserted(
  newRoot: DocumentNode,
  inserted: AddressableNode,
): ApplyResult {
  const holes = findHolesInOrder(inserted);
  const cursorTarget: NodeId =
    holes.length > 0 ? holes[0].id : inserted.id;
  return {
    ok: true,
    tree: { root: newRoot },
    cursorSet: {
      primary: { kind: "node", target: cursorTarget },
      secondaries: [],
    },
  };
}
