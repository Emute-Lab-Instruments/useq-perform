// === Navigation commands for structure navigation ===

/**
 * Move cursor in (to first child node) and return a transaction to update selection.
 */
import { nodeTreeCursorField } from "../structure.mjs";
import { EditorSelection } from "@codemirror/state";

export function navigateIn(state) {
    const cursor = state.field(nodeTreeCursorField, false);
    if (!cursor) {
        return null;
    }
    const path = cursor.getPath ? cursor.getPath() : 'path not available';
    if (!cursor.hasChildren()) {
        return null;
    }
    const fork = cursor.fork().in();
    const node = fork.getNode();
    if (!node) {
        return null;
    }
    if (typeof node.from !== 'number') {
        return null;
    }
    return state.update({
        selection: EditorSelection.single(node.from),
        scrollIntoView: true
    });
}

/**
 * Move cursor out (to parent node) and return a transaction to update selection.
 */
export function navigateOut(state) {
    const cursor = state.field(nodeTreeCursorField, false);
    if (!cursor) {
        return null;
    }
    const path = cursor.getPath ? cursor.getPath() : 'path not available';
    if (!cursor.canGoOut()) {
        return null;
    }
    const fork = cursor.fork().out();
    const node = fork.getNode();
    if (!node) {
        return null;
    }
    if (typeof node.from !== 'number') {
        return null;
    }
    return state.update({
        selection: EditorSelection.single(node.from),
        scrollIntoView: true
    });
}

/**
 * Move cursor to previous sibling and return a transaction to update selection.
 */
export function navigatePrev(state) {
    const cursor = state.field(nodeTreeCursorField, false);
    if (!cursor) {
        return null;
    }
    const path = cursor.getPath ? cursor.getPath() : 'path not available';
    if (!cursor.hasPrev()) {
        return null;
    }
    const fork = cursor.fork().prev();
    const node = fork.getNode();
    if (!node) {
        return null;
    }
    if (typeof node.from !== 'number') {
        return null;
    }
    return state.update({
        selection: EditorSelection.single(node.from),
        scrollIntoView: true
    });
}

/**
 * Move cursor to next sibling and return a transaction to update selection.
 */
export function navigateNext(state) {
    const cursor = state.field(nodeTreeCursorField, false);
    if (!cursor) {
        return null;
    }
    const path = cursor.getPath ? cursor.getPath() : 'path not available';
    if (!cursor.hasNext()) {
        return null;
    }
    const fork = cursor.fork().next();
    const node = fork.getNode();
    if (!node) {
        return null;
    }
    if (typeof node.from !== 'number') {
        return null;
    }
    return state.update({
        selection: EditorSelection.single(node.from),
        scrollIntoView: true
    });
}

