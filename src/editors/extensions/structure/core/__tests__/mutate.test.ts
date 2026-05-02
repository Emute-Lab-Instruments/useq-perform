/**
 * Mutation algebra tests (§5.2).
 */
import { beforeEach, describe, expect, it } from "vitest";

import { defaultIdGen, __resetIdCounterForTests } from "../types.ts";
import { makeMutators } from "../mutate.ts";
import {
  doc,
  list,
  listWithMetas,
  num,
  pp,
  stateOn,
  stateWithCursors,
  sym,
  vec,
} from "./builders.ts";
import { nodeCursor, rangeCursor, singleCursor } from "../types.ts";
import type { Meta } from "../types.ts";
import { findById } from "../traversal.ts";

// ─── Helpers ───────────────────────────────────────────────────────────────

function setup() {
  __resetIdCounterForTests();
  const ids = defaultIdGen();
  const m = makeMutators({ ids });
  return { ids, m };
}

describe("edit.slurpForward", () => {
  it("absorbs the next sibling as last child of the focused list", () => {
    // before: (foo) bar  -> (foo bar)
    const { ids, m } = setup();
    const foo = sym("foo", ids);
    const lst = list(ids, foo);
    const bar = sym("bar", ids);
    const root = doc(ids, lst, bar);
    const r = m.slurpForward(stateOn(root, lst.id));
    expect(r.noOps).toEqual([]);
    expect(pp(r.state.tree.root)).toBe("(foo bar)");
    // Cursor stays on the (now-grown) compound; ids reused.
    expect((r.state.cursors.primary as { target: string }).target).toBe(lst.id);
    // New root has the same compound id reused.
    const found = findById(r.state.tree.root, lst.id);
    expect(found?.kind).toBe("list");
  });

  it("is a no-op when there's no next sibling", () => {
    const { ids, m } = setup();
    const lst = list(ids, sym("foo", ids));
    const root = doc(ids, lst);
    const r = m.slurpForward(stateOn(root, lst.id));
    expect(r.noOps[0]?.reason).toBe("no-next-sibling");
    expect(r.state.tree.root).toBe(root);
  });

  it("is a no-op on a leaf cursor (use atomSlurp instead)", () => {
    const { ids, m } = setup();
    const a = sym("a", ids);
    const root = doc(ids, a);
    const r = m.slurpForward(stateOn(root, a.id));
    expect(r.noOps[0]?.reason).toBe("on-leaf");
  });

  it("preserves metas on the slurped sibling", () => {
    const { ids, m } = setup();
    const lst = list(ids, sym("a", ids));
    const metas: Meta[] = [{ kind: "quote", payload: undefined }];
    const quoted = listWithMetas(ids, metas, sym("b", ids));
    const root = doc(ids, lst, quoted);
    const r = m.slurpForward(stateOn(root, lst.id));
    const newL = findById(r.state.tree.root, lst.id);
    if (newL?.kind !== "list") throw new Error("expected list");
    const lastChild = newL.children[newL.children.length - 1];
    expect(lastChild.id).toBe(quoted.id);
    if (lastChild.kind !== "list") throw new Error("expected list child");
    expect(lastChild.metas).toEqual(metas);
  });
});

describe("edit.slurpBackward", () => {
  it("absorbs the previous sibling as first child", () => {
    const { ids, m } = setup();
    const foo = sym("foo", ids);
    const lst = list(ids, sym("body", ids));
    const root = doc(ids, foo, lst);
    const r = m.slurpBackward(stateOn(root, lst.id));
    expect(pp(r.state.tree.root)).toBe("(foo body)");
  });

  it("is a no-op at the first sibling position", () => {
    const { ids, m } = setup();
    const lst = list(ids, sym("body", ids));
    const root = doc(ids, lst);
    const r = m.slurpBackward(stateOn(root, lst.id));
    expect(r.noOps[0]?.reason).toBe("no-prev-sibling");
  });
});

describe("edit.barfForward", () => {
  it("ejects the last child as the next sibling", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids);
    const lst = list(ids, a, b);
    const root = doc(ids, lst);
    const r = m.barfForward(stateOn(root, lst.id));
    expect(pp(r.state.tree.root)).toBe("(a) b");
    // Cursor stays on the list.
    expect((r.state.cursors.primary as { target: string }).target).toBe(lst.id);
  });

  it("is a no-op when fewer than two children", () => {
    const { ids, m } = setup();
    const lst = list(ids, sym("a", ids));
    const root = doc(ids, lst);
    const r = m.barfForward(stateOn(root, lst.id));
    expect(r.noOps[0]?.reason).toBe("fewer-than-two-children");
  });
});

describe("edit.barfBackward", () => {
  it("ejects the first child as the previous sibling", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids);
    const lst = list(ids, a, b);
    const root = doc(ids, lst);
    const r = m.barfBackward(stateOn(root, lst.id));
    expect(pp(r.state.tree.root)).toBe("a (b)");
  });
});

describe("edit.raise", () => {
  it("replaces the parent with the focused node", () => {
    // (a (b c)) raised on b -> (b c) gone? wait — raising N replaces parent.
    // Actually: parent of b is the inner list; raising b replaces inner with b.
    // outer = (a inner-list) -> (a b)
    const { ids, m } = setup();
    const b = sym("b", ids);
    const inner = list(ids, b, sym("c", ids));
    const outer = list(ids, sym("a", ids), inner);
    const root = doc(ids, outer);
    const r = m.raise(stateOn(root, b.id));
    expect(pp(r.state.tree.root)).toBe("(a b)");
    expect((r.state.cursors.primary as { target: string }).target).toBe(b.id);
  });

  it("rejects when parent is the document root (no other siblings to remove)", () => {
    // Top-level form's parent is the document — spec says raise's precondition
    // is "parent is not the document root".
    const { ids, m } = setup();
    const a = sym("a", ids);
    const root = doc(ids, a);
    const r = m.raise(stateOn(root, a.id));
    expect(r.noOps[0]?.reason).toBe("single-top-level");
  });

  it("preserves the focused node's metas", () => {
    const { ids, m } = setup();
    const metas: Meta[] = [{ kind: "quote", payload: undefined }];
    const quoted = listWithMetas(ids, metas, sym("foo", ids));
    const outer = list(ids, sym("a", ids), quoted);
    const root = doc(ids, outer);
    const r = m.raise(stateOn(root, quoted.id));
    // Outer becomes a single-child list whose sole child = quoted (same id).
    // Wait — raising quoted means quoted REPLACES outer. So root.children[0] === quoted.
    expect(r.state.tree.root.children[0].id).toBe(quoted.id);
    const found = findById(r.state.tree.root, quoted.id);
    if (found?.kind !== "list") throw new Error();
    expect(found.metas).toEqual(metas);
  });
});

describe("edit.splice", () => {
  it("dissolves the focused compound into its parent", () => {
    // (a (b c) d) splice on (b c) -> (a b c d)
    const { ids, m } = setup();
    const b = sym("b", ids), c = sym("c", ids);
    const inner = list(ids, b, c);
    const outer = list(ids, sym("a", ids), inner, sym("d", ids));
    const root = doc(ids, outer);
    const r = m.splice(stateOn(root, inner.id));
    expect(pp(r.state.tree.root)).toBe("(a b c d)");
    // §5.2.6: cursor moves to first spliced child.
    expect((r.state.cursors.primary as { target: string }).target).toBe(b.id);
  });

  it("works at top-level (parent is document)", () => {
    // doc[ (do a b) ] splice -> doc[ a b ]
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids);
    const doForm = list(ids, sym("do", ids), a, b);
    const root = doc(ids, doForm);
    const r = m.splice(stateOn(root, doForm.id));
    expect(r.state.tree.root.children).toHaveLength(3);
    expect(r.state.tree.root.children[0].kind).toBe("symbol");
  });
});

describe("edit.enclose", () => {
  it("wraps the focused node in a fresh list", () => {
    const { ids, m } = setup();
    const a = sym("a", ids);
    const root = doc(ids, a);
    const r = m.enclose.list(stateOn(root, a.id));
    expect(pp(r.state.tree.root)).toBe("(a)");
    // Cursor moves to the new wrapper.
    const top = r.state.tree.root.children[0];
    expect(top.kind).toBe("list");
    expect((r.state.cursors.primary as { target: string }).target).toBe(top.id);
  });

  it("supports vector / map / set wrapper kinds", () => {
    const { ids, m } = setup();
    const a = sym("a", ids);
    const root = doc(ids, a);
    expect(pp(m.enclose.vector(stateOn(root, a.id)).state.tree.root)).toBe("[a]");
    const root2 = doc(ids, sym("b", ids));
    expect(pp(m.enclose.map(stateOn(root2, root2.children[0].id)).state.tree.root)).toBe(
      "{b}",
    );
    const root3 = doc(ids, sym("c", ids));
    expect(pp(m.enclose.set(stateOn(root3, root3.children[0].id)).state.tree.root)).toBe(
      "#{c}",
    );
  });

  it("encloses a range cursor's run", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids), d = sym("d", ids);
    const lst = list(ids, a, b, c, d);
    const root = doc(ids, lst);
    const range = rangeCursor(lst.id, b.id, c.id, "start");
    const r = m.enclose.vector(stateWithCursors(root, singleCursor(range)));
    expect(pp(r.state.tree.root)).toBe("(a [b c] d)");
  });

  it("enclose does not lose the wrapped node's metas", () => {
    const { ids, m } = setup();
    const metas: Meta[] = [{ kind: "quote", payload: undefined }];
    const quoted = listWithMetas(ids, metas, sym("a", ids));
    const root = doc(ids, quoted);
    const r = m.enclose.list(stateOn(root, quoted.id));
    // Inside the new wrapper, the inner list still carries its meta.
    const wrap = r.state.tree.root.children[0];
    if (wrap.kind !== "list") throw new Error("expected list wrapper");
    const inner = wrap.children[0];
    if (inner.kind !== "list") throw new Error();
    expect(inner.metas).toEqual(metas);
  });
});

describe("edit.transposeNext / edit.transposePrev", () => {
  it("transposeNext swaps with the next sibling", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
    const lst = list(ids, a, b, c);
    const root = doc(ids, lst);
    const r = m.transposeNext(stateOn(root, b.id));
    expect(pp(r.state.tree.root)).toBe("(a c b)");
    // Cursor follows b.
    expect((r.state.cursors.primary as { target: string }).target).toBe(b.id);
  });

  it("transposePrev swaps with the previous sibling", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids), c = sym("c", ids);
    const lst = list(ids, a, b, c);
    const root = doc(ids, lst);
    const r = m.transposePrev(stateOn(root, b.id));
    expect(pp(r.state.tree.root)).toBe("(b a c)");
  });

  it("transpose at sibling boundary is a no-op", () => {
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids);
    const lst = list(ids, a, b);
    const root = doc(ids, lst);
    expect(m.transposeNext(stateOn(root, b.id)).noOps[0]?.reason).toBe(
      "no-next-sibling",
    );
    expect(m.transposePrev(stateOn(root, a.id)).noOps[0]?.reason).toBe(
      "no-prev-sibling",
    );
  });

  it("transpose preserves metas on the swapped node", () => {
    const { ids, m } = setup();
    const metas: Meta[] = [{ kind: "quote", payload: undefined }];
    const quoted = listWithMetas(ids, metas, sym("x", ids));
    const a = sym("a", ids);
    const lst = list(ids, a, quoted);
    const root = doc(ids, lst);
    const r = m.transposePrev(stateOn(root, quoted.id));
    const newL = findById(r.state.tree.root, lst.id);
    if (newL?.kind !== "list") throw new Error();
    const first = newL.children[0];
    expect(first.id).toBe(quoted.id);
    if (first.kind !== "list") throw new Error();
    expect(first.metas).toEqual(metas);
  });
});

describe("edit.atomSlurp", () => {
  it("default promote-to-vector wraps the leaf and slurps", () => {
    // a b -> [a b]
    const { ids, m } = setup();
    const a = sym("a", ids), b = sym("b", ids);
    const root = doc(ids, a, b);
    const r = m.atomSlurpForward(stateOn(root, a.id));
    expect(pp(r.state.tree.root)).toBe("[a b]");
  });

  it("respects promote-to-list", () => {
    __resetIdCounterForTests();
    const ids = defaultIdGen();
    const m = makeMutators({ ids, atomSlurpBehaviour: "promote-to-list" });
    const a = sym("a", ids), b = sym("b", ids);
    const root = doc(ids, a, b);
    const r = m.atomSlurpForward(stateOn(root, a.id));
    expect(pp(r.state.tree.root)).toBe("(a b)");
  });

  it("no-op behaviour rejects with atom-slurp-disabled", () => {
    __resetIdCounterForTests();
    const ids = defaultIdGen();
    const m = makeMutators({ ids, atomSlurpBehaviour: "no-op" });
    const a = sym("a", ids);
    const root = doc(ids, a, sym("b", ids));
    const r = m.atomSlurpForward(stateOn(root, a.id));
    expect(r.noOps[0]?.reason).toBe("atom-slurp-disabled");
  });

  it("on a compound, atomSlurp behaves like a regular slurp", () => {
    const { ids, m } = setup();
    const lst = list(ids, sym("a", ids));
    const b = sym("b", ids);
    const root = doc(ids, lst, b);
    const r = m.atomSlurpForward(stateOn(root, lst.id));
    expect(pp(r.state.tree.root)).toBe("(a b)");
  });
});

describe("multi-cursor pointwise application (§3.5)", () => {
  it("applies leftmost first; later cursors see the post-mutation tree", () => {
    // Two independent compounds in adjacent siblings — each slurps once.
    // Initial: ((a) X) ((b) Y)  — outer list per side; inner list will slurp.
    //          slurpForward on inner1 -> ((a X)) ((b) Y)
    //          slurpForward on inner2 -> ((a X)) ((b Y))
    const { ids, m } = setup();
    const innerA = list(ids, sym("a", ids));
    const X = sym("X", ids);
    const outerA = list(ids, innerA, X);
    const innerB = list(ids, sym("b", ids));
    const Y = sym("Y", ids);
    const outerB = list(ids, innerB, Y);
    const root = doc(ids, outerA, outerB);
    const cs = {
      primary: nodeCursor(innerA.id),
      secondaries: [nodeCursor(innerB.id)],
    };
    const r = m.slurpForward({ tree: { root }, cursors: cs });
    expect(pp(r.state.tree.root)).toBe("((a X)) ((b Y))");
    expect(r.noOps).toEqual([]);
  });

  it("a cursor whose effective parent changed mid-mutation still operates correctly", () => {
    // Initial: (a)<- (b)<- — both lists are top-level. Cursor on first list
    // slurps the second; the second-cursor's target (lst2) is now lst1's
    // last child, so it has no next sibling and no-ops.
    const { ids, m } = setup();
    const lst1 = list(ids, sym("a", ids));
    const lst2 = list(ids, sym("b", ids));
    const root = doc(ids, lst1, lst2);
    const cs = {
      primary: nodeCursor(lst1.id),
      secondaries: [nodeCursor(lst2.id)],
    };
    const r = m.slurpForward({ tree: { root }, cursors: cs });
    expect(pp(r.state.tree.root)).toBe("(a (b))");
    // Second cursor's slurp had no next sibling under its new parent.
    expect(r.noOps).toHaveLength(1);
    expect(r.noOps[0]?.reason).toBe("no-next-sibling");
  });

  it("drops cursors whose target was destroyed", () => {
    // Splice the inner list while a secondary cursor points at the destroyed
    // compound. The secondary should be dropped.
    const { ids, m } = setup();
    const inner = list(ids, sym("b", ids), sym("c", ids));
    const outer = list(ids, sym("a", ids), inner);
    const root = doc(ids, outer);
    const cs = {
      primary: nodeCursor(inner.id),
      secondaries: [nodeCursor(inner.id)], // duplicate; second one will see inner gone
    };
    const r = m.splice({ tree: { root }, cursors: cs });
    // After the first splice on inner, the second cursor's target is gone.
    expect(r.dropped).toHaveLength(1);
  });
});
