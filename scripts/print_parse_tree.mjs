import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { default_extensions as default_clojure_extensions } from "@nextjournal/clojure-mode";

// The code to parse
const code = `(d1 (slow ([1 2 3] bar) (sqr beat)))`;

// Create the EditorState
const state = EditorState.create({
  doc: code,
  extensions: [default_clojure_extensions]
});

// Get the syntax tree
const tree = syntaxTree(state);

function treeToJson(node, state) {
  return {
    type: node.type.name,
    from: node.from,
    to: node.to,
    text: state.sliceDoc(node.from, node.to),
    children: collectChildren(node, state)
  };
}

function collectChildren(node, state) {
  const children = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    children.push(treeToJson(child, state));
  }
  return children.length > 0 ? children : undefined;
}

function isStructuralToken(type) {
  return (
    type === "(" ||
    type === ")" ||
    type === "[" ||
    type === "]" ||
    type === "{" ||
    type === "}" ||
    type === "Brace" ||
    type === "Bracket" ||
    type === "Paren"
  );
}

function filterAndLiftTree(node, state) {
  // If this is an Operator node, lift its content
  if (node.type === "Operator" && node.children && node.children.length === 1) {
    return filterAndLiftTree(node.children[0], state);
  }
  // Filter out paren/brace tokens
  if (isStructuralToken(node.type)) {
    if (node.children) {
      // Recursively flatten children
      if (node.children.length === 1) {
        return filterAndLiftTree(node.children[0], state);
      }
      return node.children.map(child => filterAndLiftTree(child, state)).filter(Boolean);
    }
    return undefined;
  }
  // Recursively process children
  let children = node.children
    ? node.children
        .map(child => filterAndLiftTree(child, state))
        .flat()
        .filter(Boolean)
    : undefined;
  return {
    ...node,
    children
  };
}

const filteredTree = filterAndLiftTree(treeToJson(tree.topNode, state), state);
console.log(JSON.stringify(filteredTree, null, 2));