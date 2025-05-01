import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { default_extensions as default_clojure_extensions } from "@nextjournal/clojure-mode";

// The code to parse
const code = `(d1  (slow   ([a      b     2 3] bar  ) (sqr beat)))`;

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
  return ["(", ")", "[", "]", "{", "}", "Brace", "Bracket", "Paren"].includes(type);
}

function isOperatorNode(node) {
  return node.type === "Operator" && node.children && node.children.length > 0;
}

function filterStructuralAndLiftOperatorNodes(node) {
  if (isStructuralToken(node.type)) {
    if (node.children) {
      return node.children.map(filterStructuralAndLiftOperatorNodes).filter(Boolean).flat();
    }
    return undefined;
  }
  if (isOperatorNode(node)) {
    // Replace Operator node with its first child (lift it)
    return filterStructuralAndLiftOperatorNodes(node.children[0]);
  }
  const children = node.children
    ? node.children.map(filterStructuralAndLiftOperatorNodes).filter(Boolean).flat()
    : undefined;
  return { ...node, children };
}

const filteredTree = filterStructuralAndLiftOperatorNodes(treeToJson(tree.topNode, state));
console.log(JSON.stringify(filteredTree, null, 2));

function getNodeAtPosition(tree, pos) {
  // Recursively find the smallest node containing pos
  function find(node) {
    if (pos < node.from || pos > node.to) return null;
    if (!node.children) return node;
    for (const child of node.children) {
      const found = find(child);
      if (found) return found;
    }
    return node;
  }
  return find(tree);
}

function printResolvedNodesForString(code, tree) {
  for (let i = 0; i < code.length; i++) {
    const node = getNodeAtPosition(tree, i);
    console.log(`pos ${i} ('${code[i]}'):`, node ? { type: node.type, from: node.from, to: node.to, text: node.text } : null);
  }
}

console.log("This is how each character resolves: ")
printResolvedNodesForString(code, filteredTree);

function isContainerNode(node) {
  return node.type === "List" || node.type === "Vector" || 
         node.type === "Program" || node.type === "Map";
}

function distributeWhitespace(children, parentFrom, parentTo) {
  if (!children || children.length === 0) return [];
  
  const result = [];
  
  // Process the first child
  const firstChild = { ...children[0] };
  // Include opening delimiters in the parent's range
  result.push(firstChild);
  
  // Process middle children with whitespace distribution
  for (let i = 1; i < children.length; i++) {
    const prev = result[i - 1];
    const current = { ...children[i] };
    
    // Calculate whitespace between elements
    const whitespace = current.from - prev.to;
    if (whitespace > 0) {
      // Split whitespace, favoring next element if odd number of spaces
      const half = Math.floor(whitespace / 2);
      prev.to += half;
      current.from = prev.to;
    }
    
    result.push(current);
  }
  
  // Ensure the last child extends to include closing delimiters
  if (result.length > 0) {
    const last = result[result.length - 1];
    last.to = parentTo;
  }
  
  return result;
}

function createAdjustedTree(node) {
  // Non-container nodes pass through unchanged
  if (!isContainerNode(node)) {
    return {
      ...node,
      children: node.children ? node.children.map(createAdjustedTree) : undefined
    };
  }
  
  // For container nodes, process children first
  const processedChildren = node.children 
    ? node.children.map(createAdjustedTree)
    : [];
    
  // Then distribute whitespace among children
  const adjustedChildren = distributeWhitespace(
    processedChildren,
    node.from,
    node.to
  );
  
  // Return the node with adjusted children
  return {
    ...node,
    children: adjustedChildren
  };
}

function resolveNodeAtPosition(tree, pos) {
  // Base case: outside tree bounds
  if (pos < tree.from || pos >= tree.to) return null;
  
  // If this is a container node with children, delegate to them
  if (isContainerNode(tree) && tree.children && tree.children.length > 0) {
    for (const child of tree.children) {
      if (pos >= child.from && pos < child.to) {
        return resolveNodeAtPosition(child, pos);
      }
    }
    
    // If we get here, position is in the container but not in any child
    // This shouldn't happen with proper whitespace distribution
    return tree;
  }
  
  // Non-container node or leaf node
  return tree;
}

function printPositionResolution(code, tree) {
  console.log("Position resolution with proper whitespace distribution:");
  for (let i = 0; i < code.length; i++) {
    const node = resolveNodeAtPosition(tree, i);
    console.log(
      `pos ${i} ('${code[i]}'):`, 
      node ? { type: node.type, from: node.from, to: node.to, text: node.text } : null
    );
  }
}

// Create a properly adjusted tree and print resolution
const adjustedTree = createAdjustedTree(filteredTree);
printPositionResolution(code, adjustedTree);
