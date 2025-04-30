import { expect } from 'chai';
import { EditorState, EditorSelection } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { structureExtensions } from "../src/editors/extensions/structure.mjs";

import { default_extensions as default_clojure_extensions } from "@nextjournal/clojure-mode";


describe('Structural Detection', () => {
    function runStructuralTest(codeWithCursor, expectedType, expectedParentType, expectedText, expectedParentText) {
        const cursorPos = codeWithCursor.indexOf('<|>');
        if (cursorPos === -1) throw new Error('Missing <|> cursor marker');
        const code = codeWithCursor.replace('<|>', '');
        const state = EditorState.create({
            doc: code,
            selection: EditorSelection.single(cursorPos),
            extensions: [default_clojure_extensions, structureExtensions],
        });

        // The currentNode field is the first in structureExtensions
        const node = state.field(structureExtensions[0], false);

        // Get the syntax tree from the state
        const tree = syntaxTree(state);

        // Print test case information
        console.log("\n=== TEST CASE ===");
        console.log("Code:", codeWithCursor);
        console.log("Cursor position:", cursorPos);

        // Print the full parse tree
        console.log("\n=== PARSE TREE ===");
        printParseTree(tree.topNode, state.doc, 0);

        // Print information about the current node
        console.log("\n=== CURRENT NODE ===");
        if (node) {
            console.log("Type:", node.type.name);
            console.log("Range:", `${node.from}-${node.to}`);
            console.log("Text:", state.doc.sliceString(node.from, node.to));
            console.log("Node properties:", getNodeProperties(node));

            if (node.parent) {
                console.log("\n=== PARENT NODE ===");
                console.log("Type:", node.parent.type.name);
                console.log("Range:", `${node.parent.from}-${node.parent.to}`);
                console.log("Text:", state.doc.sliceString(node.parent.from, node.parent.to));
                console.log("Node properties:", getNodeProperties(node.parent));
            } else {
                console.log("\n=== NO PARENT NODE ===");
            }
        } else {
            console.log("No node found");
        }

        // Print nodes at cursor position
        console.log("\n=== NODES AT CURSOR POSITION ===");
        printNodesAtPosition(tree.topNode, cursorPos, state.doc);

        console.log("\n=== TEST ASSERTIONS ===");

        expect(node).to.exist;
        expect(node.type.name).to.equal(expectedType);
        if (expectedParentType) {
            expect(node.parent).to.exist;
            expect(node.parent.type.name).to.equal(expectedParentType);
            const parentText = state.doc.sliceString(node.parent.from, node.parent.to);
            expect(parentText).to.equal(expectedParentText);
        } else {
            expect(node.parent).to.not.exist;
        }
        const text = state.doc.sliceString(node.from, node.to);
        expect(text).to.equal(expectedText);
    }

    // Helper function to print the parse tree
    function printParseTree(node, doc, depth) {
        if (!node) return;

        const indent = "  ".repeat(depth);
        const text = doc.sliceString(node.from, node.to);
        const displayText = text.length > 30 ? text.substring(0, 27) + "..." : text;
        console.log(`${indent}${node.type.name} [${node.from}-${node.to}]: "${displayText}"`);

        if (node.firstChild) {
            let child = node.firstChild;
            while (child) {
                printParseTree(child, doc, depth + 1);
                child = child.nextSibling;
            }
        }
    }

    // Helper function to print nodes at a specific position
    function printNodesAtPosition(root, pos, doc) {
        // First approach: collect nodes that contain the cursor position
        let cursor = root.cursor();
        let nodesAtPos = [];

        while (cursor.next()) {
            if (cursor.from <= pos && cursor.to >= pos) {
                nodesAtPos.push({
                    type: cursor.type.name,
                    from: cursor.from,
                    to: cursor.to,
                    text: doc.sliceString(cursor.from, cursor.to),
                    size: cursor.to - cursor.from
                });
            }
        }

        // Sort by specificity (smaller ranges first)
        nodesAtPos.sort((a, b) => a.size - b.size);

        console.log(`Found ${nodesAtPos.length} nodes at position ${pos}:`);
        nodesAtPos.forEach((node, index) => {
            const displayText = node.text.length > 30 ? node.text.substring(0, 27) + "..." : node.text;
            console.log(`${index + 1}. ${node.type} [${node.from}-${node.to}] size=${node.size}: "${displayText}"`);
        });

        // Second approach: traverse the tree to get more detailed information
        console.log("\nDetailed node information:");
        printNodeAndChildren(root, doc, pos, 0);
    }

    // Helper function to print a node and its children with detailed information
    function printNodeAndChildren(node, doc, pos, depth) {
        if (!node) return;

        const indent = "  ".repeat(depth);
        const text = doc.sliceString(node.from, node.to);
        const displayText = text.length > 30 ? text.substring(0, 27) + "..." : text;
        const containsCursor = node.from <= pos && node.to >= pos;
        const marker = containsCursor ? "→ " : "  ";

        console.log(`${marker}${indent}${node.type.name} [${node.from}-${node.to}]${containsCursor ? " *contains cursor*" : ""}: "${displayText}"`);

        if (node.firstChild) {
            let child = node.firstChild;
            while (child) {
                printNodeAndChildren(child, doc, pos, depth + 1);
                child = child.nextSibling;
            }
        }
    }

    // Helper function to get node properties
    function getNodeProperties(node) {
        const props = {};

        // Common properties
        if (node.name) props.name = node.name;
        if (node.type) props.typeName = node.type.name;
        if (node.node && node.node.name) props.nodeName = node.node.name;

        // Check for children
        if (node.firstChild) props.hasChildren = true;
        if (node.nextSibling) props.hasNextSibling = true;
        if (node.prevSibling) props.hasPrevSibling = true;

        return props;
    }
    it('selects the entire list at top level', () => {
        runStructuralTest('<|>(a1 (sqr bar))', 'List', null, '(a1 (sqr bar))', null);
    });
    it('selects symbol a1 at start', () => {
        runStructuralTest('(<|>a1 (sqr bar))', 'Symbol', 'List', 'a1', '(a1 (sqr bar))');
    });
    it('selects symbol a1 at end', () => {
        runStructuralTest('(a1<|> (sqr bar))', 'Symbol', 'List', 'a1', '(a1 (sqr bar))');
    });
    it('selects inner list', () => {
        runStructuralTest('(a1 <|>(sqr bar))', 'List', 'List', '(sqr bar)', '(a1 (sqr bar))');
    });
    it('selects symbol sqr in inner list', () => {
        runStructuralTest('(a1 (sqr<|> bar))', 'Symbol', 'List', 'sqr', '(sqr bar)');
    });

    describe('Complex Structure Tests', () => {
        // Complex code: (a1 (slow ([1 2 3] (slow 8 bar)) (let [a (+ 1 2) b (- a 3)] (+ a b))))

        it('selects vector at beginning', () => {
            runStructuralTest('(a1 (slow (<|>[1 2 3] (slow 8 bar)) (let [a (+ 1 2) b (- a 3)] (+ a b))))',
                'Vector', 'List', '[1 2 3]', '([1 2 3] (slow 8 bar))');
        });

        it('selects number in inner list', () => {
            runStructuralTest('(a1 (slow ([1 2 3] (slow <|>8 bar)) (let [a (+ 1 2) b (- a 3)] (+ a b))))',
                'Number', 'List', '8', '(slow 8 bar)');
        });

        it('selects let at beginning of form', () => {
            runStructuralTest('(a1 (slow ([1 2 3] (slow 8 bar)) (<|>let [a (+ 1 2) b (- a 3)] (+ a b))))',
                'Symbol', 'List', 'let', '(let [a (+ 1 2) b (- a 3)] (+ a b))');
        });

        it('selects symbol a in binding vector', () => {
            runStructuralTest('(a1 (slow ([1 2 3] (slow 8 bar)) (let [<|>a (+ 1 2) b (- a 3)] (+ a b))))',
                'Symbol', 'Vector', 'a', '[a (+ 1 2) b (- a 3)]');
        });

        it('selects plus in final expression', () => {
            runStructuralTest('(a1 (slow ([1 2 3] (slow 8 bar)) (let [a (+ 1 2) b (- a 3)] (<|>+ a b))))',
                'Symbol', 'List', '+', '(+ a b)');
        });

        it('selects the inner list at the end', () => {
            runStructuralTest('[1 (+ 1 2)<|>]',
                'List', 'Vector', '(+ 1 2)', '[1 (+ 1 2)]');
        });

    });
});
