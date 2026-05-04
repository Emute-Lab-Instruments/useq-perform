// src/lib/menu/previewCache.test.ts
//
// Comprehensive coverage for the preview cache (previewCache.ts).
// Tests:
//   - Cache miss → compute and store
//   - Cache hit → returns cached value without re-computing
//   - Different handedness → different cache entry
//   - Clear → empties cache
//   - Size limit → evicts oldest (LRU) when full
//   - Rapid handedness flips: only 2 computations (left + right), not N
//
// Bead: useq-perform-4zt.69.43.

import { describe, it, expect, beforeEach } from "vitest";

import { createPreviewCache, type PreviewKey } from "./previewCache";
import type { ItemId, VerbKind, Handedness } from "./types";
import type { Tree, DocumentNode } from "../../editors/extensions/structure/core/types";
import {
  __resetIdCounterForTests,
  defaultIdGen,
  makeTree,
  type IdGen,
} from "../../editors/extensions/structure/core/types";
import { doc, sym, num } from "../../editors/extensions/structure/core/__tests__/builders";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let ids: IdGen;

beforeEach(() => {
  __resetIdCounterForTests();
  ids = defaultIdGen();
});

/** Build a minimal tree: document containing a single symbol. */
function makeTree1(text: string): Tree {
  const root: DocumentNode = doc(ids, sym(text, ids));
  return makeTree(root);
}

/** Shorthand to brand a string as ItemId. */
function itemId(id: string): ItemId {
  return id as ItemId;
}

/** Shorthand to build a PreviewKey. */
function key(id: string, verb: VerbKind, hand: Handedness): PreviewKey {
  return { itemId: itemId(id), verbKind: verb, handedness: hand };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("previewCache", () => {
  beforeEach(() => {
    __resetIdCounterForTests();
    ids = defaultIdGen();
  });

  it("cache miss returns undefined", () => {
    const cache = createPreviewCache();
    const result = cache.get(key("item-1", "insert", "left"));
    expect(result).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("stores and retrieves a cached tree (cache miss → compute → hit)", () => {
    const cache = createPreviewCache();
    const k = key("item-1", "insert", "left");
    const tree = makeTree1("osc");

    // Miss
    expect(cache.get(k)).toBeUndefined();

    // Store
    cache.set(k, tree);

    // Hit
    const cached = cache.get(k);
    expect(cached).toBe(tree);
    expect(cache.size).toBe(1);
  });

  it("cache hit returns the same tree reference", () => {
    const cache = createPreviewCache();
    const k = key("item-1", "wrapWith", "right");
    const tree = makeTree1("slow");

    cache.set(k, tree);

    const first = cache.get(k);
    const second = cache.get(k);
    expect(first).toBe(tree);
    expect(second).toBe(tree);
    // Same reference — not a copy.
    expect(first).toBe(second);
  });

  it("different handedness produces different cache entries", () => {
    const cache = createPreviewCache();
    const treeLeft = makeTree1("left-tree");
    const treeRight = makeTree1("right-tree");

    const kLeft = key("item-1", "insert", "left");
    const kRight = key("item-1", "insert", "right");

    cache.set(kLeft, treeLeft);
    cache.set(kRight, treeRight);

    expect(cache.get(kLeft)).toBe(treeLeft);
    expect(cache.get(kRight)).toBe(treeRight);
    expect(cache.size).toBe(2);
  });

  it("different verbKind produces different cache entries", () => {
    const cache = createPreviewCache();
    const treeInsert = makeTree1("insert-tree");
    const treeReplace = makeTree1("replace-tree");

    cache.set(key("item-1", "insert", "left"), treeInsert);
    cache.set(key("item-1", "replace", "left"), treeReplace);

    expect(cache.get(key("item-1", "insert", "left"))).toBe(treeInsert);
    expect(cache.get(key("item-1", "replace", "left"))).toBe(treeReplace);
    expect(cache.size).toBe(2);
  });

  it("different itemId produces different cache entries", () => {
    const cache = createPreviewCache();
    const treeA = makeTree1("tree-a");
    const treeB = makeTree1("tree-b");

    cache.set(key("item-a", "insert", "left"), treeA);
    cache.set(key("item-b", "insert", "left"), treeB);

    expect(cache.get(key("item-a", "insert", "left"))).toBe(treeA);
    expect(cache.get(key("item-b", "insert", "left"))).toBe(treeB);
    expect(cache.size).toBe(2);
  });

  it("clear empties the cache", () => {
    const cache = createPreviewCache();
    cache.set(key("item-1", "insert", "left"), makeTree1("a"));
    cache.set(key("item-2", "replace", "right"), makeTree1("b"));
    expect(cache.size).toBe(2);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.get(key("item-1", "insert", "left"))).toBeUndefined();
    expect(cache.get(key("item-2", "replace", "right"))).toBeUndefined();
  });

  it("overwrites existing key on set (update in place)", () => {
    const cache = createPreviewCache();
    const k = key("item-1", "insert", "left");
    const treeOld = makeTree1("old");
    const treeNew = makeTree1("new");

    cache.set(k, treeOld);
    expect(cache.get(k)).toBe(treeOld);

    cache.set(k, treeNew);
    expect(cache.get(k)).toBe(treeNew);
    // Size stays at 1 — it was an update, not an insert.
    expect(cache.size).toBe(1);
  });

  // ---- LRU eviction -------------------------------------------------------

  it("evicts oldest entry when cache is full (LRU)", () => {
    // Create a cache, fill it to capacity (100), then add one more.
    // The first entry should be evicted.
    const cache = createPreviewCache();

    // Fill to 100.
    const firstKey = key("item-0", "insert", "left");
    cache.set(firstKey, makeTree1("first"));

    for (let i = 1; i < 100; i++) {
      cache.set(key(`item-${i}`, "insert", "left"), makeTree1(`t-${i}`));
    }

    expect(cache.size).toBe(100);

    // Add the 101st entry — should evict the first (LRU).
    cache.set(key("item-100", "insert", "left"), makeTree1("overflow"));

    expect(cache.size).toBe(100);
    expect(cache.get(firstKey)).toBeUndefined(); // evicted
    expect(cache.get(key("item-100", "insert", "left"))).not.toBeUndefined();
  });

  it("LRU: accessing an entry promotes it (not evicted on next overflow)", () => {
    const cache = createPreviewCache();

    // Fill to 100.
    const firstKey = key("item-0", "insert", "left");
    cache.set(firstKey, makeTree1("first"));
    for (let i = 1; i < 100; i++) {
      cache.set(key(`item-${i}`, "insert", "left"), makeTree1(`t-${i}`));
    }

    // Access the first entry — promotes it to most-recently-used.
    const accessed = cache.get(firstKey);
    expect(accessed).not.toBeUndefined();

    // Add the 101st entry — should evict the *second* entry (now oldest).
    cache.set(key("item-100", "insert", "left"), makeTree1("overflow"));

    expect(cache.size).toBe(100);
    // First entry was promoted and should survive.
    expect(cache.get(firstKey)).toBe(accessed);
    // Second entry (item-1) should have been evicted.
    expect(cache.get(key("item-1", "insert", "left"))).toBeUndefined();
  });

  it("LRU: updating an existing key promotes it", () => {
    const cache = createPreviewCache();

    // Fill to 100.
    const firstKey = key("item-0", "insert", "left");
    cache.set(firstKey, makeTree1("first"));
    for (let i = 1; i < 100; i++) {
      cache.set(key(`item-${i}`, "insert", "left"), makeTree1(`t-${i}`));
    }

    // Update the first entry — promotes it.
    const updatedTree = makeTree1("updated");
    cache.set(firstKey, updatedTree);

    // Add the 101st entry — should evict item-1 (now oldest), not item-0.
    cache.set(key("item-100", "insert", "left"), makeTree1("overflow"));

    expect(cache.size).toBe(100);
    expect(cache.get(firstKey)).toBe(updatedTree); // promoted, survived
    expect(cache.get(key("item-1", "insert", "left"))).toBeUndefined(); // evicted
  });

  // ---- Rapid handedness flips ---------------------------------------------

  it("rapid handedness flips: only 2 computations (left + right), not N", () => {
    // Simulate rapid LB↔RB flips for the same item+verb.
    // After 10 flips, the cache should have exactly 2 entries (left + right)
    // and every subsequent get should be a hit.
    const cache = createPreviewCache();
    const itemId_ = itemId("osc-fn");

    // "Compute" left preview (simulating applyVerb call).
    const leftTree = makeTree1("left-preview");
    cache.set(key(itemId_, "insert", "left"), leftTree);

    // "Compute" right preview.
    const rightTree = makeTree1("right-preview");
    cache.set(key(itemId_, "insert", "right"), rightTree);

    // Simulate 10 rapid handedness flips — all should be cache hits.
    for (let i = 0; i < 10; i++) {
      const hand: Handedness = i % 2 === 0 ? "left" : "right";
      const cached = cache.get(key(itemId_, "insert", hand));
      expect(cached).toBe(hand === "left" ? leftTree : rightTree);
    }

    // Only 2 entries in the cache.
    expect(cache.size).toBe(2);
  });

  // ---- 'both' handedness ---------------------------------------------------

  it("'both' handedness is a separate cache entry from 'left' and 'right'", () => {
    const cache = createPreviewCache();
    const treeBoth = makeTree1("both-tree");

    cache.set(key("item-1", "insert", "left"), makeTree1("left-tree"));
    cache.set(key("item-1", "insert", "right"), makeTree1("right-tree"));
    cache.set(key("item-1", "insert", "both"), treeBoth);

    expect(cache.get(key("item-1", "insert", "both"))).toBe(treeBoth);
    expect(cache.size).toBe(3);
  });
});
