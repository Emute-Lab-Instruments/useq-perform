/**
 * Wrapper recognition tests (§6.2, live-edit.md §2.2).
 *
 * Verifies that the tree-construction step correctly detects `(live-edit ...)`
 * wrapper patterns, folds them into the host node carrying a Meta, and that
 * the printer round-trips them back to source text.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
// @ts-expect-error — clojure-mode has no type declarations
import { default_extensions } from "@nextjournal/clojure-mode";

import { treeFromLezer } from "../treeFromLezer.ts";
import type { LiveEditMetaPayload } from "../treeFromLezer.ts";
import { printNode } from "../printTree.ts";
import type { NumberNode, KeywordNode, SymbolNode, Meta } from "../../core/index.ts";
import {
  __resetIdCounterForTests,
  defaultIdGen,
  makeMutators,
} from "../../core/index.ts";
import {
  doc,
  list,
  num,
  sym,
  stateOn,
} from "../../core/__tests__/builders.ts";
import { findById } from "../../core/index.ts";

function parse(source: string) {
  const state = EditorState.create({
    doc: source,
    extensions: [...default_extensions],
  });
  return treeFromLezer(state);
}

// ---------------------------------------------------------------------------
// §1  Basic wrapper recognition
// ---------------------------------------------------------------------------

describe("wrapper recognition — valid live-edit patterns", () => {
  it("(live-edit 0.5 :id \"abc\" :min 0 :max 1) parses as NumberNode with live-edit Meta", () => {
    const { tree, warnings } = parse('(live-edit 0.5 :id "abc" :min 0 :max 1)');
    expect(warnings).toHaveLength(0);
    expect(tree.root.children).toHaveLength(1);

    const node = tree.root.children[0]!;
    expect(node.kind).toBe("number");
    const numNode = node as NumberNode;
    expect(numNode.text).toBe("0.5");
  });

  it("Meta payload contains the parsed keyword args", () => {
    const { tree } = parse('(live-edit 0.5 :id "abc" :min 0 :max 1)');
    const node = tree.root.children[0]!;
    expect(node.metas).toHaveLength(1);

    const meta = node.metas[0]!;
    expect(meta.kind).toBe("live-edit");
    const payload = meta.payload as LiveEditMetaPayload;
    expect(payload.id).toBe("abc");
    expect(payload.min).toBe(0);
    expect(payload.max).toBe(1);
  });

  it("idIndex maps host node id to the full wrapper source range", () => {
    const source = '(live-edit 0.5 :id "abc" :min 0 :max 1)';
    const { tree, idIndex } = parse(source);
    const node = tree.root.children[0]!;
    const range = idIndex.get(node.id);
    expect(range).toBeDefined();
    expect(range!.from).toBe(0);
    expect(range!.to).toBe(source.length);
  });

  it("boolean host: (live-edit true :id \"x\")", () => {
    const { tree, warnings } = parse('(live-edit true :id "x")');
    expect(warnings).toHaveLength(0);
    const node = tree.root.children[0]!;
    // `true` is a symbol in ModuLisp/clojure-mode
    expect(node.kind).toBe("symbol");
    expect((node as SymbolNode).text).toBe("true");
    expect(node.metas).toHaveLength(1);
    expect(node.metas[0]!.kind).toBe("live-edit");
    expect((node.metas[0]!.payload as LiveEditMetaPayload).id).toBe("x");
  });

  it("keyword host: (live-edit :up :id \"y\" :options [:up :down])", () => {
    const { tree, warnings } = parse('(live-edit :up :id "y" :options [:up :down])');
    expect(warnings).toHaveLength(0);
    const node = tree.root.children[0]!;
    expect(node.kind).toBe("keyword");
    expect((node as KeywordNode).text).toBe(":up");
    expect(node.metas).toHaveLength(1);
    const payload = node.metas[0]!.payload as LiveEditMetaPayload;
    expect(payload.id).toBe("y");
    expect(payload.options).toEqual(["up", "down"]);
  });

  it("all keyword args: :id, :min, :max, :name, :step, :precision, :options", () => {
    const source =
      '(live-edit 42 :id "x" :min 0 :max 100 :name "volume" :step 1 :precision 2 :options [:a :b])';
    const { tree, warnings } = parse(source);
    expect(warnings).toHaveLength(0);
    const payload = tree.root.children[0]!.metas[0]!.payload as LiveEditMetaPayload;
    expect(payload.id).toBe("x");
    expect(payload.min).toBe(0);
    expect(payload.max).toBe(100);
    expect(payload.name).toBe("volume");
    expect(payload.step).toBe(1);
    expect(payload.precision).toBe(2);
    expect(payload.options).toEqual(["a", "b"]);
  });

  it("live-edit with no keyword args — just (live-edit 0.5)", () => {
    const { tree, warnings } = parse("(live-edit 0.5)");
    expect(warnings).toHaveLength(0);
    const node = tree.root.children[0]!;
    expect(node.kind).toBe("number");
    expect(node.metas).toHaveLength(1);
    const payload = node.metas[0]!.payload as LiveEditMetaPayload;
    // All payload fields are undefined
    expect(payload.id).toBeUndefined();
    expect(payload.min).toBeUndefined();
  });

  it("live-edit inside a list: (foo (live-edit 1 :id \"a\"))", () => {
    const { tree, warnings } = parse('(foo (live-edit 1 :id "a"))');
    expect(warnings).toHaveLength(0);
    const outer = tree.root.children[0]!;
    expect(outer.kind).toBe("list");
    if (outer.kind !== "list") throw new Error();
    expect(outer.children).toHaveLength(2);
    expect(outer.children[0]!.kind).toBe("symbol");
    expect(outer.children[1]!.kind).toBe("number");
    expect(outer.children[1]!.metas).toHaveLength(1);
    expect(outer.children[1]!.metas[0]!.kind).toBe("live-edit");
  });
});

// ---------------------------------------------------------------------------
// §2  Malformed wrapper patterns
// ---------------------------------------------------------------------------

describe("wrapper recognition — malformed patterns", () => {
  it("(live-edit) with no host produces warning, not a crash", () => {
    const { tree, warnings } = parse("(live-edit)");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain("Malformed live-edit wrapper");
    expect(warnings[0]!.message).toContain("no host node");
    // Falls back to a normal list
    expect(tree.root.children[0]!.kind).toBe("list");
  });

  it("warning includes correct source range", () => {
    const { warnings } = parse("abc (live-edit) def");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.from).toBe(4);
    expect(warnings[0]!.to).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// §3  Non-wrapper lists are unaffected
// ---------------------------------------------------------------------------

describe("wrapper recognition — non-wrapper lists are unaffected", () => {
  it("(foo bar baz) parses as a normal list with no metas", () => {
    const { tree, warnings } = parse("(foo bar baz)");
    expect(warnings).toHaveLength(0);
    const node = tree.root.children[0]!;
    expect(node.kind).toBe("list");
    expect(node.metas).toHaveLength(0);
  });

  it("(a live-edit b) — live-edit in non-head position is not a wrapper", () => {
    const { tree, warnings } = parse("(a live-edit b)");
    expect(warnings).toHaveLength(0);
    expect(tree.root.children[0]!.kind).toBe("list");
    expect(tree.root.children[0]!.metas).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §4  Printer round-trip
// ---------------------------------------------------------------------------

describe("printNode round-trip for live-edit", () => {
  it("parse then print: (live-edit 0.5 :id \"abc\" :min 0 :max 1)", () => {
    const source = '(live-edit 0.5 :id "abc" :min 0 :max 1)';
    const { tree } = parse(source);
    const printed = printNode(tree.root.children[0]!);
    expect(printed).toBe(source);
  });

  it("round-trip with no keyword args", () => {
    const source = "(live-edit 0.5)";
    const { tree } = parse(source);
    const printed = printNode(tree.root.children[0]!);
    expect(printed).toBe(source);
  });

  it("round-trip with keyword host and options", () => {
    const source = '(live-edit :up :id "y" :options [:up :down])';
    const { tree } = parse(source);
    const printed = printNode(tree.root.children[0]!);
    expect(printed).toBe(source);
  });

  it("round-trip preserves all keyword args", () => {
    const source =
      '(live-edit 42 :id "x" :name "vol" :min 0 :max 100 :step 1 :precision 2 :options [:a :b])';
    const { tree } = parse(source);
    const printed = printNode(tree.root.children[0]!);
    expect(printed).toBe(source);
  });

  it("round-trip for live-edit nested inside a list", () => {
    const source = '(foo (live-edit 1 :id "a"))';
    const { tree } = parse(source);
    const printed = printNode(tree.root.children[0]!);
    expect(printed).toBe(source);
  });

  it("round-trip for full document with live-edit", () => {
    const { tree } = parse('(foo (live-edit 1 :id "a") bar)');
    const printed = printNode(tree.root);
    expect(printed).toBe('(foo (live-edit 1 :id "a") bar)');
  });
});

// ---------------------------------------------------------------------------
// §5  Meta preservation through structural ops
// ---------------------------------------------------------------------------

describe("live-edit meta preservation through structural ops", () => {
  function setup() {
    __resetIdCounterForTests();
    const ids = defaultIdGen();
    return { ids, m: makeMutators({ ids }) };
  }

  const LIVE_EDIT_META: Meta = {
    kind: "live-edit",
    payload: { id: "abc", min: 0, max: 1 } as LiveEditMetaPayload,
  };

  it("slurpForward preserves live-edit meta on the host", () => {
    const { ids, m } = setup();
    // Build: (a)<live-edit> b — host 'a' has the meta, 'b' is a sibling to slurp
    const a = num("0.5", ids, [LIVE_EDIT_META]);
    // We need a compound node carrying the meta to slurp. Instead, put the
    // meta-bearing node inside a list and slurp a sibling into the list.
    const inner = list(ids, a);
    // Manually attach meta to the list node
    const innerWithMeta = { ...inner, metas: [LIVE_EDIT_META] };
    const sibling = sym("b", ids);
    const root = doc(ids, innerWithMeta, sibling);
    const r = m.slurpForward(stateOn(root, innerWithMeta.id));
    const found = findById(r.state.tree.root, innerWithMeta.id);
    if (!found || found.kind !== "list") throw new Error("expected list");
    expect(found.metas).toEqual([LIVE_EDIT_META]);
  });

  it("raise preserves live-edit meta on the raised node", () => {
    const { ids, m } = setup();
    const tagged = num("0.5", ids, [LIVE_EDIT_META]);
    const wrapper = list(ids, sym("head", ids), tagged);
    const root = doc(ids, wrapper);
    const r = m.raise(stateOn(root, tagged.id));
    const top = r.state.tree.root.children[0]!;
    expect(top.id).toBe(tagged.id);
    expect(top.metas).toEqual([LIVE_EDIT_META]);
  });

  it("transposeNext preserves live-edit meta", () => {
    const { ids, m } = setup();
    const tagged = num("0.5", ids, [LIVE_EDIT_META]);
    const next = sym("y", ids);
    const outer = list(ids, tagged, next);
    const root = doc(ids, outer);
    const r = m.transposeNext(stateOn(root, tagged.id));
    const newOuter = findById(r.state.tree.root, outer.id);
    if (!newOuter || newOuter.kind !== "list") throw new Error();
    // Order is now [y, tagged]; tagged keeps its meta
    expect(newOuter.children[1]!.id).toBe(tagged.id);
    expect(newOuter.children[1]!.metas).toEqual([LIVE_EDIT_META]);
  });
});
