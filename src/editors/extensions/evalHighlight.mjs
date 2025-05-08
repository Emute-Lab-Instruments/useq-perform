// CodeMirror extension for flashing highlight on evaluated code
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

// Effect to trigger highlight
export const evalHighlightEffect = StateEffect.define();

// Decoration for highlight
const evalHighlightDeco = Decoration.mark({ class: "cm-evaluated-code" });

// StateField to manage highlight
export const evalHighlightField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    decos = decos.map(tr.changes);
    for (let e of tr.effects) {
      if (e.is(evalHighlightEffect)) {
        // Remove previous highlight, add new one
        if (e.value.from === 0 && e.value.to === 0) {
          // Special effect to clear highlight
          return Decoration.none;
        }
        return Decoration.set([
          evalHighlightDeco.range(e.value.from, e.value.to)
        ]);
      }
    }
    return decos;
  },
  provide: f => EditorView.decorations.from(f)
});

// Helper to dispatch highlight effect and clear it after 1s
export function flashEvalHighlight(view, from, to) {
  view.dispatch({ effects: evalHighlightEffect.of({ from, to }) });
  setTimeout(() => {
    view.dispatch({ effects: evalHighlightEffect.of({ from: 0, to: 0 }) });
  }, 1000);
}
