/**
 * Hole detection utilities for the per-form eval gate.
 *
 * A hole in source is written as `($ name :type)`. This module detects
 * hole patterns via regex and provides position information for diagnostic
 * emission. See docs/specs/structural-editing.md §2.9.
 */

/**
 * Pattern matching a hole in source: `($ ` followed by whitespace.
 * Global flag for repeated matching to find all hole positions.
 */
const HOLE_PATTERN = /\(\$\s/g;

/**
 * Find all hole start positions within a code string.
 * Returns character offsets relative to the start of the string.
 */
export function findHolePositions(code: string): number[] {
  const positions: number[] = [];
  HOLE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HOLE_PATTERN.exec(code)) !== null) {
    positions.push(match.index);
  }
  return positions;
}

/**
 * Find the end of a hole form starting at a given position.
 * Scans forward for the matching closing paren.
 */
export function findHoleEnd(code: string, start: number): number {
  let depth = 0;
  for (let i = start; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  // If unmatched, return end of string
  return code.length;
}

/**
 * Check whether a code string contains any holes.
 */
export function containsHoles(code: string): boolean {
  HOLE_PATTERN.lastIndex = 0;
  return HOLE_PATTERN.test(code);
}
