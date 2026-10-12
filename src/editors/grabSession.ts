/** One grab lifetime per document. History restores edits, never the grab mode. */
import { StateEffect, StateField, Transaction, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { captureStructuralFocus, type StructuralFocus } from "./extensions/structure/adapter/cursorPath.ts";
import { setIntendedFocus, structField } from "./extensions/structure/adapter/stateField.ts";
import type { StructuralAction } from "./extensions/structure/adapter/dispatcher.ts";
import { executeEditorCommand, type EditorCommandSource } from "./commands/editorCommandRouter.ts";

interface GrabSession {
  readonly focus: StructuralFocus;
  readonly moves: number;
}

const setGrabSession = StateEffect.define<GrabSession | null>();

export const grabSessionField = StateField.define<GrabSession | null>({
  create: () => null,
  update(session, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setGrabSession)) return effect.value;
    }
    return session;
  },
});

export function isGrabActive(state: EditorState): boolean {
  return state.field(grabSessionField, false) != null;
}

export function startGrab(view: EditorView): boolean {
  if (isGrabActive(view.state)) return true;
  const structural = view.state.field(structField, false);
  if (!structural || view.state.field(grabSessionField, false) === undefined) return false;
  view.dispatch({ annotations: Transaction.addToHistory.of(false), effects: setGrabSession.of({ focus: captureStructuralFocus(structural.state), moves: 0 }) });
  return true;
}

export function endGrab(view: EditorView): boolean {
  if (!isGrabActive(view.state)) return false;
  view.dispatch({ annotations: Transaction.addToHistory.of(false), effects: setGrabSession.of(null) });
  return true;
}

export function moveGrab(
  view: EditorView,
  action: StructuralAction,
  source: EditorCommandSource = "gamepad",
): boolean {
  const session = view.state.field(grabSessionField, false);
  if (!session) return false;
  const before = view.state.doc;
  const handled = executeEditorCommand(view, { kind: "structural", action, source });
  if (!view.state.doc.eq(before)) {
    view.dispatch({ annotations: Transaction.addToHistory.of(false), effects: setGrabSession.of({ ...session, moves: session.moves + 1 }) });
  }
  return handled;
}

export function cancelGrab(view: EditorView): boolean {
  const session = view.state.field(grabSessionField, false);
  if (!session) return false;
  endGrab(view);
  for (let i = 0; i < session.moves; i++) {
    if (!undo(view)) break;
  }
  view.dispatch({ annotations: Transaction.addToHistory.of(false), effects: setIntendedFocus.of(session.focus) });
  return true;
}
