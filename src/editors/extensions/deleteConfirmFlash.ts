import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

const CLEAR = { from: -1, to: -1 };

export const deleteConfirmEffect = StateEffect.define<{ from: number; to: number }>();

const confirmDeco = Decoration.mark({ class: "cm-delete-confirm" });

export const deleteConfirmField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    // Auto-clear on any user action that changes the selection or document,
    // unless the transaction is our own effect dispatch.
    if (decos !== Decoration.none) {
      const isOwnEffect = tr.effects.some((e) => e.is(deleteConfirmEffect));
      if (!isOwnEffect && (tr.docChanged || (tr.selection && !tr.selection.eq(tr.startState.selection)))) {
        return Decoration.none;
      }
    }

    decos = decos.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(deleteConfirmEffect)) {
        if (e.value.from === CLEAR.from) return Decoration.none;
        return Decoration.set([confirmDeco.range(e.value.from, e.value.to)]);
      }
    }
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function flashDeleteConfirm(view: EditorView, from: number, to: number): void {
  view.dispatch({ effects: deleteConfirmEffect.of({ from, to }) });
}

export function clearDeleteConfirm(view: EditorView): void {
  view.dispatch({ effects: deleteConfirmEffect.of(CLEAR) });
}
