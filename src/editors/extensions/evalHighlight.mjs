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
import { nodeTreeCursorField } from "./structure.mjs";
import { ASTCursor } from "../../utils/astCursor.mjs";


// Helper to find the range of the top-level s-expression as used by evalNow

// Find the range of the top-level node using the nodeTreeCursor
function getTopLevelRange(state) {
  // Get the AST cursor from the state
  const cursor = state.field(nodeTreeCursorField, false);
  if (!cursor) return { from: 0, to: 0 };
  // Get the path vector and navigate to the first entry
  const path = cursor.getPath ? cursor.getPath() : [];
  if (!Array.isArray(path) || path.length === 0) {
    // If at root, highlight the whole doc
    const docLen = state.doc.length;
    return { from: 0, to: docLen };
  }
  // The first entry in the path is the top-level node index
  const topLevelIndex = path[0];
  let topNode = cursor.root;
  if (topNode && topNode.children && topNode.children.length > topLevelIndex) {
    topNode = topNode.children[topLevelIndex];
    if (typeof topNode.from === 'number' && typeof topNode.to === 'number') {
      return { from: topNode.from, to: topNode.to };
    }
  }
  // Fallback: highlight nothing
  return { from: 0, to: 0 };
}

// Helper to dispatch highlight effect and clear it after 1s
export function flashEvalHighlight(view, _from, _to) {
  // Use the same logic as evalNow/evalToplevel
  const state = view.state;
  const range = getTopLevelRange(state);
  if (!range || range.from === range.to) {
    view.dispatch({ effects: evalHighlightEffect.of({ from: 0, to: 0 }) });
    return;
  }
  view.dispatch({ effects: evalHighlightEffect.of({ from: range.from, to: range.to }) });
  setTimeout(() => {
    view.dispatch({ effects: evalHighlightEffect.of({ from: 0, to: 0 }) });
  }, 1000);
}
