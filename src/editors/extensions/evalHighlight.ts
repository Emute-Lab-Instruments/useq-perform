// CodeMirror extension for flashing highlight on evaluated code
import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

interface EvalHighlightValue {
  from: number;
  to: number;
  isPreview?: boolean;
}

// Effect to trigger highlight
export const evalHighlightEffect = StateEffect.define<EvalHighlightValue>();

// Decoration for highlight (normal eval - yellow for connected, grey for disconnected)
const evalHighlightDeco = Decoration.mark({ class: "cm-evaluated-code" });

// Decoration for soft eval preview (cyan/blue color)
const evalPreviewHighlightDeco = Decoration.mark({ class: "cm-evaluated-code cm-evaluated-preview" });

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
        // Use preview decoration if isPreview flag is set
        const deco = e.value.isPreview ? evalPreviewHighlightDeco : evalHighlightDeco;
        return Decoration.set([
          deco.range(e.value.from, e.value.to)
        ]);
      }
    }
    return decos;
  },
  provide: f => EditorView.decorations.from(f)
});

// Helper to dispatch highlight effect and clear it after 1s
import { findNodeAt } from "./structure/new-structure.ts";


// Helper to find the range of the top-level s-expression as used by evalNow

// Find the range of the top-level node using standard syntax tree
function getTopLevelRange(state: EditorState): { from: number; to: number } {
  const selection = state.selection.main;
  let node = findNodeAt(state, selection.from, selection.to);
  
  if (node) {
    // Walk up to find the top-level node (child of Program)
    while (node.parent && node.parent.type.name !== "Program") {
      node = node.parent;
    }
    // If parent is Program, then 'node' is a top-level node
    if (node.parent && node.parent.type.name === "Program") {
      return { from: node.from, to: node.to };
    }
  }
  
  // Fallback: highlight whole doc if at root or no node found
  return { from: 0, to: state.doc.length };
}

// Helper to dispatch highlight effect and clear it after 1s
// Options: { isPreview: boolean } - use preview color for soft eval
export function flashEvalHighlight(view: EditorView, from?: number, to?: number, options: { isPreview?: boolean } = {}): void {
  const { isPreview = false } = options;

  // If range is provided, use it
  if (from !== undefined && to !== undefined && from !== to) {
    view.dispatch({ effects: evalHighlightEffect.of({ from, to, isPreview }) });
    setTimeout(() => {
      view.dispatch({ effects: evalHighlightEffect.of({ from: 0, to: 0 }) });
    }, 1000);
    return;
  }

  // Otherwise calculate top-level range
  const state = view.state;
  const range = getTopLevelRange(state);
  if (!range || range.from === range.to) {
    view.dispatch({ effects: evalHighlightEffect.of({ from: 0, to: 0 }) });
    return;
  }
  view.dispatch({ effects: evalHighlightEffect.of({ from: range.from, to: range.to, isPreview }) });
  setTimeout(() => {
    view.dispatch({ effects: evalHighlightEffect.of({ from: 0, to: 0 }) });
  }, 1000);
}
