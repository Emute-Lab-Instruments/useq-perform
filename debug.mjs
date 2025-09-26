import { createStructuralEditor, selectByText, deleteExpression } from './newStructuralEditingExtensions.mjs';

// Test deletion
const state = createStructuralEditor("(foo bar baz)");
console.log("Initial doc:", state.doc.toString());

// Try to select "bar"
const state2 = selectByText(state, "bar");
console.log("After selecting 'bar':");
console.log("Selected text:", state2.sliceDoc(state2.selection.main.from, state2.selection.main.to));

// Try delete
const state3 = deleteExpression(state2);
console.log("After delete:");
console.log("Doc:", state3.doc.toString());
console.log("Selected text:", state3.sliceDoc(state3.selection.main.from, state3.selection.main.to));