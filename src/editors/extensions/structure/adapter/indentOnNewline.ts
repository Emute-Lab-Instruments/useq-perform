/**
 * Re-trigger the fixed-point indenter on newline edits.
 *
 * Companion to `indentFixedPoint.ts`. The fixed-point pass runs after
 * structural mutations (see `applyOp.ts`) and via the explicit
 * `format.indentToFixedPoint` action. This extension closes the remaining gap:
 * plain typing that inserts/removes/replaces a `\n` — Enter to break a form
 * across lines, Backspace-join, multi-line paste — leaves indentation stale
 * because no structural op fires and CodeMirror's `insertNewline` doesn't
 * indent on its own.
 *
 * Fires on every newline-bearing change regardless of `autoFormatStrategy`.
 * That setting controls *post-mutation* reformatting; plain typing is a
 * separate concern and indent on Enter is always wanted. Re-indents the union
 * of post-change line ranges containing a newline insertion or deletion.
 *
 * Guards:
 *   - Skips its own dispatches via the `format.indentFixedPoint` userEvent.
 *   - Skips `structure.mutate` transactions — `applyOp` already handles those
 *     when the strategy is `"indent-fixed-point"`.
 *
 * Dispatch timing: `view.dispatch` is not safe to call directly from an
 * `updateListener` (per CodeMirror docs), so the re-indent is scheduled via
 * `queueMicrotask` to run after the current update completes.
 */

import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

import { indentRangeToFixedPoint } from "./indentFixedPoint.ts";

export const indentOnNewlineChange: Extension = EditorView.updateListener.of(
  (u) => {
    if (!u.docChanged) return;

    for (const tr of u.transactions) {
      if (
        tr.isUserEvent("format.indentFixedPoint") ||
        tr.isUserEvent("structure.mutate")
      ) {
        return;
      }
    }

    // Collect the post-change span covering every newline-bearing change.
    let lo = Infinity;
    let hi = -1;
    const oldDoc = u.startState.doc;
    u.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
      const insertedHasNewline = inserted.toString().includes("\n");
      const removedHasNewline =
        fromA < toA && oldDoc.sliceString(fromA, toA).includes("\n");
      if (!insertedHasNewline && !removedHasNewline) return;
      if (fromB < lo) lo = fromB;
      if (toB > hi) hi = toB;
    });
    if (hi < 0) return;

    // Snap to whole lines in the post-change doc, then defer the dispatch.
    const doc = u.state.doc;
    const fromLine = doc.lineAt(Math.min(lo, doc.length)).from;
    const toLine = doc.lineAt(Math.min(hi, doc.length)).to;
    const view = u.view;
    queueMicrotask(() => {
      indentRangeToFixedPoint(view, fromLine, toLine);
    });
  },
);
