/**
 * Meta operations tests (§6.6).
 */
import { beforeEach, describe, expect, it } from "vitest";

import { defaultIdGen, __resetIdCounterForTests } from "../types.ts";
import { metaAdd, metaRemove, metaCycle, metaFoldToggle, DEFAULT_META_CYCLE } from "../meta.ts";
import type { MetaFoldToggleResult } from "../meta.ts";
import {
  doc,
  list,
  listWithMetas,
  num,
  pp,
  stateOn,
  sym,
  hole,
} from "./builders.ts";
import { nodeCursor, singleCursor } from "../types.ts";
import type { Meta, State } from "../types.ts";
import { findById } from "../traversal.ts";

// ─── Helpers ───────────────────────────────────────────────────────────────

function setup() {
  __resetIdCounterForTests();
  const ids = defaultIdGen();
  return { ids };
}

// ─── meta.add ──────────────────────────────────────────────────────────────

describe("meta.add", () => {
  it("adds an ignore meta to a leaf node", () => {
    const { ids } = setup();
    const a = sym("a", ids);
    const root = doc(ids, a);
    const state = stateOn(root, a.id);

    const r = metaAdd("ignore")(state);
    expect(r.noOps).toEqual([]);

    const node = findById(r.state.tree.root, a.id);
    expect(node).not.toBeNull();
    expect(node!.kind).toBe("symbol");
    if (node!.kind !== "document") {
      expect(node!.metas).toEqual([{ kind: "ignore", payload: undefined }]);
    }
  });

  it("adds a meta to the outermost position (end of array)", () => {
    const { ids } = setup();
    const existingMetas: Meta[] = [{ kind: "quote", payload: undefined }];
    const a = sym("a", ids, existingMetas);
    const root = doc(ids, a);
    const state = stateOn(root, a.id);

    const r = metaAdd("ignore")(state);
    expect(r.noOps).toEqual([]);

    const node = findById(r.state.tree.root, a.id);
    if (node!.kind !== "document") {
      expect(node!.metas).toEqual([
        { kind: "quote", payload: undefined },
        { kind: "ignore", payload: undefined },
      ]);
    }
  });

  it("adds a meta to a compound node", () => {
    const { ids } = setup();
    const lst = list(ids, sym("a", ids));
    const root = doc(ids, lst);
    const state = stateOn(root, lst.id);

    const r = metaAdd("ignore")(state);
    expect(r.noOps).toEqual([]);
    expect(pp(r.state.tree.root)).toBe("<ignore>(a)");
  });

  it("is a no-op on a hole (§2.9.6)", () => {
    const { ids } = setup();
    const h = hole("x", "expr", ids);
    const root = doc(ids, h);
    const state = stateOn(root, h.id);

    const r = metaAdd("ignore")(state);
    expect(r.noOps[0]?.reason).toBe("on-leaf");
  });

  it("is a no-op on the document root", () => {
    const { ids } = setup();
    const a = sym("a", ids);
    const root = doc(ids, a);
    const state = stateOn(root, root.id);

    const r = metaAdd("ignore")(state);
    expect(r.noOps[0]?.reason).toBe("at-document-root");
  });

  it("cursor stays on the same node after adding meta", () => {
    const { ids } = setup();
    const a = sym("a", ids);
    const root = doc(ids, a);
    const state = stateOn(root, a.id);

    const r = metaAdd("ignore")(state);
    expect(r.state.cursors.primary).toEqual(nodeCursor(a.id));
  });

  it("supports custom payload", () => {
    const { ids } = setup();
    const a = sym("a", ids);
    const root = doc(ids, a);
    const state = stateOn(root, a.id);

    const r = metaAdd("metadata", { type: "tag" })(state);
    const node = findById(r.state.tree.root, a.id);
    if (node!.kind !== "document") {
      expect(node!.metas[0]).toEqual({ kind: "metadata", payload: { type: "tag" } });
    }
  });
});

// ─── meta.remove ───────────────────────────────────────────────────────────

describe("meta.remove", () => {
  it("removes the outermost meta from a node", () => {
    const { ids } = setup();
    const metas: Meta[] = [
      { kind: "quote", payload: undefined },
      { kind: "ignore", payload: undefined },
    ];
    const a = sym("a", ids, metas);
    const root = doc(ids, a);
    const state = stateOn(root, a.id);

    const r = metaRemove(state);
    expect(r.noOps).toEqual([]);

    const node = findById(r.state.tree.root, a.id);
    if (node!.kind !== "document") {
      expect(node!.metas).toEqual([{ kind: "quote", payload: undefined }]);
    }
  });

  it("removes the only meta from a node", () => {
    const { ids } = setup();
    const metas: Meta[] = [{ kind: "ignore", payload: undefined }];
    const a = sym("a", ids, metas);
    const root = doc(ids, a);
    const state = stateOn(root, a.id);

    const r = metaRemove(state);
    expect(r.noOps).toEqual([]);

    const node = findById(r.state.tree.root, a.id);
    if (node!.kind !== "document") {
      expect(node!.metas).toEqual([]);
    }
  });

  it("is a no-op when node has no metas", () => {
    const { ids } = setup();
    const a = sym("a", ids);
    const root = doc(ids, a);
    const state = stateOn(root, a.id);

    const r = metaRemove(state);
    expect(r.noOps[0]?.reason).toBe("no-meta");
  });

  it("is a no-op on the document root", () => {
    const { ids } = setup();
    const root = doc(ids, sym("a", ids));
    const state = stateOn(root, root.id);

    const r = metaRemove(state);
    expect(r.noOps[0]?.reason).toBe("at-document-root");
  });

  it("removes outermost meta from a compound node", () => {
    const { ids } = setup();
    const metas: Meta[] = [{ kind: "ignore", payload: undefined }];
    const lst = listWithMetas(ids, metas, sym("a", ids));
    const root = doc(ids, lst);
    const state = stateOn(root, lst.id);

    const r = metaRemove(state);
    expect(r.noOps).toEqual([]);
    expect(pp(r.state.tree.root)).toBe("(a)");
  });
});

// ─── meta.cycle ────────────────────────────────────────────────────────────

describe("meta.cycle", () => {
  it("adds first cycle kind when node has no metas", () => {
    const { ids } = setup();
    const a = sym("a", ids);
    const root = doc(ids, a);
    const state = stateOn(root, a.id);

    const r = metaCycle()(state);
    expect(r.noOps).toEqual([]);

    const node = findById(r.state.tree.root, a.id);
    if (node!.kind !== "document") {
      expect(node!.metas).toEqual([{ kind: "quote", payload: undefined }]);
    }
  });

  it("advances from quote to unquote", () => {
    const { ids } = setup();
    const metas: Meta[] = [{ kind: "quote", payload: undefined }];
    const a = sym("a", ids, metas);
    const root = doc(ids, a);
    const state = stateOn(root, a.id);

    const r = metaCycle()(state);
    expect(r.noOps).toEqual([]);

    const node = findById(r.state.tree.root, a.id);
    if (node!.kind !== "document") {
      expect(node!.metas).toEqual([{ kind: "unquote", payload: undefined }]);
    }
  });

  it("removes meta at end of cycle (unquote -> off)", () => {
    const { ids } = setup();
    const metas: Meta[] = [{ kind: "unquote", payload: undefined }];
    const a = sym("a", ids, metas);
    const root = doc(ids, a);
    const state = stateOn(root, a.id);

    const r = metaCycle()(state);
    expect(r.noOps).toEqual([]);

    const node = findById(r.state.tree.root, a.id);
    if (node!.kind !== "document") {
      expect(node!.metas).toEqual([]);
    }
  });

  it("replaces unknown outermost kind with first cycle kind", () => {
    const { ids } = setup();
    const metas: Meta[] = [{ kind: "debug", payload: undefined }];
    const a = sym("a", ids, metas);
    const root = doc(ids, a);
    const state = stateOn(root, a.id);

    const r = metaCycle()(state);
    expect(r.noOps).toEqual([]);

    const node = findById(r.state.tree.root, a.id);
    if (node!.kind !== "document") {
      expect(node!.metas).toEqual([{ kind: "quote", payload: undefined }]);
    }
  });

  it("supports custom cycle", () => {
    const { ids } = setup();
    const metas: Meta[] = [{ kind: "ignore", payload: undefined }];
    const a = sym("a", ids, metas);
    const root = doc(ids, a);
    const state = stateOn(root, a.id);

    const customCycle = ["ignore", "debug"];
    const r = metaCycle(customCycle)(state);
    expect(r.noOps).toEqual([]);

    const node = findById(r.state.tree.root, a.id);
    if (node!.kind !== "document") {
      expect(node!.metas).toEqual([{ kind: "debug", payload: undefined }]);
    }
  });

  it("preserves inner metas while cycling the outermost", () => {
    const { ids } = setup();
    const metas: Meta[] = [
      { kind: "metadata", payload: "tag" },
      { kind: "quote", payload: undefined },
    ];
    const a = sym("a", ids, metas);
    const root = doc(ids, a);
    const state = stateOn(root, a.id);

    const r = metaCycle()(state);
    expect(r.noOps).toEqual([]);

    const node = findById(r.state.tree.root, a.id);
    if (node!.kind !== "document") {
      expect(node!.metas).toEqual([
        { kind: "metadata", payload: "tag" },
        { kind: "unquote", payload: undefined },
      ]);
    }
  });

  it("is a no-op on a hole", () => {
    const { ids } = setup();
    const h = hole("x", "expr", ids);
    const root = doc(ids, h);
    const state = stateOn(root, h.id);

    const r = metaCycle()(state);
    expect(r.noOps[0]?.reason).toBe("on-leaf");
  });
});

// ─── meta.foldToggle ───────────────────────────────────────────────────────

describe("meta.foldToggle", () => {
  it("returns the node id for toggling when node has metas", () => {
    const { ids } = setup();
    const metas: Meta[] = [{ kind: "ignore", payload: undefined }];
    const a = sym("a", ids, metas);
    const root = doc(ids, a);
    const state = stateOn(root, a.id);

    const r = metaFoldToggle(state) as MetaFoldToggleResult;
    expect(r.noOps).toEqual([]);
    expect(r.toggledNodes).toEqual([a.id]);
    // Tree is unchanged (display-only op)
    expect(r.state).toBe(state);
  });

  it("is a no-op when node has no metas", () => {
    const { ids } = setup();
    const a = sym("a", ids);
    const root = doc(ids, a);
    const state = stateOn(root, a.id);

    const r = metaFoldToggle(state) as MetaFoldToggleResult;
    expect(r.noOps[0]?.reason).toBe("no-meta");
    expect(r.toggledNodes).toEqual([]);
  });

  it("is a no-op on document root", () => {
    const { ids } = setup();
    const root = doc(ids, sym("a", ids));
    const state = stateOn(root, root.id);

    const r = metaFoldToggle(state) as MetaFoldToggleResult;
    expect(r.noOps[0]?.reason).toBe("at-document-root");
    expect(r.toggledNodes).toEqual([]);
  });

  it("does not mutate the tree", () => {
    const { ids } = setup();
    const metas: Meta[] = [{ kind: "quote", payload: undefined }];
    const a = sym("a", ids, metas);
    const root = doc(ids, a);
    const state = stateOn(root, a.id);

    const r = metaFoldToggle(state) as MetaFoldToggleResult;
    expect(r.state.tree).toBe(state.tree);
  });
});
