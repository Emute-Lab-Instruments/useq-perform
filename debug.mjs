import { createStructuralEditor, selectByText, moveNext, movePrevious } from './newStructuralEditingExtensions.mjs';

// Test move operations
const state = createStructuralEditor("(a b c)");
console.log("Initial doc:", state.doc.toString());

// Select "a" and move it next
const state2 = selectByText(state, "a");
console.log("1. Selected 'a':", state2.sliceDoc(state2.selection.main.from, state2.selection.main.to));

const state3 = moveNext(state2);
console.log("2. After move next:");
console.log("   Doc:", state3.doc.toString());
console.log("   Selected:", state3.sliceDoc(state3.selection.main.from, state3.selection.main.to));

// Now test move previous with "c"
const state4 = selectByText(state3, "c");
const state5 = movePrevious(state4);
console.log("3. After move previous:");
console.log("   Doc:", state5.doc.toString());
console.log("   Selected:", state5.sliceDoc(state5.selection.main.from, state5.selection.main.to));