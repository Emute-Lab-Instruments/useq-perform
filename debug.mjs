import { createStructuralEditor, selectByText, slurpRight } from './newStructuralEditingExtensions.mjs';

// Test slurp right
const state = createStructuralEditor("(a b) c");
console.log("Initial doc:", state.doc.toString());

// Try to select "(a b)"
const state2 = selectByText(state, "(a b)");
console.log("After selecting '(a b)':");
console.log("Selected text:", state2.sliceDoc(state2.selection.main.from, state2.selection.main.to));

// Try slurp right
const state3 = slurpRight(state2);
console.log("After slurp right:");
console.log("Doc:", state3.doc.toString());
console.log("Selected text:", state3.sliceDoc(state3.selection.main.from, state3.selection.main.to));