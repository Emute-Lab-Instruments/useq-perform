/**
 * Navigation algebra tests (§5.1).
 */
import { beforeEach, describe, expect, it } from "vitest";

import { defaultIdGen, __resetIdCounterForTests } from "../types.ts";
import { nav } from "../nav.ts";
import {
  doc,
  hole,
  list,
  num,
  stateOn,
  stateWithCursors,
  sym,
  vec,
} from "./builders.ts";
import { nodeCursor, rangeCursor, singleCursor } from "../types.ts";

describe("nav", () => {
  let ids: ReturnType<typeof defaultIdGen>;
  beforeEach(() => {
    __resetIdCounterForTests();
    ids = defaultIdGen();
  });

  // ─── nav.up / nav.down ──────────────────────────────────────────────────

  it("nav.up moves cursor to parent compound", () => {
    // (foo bar)  cursor on bar -> cursor on the list
    const foo = sym("foo", ids);
    const bar = sym("bar", ids);
    const lst = list(ids, foo, bar);
    const root = doc(ids, lst);
    const r = nav.up(stateOn(root, bar.id));
    expect(r.state.cursors.primary).toEqual(nodeCursor(lst.id));
    expect(r.noOps).toEqual([]);
    // Tree unchanged.
    expect(r.state.tree.root).toBe(root);
  });

  it("nav.up at top-level form moves to document root", () => {
    const a = sym("a", ids);
    const root = doc(ids, a);
    const r = nav.up(stateOn(root, a.id));
    expect(r.state.cursors.primary).toEqual(nodeCursor(root.id));
  });

  it("nav.up at document root is a no-op flash", () => {
    const a = sym("a", ids);
    const root = doc(ids, a);
    const r = nav.up(stateOn(root, root.id));
    expect(r.noOps).toEqual([{ cursor: nodeCursor(root.id), reason: "at-document-root" }]);
    expect(r.state.cursors.primary).toEqual(nodeCursor(root.id));
  });

  it("nav.down on a compound goes to first child", () => {
    const a = sym("a", ids);
    const b = sym("b", ids);
    const lst = list(ids, a, b);
    const root = doc(ids, lst);
    const r = nav.down(stateOn(root, lst.id));
    expect(r.state.cursors.primary).toEqual(nodeCursor(a.id));
  });

  it("nav.down on a leaf is a no-op (on-leaf)", () => {
    const a = sym("a", ids);
    const root = doc(ids, a);
    const r = nav.down(stateOn(root, a.id));
    expect(r.noOps[0]?.reason).toBe("on-leaf");
  });

  it("nav.down on an empty compound is a no-op (empty-compound)", () => {
    const empty = list(ids);
    const root = doc(ids, empty);
    const r = nav.down(stateOn(root, empty.id));
    expect(r.noOps[0]?.reason).toBe("empty-compound");
  });

  // ─── nav.next / nav.prev ────────────────────────────────────────────────

  it("nav.next moves to next sibling under the same parent", () => {
    const a = sym("a", ids);
    const b = sym("b", ids);
    const c = sym("c", ids);
    const lst = list(ids, a, b, c);
    const root = doc(ids, lst);
    const r = nav.next(stateOn(root, b.id));
    expect(r.state.cursors.primary).toEqual(nodeCursor(c.id));
  });

  it("nav.next at last sibling is a no-op", () => {
    const a = sym("a", ids);
    const b = sym("b", ids);
    const lst = list(ids, a, b);
    const root = doc(ids, lst);
    const r = nav.next(stateOn(root, b.id));
    expect(r.noOps[0]?.reason).toBe("no-next-sibling");
  });

  it("nav.prev at first sibling is a no-op", () => {
    const a = sym("a", ids);
    const b = sym("b", ids);
    const lst = list(ids, a, b);
    const root = doc(ids, lst);
    const r = nav.prev(stateOn(root, a.id));
    expect(r.noOps[0]?.reason).toBe("no-prev-sibling");
  });

  // ─── nav.first / nav.last ───────────────────────────────────────────────

  it("nav.first jumps to first sibling", () => {
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
    const lst = list(ids, a, b, c);
    const root = doc(ids, lst);
    const r = nav.first(stateOn(root, c.id));
    expect(r.state.cursors.primary).toEqual(nodeCursor(a.id));
  });

  it("nav.last jumps to last sibling", () => {
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
    const lst = list(ids, a, b, c);
    const root = doc(ids, lst);
    const r = nav.last(stateOn(root, a.id));
    expect(r.state.cursors.primary).toEqual(nodeCursor(c.id));
  });

  // ─── nav.extendNext / nav.extendPrev / nav.shrink ──────────────────────

  it("nav.extendNext converts node cursor to range cursor of length 2", () => {
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

  it("nav.extendNext on a range grows further", () => {
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
    const lst = list(ids, a, b, c);
    const root = doc(ids, lst);
    const range = rangeCursor(lst.id, a.id, b.id, "start");
    const s = stateWithCursors(root, singleCursor(range));
    const r = nav.extendNext(s);
    const cur = r.state.cursors.primary;
    expect(cur.kind).toBe("range");
    if (cur.kind === "range") {
      expect(cur.end).toBe(c.id);
      expect(cur.start).toBe(a.id);
    }
  });

  it("nav.extendNext at last sibling fails", () => {
    const a = sym("a", ids), b = sym("b", ids);
    const lst = list(ids, a, b);
    const root = doc(ids, lst);
    const r = nav.extendNext(stateOn(root, b.id));
    expect(r.noOps[0]?.reason).toBe("range-cannot-extend");
  });

  it("nav.shrink on a length-2 range collapses to a node cursor", () => {
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
    const lst = list(ids, a, b, c);
    const root = doc(ids, lst);
    const range = rangeCursor(lst.id, a.id, b.id, "start");
    const s = stateWithCursors(root, singleCursor(range));
    const r = nav.shrink(s);
    expect(r.state.cursors.primary.kind).toBe("node");
    if (r.state.cursors.primary.kind === "node") {
      expect(r.state.cursors.primary.target).toBe(a.id);
    }
  });

  it("nav.shrink on a length-3 range stays a range, end retreats", () => {
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
    const lst = list(ids, a, b, c);
    const root = doc(ids, lst);
    const range = rangeCursor(lst.id, a.id, c.id, "start");
    const s = stateWithCursors(root, singleCursor(range));
    const r = nav.shrink(s);
    expect(r.state.cursors.primary.kind).toBe("range");
    if (r.state.cursors.primary.kind === "range") {
      expect(r.state.cursors.primary.start).toBe(a.id);
      expect(r.state.cursors.primary.end).toBe(b.id);
    }
  });

  it("nav.shrink on a node cursor is a no-op", () => {
    const a = sym("a", ids);
    const root = doc(ids, a);
    const r = nav.shrink(stateOn(root, a.id));
    expect(r.noOps[0]?.reason).toBe("range-not-shrinkable");
  });

  // ─── nav.nextHole / nav.prevHole ───────────────────────────────────────

  it("nav.nextHole finds the next hole in document order", () => {
    const h1 = hole("freq", "number", ids);
    const h2 = hole("amp", "number", ids);
    const lst = list(ids, sym("synth", ids), h1, h2);
    const root = doc(ids, lst);
    // From the list itself, next hole is h1.
    const r1 = nav.nextHole(stateOn(root, lst.id));
    expect((r1.state.cursors.primary as { target: string }).target).toBe(h1.id);
    // From h1, next hole is h2.
    const r2 = nav.nextHole(stateOn(root, h1.id));
    expect((r2.state.cursors.primary as { target: string }).target).toBe(h2.id);
  });

  it("nav.prevHole walks backwards", () => {
    const h1 = hole("a", "number", ids);
    const h2 = hole("b", "number", ids);
    const root = doc(ids, vec(ids, h1, h2));
    const r = nav.prevHole(stateOn(root, h2.id));
    expect((r.state.cursors.primary as { target: string }).target).toBe(h1.id);
  });

  it("nav.nextHole returns no-hole when none exist", () => {
    const root = doc(ids, sym("foo", ids));
    const r = nav.nextHole(stateOn(root, root.id));
    expect(r.noOps[0]?.reason).toBe("no-hole");
  });

  // ─── pointwise application across cursor set ───────────────────────────

  it("nav applies pointwise to all cursors", () => {
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
    const lst = list(ids, a, b, c);
    const root = doc(ids, lst);
    const cs = {
      primary: nodeCursor(a.id),
      secondaries: [nodeCursor(b.id)],
    };
    const r = nav.next({ tree: { root }, cursors: cs });
    expect((r.state.cursors.primary as { target: string }).target).toBe(b.id);
    expect((r.state.cursors.secondaries[0] as { target: string }).target).toBe(c.id);
    // Last-sibling cursor (b -> c, c -> noop) tested separately.
  });

  it("nav records noOps per-cursor without dropping cursors", () => {
    const a = sym("a", ids), b = sym("b", ids);
    const lst = list(ids, a, b);
    const root = doc(ids, lst);
    const cs = {
      primary: nodeCursor(a.id),
      secondaries: [nodeCursor(b.id)],
    };
    const r = nav.next({ tree: { root }, cursors: cs });
    // a -> b succeeds, b -> noop.
    expect(r.noOps).toHaveLength(1);
    expect(r.noOps[0]?.reason).toBe("no-next-sibling");
    expect(r.state.cursors.primary).toEqual(nodeCursor(b.id));
    expect(r.state.cursors.secondaries[0]).toEqual(nodeCursor(b.id));
  });

  it("nav never mutates the tree", () => {
    const a = sym("a", ids);
    const lst = list(ids, a, num("1", ids));
    const root = doc(ids, lst);
    const before = { tree: { root }, cursors: { primary: nodeCursor(a.id), secondaries: [] } };
    const r = nav.next(before);
    expect(r.state.tree.root).toBe(root);
  });
});
