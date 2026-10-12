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
import type { EditorState, ChangeSet } from "@codemirror/state";
import { setIntendedFocus, structField } from "./stateField.ts";
import { captureStructuralFocus } from "./cursorPath.ts";

const MAX_ITERATIONS = 16;

/**
 * Re-indent every line whose start falls inside [from, to] to its target
 * indent, iterating until stable. Returns true iff any whitespace was changed.
 *
 * `from` / `to` are mapped forward through each iteration's changes, so the
 * range stays anchored to the same content even as line lengths shift.
 */
export function planIndentation(state: EditorState, from: number, to: number): ChangeSet {
  let combined = state.changes([]);
  let draft = state;
  let lo = from;
  let hi = to;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const changes = indentRange(draft, lo, hi);
    if (changes.empty) break;
    combined = combined.compose(changes);
    draft = draft.update({ changes, filter: false }).state;
    lo = changes.mapPos(lo, -1);
    hi = changes.mapPos(hi, 1);
  }
  return combined;
}

export function indentRangeToFixedPoint(view: EditorView, from: number, to: number): boolean {
  const changes = planIndentation(view.state, from, to);
  if (changes.empty) return false;
  const structural = view.state.field(structField, false);
  view.dispatch({
    changes,
    filter: false,
    effects: structural ? setIntendedFocus.of(captureStructuralFocus(structural.state)) : [],
    userEvent: "format.indentFixedPoint",
  });
  return true;
}
