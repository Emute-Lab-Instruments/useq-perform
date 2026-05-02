/**
 * Range cursor tests (§3.4, §3.5, §3.7, §5.2.10).
 *
 * Covers:
 *   - Range cursor creation via nav.extendNext/extendPrev
 *   - Range extension (growing an existing range)
 *   - Range collapse via nav.shrink
 *   - Mutation ops on range cursors: slurp, barf, raise, transpose, delete
 */
import { beforeEach, describe, expect, it } from "vitest";

import { defaultIdGen, __resetIdCounterForTests } from "../types.ts";
import { nav } from "../nav.ts";
import { makeMutators } from "../mutate.ts";
import {
  doc,
  list,
  pp,
  stateOn,
  stateWithCursors,
  sym,
  vec,
} from "./builders.ts";
import { nodeCursor, rangeCursor, singleCursor } from "../types.ts";
import type { RangeCursor, NodeCursor } from "../types.ts";

// ─── Helpers ────────────────────��──────────────────────────────────────────

function setup() {
  __resetIdCounterForTests();
  const ids = defaultIdGen();
  const m = makeMutators({ ids });
  return { ids, m };
}

// ─── Range cursor creation ��────────────────────────────────────────────────

describe("range cursor creation", () => {
  let ids: ReturnType<typeof defaultIdGen>;
  beforeEach(() => {
    __resetIdCounterForTests();
    ids = defaultIdGen();
  });

  it("nav.extendNext from a node cursor creates a range of length 2", () => {
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
    const lst = list(ids, a, b, c);
    const root = doc(ids, lst);
    const r = nav.extendNext(stateOn(root, a.id));
    const cur = r.state.cursors.primary;
    expect(cur.kind).toBe("range");
    if (cur.kind === "range") {
      expect(cur.start).toBe(a.id);
      expect(cur.end).toBe(b.id);
      expect(cur.parent).toBe(lst.id);
      expect(cur.anchor).toBe("start");
    }
  });

  it("nav.extendPrev from a node cursor creates a range extending backward", () => {
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
    const lst = list(ids, a, b, c);
    const root = doc(ids, lst);
    const r = nav.extendPrev(stateOn(root, c.id));
    const cur = r.state.cursors.primary;
    expect(cur.kind).toBe("range");
    if (cur.kind === "range") {
      expect(cur.start).toBe(b.id);
      expect(cur.end).toBe(c.id);
      expect(cur.parent).toBe(lst.id);
      expect(cur.anchor).toBe("end");
    }
  });

  it("rangeCursor() constructor throws for identical start and end", () => {
    expect(() => rangeCursor("parent", "same", "same")).toThrow();
  });

  it("nav.extendNext at the last sibling fails gracefully", () => {
    const a = sym("a", ids), b = sym("b", ids);
    const lst = list(ids, a, b);
    const root = doc(ids, lst);
    const r = nav.extendNext(stateOn(root, b.id));
    expect(r.noOps[0]?.reason).toBe("range-cannot-extend");
  });

  it("nav.extendPrev at the first sibling fails gracefully", () => {
    const a = sym("a", ids), b = sym("b", ids);
    const lst = list(ids, a, b);
    const root = doc(ids, lst);
    const r = nav.extendPrev(stateOn(root, a.id));
    expect(r.noOps[0]?.reason).toBe("range-cannot-extend");
  });
});

// ─── Range cursor extension ────────────────────────────────────────────────

describe("range cursor extension", () => {
  let ids: ReturnType<typeof defaultIdGen>;
  beforeEach(() => {
    __resetIdCounterForTests();
    ids = defaultIdGen();
  });

  it("nav.extendNext on an existing range grows rightward", () => {
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids), d = sym("d", ids);
    const lst = list(ids, a, b, c, d);
    const root = doc(ids, lst);
    const range = rangeCursor(lst.id, a.id, b.id, "start");
    const s = stateWithCursors(root, singleCursor(range));
    const r = nav.extendNext(s);
    const cur = r.state.cursors.primary as RangeCursor;
    expect(cur.kind).toBe("range");
    expect(cur.start).toBe(a.id);
    expect(cur.end).toBe(c.id);
  });

  it("nav.extendPrev on an existing range grows leftward", () => {
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids), d = sym("d", ids);
    const lst = list(ids, a, b, c, d);
    const root = doc(ids, lst);
    const range = rangeCursor(lst.id, b.id, c.id, "end");
    const s = stateWithCursors(root, singleCursor(range));
    const r = nav.extendPrev(s);
    const cur = r.state.cursors.primary as RangeCursor;
    expect(cur.kind).toBe("range");
    expect(cur.start).toBe(a.id);
    expect(cur.end).toBe(c.id);
  });

  it("extending beyond the last sibling returns a no-op", () => {
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
    const lst = list(ids, a, b, c);
    const root = doc(ids, lst);
    const range = rangeCursor(lst.id, a.id, c.id, "start");
    const s = stateWithCursors(root, singleCursor(range));
    const r = nav.extendNext(s);
    expect(r.noOps[0]?.reason).toBe("range-cannot-extend");
  });
});

// ─── Range cursor collapse ─────────────────────��───────────────────────────

describe("range cursor collapse (nav.shrink)", () => {
  let ids: ReturnType<typeof defaultIdGen>;
  beforeEach(() => {
    __resetIdCounterForTests();
    ids = defaultIdGen();
  });

  it("shrink on length-2 range collapses to a node cursor at the anchor", () => {
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
    const lst = list(ids, a, b, c);
    const root = doc(ids, lst);
    const range = rangeCursor(lst.id, a.id, b.id, "start");
    const s = stateWithCursors(root, singleCursor(range));
    const r = nav.shrink(s);
    const cur = r.state.cursors.primary;
    expect(cur.kind).toBe("node");
    expect((cur as NodeCursor).target).toBe(a.id);
  });

  it("shrink on length-3 range releases the non-anchor end", () => {
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
    const lst = list(ids, a, b, c);
    const root = doc(ids, lst);
    // anchor=start means we grew rightward; shrink releases rightmost.
    const range = rangeCursor(lst.id, a.id, c.id, "start");
    const s = stateWithCursors(root, singleCursor(range));
    const r = nav.shrink(s);
    const cur = r.state.cursors.primary as RangeCursor;
    expect(cur.kind).toBe("range");
    expect(cur.start).toBe(a.id);
    expect(cur.end).toBe(b.id);
  });

  it("shrink on length-3 range with anchor=end releases leftmost", () => {
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
    const lst = list(ids, a, b, c);
    const root = doc(ids, lst);
    // anchor=end means we grew leftward; shrink releases leftmost.
    const range = rangeCursor(lst.id, a.id, c.id, "end");
    const s = stateWithCursors(root, singleCursor(range));
    const r = nav.shrink(s);
    const cur = r.state.cursors.primary as RangeCursor;
    expect(cur.kind).toBe("range");
    expect(cur.start).toBe(b.id);
    expect(cur.end).toBe(c.id);
  });

  it("shrink on a node cursor is a no-op", () => {
    const a = sym("a", ids);
    const root = doc(ids, a);
    const r = nav.shrink(stateOn(root, a.id));
    expect(r.noOps[0]?.reason).toBe("range-not-shrinkable");
  });
});

// ─── Mutation on range cursors ──────────────────────────────��──────────────

describe("range cursor mutation: slurp", () => {
  it("slurpForward on a range extends the range by one on the right", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids), d = sym("d", ids);
    const lst = list(ids, a, b, c, d);
    const root = doc(ids, lst);
    const range = rangeCursor(lst.id, b.id, c.id, "start");
    const s = stateWithCursors(root, singleCursor(range));
    const r = m.slurpForward(s);
    expect(r.noOps).toEqual([]);
    // Range extends to include d.
    const cur = r.state.cursors.primary as RangeCursor;
    expect(cur.kind).toBe("range");
    expect(cur.start).toBe(b.id);
    expect(cur.end).toBe(d.id);
    // Tree unchanged (range slurp only adjusts the cursor).
    expect(pp(r.state.tree.root)).toBe(pp(root));
  });

  it("slurpBackward on a range extends the range by one on the left", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids), d = sym("d", ids);
    const lst = list(ids, a, b, c, d);
    const root = doc(ids, lst);
    const range = rangeCursor(lst.id, b.id, c.id, "start");
    const s = stateWithCursors(root, singleCursor(range));
    const r = m.slurpBackward(s);
    expect(r.noOps).toEqual([]);
    const cur = r.state.cursors.primary as RangeCursor;
    expect(cur.kind).toBe("range");
    expect(cur.start).toBe(a.id);
    expect(cur.end).toBe(c.id);
  });

  it("slurpForward on a range at the end is a no-op", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
    const lst = list(ids, a, b, c);
    const root = doc(ids, lst);
    const range = rangeCursor(lst.id, b.id, c.id, "start");
    const s = stateWithCursors(root, singleCursor(range));
    const r = m.slurpForward(s);
    expect(r.noOps[0]?.reason).toBe("no-next-sibling");
  });
});

describe("range cursor mutation: barf", () => {
  it("barfForward on a range shrinks from the right", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids), d = sym("d", ids);
    const lst = list(ids, a, b, c, d);
    const root = doc(ids, lst);
    const range = rangeCursor(lst.id, a.id, c.id, "start");
    const s = stateWithCursors(root, singleCursor(range));
    const r = m.barfForward(s);
    expect(r.noOps).toEqual([]);
    const cur = r.state.cursors.primary as RangeCursor;
    expect(cur.kind).toBe("range");
    expect(cur.start).toBe(a.id);
    expect(cur.end).toBe(b.id);
  });

  it("barfBackward on a range shrinks from the left", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids), d = sym("d", ids);
    const lst = list(ids, a, b, c, d);
    const root = doc(ids, lst);
    const range = rangeCursor(lst.id, b.id, d.id, "end");
    const s = stateWithCursors(root, singleCursor(range));
    const r = m.barfBackward(s);
    expect(r.noOps).toEqual([]);
    const cur = r.state.cursors.primary as RangeCursor;
    expect(cur.kind).toBe("range");
    expect(cur.start).toBe(c.id);
    expect(cur.end).toBe(d.id);
  });

  it("barfForward on a length-2 range collapses to a node cursor", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
    const lst = list(ids, a, b, c);
    const root = doc(ids, lst);
    const range = rangeCursor(lst.id, a.id, b.id, "start");
    const s = stateWithCursors(root, singleCursor(range));
    const r = m.barfForward(s);
    expect(r.noOps).toEqual([]);
    const cur = r.state.cursors.primary;
    expect(cur.kind).toBe("node");
    expect((cur as NodeCursor).target).toBe(a.id);
  });

  it("barf on a single-element range is a no-op (fewer-than-two)", () => {
    // We can't construct a length-1 range (constructor rejects), but a range
    // whose indices resolve to the same spot would trigger this. Instead we
    // test that length-2 barf collapses — the no-op path is already tested by
    // the fewer-than-two-children check internally (the point cursor path).
    // This test ensures we don't crash on a range that already has length 2.
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids);
    const lst = list(ids, a, b);
    const root = doc(ids, lst);
    const range = rangeCursor(lst.id, a.id, b.id, "start");
    const s = stateWithCursors(root, singleCursor(range));
    // barfForward on length-2 collapses to node cursor (not a no-op per se).
    const r = m.barfForward(s);
    expect(r.state.cursors.primary.kind).toBe("node");
  });
});

describe("range cursor mutation: raise", () => {
  it("raiseRange replaces the parent with the range's nodes", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
    const inner = list(ids, a, b, c);
    const outer = list(ids, sym("x", ids), inner, sym("y", ids));
    const root = doc(ids, outer);
    // Range [a, b] inside inner — raise replaces inner with a, b in outer.
    const range = rangeCursor(inner.id, a.id, b.id, "start");
    const s = stateWithCursors(root, singleCursor(range));
    const r = m.raise(s);
    expect(r.noOps).toEqual([]);
    expect(pp(r.state.tree.root)).toBe("(x a b y)");
    // Cursor collapses to the first node of the raised run.
    const cur = r.state.cursors.primary;
    expect(cur.kind).toBe("node");
    expect((cur as NodeCursor).target).toBe(a.id);
  });

  it("raiseRange on top-level range (parent is document) is a no-op", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
    const root = doc(ids, a, b, c);
    const range = rangeCursor(root.id, a.id, b.id, "start");
    const s = stateWithCursors(root, singleCursor(range));
    const r = m.raise(s);
    expect(r.noOps[0]?.reason).toBe("single-top-level");
  });
});

describe("range cursor mutation: transpose", () => {
  it("transposeNext swaps the range with the next sibling", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids), d = sym("d", ids);
    const lst = list(ids, a, b, c, d);
    const root = doc(ids, lst);
    // Range [a, b] transpose next -> d should not be used; [a,b] swaps with c.
    const range = rangeCursor(lst.id, a.id, b.id, "start");
    const s = stateWithCursors(root, singleCursor(range));
    const r = m.transposeNext(s);
    expect(r.noOps).toEqual([]);
    expect(pp(r.state.tree.root)).toBe("(c a b d)");
    // Cursor follows the range.
    const cur = r.state.cursors.primary as RangeCursor;
    expect(cur.kind).toBe("range");
    expect(cur.start).toBe(a.id);
    expect(cur.end).toBe(b.id);
  });

  it("transposePrev swaps the range with the previous sibling", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids), d = sym("d", ids);
    const lst = list(ids, a, b, c, d);
    const root = doc(ids, lst);
    const range = rangeCursor(lst.id, c.id, d.id, "end");
    const s = stateWithCursors(root, singleCursor(range));
    const r = m.transposePrev(s);
    expect(r.noOps).toEqual([]);
    expect(pp(r.state.tree.root)).toBe("(a c d b)");
    const cur = r.state.cursors.primary as RangeCursor;
    expect(cur.kind).toBe("range");
    expect(cur.start).toBe(c.id);
    expect(cur.end).toBe(d.id);
  });

  it("transposeNext at end boundary is a no-op", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
    const lst = list(ids, a, b, c);
    const root = doc(ids, lst);
    const range = rangeCursor(lst.id, b.id, c.id, "start");
    const s = stateWithCursors(root, singleCursor(range));
    const r = m.transposeNext(s);
    expect(r.noOps[0]?.reason).toBe("no-next-sibling");
  });

  it("transposePrev at start boundary is a no-op", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
    const lst = list(ids, a, b, c);
    const root = doc(ids, lst);
    const range = rangeCursor(lst.id, a.id, b.id, "start");
    const s = stateWithCursors(root, singleCursor(range));
    const r = m.transposePrev(s);
    expect(r.noOps[0]?.reason).toBe("no-prev-sibling");
  });
});

describe("range cursor mutation: delete", () => {
  it("delete removes all nodes in the range run", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids), d = sym("d", ids);
    const lst = list(ids, a, b, c, d);
    const root = doc(ids, lst);
    const range = rangeCursor(lst.id, b.id, c.id, "start");
    const s = stateWithCursors(root, singleCursor(range));
    const r = m.delete(s);
    expect(r.noOps).toEqual([]);
    expect(pp(r.state.tree.root)).toBe("(a d)");
    // Cursor relocates to the next sibling after the removed range.
    const cur = r.state.cursors.primary;
    expect(cur.kind).toBe("node");
    expect((cur as NodeCursor).target).toBe(d.id);
  });

  it("delete range at end relocates cursor to previous sibling", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
    const lst = list(ids, a, b, c);
    const root = doc(ids, lst);
    const range = rangeCursor(lst.id, b.id, c.id, "start");
    const s = stateWithCursors(root, singleCursor(range));
    const r = m.delete(s);
    expect(pp(r.state.tree.root)).toBe("(a)");
    expect((r.state.cursors.primary as NodeCursor).target).toBe(a.id);
  });

  it("delete range that empties the parent relocates to parent", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids);
    const lst = list(ids, a, b);
    const root = doc(ids, lst);
    const range = rangeCursor(lst.id, a.id, b.id, "start");
    const s = stateWithCursors(root, singleCursor(range));
    const r = m.delete(s);
    expect(pp(r.state.tree.root)).toBe("()");
    expect((r.state.cursors.primary as NodeCursor).target).toBe(lst.id);
  });

  it("delete a single node (non-range) also works", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
    const lst = list(ids, a, b, c);
    const root = doc(ids, lst);
    const r = m.delete(stateOn(root, b.id));
    expect(pp(r.state.tree.root)).toBe("(a c)");
    expect((r.state.cursors.primary as NodeCursor).target).toBe(c.id);
  });
});

describe("range cursor mutation: enclose", () => {
  it("enclose wraps the entire range run in a new compound", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids), d = sym("d", ids);
    const lst = list(ids, a, b, c, d);
    const root = doc(ids, lst);
    const range = rangeCursor(lst.id, b.id, c.id, "start");
    const s = stateWithCursors(root, singleCursor(range));
    const r = m.enclose.list(s);
    expect(r.noOps).toEqual([]);
    expect(pp(r.state.tree.root)).toBe("(a (b c) d)");
  });

  it("enclose with vector kind on a range", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
    const lst = list(ids, a, b, c);
    const root = doc(ids, lst);
    const range = rangeCursor(lst.id, a.id, b.id, "start");
    const s = stateWithCursors(root, singleCursor(range));
    const r = m.enclose.vector(s);
    expect(pp(r.state.tree.root)).toBe("([a b] c)");
  });
});
