// src/lib/menu/chain.test.ts
//
// Comprehensive coverage for the auto-chain runner in `chain.ts`.
// Tests build minimal Tree fixtures by hand using the structural-editing
// builder helpers and assert ChainStep results (never serialised text).
//
// Matrix: each scenario from the bead description plus edge cases.
//
// Bead: useq-perform-4zt.69.27.
//
// References:
//   - docs/specs/radial-menu.md §8 (auto-chain semantics)
//   - docs/specs/radial-menu.md §8.2 (hole-scope routing)
//   - src/lib/menu/chain.ts (the module under test)

import { describe, it, expect, beforeEach } from "vitest";

import { nextChainStep, type ChainStep, type HoleScope } from "./chain";
import {
  __resetIdCounterForTests,
  defaultIdGen,
  nodeCursor,
  singleCursor,
  type CursorSet,
  type DocumentNode,
  type HoleNode,
  type IdGen,
  type Tree,
} from "../../editors/extensions/structure/core/types";
import {
  doc,
  hole,
  list,
  num,
  sym,
} from "../../editors/extensions/structure/core/__tests__/builders";

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

let ids: IdGen;

beforeEach(() => {
  __resetIdCounterForTests();
  ids = defaultIdGen();
});

/** Build a `CursorSet` whose primary is a node cursor on `id`. */
function cursorOn(id: string): CursorSet {
  return singleCursor(nodeCursor(id));
}

/** Wrap a `DocumentNode` as a `Tree`. */
function asTree(root: DocumentNode): Tree {
  return { root };
}

// ---------------------------------------------------------------------------
// 1. After commit lands on first hole of a 3-hole template → reopen
// ---------------------------------------------------------------------------

describe("chain: first hole of multi-hole template", () => {
  it("reopens with the first hole's scope when cursor lands on hole 1 of 3", () => {
    // Build tree: (slow ($ rate :number) ($ dur :symbol) ($ body :expr))
    const h1 = hole("rate", "number", ids);
    const h2 = hole("dur", "symbol", ids);
    const h3 = hole("body", "expr", ids);
    const head = sym("slow", ids);
    const form = list(ids, head, h1, h2, h3);
    const root = doc(ids, form);

    const step = nextChainStep(asTree(root), cursorOn(h1.id), true);

    expect(step.reopen).toBe(true);
    if (!step.reopen) return;
    expect(step.scope.kind).toBe("typed");
    if (step.scope.kind === "typed") {
      expect(step.scope.holeType).toBe("number");
    }
    expect(step.hole.id).toBe(h1.id);
    expect(step.hole.name).toBe("rate");
  });
});

// ---------------------------------------------------------------------------
// 2. Chain advances through subsequent holes
// ---------------------------------------------------------------------------

describe("chain: advancing through holes", () => {
  it("after filling hole 1, cursor on hole 2 → chain detects hole 2", () => {
    const h1 = hole("rate", "number", ids);
    const h2 = hole("dur", "symbol", ids);
    const h3 = hole("body", "expr", ids);
    const head = sym("slow", ids);
    // Simulate: hole 1 filled with a number, cursor now on hole 2
    const filled1 = num("440", ids);
    const form = list(ids, head, filled1, h2, h3);
    const root = doc(ids, form);

    const step = nextChainStep(asTree(root), cursorOn(h2.id), true);

    expect(step.reopen).toBe(true);
    if (!step.reopen) return;
    expect(step.scope.kind).toBe("typed");
    if (step.scope.kind === "typed") {
      expect(step.scope.holeType).toBe("symbol");
    }
    expect(step.hole.id).toBe(h2.id);
  });

  it("after filling hole 2, cursor on hole 3 → chain detects hole 3", () => {
    const h3 = hole("body", "expr", ids);
    const head = sym("slow", ids);
    const filled1 = num("440", ids);
    const filled2 = sym("kick", ids);
    const form = list(ids, head, filled1, filled2, h3);
    const root = doc(ids, form);

    const step = nextChainStep(asTree(root), cursorOn(h3.id), true);

    expect(step.reopen).toBe(true);
    if (!step.reopen) return;
    expect(step.scope.kind).toBe("typed");
    if (step.scope.kind === "typed") {
      expect(step.scope.holeType).toBe("expr");
    }
    expect(step.hole.id).toBe(h3.id);
  });
});

// ---------------------------------------------------------------------------
// 3. Cancel / manual cursor move → chain ends
// ---------------------------------------------------------------------------

describe("chain: cancel and manual cursor move", () => {
  it("verbCausedMutation=false → reopen false, reason manual-cursor-move", () => {
    const h = hole("x", "number", ids);
    const head = sym("foo", ids);
    const form = list(ids, head, h);
    const root = doc(ids, form);

    // User manually navigated onto a hole — chain must NOT auto-open (§8.2.2)
    const step = nextChainStep(asTree(root), cursorOn(h.id), false);

    expect(step).toEqual({ reopen: false, reason: "manual-cursor-move" });
  });

  it("verbCausedMutation=false on a non-hole node → also manual-cursor-move", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));

    const step = nextChainStep(asTree(root), cursorOn(foo.id), false);

    expect(step).toEqual({ reopen: false, reason: "manual-cursor-move" });
  });
});

// ---------------------------------------------------------------------------
// 4. Typed-hole scope routing
// ---------------------------------------------------------------------------

describe("chain: typed-hole scope routing (§8.2.1)", () => {
  it("hole with holeType='number' → typed scope with holeType number", () => {
    const h = hole("freq", "number", ids);
    const root = doc(ids, list(ids, sym("osc", ids), h));

    const step = nextChainStep(asTree(root), cursorOn(h.id), true);

    expect(step.reopen).toBe(true);
    if (!step.reopen) return;
    expect(step.scope).toEqual({ kind: "typed", holeType: "number" });
  });

  it("hole with holeType='symbol' → typed scope with holeType symbol", () => {
    const h = hole("name", "symbol", ids);
    const root = doc(ids, list(ids, sym("def", ids), h));

    const step = nextChainStep(asTree(root), cursorOn(h.id), true);

    expect(step.reopen).toBe(true);
    if (!step.reopen) return;
    expect(step.scope).toEqual({ kind: "typed", holeType: "symbol" });
  });

  it("hole with holeType='keyword' → typed scope with holeType keyword", () => {
    const h = hole("prop", "keyword", ids);
    const root = doc(ids, list(ids, sym("get", ids), h));

    const step = nextChainStep(asTree(root), cursorOn(h.id), true);

    expect(step.reopen).toBe(true);
    if (!step.reopen) return;
    expect(step.scope).toEqual({ kind: "typed", holeType: "keyword" });
  });

  it("hole with holeType='expr' → typed scope with holeType expr", () => {
    const h = hole("body", "expr", ids);
    const root = doc(ids, list(ids, sym("when", ids), h));

    const step = nextChainStep(asTree(root), cursorOn(h.id), true);

    expect(step.reopen).toBe(true);
    if (!step.reopen) return;
    expect(step.scope).toEqual({ kind: "typed", holeType: "expr" });
  });

  it("hole with holeType='string' → typed scope with holeType string", () => {
    const h = hole("label", "string", ids);
    const root = doc(ids, list(ids, sym("print", ids), h));

    const step = nextChainStep(asTree(root), cursorOn(h.id), true);

    expect(step.reopen).toBe(true);
    if (!step.reopen) return;
    expect(step.scope).toEqual({ kind: "typed", holeType: "string" });
  });
});

// ---------------------------------------------------------------------------
// 5. Hole inside a wrapper (WrapWith) → chain detects it
// ---------------------------------------------------------------------------

describe("chain: hole inside a wrapper", () => {
  it("detects a hole inside a wrapped node", () => {
    // Simulate: WrapWith produced (slow 440 ($ body :expr))
    // The user filled the rate hole (440) and the cursor landed on the body hole.
    const bodyHole = hole("body", "expr", ids);
    const rate = num("440", ids);
    const wrapper = list(ids, sym("slow", ids), rate, bodyHole);
    const root = doc(ids, wrapper);

    const step = nextChainStep(asTree(root), cursorOn(bodyHole.id), true);

    expect(step.reopen).toBe(true);
    if (!step.reopen) return;
    expect(step.hole.id).toBe(bodyHole.id);
    expect(step.scope.kind).toBe("typed");
    if (step.scope.kind === "typed") {
      expect(step.scope.holeType).toBe("expr");
    }
  });

  it("detects a hole nested inside a deeply wrapped structure", () => {
    // Simulate: (outer (slow ($ x :number)))
    const innerHole = hole("x", "number", ids);
    const inner = list(ids, sym("slow", ids), innerHole);
    const outer = list(ids, sym("outer", ids), inner);
    const root = doc(ids, outer);

    const step = nextChainStep(asTree(root), cursorOn(innerHole.id), true);

    expect(step.reopen).toBe(true);
    if (!step.reopen) return;
    expect(step.hole.id).toBe(innerHole.id);
    expect(step.scope).toEqual({ kind: "typed", holeType: "number" });
  });
});

// ---------------------------------------------------------------------------
// 6. No hole (cursor on atom) → chain ends
// ---------------------------------------------------------------------------

describe("chain: no hole at cursor", () => {
  it("cursor on a symbol atom → reopen false, reason cursor-not-on-hole", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));

    const step = nextChainStep(asTree(root), cursorOn(foo.id), true);

    expect(step).toEqual({ reopen: false, reason: "cursor-not-on-hole" });
  });

  it("cursor on a number atom → reopen false, reason cursor-not-on-hole", () => {
    const n = num("42", ids);
    const root = doc(ids, list(ids, n));

    const step = nextChainStep(asTree(root), cursorOn(n.id), true);

    expect(step).toEqual({ reopen: false, reason: "cursor-not-on-hole" });
  });

  it("cursor on a compound (list with no holes) → reopen false, reason cursor-not-on-hole", () => {
    const inner = list(ids, sym("a", ids), sym("b", ids));
    const root = doc(ids, inner);

    const step = nextChainStep(asTree(root), cursorOn(inner.id), true);

    expect(step).toEqual({ reopen: false, reason: "cursor-not-on-hole" });
  });
});

// ---------------------------------------------------------------------------
// 7. No primary cursor → chain ends
// ---------------------------------------------------------------------------

describe("chain: no primary cursor", () => {
  it("undefined primary cursor → reopen false, reason no-hole", () => {
    // CursorSet with undefined primary is technically invalid per the type,
    // but the chain runner should handle it gracefully.
    const h = hole("x", "number", ids);
    const root = doc(ids, list(ids, sym("foo", ids), h));
    const badCursorSet: CursorSet = {
      primary: undefined as unknown as import("../../editors/extensions/structure/core/types").Cursor,
      secondaries: [],
    };

    const step = nextChainStep(asTree(root), badCursorSet, true);

    expect(step).toEqual({ reopen: false, reason: "no-hole" });
  });
});

// ---------------------------------------------------------------------------
// Additional edge cases
// ---------------------------------------------------------------------------

describe("chain: edge cases", () => {
  it("target node id not found in tree → reopen false, reason cursor-not-on-hole", () => {
    const root = doc(ids, list(ids, sym("foo", ids)));
    // Cursor points to an id that doesn't exist in the tree
    const step = nextChainStep(asTree(root), cursorOn("nonexistent"), true);

    expect(step).toEqual({ reopen: false, reason: "cursor-not-on-hole" });
  });

  it("reopen=true returns a target (ApplyTarget) and the hole node", () => {
    const h = hole("freq", "number", ids);
    const root = doc(ids, list(ids, sym("osc", ids), h));

    const step = nextChainStep(asTree(root), cursorOn(h.id), true);

    expect(step.reopen).toBe(true);
    if (!step.reopen) return;
    // target exists (opaque ApplyTarget — just check it's defined)
    expect(step.target).toBeDefined();
    // hole is the actual HoleNode
    expect(step.hole.kind).toBe("hole");
    expect(step.hole.id).toBe(h.id);
    expect(step.hole.holeType).toBe("number");
    expect(step.hole.name).toBe("freq");
  });

  it("cursor on document root → reopen false, reason cursor-not-on-hole", () => {
    const root = doc(ids, sym("foo", ids));

    const step = nextChainStep(asTree(root), cursorOn(root.id), true);

    expect(step).toEqual({ reopen: false, reason: "cursor-not-on-hole" });
  });
});
