/**
 * Hole tests (§2.9, §5.2.11).
 */
import { beforeEach, describe, expect, it } from "vitest";

import { defaultIdGen, __resetIdCounterForTests } from "../types.ts";
import {
  doc,
  hole,
  list,
  num,
  pp,
  stateOn,
  sym,
  vec,
} from "./builders.ts";
import {
  findHolesInOrder,
  holeAcceptsKind,
  isHole,
  isHoleType,
  makeHole,
} from "../holes.ts";
import { makeMutators } from "../mutate.ts";
import { nav } from "../nav.ts";
import { findById } from "../traversal.ts";
import type { AddressableNode, IdGen } from "../types.ts";

describe("holes — predicates and helpers", () => {
  it("isHoleType recognises every legal type and rejects others", () => {
    expect(isHoleType("number")).toBe(true);
    expect(isHoleType("symbol")).toBe(true);
    expect(isHoleType("keyword")).toBe(true);
    expect(isHoleType("expr")).toBe(true);
    expect(isHoleType("string")).toBe(true);
    expect(isHoleType("list")).toBe(false);
    expect(isHoleType("")).toBe(false);
  });

  it("makeHole creates a leaf with empty metas (§2.9.6)", () => {
    __resetIdCounterForTests();
    const ids = defaultIdGen();
    const h = makeHole("freq", "number", ids);
    expect(h.kind).toBe("hole");
    expect(h.name).toBe("freq");
    expect(h.holeType).toBe("number");
    expect(h.metas).toEqual([]);
    expect(isHole(h)).toBe(true);
  });

  it("findHolesInOrder walks the tree depth-first, document order", () => {
    __resetIdCounterForTests();
    const ids = defaultIdGen();
    const h1 = hole("a", "number", ids);
    const h2 = hole("b", "expr", ids);
    const h3 = hole("c", "symbol", ids);
    const root = doc(
      ids,
      list(ids, h1, vec(ids, h2)),
      h3,
    );
    const order = findHolesInOrder(root);
    expect(order.map((h) => h.name)).toEqual(["a", "b", "c"]);
  });

  it("holeAcceptsKind: type-specific holes reject mismatches", () => {
    __resetIdCounterForTests();
    const ids = defaultIdGen();
    const h = makeHole("x", "number", ids);
    expect(holeAcceptsKind(h, "number")).toBe(true);
    expect(holeAcceptsKind(h, "symbol")).toBe(false);
    expect(holeAcceptsKind(h, "list")).toBe(false);
  });

  it("holeAcceptsKind: 'expr' holes accept any addressable form", () => {
    __resetIdCounterForTests();
    const ids = defaultIdGen();
    const h = makeHole("body", "expr", ids);
    expect(holeAcceptsKind(h, "list")).toBe(true);
    expect(holeAcceptsKind(h, "vector")).toBe(true);
    expect(holeAcceptsKind(h, "symbol")).toBe(true);
    expect(holeAcceptsKind(h, "hole")).toBe(true);
    expect(holeAcceptsKind(h, "document")).toBe(false);
  });
});

describe("edit.fillHole (§5.2.11)", () => {
  function setup() {
    __resetIdCounterForTests();
    const ids = defaultIdGen();
    const m = makeMutators({ ids });
    return { ids, m };
  }

  it("replaces the hole with the supplied content; cursor lands on it", () => {
    const { ids, m } = setup();
    const h = hole("freq", "number", ids);
    const lst = list(ids, sym("synth", ids), h);
    const root = doc(ids, lst);
    const r = m.fillHole(stateOn(root, h.id), (idgen): AddressableNode => num("440", idgen));
    expect(pp(r.state.tree.root)).toBe("(synth 440)");
    // Cursor moved to the inserted content (the new number).
    const newL = findById(r.state.tree.root, lst.id);
    if (newL?.kind !== "list") throw new Error();
    const inserted = newL.children[1];
    expect((r.state.cursors.primary as { target: string }).target).toBe(inserted.id);
  });

  it("when filling with a fragment that contains holes, cursor moves to its first inner hole", () => {
    const { ids, m } = setup();
    const target = hole("body", "expr", ids);
    const root = doc(ids, target);
    let innerHoleId = "";
    const r = m.fillHole(stateOn(root, target.id), (idgen): AddressableNode => {
      const inner = makeHole("freq", "number", idgen);
      innerHoleId = inner.id;
      return list(idgen, sym("synth", idgen), inner);
    });
    expect((r.state.cursors.primary as { target: string }).target).toBe(innerHoleId);
  });

  it("rejects on cursors that aren't on a hole", () => {
    const { ids, m } = setup();
    const a = sym("a", ids);
    const root = doc(ids, a);
    const r = m.fillHole(stateOn(root, a.id), (idgen): AddressableNode => num("1", idgen));
    expect(r.noOps[0]?.reason).toBe("not-on-hole");
  });
});

describe("holes are atomic for structural ops (§2.9.2)", () => {
  it("transpose treats a hole as a single unit", () => {
    __resetIdCounterForTests();
    const ids = defaultIdGen();
    const m = makeMutators({ ids });
    const h = hole("freq", "number", ids);
    const a = sym("a", ids);
    const lst = list(ids, a, h);
    const root = doc(ids, lst);
    const r = m.transposePrev(stateOn(root, h.id));
    // After transpose: (⟨freq:number⟩ a)
    const newL = findById(r.state.tree.root, lst.id);
    if (newL?.kind !== "list") throw new Error();
    expect(newL.children[0].id).toBe(h.id);
    expect(newL.children[1].id).toBe(a.id);
  });

  it("a hole can be slurped (atomSlurp promotes it)", () => {
    __resetIdCounterForTests();
    const ids = defaultIdGen();
    const m = makeMutators({ ids });
    const h = hole("freq", "number", ids);
    const next = sym("b", ids);
    const root = doc(ids, h, next);
    const r = m.atomSlurpForward(stateOn(root, h.id));
    // Promoted to vector by default: [⟨freq:number⟩ b]
    expect(pp(r.state.tree.root)).toBe("[⟨freq:number⟩ b]");
  });

  it("slurpForward rejects on a hole (on-leaf)", () => {
    __resetIdCounterForTests();
    const ids = defaultIdGen();
    const m = makeMutators({ ids });
    const h = hole("x", "expr", ids);
    const root = doc(ids, list(ids, h, sym("a", ids)));
    const r = m.slurpForward(stateOn(root, h.id));
    expect(r.noOps[0]?.reason).toBe("on-leaf");
  });

  it("barfForward rejects on a hole (on-leaf)", () => {
    __resetIdCounterForTests();
    const ids = defaultIdGen();
    const m = makeMutators({ ids });
    const h = hole("x", "expr", ids);
    const root = doc(ids, list(ids, h, sym("a", ids)));
    const r = m.barfForward(stateOn(root, h.id));
    expect(r.noOps[0]?.reason).toBe("on-leaf");
  });

  it("raise on a hole replaces its parent (hole as whole unit)", () => {
    __resetIdCounterForTests();
    const ids = defaultIdGen();
    const m = makeMutators({ ids });
    const h = hole("freq", "number", ids);
    const outer = list(ids, list(ids, sym("a", ids), h));
    const root = doc(ids, outer);
    const r = m.raise(stateOn(root, h.id));
    // The inner list is replaced by the hole; outer list now contains just the hole.
    expect(pp(r.state.tree.root)).toBe("(⟨freq:number⟩)");
  });

  it("enclose wraps a hole in a compound (hole stays intact)", () => {
    __resetIdCounterForTests();
    const ids = defaultIdGen();
    const m = makeMutators({ ids });
    const h = hole("body", "expr", ids);
    const root = doc(ids, list(ids, sym("a", ids), h));
    const r = m.enclose.vector(stateOn(root, h.id));
    // The hole is now wrapped: (a [⟨body:expr⟩])
    expect(pp(r.state.tree.root)).toBe("(a [⟨body:expr⟩])");
  });
});

describe("holes are not addressable by navigation (§2.9.2)", () => {
  it("nav.down on a hole returns on-leaf", () => {
    __resetIdCounterForTests();
    const ids = defaultIdGen();
    const h = hole("freq", "number", ids);
    const root = doc(ids, h);
    const r = nav.down(stateOn(root, h.id));
    expect(r.noOps[0]?.reason).toBe("on-leaf");
  });
});
