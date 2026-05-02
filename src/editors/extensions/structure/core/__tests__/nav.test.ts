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

  // ─── nav.out / nav.in ──────────────────────────────────────────────────

  it("nav.out moves cursor to parent compound", () => {
    // (foo bar)  cursor on bar -> cursor on the list
    const foo = sym("foo", ids);
    const bar = sym("bar", ids);
    const lst = list(ids, foo, bar);
    const root = doc(ids, lst);
    const r = nav.out(stateOn(root, bar.id));
    expect(r.state.cursors.primary).toEqual(nodeCursor(lst.id));
    expect(r.noOps).toEqual([]);
    // Tree unchanged.
    expect(r.state.tree.root).toBe(root);
  });

  it("nav.out at top-level form moves to document root", () => {
    const a = sym("a", ids);
    const root = doc(ids, a);
    const r = nav.out(stateOn(root, a.id));
    expect(r.state.cursors.primary).toEqual(nodeCursor(root.id));
  });

  it("nav.out at document root is a no-op flash", () => {
    const a = sym("a", ids);
    const root = doc(ids, a);
    const r = nav.out(stateOn(root, root.id));
    expect(r.noOps).toEqual([{ cursor: nodeCursor(root.id), reason: "at-document-root" }]);
    expect(r.state.cursors.primary).toEqual(nodeCursor(root.id));
  });

  it("nav.in on a compound goes to first child", () => {
    const a = sym("a", ids);
    const b = sym("b", ids);
    const lst = list(ids, a, b);
    const root = doc(ids, lst);
    const r = nav.in(stateOn(root, lst.id));
    expect(r.state.cursors.primary).toEqual(nodeCursor(a.id));
  });

  it("nav.in on a leaf is a no-op (on-leaf)", () => {
    const a = sym("a", ids);
    const root = doc(ids, a);
    const r = nav.in(stateOn(root, a.id));
    expect(r.noOps[0]?.reason).toBe("on-leaf");
  });

  it("nav.in on an empty compound is a no-op (empty-compound)", () => {
    const empty = list(ids);
    const root = doc(ids, empty);
    const r = nav.in(stateOn(root, empty.id));
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

  // ─── nav.right / nav.left (§5.1.9) ─────────────────────────────────────
  //
  // Euler-tour horizontal traversal. Each compound is visited twice (pre /
  // post); leaves once. Phase travels on `NodeCursor.phase`; non-spatial ops
  // emit cursors with no phase (treated as pre-order).

  describe("nav.right (§5.1.9)", () => {
    it("on a compound in pre-order moves to first child", () => {
      // (foo bar) → cursor on list, pre → cursor on foo
      const foo = sym("foo", ids), bar = sym("bar", ids);
      const lst = list(ids, foo, bar);
      const root = doc(ids, lst);
      const r = nav.right(stateOn(root, lst.id));
      expect(r.state.cursors.primary).toEqual(nodeCursor(foo.id));
      expect(r.noOps).toEqual([]);
      expect(r.state.tree.root).toBe(root);
    });

    it("on a non-last leaf child moves to next sibling (pre-order)", () => {
      // (a b c) cursor on b → c
      const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
      const lst = list(ids, a, b, c);
      const root = doc(ids, lst);
      const r = nav.right(stateOn(root, b.id));
      expect(r.state.cursors.primary).toEqual(nodeCursor(c.id));
    });

    it("on a non-last compound child moves to next sibling in pre-order", () => {
      // (+ x (* 2 3))  with cursor on x → next sibling is the inner list,
      // which arrives in pre-order (no phase).
      const plus = sym("+", ids), x = sym("x", ids);
      const star = sym("*", ids), two = num("2", ids), three = num("3", ids);
      const inner = list(ids, star, two, three);
      const outer = list(ids, plus, x, inner);
      const root = doc(ids, outer);
      const r = nav.right(stateOn(root, x.id));
      expect(r.state.cursors.primary).toEqual(nodeCursor(inner.id));
      // No phase set → equivalent to pre.
      const cur = r.state.cursors.primary;
      expect(cur.kind === "node" && cur.phase).toBeUndefined();
    });

    it("on the last leaf child moves to parent in post-order", () => {
      // (* 2 3) cursor on 3 → list in post-order
      const star = sym("*", ids), two = num("2", ids), three = num("3", ids);
      const lst = list(ids, star, two, three);
      const root = doc(ids, lst);
      const r = nav.right(stateOn(root, three.id));
      const cur = r.state.cursors.primary;
      expect(cur.kind).toBe("node");
      if (cur.kind === "node") {
        expect(cur.target).toBe(lst.id);
        expect(cur.phase).toBe("post");
      }
    });

    it("on a compound in post-order with a next sibling moves to it (pre-order)", () => {
      // (a (b c) d)  cursor on inner list in post-order → next sibling = d
      const a = sym("a", ids);
      const b = sym("b", ids), c = sym("c", ids);
      const inner = list(ids, b, c);
      const d = sym("d", ids);
      const outer = list(ids, a, inner, d);
      const root = doc(ids, outer);
      const cs = singleCursor(nodeCursor(inner.id, "post"));
      const r = nav.right(stateWithCursors(root, cs));
      expect(r.state.cursors.primary).toEqual(nodeCursor(d.id));
    });

    it("on a compound in post-order at last position moves to parent in post-order", () => {
      // (a (b c)) cursor on inner list in post → outer list in post-order
      const a = sym("a", ids);
      const b = sym("b", ids), c = sym("c", ids);
      const inner = list(ids, b, c);
      const outer = list(ids, a, inner);
      const root = doc(ids, outer);
      const cs = singleCursor(nodeCursor(inner.id, "post"));
      const r = nav.right(stateWithCursors(root, cs));
      const cur = r.state.cursors.primary;
      if (cur.kind === "node") {
        expect(cur.target).toBe(outer.id);
        expect(cur.phase).toBe("post");
      }
    });

    it("on the document root in post-order is a no-op (traversal complete)", () => {
      const a = sym("a", ids);
      const root = doc(ids, a);
      const cs = singleCursor(nodeCursor(root.id, "post"));
      const r = nav.right(stateWithCursors(root, cs));
      expect(r.noOps[0]?.reason).toBe("at-document-root");
      // Cursor is unchanged.
      const cur = r.state.cursors.primary;
      if (cur.kind === "node") {
        expect(cur.target).toBe(root.id);
        expect(cur.phase).toBe("post");
      }
    });

    it("on the document root in pre-order moves to the first top-level form", () => {
      const a = sym("a", ids), b = sym("b", ids);
      const root = doc(ids, a, b);
      const r = nav.right(stateOn(root, root.id));
      expect(r.state.cursors.primary).toEqual(nodeCursor(a.id));
    });

    it("on the last top-level child moves to the document root in post-order", () => {
      // doc(a, b) cursor on b (last top-level) → doc root in post-order
      const a = sym("a", ids), b = sym("b", ids);
      const root = doc(ids, a, b);
      const r = nav.right(stateOn(root, b.id));
      const cur = r.state.cursors.primary;
      if (cur.kind === "node") {
        expect(cur.target).toBe(root.id);
        expect(cur.phase).toBe("post");
      }
    });

    it("on an empty compound in pre-order transitions to the same compound in post-order", () => {
      const empty = list(ids);
      const root = doc(ids, empty);
      const r = nav.right(stateOn(root, empty.id));
      const cur = r.state.cursors.primary;
      if (cur.kind === "node") {
        expect(cur.target).toBe(empty.id);
        expect(cur.phase).toBe("post");
      }
    });

    it("on a leaf top-level form moves to the document root in post-order when last", () => {
      // doc(only-leaf) → cursor on leaf is last top-level child
      const only = sym("only", ids);
      const root = doc(ids, only);
      const r = nav.right(stateOn(root, only.id));
      const cur = r.state.cursors.primary;
      if (cur.kind === "node") {
        expect(cur.target).toBe(root.id);
        expect(cur.phase).toBe("post");
      }
    });

    it("a range cursor is treated as pre-order (collapses to anchor end)", () => {
      // (a b c)  range a..b anchored at start. nav.right exits the range as a
      // node cursor on the next position via Euler-tour rules.
      const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
      const lst = list(ids, a, b, c);
      const root = doc(ids, lst);
      // Range with anchor=start uses the start endpoint (a). From a →
      // siblingShift would go to b; the spatial walk is the same here
      // because a is a leaf, non-last child.
      const range = rangeCursor(lst.id, a.id, b.id, "start");
      const r = nav.right(stateWithCursors(root, singleCursor(range)));
      // Result is a node cursor (range collapsed).
      expect(r.state.cursors.primary).toEqual(nodeCursor(b.id));
    });
  });

  describe("nav.left (§5.1.9)", () => {
    it("on a compound in post-order moves to its last child", () => {
      // (a b c) cursor on list in post-order → c (leaf, no phase)
      const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
      const lst = list(ids, a, b, c);
      const root = doc(ids, lst);
      const cs = singleCursor(nodeCursor(lst.id, "post"));
      const r = nav.left(stateWithCursors(root, cs));
      expect(r.state.cursors.primary).toEqual(nodeCursor(c.id));
    });

    it("on a non-first leaf child moves to previous sibling", () => {
      const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
      const lst = list(ids, a, b, c);
      const root = doc(ids, lst);
      const r = nav.left(stateOn(root, b.id));
      expect(r.state.cursors.primary).toEqual(nodeCursor(a.id));
    });

    it("on a non-first compound child enters the previous compound in post-order", () => {
      // (a (b c) d) cursor on d (leaf) → previous sibling is the inner list.
      // We arrive there in post-order so nav.left from there would descend
      // into its last child.
      const a = sym("a", ids);
      const b = sym("b", ids), c = sym("c", ids);
      const inner = list(ids, b, c);
      const d = sym("d", ids);
      const outer = list(ids, a, inner, d);
      const root = doc(ids, outer);
      const r = nav.left(stateOn(root, d.id));
      const cur = r.state.cursors.primary;
      if (cur.kind === "node") {
        expect(cur.target).toBe(inner.id);
        expect(cur.phase).toBe("post");
      }
    });

    it("on the first child moves to parent in pre-order", () => {
      // («hello» world) → parent list in pre-order
      const hello = sym("hello", ids), world = sym("world", ids);
      const lst = list(ids, hello, world);
      const root = doc(ids, lst);
      const r = nav.left(stateOn(root, hello.id));
      expect(r.state.cursors.primary).toEqual(nodeCursor(lst.id));
    });

    it("on a compound in pre-order with a previous sibling enters that sibling in post-order", () => {
      // (a (b c) d) cursor on the inner list in pre-order → previous sibling
      // is `a` (a leaf), arrived at as a plain node cursor.
      const a = sym("a", ids);
      const b = sym("b", ids), c = sym("c", ids);
      const inner = list(ids, b, c);
      const d = sym("d", ids);
      const outer = list(ids, a, inner, d);
      const root = doc(ids, outer);
      // Cursor on inner with no phase (pre-order).
      const r = nav.left(stateOn(root, inner.id));
      expect(r.state.cursors.primary).toEqual(nodeCursor(a.id));
    });

    it("on a compound in pre-order at first position moves to parent in pre-order", () => {
      // ((b c) d) cursor on inner list in pre-order → outer list in pre-order
      const b = sym("b", ids), c = sym("c", ids);
      const inner = list(ids, b, c);
      const d = sym("d", ids);
      const outer = list(ids, inner, d);
      const root = doc(ids, outer);
      const r = nav.left(stateOn(root, inner.id));
      expect(r.state.cursors.primary).toEqual(nodeCursor(outer.id));
    });

    it("on the document root in pre-order is a no-op (start of traversal)", () => {
      const a = sym("a", ids);
      const root = doc(ids, a);
      const r = nav.left(stateOn(root, root.id));
      expect(r.noOps[0]?.reason).toBe("at-document-root");
    });

    it("on the document root in post-order moves to its last top-level child", () => {
      const a = sym("a", ids), b = sym("b", ids);
      const root = doc(ids, a, b);
      const cs = singleCursor(nodeCursor(root.id, "post"));
      const r = nav.left(stateWithCursors(root, cs));
      expect(r.state.cursors.primary).toEqual(nodeCursor(b.id));
    });

    it("on an empty compound in post-order transitions to the same compound in pre-order", () => {
      const empty = list(ids);
      const root = doc(ids, empty);
      const cs = singleCursor(nodeCursor(empty.id, "post"));
      const r = nav.left(stateWithCursors(root, cs));
      expect(r.state.cursors.primary).toEqual(nodeCursor(empty.id));
    });
  });

  describe("Euler-tour traversal sequences", () => {
    it("right walks (+ 1 (* 2 3)) → end in five steps", () => {
      // (+ 1 (* 2 3)). Cursor starts on the inner list (pre).
      // Sequence: inner → * → 2 → 3 → inner(post) → outer(post)
      const plus = sym("+", ids), one = num("1", ids);
      const star = sym("*", ids), two = num("2", ids), three = num("3", ids);
      const inner = list(ids, star, two, three);
      const outer = list(ids, plus, one, inner);
      const root = doc(ids, outer);

      let s = stateOn(root, inner.id);
      const steps: string[] = [];
      const targets = [star.id, two.id, three.id, inner.id, outer.id];
      const phases: Array<undefined | "pre" | "post"> = [
        undefined, undefined, undefined, "post", "post",
      ];
      for (let i = 0; i < 5; i++) {
        s = nav.right(s).state;
        const cur = s.cursors.primary;
        if (cur.kind === "node") {
          expect(cur.target).toBe(targets[i]);
          expect(cur.phase).toBe(phases[i]);
          steps.push(`${cur.target}/${cur.phase ?? "pre"}`);
        }
      }
      expect(steps).toHaveLength(5);
    });

    it("left mirrors right: walking from the doc root in post-order back to start", () => {
      // (a b)  cursor at doc-root in post-order. Left should walk: b → a → outer-list
      // Tree: doc(list(a, b))
      const a = sym("a", ids), b = sym("b", ids);
      const lst = list(ids, a, b);
      const root = doc(ids, lst);
      const cs = singleCursor(nodeCursor(root.id, "post"));
      let s: typeof cs extends never ? never : import("../types.ts").State =
        stateWithCursors(root, cs);
      // Step 1: doc post → last top-level = lst, in post-order.
      s = nav.left(s).state;
      let cur = s.cursors.primary;
      if (cur.kind === "node") {
        expect(cur.target).toBe(lst.id);
        expect(cur.phase).toBe("post");
      }
      // Step 2: lst post → last child = b (leaf).
      s = nav.left(s).state;
      cur = s.cursors.primary;
      if (cur.kind === "node") {
        expect(cur.target).toBe(b.id);
        expect(cur.phase).toBeUndefined();
      }
      // Step 3: b → a.
      s = nav.left(s).state;
      cur = s.cursors.primary;
      if (cur.kind === "node") {
        expect(cur.target).toBe(a.id);
      }
      // Step 4: a (first child) → parent (lst) in pre-order.
      s = nav.left(s).state;
      cur = s.cursors.primary;
      if (cur.kind === "node") {
        expect(cur.target).toBe(lst.id);
        expect(cur.phase).toBeUndefined();
      }
      // Step 5: lst (first top-level) → doc root pre-order.
      s = nav.left(s).state;
      cur = s.cursors.primary;
      if (cur.kind === "node") {
        expect(cur.target).toBe(root.id);
        expect(cur.phase).toBeUndefined();
      }
      // Step 6: doc-root pre-order is a no-op.
      const finalRes = nav.left(s);
      expect(finalRes.noOps[0]?.reason).toBe("at-document-root");
    });
  });

  describe("phase reset by non-spatial ops", () => {
    // Land on a compound in post-order via nav.right, then do a non-spatial
    // op; the next nav.right must treat the compound as pre-order again.

    it("nav.next clears phase: after right→post then next, the next nav.right re-enters", () => {
      // (a (b c) (d e))
      // Walk: cursor on b → right → c → right → inner1(post). next → inner2.
      // Now cursor on inner2. If phase was preserved we'd treat as post and
      // step out; with phase reset we should enter inner2 first child = d.
      const a = sym("a", ids);
      const b = sym("b", ids), c = sym("c", ids);
      const inner1 = list(ids, b, c);
      const d = sym("d", ids), e = sym("e", ids);
      const inner2 = list(ids, d, e);
      const outer = list(ids, a, inner1, inner2);
      const root = doc(ids, outer);

      // Step to inner1 post-order via right×2 from b.
      let s = stateOn(root, b.id);
      s = nav.right(s).state; // → c
      s = nav.right(s).state; // → inner1 post-order
      let cur = s.cursors.primary;
      if (cur.kind === "node") {
        expect(cur.target).toBe(inner1.id);
        expect(cur.phase).toBe("post");
      }
      // nav.next clears phase, lands on inner2 with no phase.
      s = nav.next(s).state;
      cur = s.cursors.primary;
      expect(cur).toEqual(nodeCursor(inner2.id));
      // nav.right now treats inner2 as pre-order → first child = d.
      s = nav.right(s).state;
      expect(s.cursors.primary).toEqual(nodeCursor(d.id));
    });

    it("nav.in clears phase", () => {
      // From a compound in post-order, nav.in jumps to first child without
      // any phase carried.
      const a = sym("a", ids), b = sym("b", ids);
      const lst = list(ids, a, b);
      const root = doc(ids, lst);
      const cs = singleCursor(nodeCursor(lst.id, "post"));
      const r = nav.in(stateWithCursors(root, cs));
      expect(r.state.cursors.primary).toEqual(nodeCursor(a.id));
    });

    it("nav.out clears phase", () => {
      // Cursor on a leaf (no phase) — nav.out lands on parent compound with
      // no phase, regardless of how the leaf was reached.
      const a = sym("a", ids), b = sym("b", ids);
      const lst = list(ids, a, b);
      const root = doc(ids, lst);
      // First land on lst in post-order via nav.right from b.
      let s = stateOn(root, b.id);
      s = nav.right(s).state; // → lst post-order
      // Now nav.out (lst → doc root). The result should be the doc root with
      // no phase.
      const r = nav.out(s);
      expect(r.state.cursors.primary).toEqual(nodeCursor(root.id));
    });

    it("nav.first clears phase", () => {
      // cursor on inner1 in post-order; nav.first within outer → a (no phase).
      const a = sym("a", ids);
      const b = sym("b", ids), c = sym("c", ids);
      const inner = list(ids, b, c);
      const outer = list(ids, a, inner);
      const root = doc(ids, outer);
      const cs = singleCursor(nodeCursor(inner.id, "post"));
      const r = nav.first(stateWithCursors(root, cs));
      expect(r.state.cursors.primary).toEqual(nodeCursor(a.id));
    });

    it("nav.last clears phase", () => {
      const a = sym("a", ids);
      const b = sym("b", ids), c = sym("c", ids);
      const inner = list(ids, b, c);
      const outer = list(ids, a, inner);
      const root = doc(ids, outer);
      // cursor on `a` with no phase, nav.last → inner with no phase. Even if
      // nav.last were emitting a phase from somewhere, this check pins it.
      const r = nav.last(stateOn(root, a.id));
      expect(r.state.cursors.primary).toEqual(nodeCursor(inner.id));
      const cur = r.state.cursors.primary;
      expect(cur.kind === "node" && cur.phase).toBeUndefined();
    });

    it("nav.prev clears phase even when starting from a post-order cursor", () => {
      // (a (b c) d)  cursor on inner1 post-order → nav.prev → a, no phase.
      const a = sym("a", ids);
      const b = sym("b", ids), c = sym("c", ids);
      const inner = list(ids, b, c);
      const d = sym("d", ids);
      const outer = list(ids, a, inner, d);
      const root = doc(ids, outer);
      const cs = singleCursor(nodeCursor(inner.id, "post"));
      const r = nav.prev(stateWithCursors(root, cs));
      expect(r.state.cursors.primary).toEqual(nodeCursor(a.id));
    });
  });

  describe("nav.right / nav.left pointwise across cursor sets", () => {
    it("nav.right applies independently to each cursor", () => {
      const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
      const lst = list(ids, a, b, c);
      const root = doc(ids, lst);
      const cs = {
        primary: nodeCursor(a.id),
        secondaries: [nodeCursor(b.id)],
      };
      const r = nav.right({ tree: { root }, cursors: cs });
      expect(r.state.cursors.primary).toEqual(nodeCursor(b.id));
      expect(r.state.cursors.secondaries[0]).toEqual(nodeCursor(c.id));
    });

    it("nav.right never mutates the tree", () => {
      const a = sym("a", ids), b = sym("b", ids);
      const lst = list(ids, a, b);
      const root = doc(ids, lst);
      const before = stateOn(root, a.id);
      const r = nav.right(before);
      expect(r.state.tree.root).toBe(root);
    });
  });
});
