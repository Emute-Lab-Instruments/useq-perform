/**
 * Print a core Node back to ModuLisp source text.
 *
 * Two printers:
 *   - `printNode`: flat single-line output (single spaces, no indentation).
 *     Used when `format.autoFormatOnMutation = false` (§2.6).
 *   - `formatNode`: formatting-aware output per docs/specs/formatting.md §3.
 *     Width + complexity thresholds, arg-aligned or fixed-indent breaking,
 *     do-block rules, define body indent, recursive layout.
 *
 * Both are pure functions — no side effects, no CodeMirror dependency.
 */

import type { Meta, Node } from "../core/index.ts";
import type { LiveEditMetaPayload } from "./treeFromLezer.ts";
import type { FormatSettings } from "../../../../lib/settings/schema.ts";

// ─── Shared helpers ──────────────────────────────────────────────────────────

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
    switch (meta.kind) {
      case "live-edit": {
        const args = formatLiveEditArgs(
          meta.payload as LiveEditMetaPayload,
        );
        result = `(live-edit ${result}${args})`;
        break;
      }
      case "ignore":
        result = `#_${result}`;
        break;
      case "quote":
        result = `'${result}`;
        break;
      case "unquote":
        result = `~${result}`;
        break;
      case "unquote-splicing":
        result = `~@${result}`;
        break;
      case "deref":
        result = `@${result}`;
        break;
      case "syntax-quote":
        result = `\`${result}`;
        break;
      case "metadata":
        result = `^${meta.payload != null ? String(meta.payload) + " " : ""}${result}`;
        break;
      // Unknown meta kinds: wrap as a named form (fallback)
      default:
        result = `(${meta.kind} ${result})`;
        break;
    }
  }
  return result;
}

// ─── Flat printer (no formatting) ────────────────────────────────────────────

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

// ─── Formatting-aware printer (§3) ──────────────────────────────────────────

/**
 * Compute structural weight of a node (§3.2).
 *
 * - Leaf: weight = 1
 * - Compound with only leaf children: weight = 2
 * - Compound with any compound child: weight = 2 + max(child weights)
 */
function weight(n: Node): number {
  switch (n.kind) {
    case "symbol":
    case "number":
    case "keyword":
    case "string":
    case "hole":
      return 1;
    case "document":
    case "list":
    case "vector":
    case "map":
    case "set": {
      if (n.children.length === 0) return 2;
      let maxChildWeight = 0;
      let hasCompoundChild = false;
      for (const child of n.children) {
        const w = weight(child);
        if (w > 1) hasCompoundChild = true;
        if (w > maxChildWeight) maxChildWeight = w;
      }
      return hasCompoundChild ? 2 + maxChildWeight : 2;
    }
  }
}

/**
 * Print a node flat (single line, no breaks) — used for measuring width.
 * Same as `printNode` but operates on the unwrapped host node when we need
 * to measure the host separately from its meta wrappers.
 */
function printFlat(n: Node): string {
  return printNode(n);
}

/** Check whether a list node's head symbol is the given name. */
function headSymbol(n: Node): string | null {
  if (n.kind === "list" && n.children.length > 0) {
    const head = n.children[0];
    if (head.kind === "symbol") return head.text;
  }
  return null;
}

/** Returns true if a node is a leaf (weight-1 atom). */
function isLeaf(n: Node): boolean {
  switch (n.kind) {
    case "symbol":
    case "number":
    case "keyword":
    case "string":
    case "hole":
      return true;
    default:
      return false;
  }
}

/**
 * Check whether a compound is a `do` block: a list whose head is `do` with
 * more than one child (the head itself doesn't count) — §3.5.
 */
function isDoBlock(n: Node): boolean {
  return n.kind === "list" && headSymbol(n) === "do" && n.children.length > 1;
}

/** Check whether a compound is a `define` form — §3.8. */
function isDefineForm(n: Node): boolean {
  return n.kind === "list" && headSymbol(n) === "define";
}

/**
 * Format a node with proper indentation per docs/specs/formatting.md §3.
 *
 * @param n      The node to format.
 * @param fmt    Format settings.
 * @param indent Current indentation column (0 for top-level).
 * @returns Formatted source text.
 */
function formatAtColumn(
  n: Node,
  fmt: FormatSettings,
  indent: number,
): string {
  switch (n.kind) {
    // Leaves — always single-line.
    case "symbol":
    case "number":
    case "keyword":
    case "string":
      return wrapWithMetas(n.text, n.metas);
    case "hole":
      return wrapWithMetas(`($ ${n.name} :${n.holeType})`, n.metas);

    // Document root: join children with newlines (§3 — inter-top-level
    // whitespace is sacred and handled by applyOp, not here).
    case "document":
      return n.children
        .map((child) => formatAtColumn(child, fmt, 0))
        .join("\n");

    // Compound nodes: list, vector, map, set.
    case "list":
      return wrapWithMetas(formatCompound(n, fmt, indent), n.metas);
    case "vector":
      return wrapWithMetas(formatBracketedCompound(n, "[", "]", fmt, indent), n.metas);
    case "map":
      return wrapWithMetas(formatBracketedCompound(n, "{", "}", fmt, indent), n.metas);
    case "set":
      return wrapWithMetas(formatBracketedCompound(n, "#{", "}", fmt, indent), n.metas);
  }
}

/**
 * Format a list node `(...)` — handles special forms (do, define) and
 * general arg-aligned or fixed-indent breaking.
 */
function formatCompound(
  n: Node & { kind: "list"; children: ReadonlyArray<Node> },
  fmt: FormatSettings,
  indent: number,
): string {
  const children = n.children;
  if (children.length === 0) return "()";

  // Try single-line first (§3.1).
  const flat = `(${children.map(printFlat).join(" ")})`;
  const availableWidth = fmt.lineWidth - indent;
  const maxChildWeight = maxWeight(children);

  if (
    flat.length <= availableWidth &&
    maxChildWeight < fmt.complexityThreshold &&
    !isDoBlock(n)
  ) {
    return flat;
  }

  // Must break. Determine strategy based on form type.

  // §3.5 — `do` blocks: always break with 2-space body indent.
  if (isDoBlock(n)) {
    return formatDoBlock(children, fmt, indent);
  }

  // §3.8 — `define` forms: body indent when value breaks.
  if (isDefineForm(n) && children.length >= 2) {
    return formatDefineForm(children, fmt, indent);
  }

  // General breaking (§3.3 / §3.4).
  const head = children[0];
  const args = children.slice(1);

  if (args.length === 0) {
    // Single-element list — no args to break.
    return `(${formatAtColumn(head, fmt, indent + 1)})`;
  }

  // §3.3 special case: head is itself a compound → use 2-space body indent.
  if (!isLeaf(head)) {
    return formatBodyIndent(children, fmt, indent);
  }

  // Determine indent style.
  if (fmt.indentStyle === "fixed") {
    return formatBodyIndent(children, fmt, indent);
  }

  // Arg-aligned indent: first arg on same line as head, rest aligned.
  const headText = formatAtColumn(head, fmt, indent + 1);
  // Column where args start = indent + "(" + headText + " "
  const argColumn = indent + 1 + headText.length + 1;

  // §3.4 — minimum available width floor: if arg-aligned would leave
  // fewer than minAvailableWidth chars, fall back to body indent.
  if (fmt.lineWidth - argColumn < fmt.minAvailableWidth) {
    return formatBodyIndent(children, fmt, indent);
  }

  // Arg-aligned layout.
  const argIndent = " ".repeat(argColumn);
  const formattedArgs = args.map((arg) =>
    formatAtColumn(arg, fmt, argColumn),
  );

  const lines = [`(${headText} ${formattedArgs[0]}`];
  for (let i = 1; i < formattedArgs.length; i++) {
    lines.push(`${argIndent}${formattedArgs[i]}`);
  }
  // Close paren on the last line.
  lines[lines.length - 1] += ")";

  return lines.join("\n");
}

/**
 * Format a `do` block — §3.5: children on separate lines with 2-space indent.
 * The `do` keyword is on the opening line by itself.
 */
function formatDoBlock(
  children: ReadonlyArray<Node>,
  fmt: FormatSettings,
  indent: number,
): string {
  // children[0] is the `do` symbol.
  const bodyIndent = indent + 2;
  const pad = " ".repeat(bodyIndent);

  const bodyParts = children.slice(1).map((child) =>
    formatAtColumn(child, fmt, bodyIndent),
  );

  const lines = ["(do"];
  for (const part of bodyParts) {
    lines.push(`${pad}${part}`);
  }
  // Close paren on the last body line.
  lines[lines.length - 1] += ")";

  return lines.join("\n");
}

/**
 * Format a `define` form — §3.8: name stays on first line with `define`.
 * Value gets body indent (2-space) when it breaks.
 */
function formatDefineForm(
  children: ReadonlyArray<Node>,
  fmt: FormatSettings,
  indent: number,
): string {
  // (define <name> <value> ...)
  const defineSym = children[0]; // the `define` symbol
  const name = children[1];

  const defineText = formatAtColumn(defineSym, fmt, indent + 1);
  const nameText = formatAtColumn(name, fmt, indent + 1 + defineText.length + 1);

  if (children.length === 2) {
    // No value — just (define name)
    return `(${defineText} ${nameText})`;
  }

  // Try single-line for the whole form.
  const flat = `(${children.map(printFlat).join(" ")})`;
  const availableWidth = fmt.lineWidth - indent;
  if (flat.length <= availableWidth && maxWeight(children) < fmt.complexityThreshold) {
    return flat;
  }

  // Value breaks: use 2-space body indent.
  const bodyIndent = indent + 2;
  const pad = " ".repeat(bodyIndent);
  const firstLine = `(${defineText} ${nameText}`;

  const values = children.slice(2);
  const formattedValues = values.map((v) =>
    formatAtColumn(v, fmt, bodyIndent),
  );

  const lines = [firstLine];
  for (const val of formattedValues) {
    lines.push(`${pad}${val}`);
  }
  lines[lines.length - 1] += ")";

  return lines.join("\n");
}

/**
 * Format with 2-space body indent — used as fallback when arg-alignment
 * would violate the minimum available width floor, when the head is a
 * compound, when indentStyle is "fixed", and for `define` value bodies.
 */
function formatBodyIndent(
  children: ReadonlyArray<Node>,
  fmt: FormatSettings,
  indent: number,
): string {
  const bodyIndent = indent + 2;
  const pad = " ".repeat(bodyIndent);

  const head = children[0];
  const headText = formatAtColumn(head, fmt, indent + 1);
  const args = children.slice(1);

  if (args.length === 0) {
    return `(${headText})`;
  }

  const formattedArgs = args.map((arg) =>
    formatAtColumn(arg, fmt, bodyIndent),
  );

  const lines = [`(${headText}`];
  for (const part of formattedArgs) {
    lines.push(`${pad}${part}`);
  }
  lines[lines.length - 1] += ")";

  return lines.join("\n");
}

/**
 * Format a bracketed compound (vector, map, set) — §3.6.
 * When breaking, uses 1-space indent from the opening bracket.
 */
function formatBracketedCompound(
  n: Node & { children: ReadonlyArray<Node> },
  open: string,
  close: string,
  fmt: FormatSettings,
  indent: number,
): string {
  const children = n.children;
  if (children.length === 0) return `${open}${close}`;

  // Try single-line first.
  const flat = `${open}${children.map(printFlat).join(" ")}${close}`;
  const availableWidth = fmt.lineWidth - indent;
  const maxChildW = maxWeight(children);

  if (flat.length <= availableWidth && maxChildW < fmt.complexityThreshold) {
    return flat;
  }

  // Break with 1-space indent from opening bracket.
  const childIndent = indent + open.length;
  const pad = " ".repeat(childIndent);

  const formattedChildren = children.map((child) =>
    formatAtColumn(child, fmt, childIndent),
  );

  const lines = [`${open}${formattedChildren[0]}`];
  for (let i = 1; i < formattedChildren.length; i++) {
    lines.push(`${pad}${formattedChildren[i]}`);
  }
  lines[lines.length - 1] += close;

  return lines.join("\n");
}

/** Compute the maximum weight across a list of nodes. */
function maxWeight(nodes: ReadonlyArray<Node>): number {
  let max = 0;
  for (const n of nodes) {
    const w = weight(n);
    if (w > max) max = w;
  }
  return max;
}

/**
 * Format a node using the formatting-aware printer (§3).
 *
 * This is the main entry point for the formatter. It takes a Node and
 * FormatSettings and returns properly formatted source text. Pure function
 * — no side effects, no CodeMirror dependency.
 *
 * The caller (applyOp) chooses between `printNode` (flat, for
 * autoFormatOnMutation=false) and `formatNode` (formatted, for
 * autoFormatOnMutation=true).
 */
export function formatNode(n: Node, fmt: FormatSettings): string {
  return formatAtColumn(n, fmt, 0);
}
