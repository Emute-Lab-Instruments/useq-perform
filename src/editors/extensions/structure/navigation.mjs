// === Navigation commands for structure navigation ===

/**
 * Move cursor in (to first child node) and return a transaction to update selection.
 */
import { nodeTreeCursorField } from "../structure.mjs";
import { EditorSelection } from "@codemirror/state";

export function navigateIn(state) {
    console.log("navigateIn called");
    const cursor = state.field(nodeTreeCursorField, false);
    if (!cursor) {
        console.log("navigateIn: No cursor found in state");
        return null;
    }
    
    const path = cursor.getPath ? cursor.getPath() : 'path not available';
    console.log("navigateIn: Current path:", path);
    
    if (!cursor.hasChildren()) {
        console.log("navigateIn: Cursor has no children, path:", path);
        return null;
    }
    const fork = cursor.fork().in();
    const node = fork.getNode();
    if (!node) {
        console.log("navigateIn: No node found after moving in, path:", path);
        return null;
    }
    if (typeof node.from !== 'number') {
        console.log("navigateIn: Node.from is not a number:", node.from, "path:", path);
        return null;
    }
    console.log("navigateIn: Moving to position", node.from, "node type:", node.type?.name);
    return state.update({
        selection: EditorSelection.single(node.from),
        scrollIntoView: true
    });
}

/**
 * Move cursor out (to parent node) and return a transaction to update selection.
 */
export function navigateOut(state) {
    console.log("navigateOut called");
    const cursor = state.field(nodeTreeCursorField, false);
    if (!cursor) {
        console.log("navigateOut: No cursor found in state");
        return null;
    }
    
    const path = cursor.getPath ? cursor.getPath() : 'path not available';
    console.log("navigateOut: Current path:", path);
    
    if (!cursor.canGoOut()) {
        console.log("navigateOut: Cursor cannot go out (no parent), path:", path);
        return null;
    }
    const fork = cursor.fork().out();
    const node = fork.getNode();
    if (!node) {
        console.log("navigateOut: No node found after moving out, path:", path);
        return null;
    }
    if (typeof node.from !== 'number') {
        console.log("navigateOut: Node.from is not a number:", node.from, "path:", path);
        return null;
    }
    console.log("navigateOut: Moving to position", node.from, "node type:", node.type?.name);
    return state.update({
        selection: EditorSelection.single(node.from),
        scrollIntoView: true
    });
}

/**
 * Move cursor to previous sibling and return a transaction to update selection.
 */
export function navigatePrev(state) {
    console.log("navigatePrev called");
    const cursor = state.field(nodeTreeCursorField, false);
    if (!cursor) {
        console.log("navigatePrev: No cursor found in state");
        return null;
    }
    
    const path = cursor.getPath ? cursor.getPath() : 'path not available';
    console.log("navigatePrev: Current path:", path);
    
    if (!cursor.hasPrev()) {
        console.log("navigatePrev: Cursor has no previous sibling, path:", path);
        return null;
    }
    const fork = cursor.fork().prev();
    const node = fork.getNode();
    if (!node) {
        console.log("navigatePrev: No node found after moving to previous, path:", path);
        return null;
    }
    if (typeof node.from !== 'number') {
        console.log("navigatePrev: Node.from is not a number:", node.from, "path:", path);
        return null;
    }
    console.log("navigatePrev: Moving to position", node.from, "node type:", node.type?.name);
    return state.update({
        selection: EditorSelection.single(node.from),
        scrollIntoView: true
    });
}

/**
 * Move cursor to next sibling and return a transaction to update selection.
 */
export function navigateNext(state) {
    console.log("navigateNext called");
    const cursor = state.field(nodeTreeCursorField, false);
    if (!cursor) {
        console.log("navigateNext: No cursor found in state");
        return null;
    }
    
    const path = cursor.getPath ? cursor.getPath() : 'path not available';
    console.log("navigateNext: Current path:", path);
    
    if (!cursor.hasNext()) {
        console.log("navigateNext: Cursor has no next sibling, path:", path);
        return null;
    }
    const fork = cursor.fork().next();
    const node = fork.getNode();
    if (!node) {
        console.log("navigateNext: No node found after moving to next, path:", path);
        return null;
    }
    if (typeof node.from !== 'number') {
        console.log("navigateNext: Node.from is not a number:", node.from, "path:", path);
        return null;
    }
    console.log("navigateNext: Moving to position", node.from, "node type:", node.type?.name);
    return state.update({
        selection: EditorSelection.single(node.from),
        scrollIntoView: true
    });
}

