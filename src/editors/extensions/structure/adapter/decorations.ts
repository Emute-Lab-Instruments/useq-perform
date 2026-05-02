/**
 * Cursor-halo decorations for the structural-editing core.
 *
 * Paints a `Decoration.mark` over each cursor's source range, looked up via
 * the `idIndex` stored in the state field. Primary and secondary cursors
 * share a class for now (`cm-structuralCursor`); multi-cursor styling is a
 * round-3 concern.
 */

import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";

import type { Cursor } from "../core/index.ts";
import type { IdIndex, SourceRange } from "./treeFromLezer.ts";
import { structField } from "./stateField.ts";

const cursorMark = Decoration.mark({ class: "cm-structuralCursor" });
const cursorMarkPrimary = Decoration.mark({
  class: "cm-structuralCursor cm-structuralCursorPrimary",
});

function rangeForCursor(c: Cursor, idIndex: IdIndex): SourceRange | null {
  if (c.kind === "node") {
    return idIndex.get(c.target) ?? null;
  }
  // Range cursor: span from start to end via lookup in the idIndex (we
  // approximate by combining the two endpoints' ranges).
  const startR = idIndex.get(c.start);
  const endR = idIndex.get(c.end);
  if (!startR || !endR) return null;
  return { from: Math.min(startR.from, endR.from), to: Math.max(startR.to, endR.to) };
}

function buildDecorations(state: EditorState): DecorationSet {
  const value = state.field(structField, false);
  if (!value) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  const docLen = state.doc.length;
  // Collect all cursors, keep them in order so RangeSetBuilder accepts them.
  const cursors: Array<{ c: Cursor; primary: boolean }> = [
    { c: value.state.cursors.primary, primary: true },
    ...value.state.cursors.secondaries.map((c) => ({ c, primary: false })),
  ];
  const ranges = cursors
    .map((entry) => {
      const r = rangeForCursor(entry.c, value.idIndex);
      if (!r) return null;
      // Document-root cursor: skip painting (the entire document would mark).
      if (r.from === 0 && r.to === docLen && entry.c.kind === "node") {
        // We can't check the root id without exposing it; instead the
        // applyOp layer keeps the cursor on doc root only at boot. Skip
        // these by detecting "covers entire doc".
        return null;
      }
      // Clamp + skip empty ranges (safety).
      const from = Math.max(0, Math.min(r.from, docLen));
      const to = Math.max(0, Math.min(r.to, docLen));
      if (to <= from) return null;
      return { from, to, primary: entry.primary };
    })
    .filter((x): x is { from: number; to: number; primary: boolean } => x !== null)
    .sort((a, b) => a.from - b.from || a.to - b.to);

  for (const r of ranges) {
    builder.add(r.from, r.to, r.primary ? cursorMarkPrimary : cursorMark);
  }
  return builder.finish();
}

export const structuralCursorDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state);
    }
    update(u: ViewUpdate) {
      const oldField = u.startState.field(structField, false);
      const newField = u.state.field(structField, false);
      if (u.docChanged || oldField !== newField) {
        this.decorations = buildDecorations(u.state);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * Default styling for the halo. Lives here so the user can tweak via the
 * editor theme overrides without hunting through CSS.
 */
export const structuralCursorTheme = EditorView.baseTheme({
  ".cm-structuralCursor": {
    backgroundColor: "rgba(120, 180, 255, 0.20)",
    outline: "1px solid rgba(120, 180, 255, 0.55)",
    borderRadius: "3px",
  },
  ".cm-structuralCursorPrimary": {
    backgroundColor: "rgba(120, 180, 255, 0.35)",
    outline: "1px solid rgba(120, 180, 255, 0.85)",
  },
});
