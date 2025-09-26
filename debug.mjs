import { createStructuralEditor, selectByText, navigateNext } from './newStructuralEditingExtensions.mjs';
import { syntaxTree } from '@codemirror/language';

// Test the failing case
const state = createStructuralEditor("(+ 1 (* 2 3))");
console.log("Initial doc:", state.doc.toString());

// Print syntax tree
const tree = syntaxTree(state);
tree.iterate({
  enter(node) {
    console.log(`${node.type.name}: "${state.sliceDoc(node.from, node.to)}" (${node.from}-${node.to})`);
  }
});

// Try to select "(* 2 3)"
const state2 = selectByText(state, "(* 2 3)");
console.log("After selecting '(* 2 3)':");
console.log("Selection:", state2.selection.main);
console.log("Selected text:", state2.sliceDoc(state2.selection.main.from, state2.selection.main.to));

// Try navigate next
const state3 = navigateNext(state2);
console.log("After navigate next:");
console.log("Selection:", state3.selection.main);
console.log("Selected text:", state3.sliceDoc(state3.selection.main.from, state3.selection.main.to));