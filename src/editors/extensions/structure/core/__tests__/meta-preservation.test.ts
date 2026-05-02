/**
 * Meta-preservation invariants (§6.5).
 *
 * "All §5 operations act on the core of the focused node, ignoring its Metas.
 *  Metas ride along through every mutation."
 */
import { describe, expect, it } from "vitest";

import { __resetIdCounterForTests, defaultIdGen } from "../types.ts";
import { makeMutators } from "../mutate.ts";
import {
  doc,
  list,
  listWithMetas,
  num,
  stateOn,
  sym,
  vec,
} from "./builders.ts";
import { findById } from "../traversal.ts";
import type { Meta, AddressableNode } from "../types.ts";

function setup() {
  __resetIdCounterForTests();
  const ids = defaultIdGen();
  return { ids, m: makeMutators({ ids }) };
}

const QUOTE: Meta[] = [{ kind: "quote", payload: undefined }];
const DEBUG: Meta[] = [{ kind: "debug", payload: undefined }];
const STACK: Meta[] = [...QUOTE, ...DEBUG]; // innermost first per §6.1

describe("meta preservation across mutations", () => {
  it("slurpForward preserves metas on the host compound", () => {
    const { ids, m } = setup();
    const lst = listWithMetas(ids, QUOTE, sym("a", ids));
    const next = sym("b", ids);
    const root = doc(ids, lst, next);
    const r = m.slurpForward(stateOn(root, lst.id));
    const found = findById(r.state.tree.root, lst.id);
    if (found?.kind !== "list") throw new Error();
    expect(found.metas).toEqual(QUOTE);
  });

  it("slurpForward preserves metas on the slurped sibling", () => {
    const { ids, m } = setup();
    const lst = list(ids, sym("a", ids));
    const sibling = listWithMetas(ids, DEBUG, sym("inner", ids));
    const root = doc(ids, lst, sibling);
    const r = m.slurpForward(stateOn(root, lst.id));
    const newL = findById(r.state.tree.root, lst.id);
    if (newL?.kind !== "list") throw new Error();
    const last = newL.children[newL.children.length - 1];
    if (last.kind !== "list") throw new Error();
    expect(last.metas).toEqual(DEBUG);
  });

  it("barfForward preserves metas on the barfed child", () => {
    const { ids, m } = setup();
    const tagged = listWithMetas(ids, QUOTE, sym("x", ids));
    const lst = list(ids, sym("a", ids), tagged);
    const root = doc(ids, lst);
    const r = m.barfForward(stateOn(root, lst.id));
    // After barf: parent has (a) and tagged as siblings.
    const docKids = r.state.tree.root.children;
    const stillTagged = docKids[0].kind === "list" && docKids[0].id === lst.id
      ? docKids[1]
      : docKids[0];
    if (stillTagged.kind !== "list") throw new Error();
    expect(stillTagged.metas).toEqual(QUOTE);
  });

  it("raise preserves metas on the raised node", () => {
    const { ids, m } = setup();
    const stacked = listWithMetas(ids, STACK, sym("inner", ids));
    const wrapper = list(ids, sym("a", ids), stacked);
    const root = doc(ids, wrapper);
    const r = m.raise(stateOn(root, stacked.id));
    // wrapper replaced by stacked.
    const top = r.state.tree.root.children[0];
    if (top.kind !== "list") throw new Error();
    expect(top.id).toBe(stacked.id);
    expect(top.metas).toEqual(STACK);
  });

  it("transposeNext preserves metas on the moved node", () => {
    const { ids, m } = setup();
    const tagged = listWithMetas(ids, QUOTE, sym("x", ids));
    const next = sym("y", ids);
    const lst = list(ids, tagged, next);
    const root = doc(ids, lst);
    const r = m.transposeNext(stateOn(root, tagged.id));
    const newL = findById(r.state.tree.root, lst.id);
    if (newL?.kind !== "list") throw new Error();
    // Order is now [y, tagged]; tagged keeps its metas.
    expect(newL.children[1].id).toBe(tagged.id);
    if (newL.children[1].kind !== "list") throw new Error();
    expect(newL.children[1].metas).toEqual(QUOTE);
  });

  it("enclose preserves metas on the wrapped node", () => {
    const { ids, m } = setup();
    const tagged = listWithMetas(ids, DEBUG, sym("x", ids));
    const root = doc(ids, tagged);
    const r = m.enclose.vector(stateOn(root, tagged.id));
    const wrap = r.state.tree.root.children[0];
    if (wrap.kind !== "vector") throw new Error();
    const inner = wrap.children[0];
    if (inner.kind !== "list") throw new Error();
    expect(inner.metas).toEqual(DEBUG);
  });

  it("splice preserves metas on every spliced child", () => {
    const { ids, m } = setup();
    const taggedA = listWithMetas(ids, QUOTE, sym("a", ids));
    const taggedB = listWithMetas(ids, DEBUG, sym("b", ids));
    const inner = list(ids, taggedA, taggedB);
    const outer = list(ids, sym("head", ids), inner, sym("tail", ids));
    const root = doc(ids, outer);
    const r = m.splice(stateOn(root, inner.id));
    const newOuter = r.state.tree.root.children[0];
    if (newOuter.kind !== "list") throw new Error();
    // Children: head, taggedA, taggedB, tail
    expect(newOuter.children[1].id).toBe(taggedA.id);
    expect(newOuter.children[2].id).toBe(taggedB.id);
    if (newOuter.children[1].kind !== "list") throw new Error();
    if (newOuter.children[2].kind !== "list") throw new Error();
    expect(newOuter.children[1].metas).toEqual(QUOTE);
    expect(newOuter.children[2].metas).toEqual(DEBUG);
  });

  it("metas are preserved through nested mutation chains", () => {
    // Build (a (b)<quote>) — the inner list carries a quote meta.
    // 1. enclose.vector on inner -> (a [(b)<quote>])
    // 2. splice on outer -> (a [(b)<quote>])  wait, splice on outer at root would
    //    splice top-level forms. Use a different chain:
    // After enclose: (a [INNER]) where INNER is the quoted list.
    // raise INNER: parent (vector) becomes INNER -> (a (b)<quote>) again.
    const { ids, m } = setup();
    const innerB = sym("b", ids);
    const quoted = listWithMetas(ids, QUOTE, innerB);
    const outer = list(ids, sym("a", ids), quoted);
    const root = doc(ids, outer);

    const after1 = m.enclose.vector(stateOn(root, quoted.id));
    // Now find the new vector wrapper; its single child is `quoted`.
    const wrappedQ = findById(after1.state.tree.root, quoted.id);
    if (wrappedQ?.kind !== "list") throw new Error();
    expect(wrappedQ.metas).toEqual(QUOTE);

    const after2 = m.raise(after1.state);
    // After raise, the vector's parent (outer's slot for vec) is replaced by
    // quoted. Quoted still has its meta.
    const final = findById(after2.state.tree.root, quoted.id);
    if (final?.kind !== "list") throw new Error();
    expect(final.metas).toEqual(QUOTE);
  });
});
