/**
 * Meta serialization/parse round-trip (§6.5 Meta preservation, §7.4(c)).
 *
 * `printTree.wrapWithMetas` serializes Metas to prefix sigils (`'`, `` ` ``,
 * `~`, `~@`, `@`) and `^X` metadata. `treeFromLezer.trySigilMeta` must be the
 * inverse, recognizing those surfaces and folding them into Meta-bearing
 * hosts. This test pins the parse side and the print→parse round-trip so the
 * two cannot drift back apart.
 *
 * `ignore` (`#_`) is intentionally NOT covered: the clojure grammar lists
 * `Discard` in `@skip`, so ignore-forms are dropped from the parse tree and
 * cannot be recovered. See `SIGIL_META_KINDS` in treeFromLezer.ts.
 */

import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
// @ts-expect-error — clojure-mode has no type declarations
import { default_extensions } from "@nextjournal/clojure-mode";

import { treeFromLezer } from "../treeFromLezer.ts";
import { printNode } from "../printTree.ts";
import type { Node } from "../../core/index.ts";

function parse(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [...default_extensions],
  });
  return treeFromLezer(state);
}

function only(doc: string): Node {
  const { tree, warnings } = parse(doc);
  expect(warnings).toHaveLength(0);
  expect(tree.root.children).toHaveLength(1);
  return tree.root.children[0]!;
}

describe("sigil Meta recognition (§6.2) — parse side", () => {
  const cases: Array<[string, string, string]> = [
    ["quote", "'foo", "foo"],
    ["syntax-quote", "`foo", "foo"],
    ["unquote", "~foo", "foo"],
    ["unquote-splicing", "~@foo", "foo"],
    ["deref", "@foo", "foo"],
  ];

  for (const [kind, src, hostText] of cases) {
    it(`${src} folds to a host with a ${kind} Meta`, () => {
      const node = only(src);
      expect(node.kind).toBe("symbol");
      expect(node.metas).toHaveLength(1);
      expect(node.metas[0]!.kind).toBe(kind);
      if (node.kind === "symbol") expect(node.text).toBe(hostText);
    });
  }

  it("'(a b) folds the quoted list, not its children", () => {
    const node = only("'(a b)");
    expect(node.kind).toBe("list");
    expect(node.metas).toHaveLength(1);
    expect(node.metas[0]!.kind).toBe("quote");
    if (node.kind === "list") {
      expect(node.children).toHaveLength(2);
      expect(node.children.every((c) => c.metas.length === 0)).toBe(true);
    }
  });

  it("^:dynamic x folds to host x with a metadata Meta carrying the payload", () => {
    const node = only("^:dynamic x");
    expect(node.kind).toBe("symbol");
    expect(node.metas).toHaveLength(1);
    expect(node.metas[0]!.kind).toBe("metadata");
    expect(node.metas[0]!.payload).toBe(":dynamic");
  });
});

describe("Meta round-trip: parse(print(parse(src))) is stable", () => {
  const sources = ["'foo", "`foo", "~foo", "~@foo", "@foo", "^:dynamic x", "'(a b)"];

  for (const src of sources) {
    it(`${src} preserves its Meta through a print→reparse cycle`, () => {
      const first = only(src);
      const printed = printNode(first);
      const second = only(printed);
      expect(second.metas.map((m) => m.kind)).toEqual(
        first.metas.map((m) => m.kind),
      );
    });
  }
});

describe("non-sigil forms are unaffected", () => {
  it("plain symbol has no Metas", () => {
    const node = only("foo");
    expect(node.metas).toHaveLength(0);
  });

  it("true/false/nil are symbols with no Meta (booleans are symbols, §2.1)", () => {
    for (const src of ["true", "false", "nil"]) {
      const node = only(src);
      expect(node.kind).toBe("symbol");
      expect(node.metas).toHaveLength(0);
    }
  });
});
