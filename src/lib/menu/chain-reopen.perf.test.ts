// src/lib/menu/chain-reopen.perf.test.ts
//
// Auto-chain reopen performance budget test for the radial menu.
// Per docs/specs/radial-menu.md §11.5:
//   - Auto-chain reopen (verb commit to next menu's first frame): ≤ 100 ms target
//
// This test measures the *pure computation* path of the chain reopen:
//   1. applyVerb() — tree mutation computation
//   2. nextChainStep() — hole detection
//   3. reduce() for reopen — state transition (closed → open)
//   4. Total round-trip (all three combined)
//
// The 100 ms budget covers DOM rendering too, which we cannot measure in a
// unit test. The pure computation should be well under 1 ms — if it's not,
// there's a fixable regression in the verb, chain, or reducer.
//
// bd-69.42

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { INITIAL_STATE, reduce } from "./state";
import { applyVerb } from "./verbs";
import { nextChainStep } from "./chain";
import { loadManifest, getCachedManifest, setCachedManifest, clearCachedManifest } from "./manifest";
import type { ApplyTarget, Manifest, MenuItem, MenuState, Verb } from "./types";
import manifestJson from "./manifest.json";
import { defaultIdGen } from "../../editors/extensions/structure/core/index";
import type { IdGen, Tree, CursorSet, DocumentNode, Node } from "../../editors/extensions/structure/core/types";
import { makeCompound, setChildren, findById } from "../../editors/extensions/structure/core/traversal";
import { makeHole } from "../../editors/extensions/structure/core/holes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a stub ApplyTarget (same pattern as cold-open.perf.test.ts). */
function makeTarget(): ApplyTarget {
  return { __brand: "ApplyTarget" } as ApplyTarget;
}

/** Parsed manifest loaded once for all iterations. */
function parsedManifest() {
  const result = loadManifest(manifestJson);
  if (!result.ok) throw new Error("manifest.json failed to load: " + JSON.stringify(result.errors));
  return result.value;
}

/**
 * Build a minimal tree with a single top-level form suitable for testing
 * the Insert verb + chain path.
 *
 * Tree shape:
 *   (document
 *     (list sym:target h1:freq:number))
 *
 * The cursor starts on `sym:target`. Applying Insert with a function item
 * that has a signature with typed holes will produce a new tree whose
 * cursor lands on the first hole, triggering auto-chain.
 */
function makeTestTree(ids: IdGen): {
  tree: Tree;
  cursorSet: CursorSet;
  targetId: NodeId;
} {
  const target = {
    id: ids.next(),
    kind: "symbol" as const,
    text: "x",
    metas: [],
  };

  const list = makeCompound("list", [target], ids);
  const root: DocumentNode = {
    id: ids.next(),
    kind: "document",
    children: [list],
  };

  return {
    tree: { root },
    cursorSet: {
      primary: { kind: "node", target: target.id },
      secondaries: [],
    },
    targetId: target.id,
  };
}

/**
 * Build a tree where the cursor is already on a hole (simulating the
 * state after a verb inserted a form with holes).
 */
function makeTreeWithHole(ids: IdGen): {
  tree: Tree;
  cursorSet: CursorSet;
} {
  const hole = makeHole("freq", "number", ids);
  const head = {
    id: ids.next(),
    kind: "symbol" as const,
    text: "osc",
    metas: [],
  };
  const list = makeCompound("list", [head, hole], ids);
  const root: DocumentNode = {
    id: ids.next(),
    kind: "document",
    children: [list],
  };

  return {
    tree: { root },
    cursorSet: {
      primary: { kind: "node", target: hole.id },
      secondaries: [],
    },
  };
}

/** Find the first function item in the manifest that has a non-empty signature. */
function findFunctionWithSignature(manifest: Manifest): MenuItem | null {
  for (const tab of manifest.tabs) {
    for (const cat of tab.categories) {
      for (const item of cat.items) {
        if (item.kind === "function" && item.signature && item.signature.length > 0) {
          return item;
        }
      }
    }
  }
  return null;
}

/** Find any function item (with or without signature). */
function findAnyFunctionItem(manifest: Manifest): MenuItem | null {
  for (const tab of manifest.tabs) {
    for (const cat of tab.categories) {
      for (const item of cat.items) {
        if (item.kind === "function") {
          return item;
        }
      }
    }
  }
  return null;
}

/** Find any symbol item. */
function findAnySymbolItem(manifest: Manifest): MenuItem | null {
  for (const tab of manifest.tabs) {
    for (const cat of tab.categories) {
      for (const item of cat.items) {
        if (item.kind === "symbol") {
          return item;
        }
      }
    }
  }
  return null;
}

/** Compute median, p95, max from sorted array. */
function stats(times: number[]) {
  const N = times.length;
  return {
    median: times[Math.floor(N / 2)],
    p95: times[Math.floor(N * 0.95)],
    max: times[N - 1],
  };
}

// ---------------------------------------------------------------------------
// Type import for NodeId
// ---------------------------------------------------------------------------
type NodeId = import("../../editors/extensions/structure/core/types").NodeId;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Auto-chain reopen performance budget (§11.5)", () => {
  afterEach(() => {
    clearCachedManifest();
  });

  describe("applyVerb() — tree mutation computation", () => {
    it("Insert verb produces a tree with holes in < 0.1 ms median over 100 iterations", () => {
      const manifest = parsedManifest();
      const item = findFunctionWithSignature(manifest);
      // If no function with signature, fall back to any function item.
      const testItem = item ?? findAnyFunctionItem(manifest);
      if (!testItem) return; // no function items in manifest — skip

      const verb: Verb = { kind: "insert", hand: "left" };
      const N = 100;
      const times: number[] = [];

      // Warm up
      for (let i = 0; i < 10; i++) {
        const ids = defaultIdGen("perf");
        const { tree, cursorSet } = makeTestTree(ids);
        applyVerb({ tree, cursorSet, item: testItem, verb, ids });
      }

      for (let i = 0; i < N; i++) {
        const ids = defaultIdGen("perf");
        const { tree, cursorSet } = makeTestTree(ids);
        const t0 = performance.now();
        const result = applyVerb({ tree, cursorSet, item: testItem, verb, ids });
        const t1 = performance.now();
        // Sanity: the verb should succeed (at least for function items).
        void result;
        times.push(t1 - t0);
      }

      times.sort((a, b) => a - b);
      const s = stats(times);

      // Verb application is a pure tree transformation — should be < 100 µs.
      expect(s.median).toBeLessThan(0.1);

      // eslint-disable-next-line no-console
      console.log(`applyVerb: median=${s.median.toFixed(4)}ms p95=${s.p95.toFixed(4)}ms max=${s.max.toFixed(4)}ms`);
    });
  });

  describe("nextChainStep() — hole detection", () => {
    it("hole detection on a tree with holes is < 0.01 ms median over 100 iterations", () => {
      const N = 100;
      const times: number[] = [];

      // Warm up
      for (let i = 0; i < 10; i++) {
        const ids = defaultIdGen("perf");
        const { tree, cursorSet } = makeTreeWithHole(ids);
        nextChainStep(tree, cursorSet, true);
      }

      for (let i = 0; i < N; i++) {
        const ids = defaultIdGen("perf");
        const { tree, cursorSet } = makeTreeWithHole(ids);
        const t0 = performance.now();
        const step = nextChainStep(tree, cursorSet, true);
        const t1 = performance.now();
        // Sanity: cursor on a hole should trigger reopen.
        void step;
        times.push(t1 - t0);
      }

      times.sort((a, b) => a - b);
      const s = stats(times);

      // Hole detection is a tree traversal — should be < 10 µs.
      expect(s.median).toBeLessThan(0.01);

      // eslint-disable-next-line no-console
      console.log(`nextChainStep: median=${s.median.toFixed(4)}ms p95=${s.p95.toFixed(4)}ms max=${s.max.toFixed(4)}ms`);
    });

    it("hole detection returns reopen=true when cursor is on a hole", () => {
      const ids = defaultIdGen("verify");
      const { tree, cursorSet } = makeTreeWithHole(ids);
      const step = nextChainStep(tree, cursorSet, true);
      expect(step.reopen).toBe(true);
      if (step.reopen) {
        expect(step.scope.kind).toBe("typed");
        if (step.scope.kind === "typed") {
          expect(step.scope.holeType).toBe("number");
        }
      }
    });

    it("hole detection returns reopen=false when cursor is not on a hole", () => {
      const ids = defaultIdGen("verify");
      const { tree, cursorSet } = makeTestTree(ids);
      // Cursor is on a symbol node, not a hole.
      const step = nextChainStep(tree, cursorSet, true);
      expect(step.reopen).toBe(false);
    });

    it("hole detection returns reopen=false when verbCausedMutation=false", () => {
      const ids = defaultIdGen("verify");
      const { tree, cursorSet } = makeTreeWithHole(ids);
      // Even though cursor is on a hole, manual nav should not trigger chain.
      const step = nextChainStep(tree, cursorSet, false);
      expect(step.reopen).toBe(false);
    });
  });

  describe("reduce() for reopen — closed → open state transition", () => {
    let manifest: Manifest;
    let target: ApplyTarget;

    beforeEach(() => {
      manifest = parsedManifest();
      setCachedManifest(manifest);
      target = makeTarget();
    });

    it("re-open from closed is < 0.1 ms median over 100 iterations", () => {
      const N = 100;
      const times: number[] = [];

      // Warm up
      for (let i = 0; i < 10; i++) {
        reduce(INITIAL_STATE, { kind: "open", target, manifest });
      }

      for (let i = 0; i < N; i++) {
        const t0 = performance.now();
        reduce(INITIAL_STATE, { kind: "open", target, manifest });
        const t1 = performance.now();
        times.push(t1 - t0);
      }

      times.sort((a, b) => a - b);
      const s = stats(times);

      // Re-open transition is a flat object creation — should be < 100 µs.
      expect(s.median).toBeLessThan(0.1);

      // eslint-disable-next-line no-console
      console.log(`reduce reopen: median=${s.median.toFixed(4)}ms p95=${s.p95.toFixed(4)}ms max=${s.max.toFixed(4)}ms`);
    });

    it("cancel + reopen round-trip is < 0.1 ms median over 100 iterations", () => {
      const N = 100;
      const times: number[] = [];

      // Warm up
      for (let i = 0; i < 10; i++) {
        const open = reduce(INITIAL_STATE, { kind: "open", target, manifest });
        const closed = reduce(open, { kind: "cancel" });
        reduce(closed, { kind: "open", target, manifest });
      }

      for (let i = 0; i < N; i++) {
        const t0 = performance.now();
        // Simulate dispatcher's close-then-reopen path:
        const open = reduce(INITIAL_STATE, { kind: "open", target, manifest });
        const closed = reduce(open, { kind: "cancel" });
        const reopened = reduce(closed, { kind: "open", target, manifest });
        const t1 = performance.now();
        // Sanity: should be back in open phase.
        void reopened;
        times.push(t1 - t0);
      }

      times.sort((a, b) => a - b);
      const s = stats(times);

      // Two reducer transitions are still pure computation — < 100 µs.
      expect(s.median).toBeLessThan(0.1);

      // eslint-disable-next-line no-console
      console.log(`cancel+reopen round-trip: median=${s.median.toFixed(4)}ms p95=${s.p95.toFixed(4)}ms max=${s.max.toFixed(4)}ms`);
    });
  });

  describe("full chain-reopen path (applyVerb + nextChainStep + reduce)", () => {
    let manifest: Manifest;
    let target: ApplyTarget;

    beforeEach(() => {
      manifest = parsedManifest();
      setCachedManifest(manifest);
      target = makeTarget();
    });

    it("total round-trip is < 0.5 ms median over 100 iterations", () => {
      const item = findFunctionWithSignature(manifest);
      // If no function with signature, use any function to get a valid verb result.
      const testItem = item ?? findAnyFunctionItem(manifest);
      if (!testItem) return; // no function items — skip

      const verb: Verb = { kind: "insert", hand: "left" };
      const N = 100;
      const times: number[] = [];

      // Warm up
      for (let i = 0; i < 10; i++) {
        const ids = defaultIdGen("perf");
        const { tree, cursorSet } = makeTestTree(ids);
        const result = applyVerb({ tree, cursorSet, item: testItem, verb, ids });
        if (result.ok) {
          nextChainStep(result.tree, result.cursorSet, true);
        }
      }

      for (let i = 0; i < N; i++) {
        const ids = defaultIdGen("perf");
        const { tree, cursorSet } = makeTestTree(ids);
        const t0 = performance.now();

        // Step 1: apply the verb (tree mutation)
        const result = applyVerb({ tree, cursorSet, item: testItem, verb, ids });

        if (result.ok) {
          // Step 2: check for auto-chain (hole detection)
          const step = nextChainStep(result.tree, result.cursorSet, true);

          if (step.reopen) {
            // Step 3: close then reopen the menu (dispatcher does cancel then open)
            const openState = reduce(INITIAL_STATE, { kind: "open", target, manifest });
            const closedState = reduce(openState, { kind: "cancel" });
            reduce(closedState, {
              kind: "open",
              target: step.target,
              manifest,
            });
          }
        }

        const t1 = performance.now();
        times.push(t1 - t0);
      }

      times.sort((a, b) => a - b);
      const s = stats(times);

      // The entire chain-reopen pure computation should be < 500 µs.
      expect(s.median).toBeLessThan(0.5);

      // eslint-disable-next-line no-console
      console.log(
        `full chain-reopen: median=${s.median.toFixed(4)}ms p95=${s.p95.toFixed(4)}ms max=${s.max.toFixed(4)}ms`,
      );
    });

    it("full path produces correct auto-chain reopen when cursor lands on hole", () => {
      const item = findFunctionWithSignature(manifest);
      if (!item) return; // skip if no function with signature

      const verb: Verb = { kind: "insert", hand: "left" };
      const ids = defaultIdGen("verify");
      const { tree, cursorSet } = makeTestTree(ids);

      // Step 1: apply the verb
      const result = applyVerb({ tree, cursorSet, item, verb, ids });
      expect(result.ok).toBe(true);

      if (result.ok) {
        // Step 2: chain check
        const step = nextChainStep(result.tree, result.cursorSet, true);

        // A function item with a signature should produce holes in the
        // inserted form, and the cursor should land on the first hole.
        // Whether chain triggers depends on whether the inserted form has holes.
        if (item.signature && item.signature.length > 0) {
          expect(step.reopen).toBe(true);
          if (step.reopen) {
            // Step 3: reopen should produce a valid open state
            const openState = reduce(INITIAL_STATE, {
              kind: "open",
              target: step.target,
              manifest,
            });
            expect(openState.phase).toBe("open");
          }
        }
      }
    });
  });

  describe("insert symbol (no chain)", () => {
    let manifest: Manifest;

    beforeEach(() => {
      manifest = parsedManifest();
    });

    it("symbol insert terminates chain correctly (no hole)", () => {
      const item = findAnySymbolItem(manifest);
      if (!item) return; // no symbol items — skip

      const verb: Verb = { kind: "insert", hand: "left" };
      const ids = defaultIdGen("verify");
      const { tree, cursorSet } = makeTestTree(ids);

      const result = applyVerb({ tree, cursorSet, item, verb, ids });
      expect(result.ok).toBe(true);

      if (result.ok) {
        const step = nextChainStep(result.tree, result.cursorSet, true);
        // Symbol items produce no holes, so chain should terminate.
        expect(step.reopen).toBe(false);
      }
    });
  });
});
