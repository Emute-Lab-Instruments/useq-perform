// Pure atom manipulation operations (atom-manipulation.md §2-§5).
// These operate on source text representations of leaf nodes.

import { cycleSymbol, cycleKeyword, type CycleResult } from "./cycleGroups.ts";

// ─── Number adjustment (§2.2) ───────────────────────────────────────────────

export type AdjustResult =
  | { readonly kind: "adjusted"; readonly newText: string }
  | { readonly kind: "no-op"; readonly reason: string };

/**
 * Adjust a number literal by its precision-derived step.
 * Preserves decimal formatting (trailing zeros, precision).
 */
export function adjustNumber(text: string, direction: 1 | -1): AdjustResult {
  const trimmed = text.trim();
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return { kind: "no-op", reason: "not-a-number" };

  const dotIndex = trimmed.indexOf(".");
  let step: number;
  let decimalPlaces: number;

  if (dotIndex === -1) {
    // Integer: step = 1
    step = 1;
    decimalPlaces = 0;
  } else {
    // Float: step = 10^-(decimal_places)
    decimalPlaces = trimmed.length - dotIndex - 1;
    step = Math.pow(10, -decimalPlaces);
  }

  const newValue = num + step * direction;

  // Format preserving trailing zeros (§2.2.4)
  let newText: string;
  if (decimalPlaces === 0) {
    newText = String(Math.round(newValue));
  } else {
    newText = newValue.toFixed(decimalPlaces);
  }

  // Preserve leading whitespace from original
  const leadMatch = text.match(/^(\s*)/);
  const trailMatch = text.match(/(\s*)$/);
  const leading = leadMatch ? leadMatch[1] : "";
  const trailing = trailMatch ? trailMatch[1] : "";

  return { kind: "adjusted", newText: leading + newText + trailing };
}

// ─── Boolean toggle (§2.3) ──────────────────────────────────────────────────

export function toggleBoolean(text: string): AdjustResult {
  const trimmed = text.trim();
  if (trimmed === "true") return { kind: "adjusted", newText: "false" };
  if (trimmed === "false") return { kind: "adjusted", newText: "true" };
  return { kind: "no-op", reason: "not-a-boolean" };
}

// ─── Polarity flip (§5) ─────────────────────────────────────────────────────

export function flipPolarity(text: string): AdjustResult {
  const trimmed = text.trim();
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return { kind: "no-op", reason: "not-a-number" };
  if (num === 0) return { kind: "no-op", reason: "zero" };

  let newText: string;
  if (trimmed.startsWith("-")) {
    // Negative → positive: strip leading minus
    newText = trimmed.slice(1);
  } else {
    // Positive → negative: prepend minus
    newText = "-" + trimmed;
  }

  return { kind: "adjusted", newText };
}

// ─── Symbol / keyword cycling (§3) ──────────────────────────────────────────

export type AtomCycleResult =
  | { readonly kind: "cycled"; readonly newText: string; readonly groupId: string; readonly index: number; readonly members: readonly string[] }
  | { readonly kind: "no-op"; readonly reason: string };

export function cycleAtom(text: string, nodeKind: "symbol" | "keyword", direction: 1 | -1): AtomCycleResult {
  const trimmed = text.trim();

  let result: CycleResult;
  if (nodeKind === "symbol") {
    result = cycleSymbol(trimmed, direction);
  } else {
    result = cycleKeyword(trimmed, direction);
  }

  if (result.kind === "no-group") {
    return { kind: "no-op", reason: "not-in-cycle-group" };
  }

  return {
    kind: "cycled",
    newText: result.newValue,
    groupId: result.groupId,
    index: result.index,
    members: result.members,
  };
}

// ─── Dispatch helper (§2.1) ─────────────────────────────────────────────────

export type AtomAdjustResult =
  | { readonly kind: "adjusted"; readonly newText: string }
  | { readonly kind: "cycled"; readonly newText: string; readonly groupId: string; readonly index: number; readonly members: readonly string[] }
  | { readonly kind: "no-op"; readonly reason: string };

/**
 * Top-level dispatch for LB/RB atom adjustment.
 * Determines action from node kind and text content.
 */
export function atomAdjust(
  text: string,
  nodeKind: string,
  direction: 1 | -1,
): AtomAdjustResult {
  switch (nodeKind) {
    case "number": {
      const r = adjustNumber(text, direction);
      return r.kind === "adjusted"
        ? { kind: "adjusted", newText: r.newText }
        : { kind: "no-op", reason: r.reason };
    }
    case "symbol": {
      // Check boolean first (true/false are symbols in ModuLisp)
      const boolResult = toggleBoolean(text);
      if (boolResult.kind === "adjusted") {
        return { kind: "adjusted", newText: boolResult.newText };
      }
      return cycleAtom(text, "symbol", direction);
    }
    case "keyword":
      return cycleAtom(text, "keyword", direction);
    default:
      return { kind: "no-op", reason: "unsupported-kind" };
  }
}
