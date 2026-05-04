// src/lib/menu/previewCache.ts
//
// Per-(item, verb, hand) memoization layer for preview thumbnail computation.
// Spec: docs/specs/radial-menu.md §11.5 — "Live preview re-render on
// `shoulderHeld` change: ≤ 16 ms. Preview thumbnail computation must be
// cached per `(item, verb)` pair so changing handedness doesn't re-parse
// the predicted insertion."
//
// The task spec extends this to `(item, verb, handedness)` triples so that
// rapid LB↔RB flips during the frozen sub-phase produce at most 2
// computations (one for 'left', one for 'right'), not N.
//
// The cache stores the predicted `Tree` result of `applyVerb` for a given
// (itemId, verbKind, handedness) triple. `clear()` busts the entire cache
// (called when the manifest reloads or the menu closes).
//
// Maximum cache size: 100 entries (LRU eviction). The bound is generous —
// a typical manifest has ~60 items × 4 verbs × 3 hands = 720 theoretical
// keys, but only the (item, verb) pairs the user actually hovers over will
// populate the cache. 100 covers the working set of a single menu session
// comfortably.
//
// PURE — no DOM, no async, no Solid imports.

import type { Tree } from "../../editors/extensions/structure/core/types";
import type { Handedness, ItemId, VerbKind } from "./types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Cache key: a (item, verb, handedness) triple. The `itemId` is the manifest
 * item's unique ID; `verbKind` is one of the four apply verbs; `handedness`
 * is the shoulder held ('left' | 'right' | 'both').
 *
 * Structured as an interface (rather than a template-string key) so callers
 * construct it explicitly and the key shape is self-documenting.
 */
export interface PreviewKey {
  readonly itemId: ItemId;
  readonly verbKind: VerbKind;
  readonly handedness: Handedness;
}

/**
 * Memoization cache for preview computation. Stores the predicted tree
 * result of `applyVerb` for a given (item, verb, hand) triple.
 *
 * Lifecycle:
 * - `get(key)` — cache hit returns the cached Tree; miss returns `undefined`.
 * - `set(key, tree)` — stores the result; may evict the oldest entry if at
 *   capacity.
 * - `clear()` — busts the entire cache. Called on manifest reload or menu
 *   close.
 * - `size` — current entry count (for diagnostics / telemetry).
 */
export interface PreviewCache {
  get(key: PreviewKey): Tree | undefined;
  set(key: PreviewKey, tree: Tree): void;
  clear(): void;
  readonly size: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Maximum entries before LRU eviction. */
const MAX_CACHE_SIZE = 100;

/**
 * Serialise a `PreviewKey` into a flat string suitable as a `Map` key.
 * Uses `:` as a separator — safe because branded IDs and discriminators
 * don't contain colons.
 */
function serialiseKey(key: PreviewKey): string {
  return `${key.itemId}:${key.verbKind}:${key.handedness}`;
}

/**
 * Create a new preview cache instance.
 *
 * Uses a `Map<string, Tree>` with LRU eviction: when `set()` is called at
 * capacity, the oldest entry (first-inserted that hasn't been recently
 * accessed) is evicted. LRU order is maintained via a parallel array of
 * keys — `get()` promotes to the back (most-recent), `set()` evicts from
 * the front (least-recent).
 */
export function createPreviewCache(): PreviewCache {
  const store = new Map<string, Tree>();
  // Ordered list of serialised keys. Front = least recently used; back = most.
  const order: string[] = [];

  /** Move `key` to the back of the LRU order (most recently used). */
  function promote(key: string): void {
    const idx = order.indexOf(key);
    if (idx !== -1) {
      order.splice(idx, 1);
      order.push(key);
    }
  }

  return {
    get(key: PreviewKey): Tree | undefined {
      const k = serialiseKey(key);
      const tree = store.get(k);
      if (tree !== undefined) {
        promote(k);
      }
      return tree;
    },

    set(key: PreviewKey, tree: Tree): void {
      const k = serialiseKey(key);

      // If the key already exists, update in place and promote.
      if (store.has(k)) {
        store.set(k, tree);
        promote(k);
        return;
      }

      // Evict the least-recently-used entry if at capacity.
      if (store.size >= MAX_CACHE_SIZE) {
        const lru = order.shift();
        if (lru !== undefined) {
          store.delete(lru);
        }
      }

      store.set(k, tree);
      order.push(k);
    },

    clear(): void {
      store.clear();
      order.length = 0;
    },

    get size(): number {
      return store.size;
    },
  };
}
