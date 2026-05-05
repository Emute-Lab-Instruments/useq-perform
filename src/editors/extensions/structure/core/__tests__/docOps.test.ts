/**
 * Tests for document-root bulk operations (§5.3).
 */
import { beforeEach, describe, expect, it } from "vitest";

import { __resetIdCounterForTests, defaultIdGen } from "../types.ts";
import { docDeleteAll, docSelectAll } from "../docOps.ts";
import { doc, list, num, pp, stateOn, sym } from "./builders.ts";
import { nodeCursor, singleCursor } from "../types.ts";

function setup() {
  __resetIdCounterForTests();
  const ids = defaultIdGen();
  return { ids };
}

// ─── doc.deleteAll ────────────────────────────────────────────────────────────

describe("doc.deleteAll", () => {
  it("clears all children and puts cursor on document root", () => {
    const { ids } = setup();
    const a = sym("a", ids);
    const b = num("42", ids);
    const root = doc(ids, a, b);
    const state = stateOn(root, a.id);

    const result = docDeleteAll(state);

    expect(result.noOps).toEqual([]);
    expect(result.state.tree.root.children).toEqual([]);
    expect(result.state.tree.root.id).toBe(root.id);
    expect(result.state.cursors.primary).toEqual(nodeCursor(root.id));
    expect(result.state.cursors.secondaries).toEqual([]);
  });

  it("works when cursor is on a nested node", () => {
    const { ids } = setup();
    const inner = sym("x", ids);
    const outer = list(ids, inner);
    const root = doc(ids, outer);
    const state = stateOn(root, inner.id);

    const result = docDeleteAll(state);

    expect(result.state.tree.root.children).toEqual([]);
    expect(result.state.cursors.primary).toEqual(nodeCursor(root.id));
  });

  it("is a no-op (returns root cursor) when document is already empty", () => {
    const { ids } = setup();
    const root = doc(ids);
    const state = stateOn(root, root.id);

    const result = docDeleteAll(state);

    expect(result.noOps).toEqual([]);
    expect(result.state.tree.root.children).toEqual([]);
    expect(result.state.cursors.primary).toEqual(nodeCursor(root.id));
  });
});

// ─── doc.selectAll ────────────────────────────────────────────────────────────

describe("doc.selectAll", () => {
  it("places cursor on document root without changing tree", () => {
    const { ids } = setup();
    const a = sym("a", ids);
    const b = sym("b", ids);
    const root = doc(ids, a, b);
    const state = stateOn(root, a.id);

    const result = docSelectAll(state);

    expect(result.noOps).toEqual([]);
    expect(result.state.tree).toBe(state.tree); // tree identity preserved
    expect(result.state.cursors.primary).toEqual(nodeCursor(root.id));
    expect(result.state.cursors.secondaries).toEqual([]);
  });

  it("collapses multi-cursor to single cursor on root", () => {
    const { ids } = setup();
    const a = sym("a", ids);
    const b = sym("b", ids);
    const root = doc(ids, a, b);
    const state = {
      tree: { root },
      cursors: {
        primary: nodeCursor(a.id),
        secondaries: [nodeCursor(b.id)],
      },
    };

    const result = docSelectAll(state);

    expect(result.state.cursors.primary).toEqual(nodeCursor(root.id));
    expect(result.state.cursors.secondaries).toEqual([]);
  });

  it("is idempotent when cursor is already on root", () => {
    const { ids } = setup();
    const root = doc(ids, sym("a", ids));
    const state = stateOn(root, root.id);

    const result = docSelectAll(state);

    expect(result.state.tree).toBe(state.tree);
    expect(result.state.cursors.primary).toEqual(nodeCursor(root.id));
  });
});
