/**
 * Print a core Node back to ModuLisp source text.
 *
 * Current: flat single-line output (single spaces between siblings, no
 * indentation). This is a placeholder — the target behaviour is defined in
 * docs/specs/formatting.md §3 (width + complexity thresholds, arg-aligned
 * breaking, do-block rules, recursive layout).
 */

import type { Meta, Node } from "../core/index.ts";
import type { LiveEditMetaPayload } from "./treeFromLezer.ts";

/**
 * Format keyword args from a LiveEditMetaPayload back to source text.
 * Produces strings like ` :id "abc" :min 0 :max 1`. Returns empty string
 * when no keyword args are present.
 */
function formatLiveEditArgs(payload: LiveEditMetaPayload): string {
  const parts: string[] = [];
  if (payload.id !== undefined) parts.push(`:id "${payload.id}"`);
  if (payload.name !== undefined) parts.push(`:name "${payload.name}"`);
  if (payload.min !== undefined) parts.push(`:min ${payload.min}`);
  if (payload.max !== undefined) parts.push(`:max ${payload.max}`);
  if (payload.step !== undefined) parts.push(`:step ${payload.step}`);
  if (payload.precision !== undefined)
    parts.push(`:precision ${payload.precision}`);
  if (payload.options !== undefined && payload.options.length > 0)
    parts.push(`:options [${payload.options.map((o) => `:${o}`).join(" ")}]`);
  return parts.length > 0 ? " " + parts.join(" ") : "";
}

/**
 * Wrap printed text with any Meta wrappers present on the node.
 * Innermost Meta wraps first (index 0), outermost last. This matches the
 * stack order defined in §6.1.
 */
function wrapWithMetas(
  text: string,
  metas: ReadonlyArray<Meta>,
): string {
  let result = text;
  for (const meta of metas) {
    if (meta.kind === "live-edit") {
      const args = formatLiveEditArgs(
        meta.payload as LiveEditMetaPayload,
      );
      result = `(live-edit ${result}${args})`;
    }
    // Other Meta kinds can be added here later.
  }
  return result;
}

export function printNode(n: Node): string {
  switch (n.kind) {
    case "document":
      return n.children.map(printNode).join("\n");
    case "symbol":
    case "number":
    case "keyword":
    case "string":
      return wrapWithMetas(n.text, n.metas);
    case "hole":
      // Holes are deferred for rendering. Print as ($ name :type) so the
      // user can at least see them as text. This is a placeholder; not the
      // final hole syntax (see docs/specs/structural-editing.md §2.9).
      // Holes always have empty metas (§2.9.6), but wrap just in case.
      return wrapWithMetas(`($ ${n.name} :${n.holeType})`, n.metas);
    case "list":
      return wrapWithMetas(
        `(${n.children.map(printNode).join(" ")})`,
        n.metas,
      );
    case "vector":
      return wrapWithMetas(
        `[${n.children.map(printNode).join(" ")}]`,
        n.metas,
      );
    case "map":
      return wrapWithMetas(
        `{${n.children.map(printNode).join(" ")}}`,
        n.metas,
      );
    case "set":
      return wrapWithMetas(
        `#{${n.children.map(printNode).join(" ")}}`,
        n.metas,
      );
  }
}
