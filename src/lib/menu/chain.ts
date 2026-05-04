// src/lib/menu/chain.ts
//
// Pure auto-chain runner for the gamepad-driven radial menu. Spec:
// docs/specs/radial-menu.md §8 (auto-chain semantics) and §8.2 (hole-scope
// routing). The chain runs *after* a verb commits — the dispatcher
// (useq-perform-4zt.69.33 / H1) calls `applyVerb(...)`, then feeds the
// resulting `(tree, cursorSet)` pair into `nextChainStep(...)` to decide
// whether to re-open the menu and with what scope.
//
// PURE. No `Date.now()`, no DOM, no async, no Solid imports, no menu-state
// mutation. Errors are returned as `{ reopen: false, reason: ... }` —
// never thrown. The dispatcher consumes the returned `ChainStep` and is
// the sole impure component (per §11.2).
//
// Imports from `src/editors/extensions/structure/core/` are intentional
// and consistent with `verbs.ts`: the chain runner reads structural-editing
// shapes directly. Imports use bare module specifiers (no `.ts` suffix) to
// stay aligned with the layered import-boundary lint posture in the menu
// epic.
//
// The dispatcher is responsible for narrowing the manifest (or filtering
// rendered items) using the returned `HoleScope`. This module just reports
// what it sees — it does not touch the manifest.

import { findById } from "../../editors/extensions/structure/core/traversal";
import type {
  Cursor,
  CursorSet,
  HoleNode,
  Node,
  NodeId,
  Tree,
} from "../../editors/extensions/structure/core/types";

import type { ApplyTarget, HoleType } from "./types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The narrowing scope passed to the dispatcher's reopen call. Maps to the
 * routing table in radial-menu.md §8.2.1.
 *
 * - `{ kind: 'unfiltered' }` — untyped hole (no `holeType` narrowing): the
 *   menu opens at the root level and any verb is acceptable.
 * - `{ kind: 'typed', holeType }` — typed hole: the dispatcher narrows the
 *   visible items / pre-selects a tab per the §8.2.1 routing table.
 *
 * Future scopes (e.g. `{ kind: 'category', categoryId }`) are deferred per
 * §13 and not surfaced here yet. Adding them later is an additive change.
 *
 * @see docs/specs/radial-menu.md §8.2.1
 */
export type HoleScope =
  | { readonly kind: "unfiltered" }
  | { readonly kind: "typed"; readonly holeType: HoleType };

/**
 * The result of chain inspection. Either we have a hole to re-open on
 * (with the scope and the hole node so the caller can highlight / preview),
 * or we don't (with a reason for telemetry / diagnostics).
 *
 * `reopen: false` is not an error — `'no-hole'` and `'cursor-not-on-hole'`
 * are normal terminal states; `'manual-cursor-move'` is the §8 carve-out
 * (manual nav into a hole never auto-opens; user must tap Y).
 *
 * @see docs/specs/radial-menu.md §8
 */
export type ChainStep =
  | {
      readonly reopen: false;
      readonly reason:
        | "no-hole"
        | "cursor-not-on-hole"
        | "manual-cursor-move";
    }
  | {
      readonly reopen: true;
      readonly target: ApplyTarget;
      readonly scope: HoleScope;
      readonly hole: HoleNode;
    };

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Compute the next chain step after a verb applies.
 *
 * Per spec §8 + §8.2.1:
 *
 * 1. If the cursor moved by user navigation (not by the just-committed
 *    verb), return `{ reopen: false, reason: 'manual-cursor-move' }`.
 *    Manual nav into a hole **never** auto-opens the menu — the user
 *    always taps Y to summon it (§8.2.2).
 * 2. Otherwise inspect the primary cursor's target node:
 *    - If it is a `HoleNode` with a `holeType`, return a typed scope
 *      so the dispatcher can pre-select the right tab / sub-mode.
 *      (Untyped holes — i.e. holes without a `holeType` — are not
 *      possible under the current type system: every `HoleNode` carries
 *      a `holeType`. The `unfiltered` branch is reserved for future
 *      hole shapes that lack narrowing data.)
 *    - If it is anything else, the chain ends — the cursor landed on a
 *      filled form per §5.4.
 *
 * The returned `ApplyTarget` is constructed by branding a small carrier
 * that records the hole's NodeId. ApplyTarget is opaque (declared in
 * types.ts §3.1.3) and the dispatcher binds it to the structural cursor
 * type at construction time. The carrier shape stays internal — no other
 * consumer should read its fields.
 *
 * @param tree           the post-mutation tree
 * @param cursorSet      the post-mutation cursor (where the verb landed it)
 * @param verbCausedMutation
 *   `true` if the cursor moved due to the just-committed verb (per §5.4 /
 *   §8.3 cursor placement); `false` if it moved by user navigation. The
 *   chain only triggers on the verb-caused branch (§8.2.2).
 *
 * @see docs/specs/radial-menu.md §8
 * @see docs/specs/radial-menu.md §8.2.1
 */
export function nextChainStep(
  tree: Tree,
  cursorSet: CursorSet,
  verbCausedMutation: boolean,
): ChainStep {
  // §8.2.2 carve-out: manual navigation onto a hole never auto-opens.
  if (!verbCausedMutation) {
    return { reopen: false, reason: "manual-cursor-move" };
  }

  // Resolve the primary cursor's focused node id. Range cursors are deferred
  // (radial-menu.md §13.11); follow verbs.ts and use `start` as the focus
  // for ranges so the chain still has a chance to fire.
  const focusedId = primaryFocusId(cursorSet);
  if (focusedId === null) {
    // No primary focus: nothing to chain on. Treat as plain "no hole".
    return { reopen: false, reason: "no-hole" };
  }

  const node = findById(tree.root, focusedId);
  if (node === null || !isHoleNode(node)) {
    return { reopen: false, reason: "cursor-not-on-hole" };
  }

  // The current `HoleNode` shape (structural-editing core/types.ts §2.9)
  // requires `holeType`, so every hole is "typed". The `unfiltered` branch
  // exists for forward compatibility with future untyped holes.
  const scope: HoleScope = node.holeType
    ? { kind: "typed", holeType: node.holeType }
    : { kind: "unfiltered" };

  return {
    reopen: true,
    target: holeAsApplyTarget(node.id),
    scope,
    hole: node,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the primary cursor's focused node id. Mirrors the convention used
 * by `verbs.ts`: range cursors fall through to `start` so callers always get
 * a single id to work with. In practice the chain runner is invoked
 * post-verb-commit when verbs always emit a single-node primary cursor on
 * the inserted form / first hole (§5.4) — the range branch is unreachable
 * but kept for total coverage.
 */
function primaryFocusId(cursorSet: CursorSet): NodeId | null {
  const c: Cursor | undefined = cursorSet.primary;
  if (c === undefined) return null;
  if (c.kind === "node") return c.target;
  return c.start;
}

/** Local hole-leaf type guard. Mirrors `holes.ts:isHole` but operates on
 *  the broader `Node | null` callsite without an extra import boundary. */
function isHoleNode(n: Node): n is HoleNode {
  return n.kind === "hole";
}

/**
 * Brand the hole's node id as an `ApplyTarget`. ApplyTarget is opaque to
 * this layer (its concrete shape is owned by structural-editing per
 * types.ts §3.1.3); the dispatcher reads the carrier's `nodeId` field at
 * reopen time to bind it to the live cursor. No other consumer should
 * depend on the carrier shape — treat values of this type as opaque.
 */
function holeAsApplyTarget(nodeId: NodeId): ApplyTarget {
  return { __brand: "ApplyTarget", nodeId } as unknown as ApplyTarget;
}
