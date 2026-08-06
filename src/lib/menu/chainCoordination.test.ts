import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetIdCounterForTests,
  defaultIdGen,
  nodeCursor,
  singleCursor,
  type IdGen,
  type Tree,
} from "../../editors/extensions/structure/core/types";
import { doc, hole, sym } from "../../editors/extensions/structure/core/__tests__/builders";
import type { Manifest } from "./types";
import { postVerbMenuInputs } from "./chainCoordination";

describe("post-verb menu coordination", () => {
  let ids: IdGen;

  beforeEach(() => {
    __resetIdCounterForTests();
    ids = defaultIdGen();
  });

  it("always closes when the committed cursor is not on a hole", () => {
    const node = sym("x", ids);
    const tree: Tree = { root: doc(ids, node) };

    expect(postVerbMenuInputs(tree, singleCursor(nodeCursor(node.id)), null)).toEqual([
      { kind: "cancel" },
    ]);
  });

  it("closes then reopens at a committed hole when a manifest is available", () => {
    const node = hole("rate", "number", ids);
    const tree: Tree = { root: doc(ids, node) };
    const manifest = { tabs: [] } as unknown as Manifest;

    const inputs = postVerbMenuInputs(tree, singleCursor(nodeCursor(node.id)), manifest);

    expect(inputs[0]).toEqual({ kind: "cancel" });
    expect(inputs[1]).toMatchObject({ kind: "open", manifest });
  });
});
