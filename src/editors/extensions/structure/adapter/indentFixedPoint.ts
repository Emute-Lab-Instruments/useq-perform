/**
 * "Press Tab repeatedly until nothing changes."
 *
 * One of several experimental auto-format strategies (see
 * docs/specs/formatting.md §2.6, §7). Operates on a character range of the
 * current document: walks each line, asks CodeMirror's indent service for the
 * target indent, replaces the leading whitespace where it disagrees. Iterates
 * until a pass produces no changes (or we hit the safety cap).
 *
 * Rationale for iteration: `indentRange` already threads computed indents
 * forward via `overrideIndentation` and usually converges in a single pass,
 * but pathological cases (deeply mis-indented blocks where a later line's
 * target depends on a column derived from an as-yet-unfixed earlier line) can
 * need a second pass. The cap is a safety net, not a tuning knob.
 *
 * No CodeMirror-internal trickery: this just dispatches transactions whose
 * `changes` come from `indentRange`. Cursor mapping, undo, autosave, etc. all
 * work normally.
 */

import { indentRange } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";

const MAX_ITERATIONS = 16;

/**
 * Re-indent every line whose start falls inside [from, to] to its target
 * indent, iterating until stable. Returns true iff any whitespace was changed.
 *
 * `from` / `to` are mapped forward through each iteration's changes, so the
 * range stays anchored to the same content even as line lengths shift.
 */
export function indentRangeToFixedPoint(
  view: EditorView,
  from: number,
  to: number,
): boolean {
  let dispatched = false;
  let lo = from;
  let hi = to;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const changes = indentRange(view.state, lo, hi);
    if (changes.empty) return dispatched;
    view.dispatch({
      changes,
      userEvent: "format.indentFixedPoint",
    });
    lo = changes.mapPos(lo, -1);
    hi = changes.mapPos(hi, 1);
    dispatched = true;
  }
  return dispatched;
}
