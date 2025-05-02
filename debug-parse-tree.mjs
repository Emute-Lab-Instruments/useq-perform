import { EditorState, EditorSelection } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { default_extensions as default_clojure_extensions } from "@nextjournal/clojure-mode";
import { nodeTrackingField, stateToNodeContext } from "./src/editors/extensions/structure.mjs";

// This is a simplified version of the makeStateFromCodeWithCursor function from the tests
function makeStateFromCode(code, cursorPos) {
  const state = EditorState.create({
    doc: code,
    selection: EditorSelection.single(cursorPos),
    extensions: [default_clojure_extensions, nodeTrackingField],
  });
  return state;
}

// Function to print the raw parse tree structure at a position
function printRawParseTree(code, position) {
  const state = makeStateFromCode(code, position);
  const tree = syntaxTree(state);
  const node = tree.resolve(position, -1);

  console.log(`\n--- Position ${position} (char: '${code[position] || "EOF"}') ---`);

  // Print raw node details
  console.log("Raw Node:");
  console.log({
    name: node.name,
    from: node.from,
    to: node.to,
    text: state.sliceDoc(node.from, node.to),
  });

  // Print parent if any
  if (node.parent) {
    console.log("\nParent:");
    console.log({
      name: node.parent.name,
      from: node.parent.from,
      to: node.parent.to,
      text: state.sliceDoc(node.parent.from, node.parent.to),
    });
  }

  // Print siblings if any
  if (node.parent) {
    console.log("\nAll Siblings (in order):");
    let sibling = node.parent.firstChild;
    let siblingIndex = 0;
    while (sibling) {
      console.log(`Sibling ${siblingIndex++}:`, {
        name: sibling.name,
        from: sibling.from,
        to: sibling.to,
        text: state.sliceDoc(sibling.from, sibling.to),
        isCurrent: sibling === node
      });
      sibling = sibling.nextSibling;
    }
  }
}

// Function to print the node context as used in the tests
function printNodeContext(code, position) {
  const state = makeStateFromCode(code, position);
  const nodeContext = state.field(nodeTrackingField);

  console.log("\nNode Context (as used in tests):");
  console.log(JSON.stringify(nodeContext, (key, value) => {
    if (key === 'firstChild' || key === 'parent') return value ? `[${value.type || value.name}: ${value.text}]` : null;
    return value;
  }, 2));
}

// Test the failing test cases
console.log("=== DEBUGGING FAILING TEST CASES ===");

// Test case 1: "Detects left sibling in list"
console.log("\n\n=== TEST CASE: (a b) with cursor at 'b' ===");
const code1 = "(a b)";
const position1 = 3; // Position of 'b'
printRawParseTree(code1, position1);
printNodeContext(code1, position1);

// Test case 2: "Detects right sibling in list"
console.log("\n\n=== TEST CASE: (a b) with cursor at 'a' ===");
const code2 = "(a b)";
const position2 = 1; // Position of 'a'
printRawParseTree(code2, position2);
printNodeContext(code2, position2);

// Compare with vector which works correctly
console.log("\n\n=== COMPARISON: [a b] with cursor at 'a' ===");
const code3 = "[a b]";
const position3 = 1; // Position of 'a'
printRawParseTree(code3, position3);
printNodeContext(code3, position3);

console.log("\n\n=== COMPARISON: [a b] with cursor at 'b' ===");
const code4 = "[a b]";
const position4 = 3; // Position of 'b'
printRawParseTree(code4, position4);
printNodeContext(code4, position4);
