/**
 * CodeMirror state field that wraps the structural-editing core.
 *
 * Holds:
 *   - the parsed core `State` (tree + cursors)
 *   - the `idIndex` mapping core node ids to source ranges
 *   - the cursor path(s) — used to re-derive cursors after a re-parse, since
 *     ids are minted fresh each fold.
 *
 * Behaviour:
 *   - On the field's initial creation, parse from scratch with the doc's
 *     primary CodeMirror selection mapped to the smallest enclosing top-level
 *     form, falling back to the document root.
 *   - On text edits, fold the new document once and resolve the mutation
 *     transaction's intended focus, falling back to saved paths for text input.
 *   - Other dispatches that just want to update the cursor (e.g. nav ops)
 *     pass `setStructState` effect carrying the new core state.
 */

import { StateEffect, StateField } from "@codemirror/state";
import type { EditorState, Transaction } from "@codemirror/state";
import { invertedEffects } from "@codemirror/commands";

import { nodeCursor, singleCursor, type State } from "../core/index.ts";
import {
  pathsFromCursorSet,
  rederiveCursors,
  type CursorPath,
  captureStructuralFocus,
  resolveStructuralFocus,
  type StructuralFocus,
} from "./cursorPath.ts";
import { treeFromLezer, type IdIndex } from "./treeFromLezer.ts";

export interface StructFieldValue {
  readonly state: State;
  readonly idIndex: IdIndex;
  /**
   * Cursor paths captured after the last user-driven update. Used to
   * re-derive cursors when the doc text changes (which invalidates ids).
   */
  readonly cursorPaths: ReadonlyArray<CursorPath>;
}

/** Effect carrying a new core state after navigation or selection projection. */
export const setStructState = StateEffect.define<{
  state: State;
  idIndex: IdIndex;
  cursorPaths: ReadonlyArray<CursorPath>;
}>();

/** Applied with the text edit, so observers never see text with the old focus. */
export const setIntendedFocus = StateEffect.define<StructuralFocus>();

function initialFromDoc(es: EditorState): StructFieldValue {
  const { tree, idIndex } = treeFromLezer(es);
  // Default cursor: the document root. The user's first nav.in/next will
  // dive into a top-level form. This is intentional — round 2 punts on
  // mapping the CodeMirror selection to a structural cursor at boot.
  const cs = singleCursor(nodeCursor(tree.root.id));
  return {
    state: { tree, cursors: cs },
    idIndex,
    cursorPaths: pathsFromCursorSet(cs, tree),
  };
}

export const structField = StateField.define<StructFieldValue>({
  create: initialFromDoc,
  update(value, tr: Transaction): StructFieldValue {
    const intended = tr.effects.find((effect) => effect.is(setIntendedFocus));
    if (intended?.is(setIntendedFocus)) {
      const { tree, idIndex } = tr.docChanged ? treeFromLezer(tr.state) : {
        tree: value.state.tree, idIndex: value.idIndex,
      };
      const cursors = resolveStructuralFocus(intended.value, tree);
      return { state: { tree, cursors }, idIndex, cursorPaths: pathsFromCursorSet(cursors, tree) };
    }
    // Effects always win over doc-change re-parse; an op may have produced
    // a new state plus the matching text edit in the same transaction.
    for (const e of tr.effects) {
      if (e.is(setStructState)) {
        return {
          state: e.value.state,
          idIndex: e.value.idIndex,
          cursorPaths: e.value.cursorPaths,
        };
      }
    }
    if (tr.docChanged) {
      const { tree, idIndex } = treeFromLezer(tr.state);
      const cursors = rederiveCursors(value.cursorPaths, tree);
      const newState: State = { tree, cursors };
      return {
        state: newState,
        idIndex,
        cursorPaths: pathsFromCursorSet(cursors, tree),
      };
    }
    return value;
  },
  provide: (field) => invertedEffects.of((tr) =>
    tr.docChanged && tr.effects.some((effect) => effect.is(setIntendedFocus))
      ? [setIntendedFocus.of(captureStructuralFocus(tr.startState.field(field).state))]
      : [],
  ),
});

// ─── Insertion mode (§4 mode boundary) ──────────────────────────────────────
//
// Boolean state field: true when the editor is in insertion mode (free-form
// text editing), false when in structural mode (default). Toggled by
// mode.insert / mode.structural actions dispatched from the gamepad layer.

/** Effect to toggle insertion mode on or off. */
export const setInsertionMode = StateEffect.define<boolean>();

export const insertionModeField = StateField.define<boolean>({
  create: () => false,
  update(value, tr: Transaction): boolean {
    for (const e of tr.effects) {
      if (e.is(setInsertionMode)) return e.value;
    }
    return value;
  },
});
