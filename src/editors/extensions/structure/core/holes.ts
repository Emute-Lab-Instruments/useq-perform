/**
 * Hole helpers (§2.9).
 *
 * Holes are first-class structural nodes (§2.9.6 — they are NOT Metas).
 * Atomic per §2.9.2: structural ops treat them as single units; their
 * `name` and `holeType` are not addressable.
 */

import type { HoleNode, HoleType, IdGen, Node, NodeId } from "./types.ts";

/** Create a fresh hole leaf. Holes are never Meta-bearing (§2.9.6). */
export function makeHole(
  name: string,
  holeType: HoleType,
  ids: IdGen,
): HoleNode {
  return {
    id: ids.next(),
    kind: "hole",
    metas: [],
    name,
    holeType,
  };
}

/** True iff `n` is a hole leaf. */
export function isHole(n: Node): n is HoleNode {
  return n.kind === "hole";
}

/** True iff `t` is a valid hole type per §2.9. */
export function isHoleType(t: string): t is HoleType {
  return (
    t === "number" ||
    t === "symbol" ||
    t === "keyword" ||
    t === "expr" ||
    t === "string"
  );
}

/**
 * Visit every hole in document order under `root`, depth-first. Returns the
 * holes in the order they appear. Used by `nav.nextHole` / `nav.prevHole`
 * (§5.1.8) and by `edit.fillHole` cursor placement (§5.2.11).
 */
export function findHolesInOrder(root: Node): ReadonlyArray<HoleNode> {
  const out: HoleNode[] = [];
  const walk = (n: Node): void => {
    if (n.kind === "hole") {
      out.push(n);
      return;
    }
    if (
      n.kind === "list" ||
      n.kind === "vector" ||
      n.kind === "map" ||
      n.kind === "set" ||
      n.kind === "document"
    ) {
      for (const c of n.children) walk(c);
    }
  };
  walk(root);
  return out;
}

/**
 * Match the hole's `holeType` against a payload kind. Lightweight check; not
 * an exhaustive type system. Used by `edit.fillHole` to flag ill-typed
 * fills (caller may still proceed; this returns a hint).
 */
export function holeAcceptsKind(
  h: HoleNode,
  kind: Node["kind"],
): boolean {
  switch (h.holeType) {
    case "number":
      return kind === "number";
    case "symbol":
      return kind === "symbol";
    case "keyword":
      return kind === "keyword";
    case "string":
      return kind === "string";
    case "expr":
      // any addressable form satisfies an expr hole; document is invalid here.
      return kind !== "document";
  }
}
