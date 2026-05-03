import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
// @ts-expect-error — clojure-mode has no type declarations
import { default_extensions } from "@nextjournal/clojure-mode";

import { childrenOf, type Node } from "../../core/index.ts";
import { treeFromLezer, type IdIndex } from "../treeFromLezer.ts";

function parse(doc: string) {
  return treeFromLezer(EditorState.create({
    doc,
    extensions: [...default_extensions],
  }));
}

function expectChildRangesInsideParents(node: Node, idIndex: IdIndex): number {
  const range = idIndex.get(node.id);
  expect(range).toBeDefined();

  let count = 1;
  for (const child of childrenOf(node)) {
    const childRange = idIndex.get(child.id);
    expect(childRange).toBeDefined();
    expect(childRange!.from).toBeGreaterThanOrEqual(range!.from);
    expect(childRange!.to).toBeLessThanOrEqual(range!.to);
    count += expectChildRangesInsideParents(child, idIndex);
  }
  return count;
}

describe("treeFromLezer malformed range handling", () => {
  it("does not attach malformed set error nodes outside the parent range", () => {
    const { tree, idIndex } = parse("\"\" #]} ");
    const visited = expectChildRangesInsideParents(tree.root, idIndex);
    expect(idIndex.size).toBe(visited);
  });
});
