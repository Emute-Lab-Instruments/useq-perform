/**
 * Print a core Node back to ModuLisp source text.
 *
 * Round-2 strategy (per task brief): whole-form re-render. We do NOT preserve
 * original whitespace, line breaks, or comments inside the printed range —
 * the caller replaces the entire source range of a top-level form with the
 * printed string. Whitespace fidelity is explicitly out of scope.
 *
 * Output uses single spaces between siblings; compounds with multiple
 * children get a single trailing space removed. No indentation. The user is
 * expected to reformat manually if they care about layout — round-3 work.
 */

import type { Node } from "../core/index.ts";

export function printNode(n: Node): string {
  switch (n.kind) {
    case "document":
      return n.children.map(printNode).join("\n");
    case "symbol":
    case "number":
    case "keyword":
    case "string":
      return n.text;
    case "hole":
      // Holes are deferred for rendering. Print as ($ name :type) so the
      // user can at least see them as text. This is a placeholder; not the
      // final hole syntax (see docs/specs/structural-editing.md §2.9).
      return `($ ${n.name} :${n.holeType})`;
    case "list":
      return `(${n.children.map(printNode).join(" ")})`;
    case "vector":
      return `[${n.children.map(printNode).join(" ")}]`;
    case "map":
      return `{${n.children.map(printNode).join(" ")}}`;
    case "set":
      return `#{${n.children.map(printNode).join(" ")}}`;
  }
}
