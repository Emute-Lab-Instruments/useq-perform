/**
 * Hole recognition tests (§2.9.1, §2.10).
 *
 * Verifies that the tree-construction step correctly detects `($ name :type)`
 * patterns in source and folds them to hole leaves, and that malformed patterns
 * produce structural warnings without breaking tree construction.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
// @ts-expect-error — clojure-mode has no type declarations
import { default_extensions } from "@nextjournal/clojure-mode";

import { treeFromLezer } from "../treeFromLezer.ts";
import type { HoleNode } from "../../core/index.ts";

function parse(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [...default_extensions],
  });
  return treeFromLezer(state);
}

describe("hole recognition — valid patterns (§2.9.1)", () => {
  it("($ freq :number) folds to a hole leaf with name='freq', holeType='number'", () => {
    const { tree, warnings } = parse("($ freq :number)");
    expect(warnings).toHaveLength(0);
    expect(tree.root.children).toHaveLength(1);
    const node = tree.root.children[0]!;
    expect(node.kind).toBe("hole");
    const hole = node as HoleNode;
    expect(hole.name).toBe("freq");
    expect(hole.holeType).toBe("number");
  });

  it("($ body :expr) folds to a hole leaf with type='expr'", () => {
    const { tree, warnings } = parse("($ body :expr)");
    expect(warnings).toHaveLength(0);
    const hole = tree.root.children[0]! as HoleNode;
    expect(hole.kind).toBe("hole");
    expect(hole.name).toBe("body");
    expect(hole.holeType).toBe("expr");
  });

  it("($ name :symbol) folds to a hole leaf with type='symbol'", () => {
    const { tree, warnings } = parse("($ name :symbol)");
    expect(warnings).toHaveLength(0);
    const hole = tree.root.children[0]! as HoleNode;
    expect(hole.kind).toBe("hole");
    expect(hole.name).toBe("name");
    expect(hole.holeType).toBe("symbol");
  });

  it("($ tag :keyword) folds to a hole leaf with type='keyword'", () => {
    const { tree, warnings } = parse("($ tag :keyword)");
    expect(warnings).toHaveLength(0);
    const hole = tree.root.children[0]! as HoleNode;
    expect(hole.kind).toBe("hole");
    expect(hole.name).toBe("tag");
    expect(hole.holeType).toBe("keyword");
  });

  it("($ msg :string) folds to a hole leaf with type='string'", () => {
    const { tree, warnings } = parse("($ msg :string)");
    expect(warnings).toHaveLength(0);
    const hole = tree.root.children[0]! as HoleNode;
    expect(hole.kind).toBe("hole");
    expect(hole.name).toBe("msg");
    expect(hole.holeType).toBe("string");
  });

  it("hole inside a list: (synth ($ freq :number)) — only inner list is a hole", () => {
    const { tree, warnings } = parse("(synth ($ freq :number))");
    expect(warnings).toHaveLength(0);
    expect(tree.root.children).toHaveLength(1);
    const outer = tree.root.children[0]!;
    expect(outer.kind).toBe("list");
    if (outer.kind !== "list") throw new Error();
    expect(outer.children).toHaveLength(2);
    expect(outer.children[0]!.kind).toBe("symbol");
    expect(outer.children[1]!.kind).toBe("hole");
    const hole = outer.children[1]! as HoleNode;
    expect(hole.name).toBe("freq");
    expect(hole.holeType).toBe("number");
  });

  it("multiple holes in one doc parse independently", () => {
    const { tree, warnings } = parse("($ a :number) ($ b :expr)");
    expect(warnings).toHaveLength(0);
    expect(tree.root.children).toHaveLength(2);
    expect((tree.root.children[0]! as HoleNode).name).toBe("a");
    expect((tree.root.children[0]! as HoleNode).holeType).toBe("number");
    expect((tree.root.children[1]! as HoleNode).name).toBe("b");
    expect((tree.root.children[1]! as HoleNode).holeType).toBe("expr");
  });

  it("hole gets registered in idIndex with correct source range", () => {
    const { tree, idIndex } = parse("($ freq :number)");
    const hole = tree.root.children[0]! as HoleNode;
    const range = idIndex.get(hole.id);
    expect(range).toBeDefined();
    expect(range!.from).toBe(0);
    expect(range!.to).toBe(16); // length of "($ freq :number)"
  });
});

describe("hole recognition — malformed patterns (§2.10 warnings)", () => {
  it("($ ) — wrong arity (only $ head) produces warning, falls back to list", () => {
    const { tree, warnings } = parse("($ )");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain("Malformed hole");
    expect(warnings[0]!.message).toContain("element(s)");
    // Falls back to a normal list
    expect(tree.root.children[0]!.kind).toBe("list");
  });

  it("($ freq) — wrong arity (missing type) produces warning", () => {
    const { tree, warnings } = parse("($ freq)");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain("Malformed hole");
    expect(warnings[0]!.message).toContain("element(s)");
    expect(tree.root.children[0]!.kind).toBe("list");
  });

  it("($ freq :number extra) — too many children produces warning", () => {
    const { tree, warnings } = parse("($ freq :number extra)");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain("Malformed hole");
    expect(warnings[0]!.message).toContain("4 element(s)");
    expect(tree.root.children[0]!.kind).toBe("list");
  });

  it("($ 42 :number) — numeric name produces warning", () => {
    const { tree, warnings } = parse("($ 42 :number)");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain("name must be a symbol");
    expect(warnings[0]!.message).toContain("number");
    expect(tree.root.children[0]!.kind).toBe("list");
  });

  it('($ :foo :number) — keyword name produces warning', () => {
    const { tree, warnings } = parse("($ :foo :number)");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain("name must be a symbol");
    expect(tree.root.children[0]!.kind).toBe("list");
  });

  it("($ freq number) — non-keyword type produces warning", () => {
    const { tree, warnings } = parse("($ freq number)");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain("type must be a keyword");
    expect(tree.root.children[0]!.kind).toBe("list");
  });

  it("($ freq :invalid) — unknown type value produces warning", () => {
    const { tree, warnings } = parse("($ freq :invalid)");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain("unknown type");
    expect(warnings[0]!.message).toContain(":invalid");
    expect(tree.root.children[0]!.kind).toBe("list");
  });

  it("warnings include correct source range", () => {
    const { warnings } = parse("abc ($ freq) def");
    expect(warnings).toHaveLength(1);
    // The malformed hole is at positions 4..12
    expect(warnings[0]!.from).toBe(4);
    expect(warnings[0]!.to).toBe(12);
  });
});

describe("hole recognition — non-hole lists are unaffected", () => {
  it("(foo bar baz) parses as a normal list", () => {
    const { tree, warnings } = parse("(foo bar baz)");
    expect(warnings).toHaveLength(0);
    expect(tree.root.children[0]!.kind).toBe("list");
  });

  it("(a $ b) — $ in non-head position is not a hole pattern", () => {
    const { tree, warnings } = parse("(a $ b)");
    expect(warnings).toHaveLength(0);
    expect(tree.root.children[0]!.kind).toBe("list");
  });

  it("[$ freq :number] — vector is not hole-eligible (only lists)", () => {
    const { tree, warnings } = parse("[$ freq :number]");
    expect(warnings).toHaveLength(0);
    expect(tree.root.children[0]!.kind).toBe("vector");
  });

  it("empty list () is not a hole", () => {
    const { tree, warnings } = parse("()");
    expect(warnings).toHaveLength(0);
    expect(tree.root.children[0]!.kind).toBe("list");
  });
});
