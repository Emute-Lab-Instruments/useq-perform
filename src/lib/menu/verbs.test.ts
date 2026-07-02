// src/lib/menu/verbs.test.ts
//
// Comprehensive coverage for the four apply verbs in `verbs.ts`:
// Insert, Replace, WrapWith, Call. Tests build minimal Tree fixtures by
// hand and assert tree shape + landing cursor (never serialised text).
//
// Matrix: each verb × each item kind × each meaningful handedness, plus
// the documented edge cases (doc-root target, hole target, all-holes-
// filled function, snippet-stub `no-template`, `'both'` handedness).
//
// Bead: useq-perform-4zt.69.25.
//
// References:
//   - docs/specs/radial-menu.md §5 (verb semantics)
//   - docs/specs/radial-menu.md §5.4 (first-hole-or-form cursor rule)
//   - src/lib/menu/verbs.ts (the implementations under test)

import { describe, it, expect, beforeEach } from "vitest";

import {
  applyVerb,
  applyInsert,
  applyReplace,
  applyWrapWith,
  applyCall,
  type ApplyResult,
} from "./verbs";
import type {
  FunctionItem,
  Handedness,
  ItemId,
  LiteralItem,
  MenuItem,
  SnippetItem,
  SnippetTemplate,
  SymbolItem,
} from "./types";
import {
  __resetIdCounterForTests,
  defaultIdGen,
  nodeCursor,
  singleCursor,
  type CursorSet,
  type DocumentNode,
  type IdGen,
  type Tree,
} from "../../editors/extensions/structure/core/types";
import {
  doc,
  hole,
  list,
  num,
  sym,
} from "../../editors/extensions/structure/core/__tests__/builders";

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

/**
 * Per-test scratch space. `ids` mints deterministic ids (`n1`, `n2`, …) so
 * tests can refer to specific node ids when convenient. The id counter is
 * reset before every test in a `beforeEach`.
 */
let ids: IdGen;

beforeEach(() => {
  __resetIdCounterForTests();
  ids = defaultIdGen();
});

/** Build a `CursorSet` whose primary is a node cursor on `id`. */
function cursorOn(id: string): CursorSet {
  return singleCursor(nodeCursor(id));
}

/** Wrap a `DocumentNode` as a `Tree`. */
function asTree(root: DocumentNode): Tree {
  return { root };
}

/** Assert success and return the success branch (narrowing helper). */
function assertOk(
  r: ApplyResult,
): Extract<ApplyResult, { ok: true }> {
  if (!r.ok) {
    throw new Error(`expected ok ApplyResult, got reason=${r.reason}`);
  }
  return r;
}

// ---- Item builders ---------------------------------------------------------

let itemSeq = 0;
function nextId(): ItemId {
  itemSeq += 1;
  return `item-${itemSeq}` as ItemId;
}

beforeEach(() => {
  itemSeq = 0;
});

function fnItem(
  head: string,
  signature: ReadonlyArray<{ name: string; type: "number" | "symbol" | "keyword" | "expr" | "string" }> = [],
): FunctionItem {
  return {
    kind: "function",
    id: nextId(),
    label: head,
    head,
    signature,
  };
}

function symItem(text: string): SymbolItem {
  return { kind: "symbol", id: nextId(), label: text, text };
}

function numLit(n: number): LiteralItem {
  return {
    kind: "literal",
    id: nextId(),
    label: String(n),
    literal: n,
    literalKind: "number",
  };
}

function boolLit(b: boolean): LiteralItem {
  return {
    kind: "literal",
    id: nextId(),
    label: String(b),
    literal: b,
    literalKind: "boolean",
  };
}

function kwLit(name: string): LiteralItem {
  return {
    kind: "literal",
    id: nextId(),
    label: name,
    literal: name,
    literalKind: "keyword",
  };
}

function snippet(): SnippetItem {
  // The template is opaque at this layer; the verbs short-circuit before
  // touching it (see C2 follow-up note in verbs.ts).
  return {
    kind: "snippet",
    id: nextId(),
    label: "stub",
    template: { __brand: "SnippetTemplate" } as SnippetTemplate,
  };
}

// ---------------------------------------------------------------------------
// applyInsert (§5.1.1)
// ---------------------------------------------------------------------------

describe("applyInsert", () => {
  // -- function items -------------------------------------------------------

  it("function · left: inserts a new (head h) before the target as a sibling", () => {
    // Doc: (foo)  cursor on foo  →  Insert (slow ($ rate :number)) left
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const item = fnItem("slow", [{ name: "rate", type: "number" }]);

    const r = assertOk(
      applyInsert(asTree(root), cursorOn(foo.id), item, "left", ids),
    );

    // The outer list now has 2 children: the inserted form, then foo.
    const outerList = r.tree.root.children[0];
    if (outerList.kind !== "list") throw new Error("expected list");
    expect(outerList.children).toHaveLength(2);
    const inserted = outerList.children[0];
    if (inserted.kind !== "list") throw new Error("expected inserted list");
    expect(inserted.children).toHaveLength(2); // (slow <hole>)
    expect(inserted.children[0].kind).toBe("symbol");
    expect(inserted.children[1].kind).toBe("hole");
    // Cursor lands on the first hole.
    expect(r.cursorSet.primary.kind).toBe("node");
    if (r.cursorSet.primary.kind === "node") {
      expect(r.cursorSet.primary.target).toBe(inserted.children[1].id);
    }
    // The original target is still present and unmodified.
    expect(outerList.children[1].id).toBe(foo.id);
  });

  it("function · right: inserts as sibling-after", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const item = fnItem("bar", []); // no signature → (bar)

    const r = assertOk(
      applyInsert(asTree(root), cursorOn(foo.id), item, "right", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    expect(outer.children[0].id).toBe(foo.id);
    expect(outer.children[1].kind).toBe("list");
    // No holes → cursor lands on the inserted form itself.
    if (r.cursorSet.primary.kind === "node") {
      expect(r.cursorSet.primary.target).toBe(outer.children[1].id);
    }
  });

  it("function · both: returns unsupported-combination", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const r = applyInsert(
      asTree(root),
      cursorOn(foo.id),
      fnItem("slow"),
      "both",
      ids,
    );
    expect(r).toEqual({ ok: false, reason: "unsupported-combination" });
  });

  // -- symbol items ---------------------------------------------------------

  it("symbol · left: inserts a bare symbol leaf before the target", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const r = assertOk(
      applyInsert(asTree(root), cursorOn(foo.id), symItem("x"), "left", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    expect(outer.children).toHaveLength(2);
    expect(outer.children[0].kind).toBe("symbol");
    if (outer.children[0].kind === "symbol") {
      expect(outer.children[0].text).toBe("x");
    }
    // No holes → cursor on the inserted symbol.
    if (r.cursorSet.primary.kind === "node") {
      expect(r.cursorSet.primary.target).toBe(outer.children[0].id);
    }
  });

  it("symbol · right: inserts after", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const r = assertOk(
      applyInsert(asTree(root), cursorOn(foo.id), symItem("y"), "right", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    expect(outer.children[0].id).toBe(foo.id);
    expect(outer.children[1].kind).toBe("symbol");
  });

  // -- literal items --------------------------------------------------------

  it("literal · number · left: inserts a number leaf with stringified text", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const r = assertOk(
      applyInsert(asTree(root), cursorOn(foo.id), numLit(42), "left", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    const inserted = outer.children[0];
    expect(inserted.kind).toBe("number");
    if (inserted.kind === "number") {
      expect(inserted.text).toBe("42");
    }
  });

  it("literal · boolean · right: inserts a symbol leaf (true/false are bare symbols)", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const r = assertOk(
      applyInsert(asTree(root), cursorOn(foo.id), boolLit(true), "right", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    const inserted = outer.children[1];
    expect(inserted.kind).toBe("symbol");
    if (inserted.kind === "symbol") {
      expect(inserted.text).toBe("true");
    }
  });

  it("literal · keyword: prepends a colon if absent", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const r = assertOk(
      applyInsert(asTree(root), cursorOn(foo.id), kwLit("freq"), "left", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    const inserted = outer.children[0];
    expect(inserted.kind).toBe("keyword");
    if (inserted.kind === "keyword") {
      expect(inserted.text).toBe(":freq");
    }
  });

  it("literal · keyword: preserves an explicit colon prefix", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const r = assertOk(
      applyInsert(asTree(root), cursorOn(foo.id), kwLit(":already"), "left", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    const inserted = outer.children[0];
    if (inserted.kind === "keyword") {
      expect(inserted.text).toBe(":already");
    }
  });

  // -- snippet items --------------------------------------------------------

  it("snippet: returns no-template (C2 deferral)", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const r = applyInsert(asTree(root), cursorOn(foo.id), snippet(), "left", ids);
    expect(r).toEqual({ ok: false, reason: "no-template" });
  });

  // -- doc-root target ------------------------------------------------------

  it("doc-root · function · right: appends to top-level children regardless of hand", () => {
    const a = sym("a", ids);
    const root = doc(ids, a);
    const item = fnItem("foo", []);
    const r = assertOk(
      applyInsert(asTree(root), cursorOn(root.id), item, "right", ids),
    );
    expect(r.tree.root.children).toHaveLength(2);
    expect(r.tree.root.children[0].id).toBe(a.id);
    expect(r.tree.root.children[1].kind).toBe("list");
  });

  it("doc-root · function · left: ignores handedness and appends (per §5.1.1)", () => {
    const a = sym("a", ids);
    const root = doc(ids, a);
    const r = assertOk(
      applyInsert(asTree(root), cursorOn(root.id), fnItem("foo", []), "left", ids),
    );
    // Doc-root special case: appended last regardless of `'left'`.
    expect(r.tree.root.children).toHaveLength(2);
    expect(r.tree.root.children[0].id).toBe(a.id);
  });

  it("doc-root · symbol: also appends as sibling at top level", () => {
    const root = doc(ids); // empty doc
    const r = assertOk(
      applyInsert(asTree(root), cursorOn(root.id), symItem("x"), "right", ids),
    );
    expect(r.tree.root.children).toHaveLength(1);
    expect(r.tree.root.children[0].kind).toBe("symbol");
  });

  // -- empty-compound target ------------------------------------------------

  it("empty compound · symbol: inserts inside the empty form (() + x → (x))", () => {
    // Halo on an empty list `()`; there is no sibling context, so Insert
    // seeds the form rather than appending a top-level sibling.
    const emptyList = list(ids);
    const root = doc(ids, emptyList);
    const r = assertOk(
      applyInsert(asTree(root), cursorOn(emptyList.id), symItem("x"), "right", ids),
    );
    expect(r.tree.root.children).toHaveLength(1);
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    expect(outer.children).toHaveLength(1);
    expect(outer.children[0].kind).toBe("symbol");
    // Cursor lands on the inserted symbol (no holes in a bare symbol).
    expect(r.cursorSet.primary).toEqual({
      kind: "node",
      target: outer.children[0].id,
    });
  });

  it("empty compound · left hand: still seeds inside (handedness moot when empty)", () => {
    const emptyVec = list(ids); // list builder; kind is 'list' — shape parity
    const root = doc(ids, emptyVec);
    const r = assertOk(
      applyInsert(asTree(root), cursorOn(emptyVec.id), symItem("y"), "left", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    expect(outer.children).toHaveLength(1);
    expect(outer.children[0].kind).toBe("symbol");
    // No stray top-level sibling was appended.
    expect(r.tree.root.children).toHaveLength(1);
  });

  // -- hole target ----------------------------------------------------------

  it("hole target · symbol · left: inserts as sibling of the hole (does not fill it)", () => {
    // (foo <h>) cursor on h
    const h = hole("a", "expr", ids);
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo, h));
    const r = assertOk(
      applyInsert(asTree(root), cursorOn(h.id), symItem("x"), "left", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    // (foo x <h>) — x is at index 1, h is at index 2.
    expect(outer.children).toHaveLength(3);
    expect(outer.children[1].kind).toBe("symbol");
    expect(outer.children[2].id).toBe(h.id);
  });

  // -- invalid-target cases -------------------------------------------------

  it("returns invalid-target if the cursor target is not in the tree", () => {
    const root = doc(ids, sym("a", ids));
    const r = applyInsert(
      asTree(root),
      cursorOn("nonexistent"),
      symItem("x"),
      "left",
      ids,
    );
    expect(r).toEqual({ ok: false, reason: "invalid-target" });
  });
});

// ---------------------------------------------------------------------------
// applyReplace (§5.1.2)
// ---------------------------------------------------------------------------

describe("applyReplace", () => {
  it("function · left: replaces target with (head h…)", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const item = fnItem("slow", [{ name: "r", type: "number" }]);
    const r = assertOk(
      applyReplace(asTree(root), cursorOn(foo.id), item, "left", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    // foo replaced by (slow <hole>)
    expect(outer.children).toHaveLength(1);
    const replaced = outer.children[0];
    if (replaced.kind !== "list") throw new Error("expected list");
    expect(replaced.children).toHaveLength(2);
    // Cursor lands on the first hole inside the replacement.
    if (r.cursorSet.primary.kind === "node") {
      expect(r.cursorSet.primary.target).toBe(replaced.children[1].id);
    }
  });

  it("function · right: behaves identically to left (handedness reserved)", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const item = fnItem("inc", []);
    const r = assertOk(
      applyReplace(asTree(root), cursorOn(foo.id), item, "right", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    expect(outer.children[0].kind).toBe("list");
    // No holes → cursor lands on the form itself.
    if (r.cursorSet.primary.kind === "node") {
      expect(r.cursorSet.primary.target).toBe(outer.children[0].id);
    }
  });

  it("symbol: replaces target with bare symbol leaf", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const r = assertOk(
      applyReplace(asTree(root), cursorOn(foo.id), symItem("y"), "left", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    expect(outer.children).toHaveLength(1);
    expect(outer.children[0].kind).toBe("symbol");
    if (outer.children[0].kind === "symbol") {
      expect(outer.children[0].text).toBe("y");
    }
  });

  it("literal · number: replaces with number leaf", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const r = assertOk(
      applyReplace(asTree(root), cursorOn(foo.id), numLit(7), "left", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    expect(outer.children[0].kind).toBe("number");
  });

  it("snippet: returns no-template", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const r = applyReplace(
      asTree(root),
      cursorOn(foo.id),
      snippet(),
      "left",
      ids,
    );
    expect(r).toEqual({ ok: false, reason: "no-template" });
  });

  it("both: returns unsupported-combination", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const r = applyReplace(
      asTree(root),
      cursorOn(foo.id),
      symItem("x"),
      "both",
      ids,
    );
    expect(r).toEqual({ ok: false, reason: "unsupported-combination" });
  });

  it("doc-root target: returns invalid-target (conservative §5.1.2)", () => {
    const root = doc(ids, sym("a", ids));
    const r = applyReplace(
      asTree(root),
      cursorOn(root.id),
      fnItem("foo"),
      "left",
      ids,
    );
    expect(r).toEqual({ ok: false, reason: "invalid-target" });
  });

  it("hole target: replaces the hole wholesale (typed-hole semantics still apply at edit layer)", () => {
    const h = hole("a", "expr", ids);
    const root = doc(ids, list(ids, h));
    const r = assertOk(
      applyReplace(asTree(root), cursorOn(h.id), numLit(3), "left", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    expect(outer.children[0].kind).toBe("number");
  });

  it("returns invalid-target if the cursor target is not in the tree", () => {
    const root = doc(ids, sym("a", ids));
    const r = applyReplace(
      asTree(root),
      cursorOn("nope"),
      symItem("x"),
      "left",
      ids,
    );
    expect(r).toEqual({ ok: false, reason: "invalid-target" });
  });
});

// ---------------------------------------------------------------------------
// applyWrapWith (§5.1.3)
// ---------------------------------------------------------------------------

describe("applyWrapWith", () => {
  it("function · left: target becomes the FIRST hole's slot in the wrapper", () => {
    // (foo) cursor on foo
    // Wrap with (slow ($ rate :number) ($ body :expr))
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const item = fnItem("slow", [
      { name: "rate", type: "number" },
      { name: "body", type: "expr" },
    ]);
    const r = assertOk(
      applyWrapWith(asTree(root), cursorOn(foo.id), item, "left", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    const wrapper = outer.children[0];
    if (wrapper.kind !== "list") throw new Error("expected wrapper list");
    // Wrapper: (slow foo <body-hole>) — head, target (filling first hole), then remaining hole.
    expect(wrapper.children).toHaveLength(3);
    expect(wrapper.children[0].kind).toBe("symbol");
    if (wrapper.children[0].kind === "symbol") {
      expect(wrapper.children[0].text).toBe("slow");
    }
    expect(wrapper.children[1].id).toBe(foo.id);
    expect(wrapper.children[2].kind).toBe("hole");
    // Cursor lands on the remaining hole.
    if (r.cursorSet.primary.kind === "node") {
      expect(r.cursorSet.primary.target).toBe(wrapper.children[2].id);
    }
  });

  it("function · right: target becomes the LAST hole's slot in the wrapper", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const item = fnItem("slow", [
      { name: "rate", type: "number" },
      { name: "body", type: "expr" },
    ]);
    const r = assertOk(
      applyWrapWith(asTree(root), cursorOn(foo.id), item, "right", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    const wrapper = outer.children[0];
    if (wrapper.kind !== "list") throw new Error("expected wrapper list");
    // (slow <rate-hole> foo)
    expect(wrapper.children).toHaveLength(3);
    expect(wrapper.children[1].kind).toBe("hole");
    expect(wrapper.children[2].id).toBe(foo.id);
    // Cursor lands on the remaining hole (the rate hole at index 1).
    if (r.cursorSet.primary.kind === "node") {
      expect(r.cursorSet.primary.target).toBe(wrapper.children[1].id);
    }
  });

  it("function · single-hole signature: target consumes the only hole; cursor lands on the wrapper itself", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const item = fnItem("not", [{ name: "x", type: "expr" }]);
    const r = assertOk(
      applyWrapWith(asTree(root), cursorOn(foo.id), item, "left", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    const wrapper = outer.children[0];
    if (wrapper.kind !== "list") throw new Error("expected wrapper list");
    // (not foo) — head + target only, no remaining holes.
    expect(wrapper.children).toHaveLength(2);
    expect(wrapper.children[1].id).toBe(foo.id);
    // No holes left → cursor lands on the wrapper.
    if (r.cursorSet.primary.kind === "node") {
      expect(r.cursorSet.primary.target).toBe(wrapper.id);
    }
  });

  it("function · empty signature: returns no-template (no slot for the target)", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const r = applyWrapWith(
      asTree(root),
      cursorOn(foo.id),
      fnItem("noop", []),
      "left",
      ids,
    );
    expect(r).toEqual({ ok: false, reason: "no-template" });
  });

  it("symbol: returns unsupported-combination", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const r = applyWrapWith(
      asTree(root),
      cursorOn(foo.id),
      symItem("x"),
      "left",
      ids,
    );
    expect(r).toEqual({ ok: false, reason: "unsupported-combination" });
  });

  it("literal: returns unsupported-combination", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const r = applyWrapWith(
      asTree(root),
      cursorOn(foo.id),
      numLit(1),
      "left",
      ids,
    );
    expect(r).toEqual({ ok: false, reason: "unsupported-combination" });
  });

  it("snippet: returns no-template", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const r = applyWrapWith(
      asTree(root),
      cursorOn(foo.id),
      snippet(),
      "left",
      ids,
    );
    expect(r).toEqual({ ok: false, reason: "no-template" });
  });

  it("both: returns unsupported-combination (precedes kind check)", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const r = applyWrapWith(
      asTree(root),
      cursorOn(foo.id),
      fnItem("slow", [{ name: "r", type: "number" }]),
      "both",
      ids,
    );
    expect(r).toEqual({ ok: false, reason: "unsupported-combination" });
  });

  it("doc-root target: returns invalid-target", () => {
    const root = doc(ids, sym("a", ids));
    const r = applyWrapWith(
      asTree(root),
      cursorOn(root.id),
      fnItem("slow", [{ name: "x", type: "expr" }]),
      "left",
      ids,
    );
    expect(r).toEqual({ ok: false, reason: "invalid-target" });
  });

  it("hole target: wraps the hole as a child of the new wrapper", () => {
    // (foo <h>) cursor on h. Wrap the hole with (slow $rate $body) left.
    const h = hole("a", "expr", ids);
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo, h));
    const item = fnItem("slow", [
      { name: "rate", type: "number" },
      { name: "body", type: "expr" },
    ]);
    const r = assertOk(
      applyWrapWith(asTree(root), cursorOn(h.id), item, "left", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    // Outer: (foo (slow <h> <body-hole>))
    const wrapper = outer.children[1];
    if (wrapper.kind !== "list") throw new Error("expected wrapper");
    expect(wrapper.children[1].id).toBe(h.id);
    expect(wrapper.children[2].kind).toBe("hole");
  });

  it("returns invalid-target if the cursor target is not in the tree", () => {
    const root = doc(ids, sym("a", ids));
    const r = applyWrapWith(
      asTree(root),
      cursorOn("nope"),
      fnItem("slow", [{ name: "x", type: "expr" }]),
      "left",
      ids,
    );
    expect(r).toEqual({ ok: false, reason: "invalid-target" });
  });
});

// ---------------------------------------------------------------------------
// applyCall (§5.1.4)
// ---------------------------------------------------------------------------

describe("applyCall", () => {
  it("function · left: target is the first arg; remaining holes are sig[1..]", () => {
    // (42) cursor on 42. Call with (mul ($ a :number) ($ b :number)) left.
    const fortytwo = num("42", ids);
    const root = doc(ids, list(ids, fortytwo));
    const item = fnItem("mul", [
      { name: "a", type: "number" },
      { name: "b", type: "number" },
    ]);
    const r = assertOk(
      applyCall(asTree(root), cursorOn(fortytwo.id), item, "left", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    const callForm = outer.children[0];
    if (callForm.kind !== "list") throw new Error("expected call form");
    // (mul 42 <b-hole>)
    expect(callForm.children).toHaveLength(3);
    expect(callForm.children[0].kind).toBe("symbol");
    expect(callForm.children[1].id).toBe(fortytwo.id);
    expect(callForm.children[2].kind).toBe("hole");
    // Cursor lands on the remaining hole.
    if (r.cursorSet.primary.kind === "node") {
      expect(r.cursorSet.primary.target).toBe(callForm.children[2].id);
    }
  });

  it("function · right: target is the last arg; remaining holes are sig[0..N-2]", () => {
    const fortytwo = num("42", ids);
    const root = doc(ids, list(ids, fortytwo));
    const item = fnItem("mul", [
      { name: "a", type: "number" },
      { name: "b", type: "number" },
    ]);
    const r = assertOk(
      applyCall(asTree(root), cursorOn(fortytwo.id), item, "right", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    const callForm = outer.children[0];
    if (callForm.kind !== "list") throw new Error("expected call form");
    // (mul <a-hole> 42)
    expect(callForm.children).toHaveLength(3);
    expect(callForm.children[1].kind).toBe("hole");
    expect(callForm.children[2].id).toBe(fortytwo.id);
  });

  it("function · no signature: produces (head target); identical for either hand", () => {
    const a = sym("a", ids);
    const root = doc(ids, list(ids, a));
    const item = fnItem("identity", []);
    const r = assertOk(
      applyCall(asTree(root), cursorOn(a.id), item, "left", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    const callForm = outer.children[0];
    if (callForm.kind !== "list") throw new Error("expected call form");
    expect(callForm.children).toHaveLength(2);
    expect(callForm.children[1].id).toBe(a.id);
    // No holes → cursor on the call form.
    if (r.cursorSet.primary.kind === "node") {
      expect(r.cursorSet.primary.target).toBe(callForm.id);
    }
  });

  it("function · single-hole signature: target consumes the slot (no extra holes)", () => {
    // Discovered while reading verbs.ts: when sig.length === 1 the
    // `drop` slice is empty for both hands, so the form is (head target)
    // either way — handedness becomes a visual no-op here.
    const a = sym("a", ids);
    const root = doc(ids, list(ids, a));
    const item = fnItem("not", [{ name: "x", type: "expr" }]);
    const r = assertOk(
      applyCall(asTree(root), cursorOn(a.id), item, "right", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    const callForm = outer.children[0];
    if (callForm.kind !== "list") throw new Error("expected call form");
    expect(callForm.children).toHaveLength(2);
    expect(callForm.children[1].id).toBe(a.id);
  });

  it("symbol · left: builds (head target) using item.text as the head", () => {
    const a = sym("a", ids);
    const root = doc(ids, list(ids, a));
    const r = assertOk(
      applyCall(asTree(root), cursorOn(a.id), symItem("inc"), "left", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    const callForm = outer.children[0];
    if (callForm.kind !== "list") throw new Error("expected call form");
    expect(callForm.children).toHaveLength(2);
    if (callForm.children[0].kind === "symbol") {
      expect(callForm.children[0].text).toBe("inc");
    }
    expect(callForm.children[1].id).toBe(a.id);
  });

  it("symbol · right: also builds (head target) — symbols have no signature", () => {
    const a = sym("a", ids);
    const root = doc(ids, list(ids, a));
    const r = assertOk(
      applyCall(asTree(root), cursorOn(a.id), symItem("inc"), "right", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    const callForm = outer.children[0];
    if (callForm.kind !== "list") throw new Error("expected call form");
    expect(callForm.children[1].id).toBe(a.id);
  });

  it("literal: returns unsupported-combination", () => {
    const a = sym("a", ids);
    const root = doc(ids, list(ids, a));
    const r = applyCall(
      asTree(root),
      cursorOn(a.id),
      numLit(1),
      "left",
      ids,
    );
    expect(r).toEqual({ ok: false, reason: "unsupported-combination" });
  });

  it("snippet: returns unsupported-combination", () => {
    const a = sym("a", ids);
    const root = doc(ids, list(ids, a));
    const r = applyCall(
      asTree(root),
      cursorOn(a.id),
      snippet(),
      "left",
      ids,
    );
    expect(r).toEqual({ ok: false, reason: "unsupported-combination" });
  });

  it("both: returns unsupported-combination", () => {
    const a = sym("a", ids);
    const root = doc(ids, list(ids, a));
    const r = applyCall(
      asTree(root),
      cursorOn(a.id),
      fnItem("foo"),
      "both",
      ids,
    );
    expect(r).toEqual({ ok: false, reason: "unsupported-combination" });
  });

  it("doc-root target: returns invalid-target", () => {
    const root = doc(ids, sym("a", ids));
    const r = applyCall(
      asTree(root),
      cursorOn(root.id),
      fnItem("slow", [{ name: "x", type: "expr" }]),
      "left",
      ids,
    );
    expect(r).toEqual({ ok: false, reason: "invalid-target" });
  });

  it("hole target: wraps the hole as the call's argument", () => {
    // Discovered: Call with a hole as target produces e.g. (inc <hole>).
    // The hole is a valid AddressableNode, so it survives as a child of
    // the freshly-minted call form.
    const h = hole("a", "expr", ids);
    const root = doc(ids, list(ids, h));
    const r = assertOk(
      applyCall(asTree(root), cursorOn(h.id), symItem("inc"), "left", ids),
    );
    const outer = r.tree.root.children[0];
    if (outer.kind !== "list") throw new Error("expected list");
    const callForm = outer.children[0];
    if (callForm.kind !== "list") throw new Error("expected call form");
    expect(callForm.children[1].id).toBe(h.id);
  });

  it("returns invalid-target if the cursor target is not in the tree", () => {
    const root = doc(ids, sym("a", ids));
    const r = applyCall(
      asTree(root),
      cursorOn("nope"),
      symItem("inc"),
      "left",
      ids,
    );
    expect(r).toEqual({ ok: false, reason: "invalid-target" });
  });
});

// ---------------------------------------------------------------------------
// applyVerb dispatch entry point
// ---------------------------------------------------------------------------

describe("applyVerb dispatch", () => {
  it("dispatches verb.kind === 'insert' to applyInsert", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const r = applyVerb({
      tree: asTree(root),
      cursorSet: cursorOn(foo.id),
      item: symItem("x"),
      verb: { kind: "insert", hand: "left" },
      ids,
    });
    // Insert success: outer list now has 2 children.
    expect(r.ok).toBe(true);
    if (r.ok) {
      const outer = r.tree.root.children[0];
      if (outer.kind !== "list") throw new Error("expected list");
      expect(outer.children).toHaveLength(2);
    }
  });

  it("dispatches verb.kind === 'replace' to applyReplace", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const r = applyVerb({
      tree: asTree(root),
      cursorSet: cursorOn(foo.id),
      item: symItem("y"),
      verb: { kind: "replace", hand: "left" },
      ids,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const outer = r.tree.root.children[0];
      if (outer.kind !== "list") throw new Error("expected list");
      // Replace: target replaced wholesale, so still 1 child but new identity.
      expect(outer.children).toHaveLength(1);
      expect(outer.children[0].id).not.toBe(foo.id);
    }
  });

  it("dispatches verb.kind === 'wrapWith' to applyWrapWith", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const item = fnItem("slow", [{ name: "x", type: "expr" }]);
    const r = applyVerb({
      tree: asTree(root),
      cursorSet: cursorOn(foo.id),
      item,
      verb: { kind: "wrapWith", hand: "left" },
      ids,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const outer = r.tree.root.children[0];
      if (outer.kind !== "list") throw new Error("expected list");
      const wrapper = outer.children[0];
      if (wrapper.kind !== "list") throw new Error("expected wrapper");
      expect(wrapper.children[1].id).toBe(foo.id);
    }
  });

  it("dispatches verb.kind === 'call' to applyCall", () => {
    const a = sym("a", ids);
    const root = doc(ids, list(ids, a));
    const r = applyVerb({
      tree: asTree(root),
      cursorSet: cursorOn(a.id),
      item: symItem("inc"),
      verb: { kind: "call", hand: "left" },
      ids,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const outer = r.tree.root.children[0];
      if (outer.kind !== "list") throw new Error("expected list");
      const callForm = outer.children[0];
      if (callForm.kind !== "list") throw new Error("expected call form");
      expect(callForm.children).toHaveLength(2);
      expect(callForm.children[1].id).toBe(a.id);
    }
  });

  it("propagates the dispatched verb's hand parameter (right insert vs left insert)", () => {
    const foo = sym("foo", ids);
    const root = doc(ids, list(ids, foo));
    const right = applyVerb({
      tree: asTree(root),
      cursorSet: cursorOn(foo.id),
      item: symItem("x"),
      verb: { kind: "insert", hand: "right" },
      ids,
    });
    expect(right.ok).toBe(true);
    if (right.ok) {
      const outer = right.tree.root.children[0];
      if (outer.kind !== "list") throw new Error("expected list");
      // Right: foo first, then inserted symbol.
      expect(outer.children[0].id).toBe(foo.id);
      expect(outer.children[1].kind).toBe("symbol");
    }
  });
});
