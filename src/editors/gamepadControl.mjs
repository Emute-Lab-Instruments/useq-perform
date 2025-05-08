import { initGamepad, pollGamepad } from "../io/gamepad.mjs"
import { navigateIn, navigateNext, navigateOut, navigatePrev } from "./extensions/structure/navigation.mjs";
import { nodeTreeCursorField, getTrimmedRange } from "./extensions/structure.mjs";


let editorView = null;


function hideEditorCursor() {
    if (editorView && editorView.dom) {
        editorView.dom.classList.add('hide-cursor');
    }
}

function showEditorCursor() {
    if (editorView && editorView.dom) {
        editorView.dom.classList.remove('hide-cursor');
    }
}

export function initGamepadControl(view) {
    editorView = view;
    if (editorView && editorView.dom) {
        // Show cursor on mouse click/tap in editor
        editorView.dom.addEventListener('pointerdown', showEditorCursor);
    }
    initGamepad();
    loop();
}

let prevGamepadState = {
    buttons: {},
    axes: []
};

function loop() {
    const poll = pollGamepad();
    store = updateStoreWithGamepad(store, poll);

    // Pass only gamepad fields to handlers for new/old state comparison
    handleGamepadPoll(store, prevGamepadState);

    // Save previous gamepad state for next loop
    prevGamepadState = {
        buttons: { ...poll.buttons },
        axes: Array.isArray(poll.axes) ? [...poll.axes] : []
    };

    setTimeout(loop, 50); // Run 10 times a second (every 100ms)
}

function updateStoreWithGamepad(currentStore, gamepadState) {
    return {
        ...currentStore,
        buttons: gamepadState.buttons,
        axes: gamepadState.axes,
        // add any other gamepad fields you want to track
    };
}

import { showPickerMenu, showNumberPickerMenu } from "../ui/pickerMenu.mjs";
import { evalNow } from "./editorConfig.mjs";

let store = {
    mode: "normal", // also create, edit, move, picker, etc
    picker: null,   // { options, selectedIndex, closeMenu, direction } | null
    navigationMode: "structural", // or 'spatial'
    buttonRepeat: {} // { [buttonName]: { pressedAt, lastRepeat } }
}
// Toggle between 'structural' and 'spatial' navigation modes
function toggleNavigationMode() {
    store = {
        ...store,
        navigationMode: store.navigationMode === "structural" ? "spatial" : "structural"
    };
    // Optionally, show a UI notification here
    console.debug(`[gamepadControl] navigationMode set to ${store.navigationMode}`);
}

// --- Spatial navigation helpers ---
function getNodeLineAndColumn(node, state) {
    const line = state.doc.lineAt(node.from);
    const col = node.from - line.from;
    return { line: line.number, col };
}

function getAllNodes(state) {
    const tree = state.field(nodeTreeCursorField, false)?.root;
    if (!tree) return [];
    const nodes = [];
    function visit(node) {
        if (!node) return;
        nodes.push(node);
        if (node.children) node.children.forEach(visit);
    }
    visit(tree);
    return nodes;
}

function spatialNavigateLeft(state) {
    const cursor = state.field(nodeTreeCursorField, false);
    if (!cursor) return null;
    const node = cursor.getNode();
    if (!node) return null;
    const { line, col } = getNodeLineAndColumn(node, state);
    const nodes = getAllNodes(state).filter(n => n !== node);
    // Find node on same line, ends before this node starts, closest to the left
    let best = null;
    let bestDist = Infinity;
    for (const n of nodes) {
        const nLine = state.doc.lineAt(n.from).number;
        const nCol = n.from - state.doc.lineAt(n.from).from;
        if (nLine === line && n.from < node.from) {
            const dist = col - nCol;
            if (dist > 0 && dist < bestDist) {
                best = n;
                bestDist = dist;
            }
        }
    }
    if (best) {
        return state.update({
            selection: { anchor: best.from },
            scrollIntoView: true
        });
    }
    return null;
}

function spatialNavigateRight(state) {
    const cursor = state.field(nodeTreeCursorField, false);
    if (!cursor) return null;
    const node = cursor.getNode();
    if (!node) return null;
    const { line, col } = getNodeLineAndColumn(node, state);
    const nodes = getAllNodes(state).filter(n => n !== node);
    // Find node on same line, starts after this node's start, closest to the right
    let best = null;
    let bestDist = Infinity;
    for (const n of nodes) {
        const nLine = state.doc.lineAt(n.from).number;
        const nCol = n.from - state.doc.lineAt(n.from).from;
        if (nLine === line && n.from > node.from) {
            const dist = nCol - col;
            if (dist > 0 && dist < bestDist) {
                best = n;
                bestDist = dist;
            }
        }
    }
    // If the current node has children, prefer the first child that starts after the cursor
    if (node.children && node.children.length > 0) {
        for (const child of node.children) {
            const childLine = state.doc.lineAt(child.from).number;
            const childCol = child.from - state.doc.lineAt(child.from).from;
            if (childLine === line && child.from > node.from) {
                const dist = childCol - col;
                if (dist > 0 && dist < bestDist) {
                    best = child;
                    bestDist = dist;
                }
            }
        }
    }
    if (best) {
        return state.update({
            selection: { anchor: best.from },
            scrollIntoView: true
        });
    }
    return null;
}

function spatialNavigateUp(state) {
    const cursor = state.field(nodeTreeCursorField, false);
    if (!cursor) return null;
    const node = cursor.getNode();
    if (!node) return null;
    const { line, col } = getNodeLineAndColumn(node, state);
    const nodes = getAllNodes(state).filter(n => n !== node);
    // Find node in same column, on a line above, closest vertically
    let best = null;
    let bestDist = Infinity;
    for (const n of nodes) {
        const nLine = state.doc.lineAt(n.from).number;
        const nCol = n.from - state.doc.lineAt(n.from).from;
        if (nCol === col && nLine < line) {
            const dist = line - nLine;
            if (dist > 0 && dist < bestDist) {
                best = n;
                bestDist = dist;
            }
        }
    }
    if (best) {
        return state.update({
            selection: { anchor: best.from },
            scrollIntoView: true
        });
    }
    return null;
}

function spatialNavigateDown(state) {
    const cursor = state.field(nodeTreeCursorField, false);
    if (!cursor) return null;
    const node = cursor.getNode();
    if (!node) return null;
    const { line, col } = getNodeLineAndColumn(node, state);
    const nodes = getAllNodes(state).filter(n => n !== node);
    // Find node in same column, on a line below, closest vertically
    let best = null;
    let bestDist = Infinity;
    for (const n of nodes) {
        const nLine = state.doc.lineAt(n.from).number;
        const nCol = n.from - state.doc.lineAt(n.from).from;
        if (nCol === col && nLine > line) {
            const dist = nLine - line;
            if (dist > 0 && dist < bestDist) {
                best = n;
                bestDist = dist;
            }
        }
    }
    if (best) {
        return state.update({
            selection: { anchor: best.from },
            scrollIntoView: true
        });
    }
    return null;
}

// functionalities to implement:
// navigation DONE
// deletion DONE
// insertion
// duplication
// moving
// toggling collapse

function newPress(buttonName, newState, oldState) {
    const newBtn = newState.buttons[buttonName];
    const oldBtn = oldState.buttons[buttonName];
    const newPressed = newBtn && typeof newBtn.pressed === 'boolean' ? newBtn.pressed : false;
    const oldPressed = oldBtn && typeof oldBtn.pressed === 'boolean' ? oldBtn.pressed : false;
    return newPressed && !oldPressed;
}


function handleButtonNavigation(newState, oldState) {
    // Button repeat config
    const initialDelay = 300; // ms before repeat starts
    const repeatInterval = 60; // ms between repeats
    const now = Date.now();

    // Choose navigation map based on mode
    const isSpatial = store.navigationMode === "spatial";
    const map = isSpatial
        ? {
            "Up": spatialNavigateUp,
            "Down": spatialNavigateDown,
            "Left": spatialNavigateLeft,
            "Right": spatialNavigateRight,
        }
        : {
            "Up": navigatePrev,
            "Down": navigateNext,
            "Left": navigatePrev,
            "Right": navigateNext,
        };

    // Only repeat for navigation buttons
    for (const [button, handler] of Object.entries(map)) {
        const isPressed = newState.buttons[button]?.pressed;
        const wasPressed = oldState.buttons[button]?.pressed;
        if (isPressed) {
            if (!store.buttonRepeat[button]) {
                // Just pressed: trigger immediately
                store.buttonRepeat[button] = { pressedAt: now, lastRepeat: now };
                const transaction = handler(editorView.state);
                if (transaction) editorView.dispatch(transaction);
            } else {
                // Held: check if should repeat
                const { pressedAt, lastRepeat } = store.buttonRepeat[button];
                const delay = now - pressedAt;
                const sinceLast = now - lastRepeat;
                if (delay >= initialDelay && sinceLast >= repeatInterval) {
                    store.buttonRepeat[button].lastRepeat = now;
                    const transaction = handler(editorView.state);
                    if (transaction) editorView.dispatch(transaction);
                }
            }
        } else if (store.buttonRepeat[button]) {
            // Released: clear tracking
            delete store.buttonRepeat[button];
        }
    }

    // For non-repeating buttons (A, B, etc.), use original logic
    let action = null;
    let buttonThatTriggered = "NONE";
    const nonRepeatMap = {
        "A": isSpatial ? navigateIn : navigateIn,
        "B": isSpatial ? navigateOut : navigateOut,
    };
    for (const [button, handler] of Object.entries(nonRepeatMap)) {
        if (newPress(button, newState, oldState)) {
            action = handler;
            buttonThatTriggered = button;
            break;
        }
    }
    if (action) {
        const transaction = action(editorView.state);
        if (transaction) {
            editorView.dispatch(transaction);
        }
    }
}


// each one of these pushes another picker menu on the stack
// once that picker menu resolves, it pops everything off the stack and returns to normal mode
const createMenuOptions = [
    // numbers arranged in a 3x3 + 1 grid (1-2-3, 4-5-6, 7-8-9, 0)
    { name: "Number", text: "123" },
    // operators like +, -, *, /, %, floor, ceil
    { name: "Math", lucideIcon: "calculator" },
    // the options t, beat, bar, slow, fast
    { name: "Timing", lucideIcon: "clock" },
    // ignore for now
    // { name: "Symbol", text: "abc" },
    // inserts a list '()', moves the cursor inside, and creates a new picker menu for the function
    { name: "Call", text: "()" },
    // inserts a list '[]', moves the cursor inside, and creates a new picker menu for the first element
    { name: "List", text: "[]" },
    // ignore for now
    // { name: "Sequencing", text: "" },
    // a1, a2, a3, d1, d2, d3, ain1, ain2, swt, swm
    { name: "IO", lucideIcon: "arrow-left-right" },
    // uni->bi, bi->uni
    { name: "Utils", lucideIcon: "wrench" },
];




function createNode(direction, newState, oldState) {
    if (store.mode === "picker") {
        console.debug("[gamepadControl] createNode: already in picker mode, aborting");
        return;
    }
    const options = createMenuOptions.map(opt => ({
        label: opt.name,
        value: opt.name,
        icon: opt.lucideIcon || undefined
    }));

    store = {
        ...store,
        mode: "picker",
        picker: {
            options,
            selectedIndex: 0,
            closeMenu: null,
            direction
        }
    };
    console.debug("[gamepadControl] createNode: set mode to 'picker'");

    const closeMenu = showPickerMenu({
        items: options,
        title: "Create Node",
        layout: "grid",
        onSelect: (item, idx) => {
            console.debug("[gamepadControl] showPickerMenu onSelect: item.value =", item.value, "idx =", idx, "store.mode =", store.mode);
            if (item.value === "Number") {
                console.debug("[gamepadControl] Number option selected, closing picker and showing number picker. store before closeMenu:", JSON.stringify(store));
                closeMenu();
                console.debug("[gamepadControl] Picker menu closed. store after closeMenu:", JSON.stringify(store));
                store = {
                    ...store,
                    mode: "number-picker",
                    picker: null
                };
                console.debug("[gamepadControl] store set to number-picker mode:", JSON.stringify(store));
                showNumberPickerMenu({
                    title: "Pick a Number",
                    initialValue: 0,
                    min: -9999,
                    max: 9999,
                    step: 1,
                    onSelect: (numberValue) => {
                        console.debug("[gamepadControl] Number picker returned value:", numberValue, "store before reset:", JSON.stringify(store));
                        store = {
                            ...store,
                            mode: "normal",
                            picker: null
                        };
                        console.debug("[gamepadControl] store set to normal mode after number picker:", JSON.stringify(store));
                        // TODO: insert number node at direction with value numberValue
                    }
                });
                console.debug("[gamepadControl] showNumberPickerMenu called");
            } else {
                console.debug("[gamepadControl] Non-number option selected:", item.value, "store before closeMenu:", JSON.stringify(store));
                closeMenu();
                store = {
                    ...store,
                    mode: "normal",
                    picker: null
                };
                console.debug("[gamepadControl] store set to normal mode after non-number:", JSON.stringify(store));
                if (typeof store.onPickerSelect === 'function') {
                    store.onPickerSelect(item, idx, direction);
                }
            }
        }
    });

    store = {
        ...store,
        picker: {
            ...store.picker,
            closeMenu
        }
    };
    console.debug("[gamepadControl] createNode: picker menu shown, closeMenu set");
}


function replaceNode(newState, oldState) {
    createNode("replace", newState, oldState);
}


function createNodeBefore(newState, oldState) {
    createNode("before", newState, oldState);
}


function createNodeAfter(newState, oldState) {
    createNode("after", newState, oldState);
}


function cancelAction(newState, oldState) {
    // If in picker mode, close picker and return to normal
    if (store.mode === "picker" && store.picker && typeof store.picker.closeMenu === 'function') {
        store.picker.closeMenu();
    }
    store = {
        ...store,
        mode: "normal",
        picker: null
    };
}

function pressedButtons(state) {
    return Object.entries(state.buttons)
        .filter(([key, value]) => value.pressed)
        .map(([key, value]) => key);
}

function deleteNode(newState, oldState) {
    if (!editorView) return;
    const state = editorView.state;
    const cursor = state.field(nodeTreeCursorField, false);
    if (!cursor || !cursor.getNode) return;
    const node = cursor.getNode();
    if (!node) return;
    const range = getTrimmedRange(node, state);
    if (!range) return;

    // Find whitespace after node's end
    const doc = state.doc;
    let whitespaceEnd = range.to;
    const docLen = doc.length;
    while (whitespaceEnd < docLen) {
        const ch = doc.sliceString(whitespaceEnd, whitespaceEnd + 1);
        if (ch === ' ' || ch === '\t') {
            whitespaceEnd++;
        } else if (ch === '\n') {
            whitespaceEnd++;
            break;
        } else {
            break;
        }
    }

    editorView.dispatch({
        changes: { from: range.from, to: whitespaceEnd, insert: "" },
        selection: { anchor: range.from },
        scrollIntoView: true,
        userEvent: "delete.node"
    });
}


function handleButtonPresses(newState, oldState) {
    // Debug: log all pressed buttons to help identify button names
    const pressed = pressedButtons(newState);
    if (pressed.length > 0) {
        console.debug('[gamepadControl] Pressed buttons:', pressed);
    }
    if (newState.mode === "picker" && store.picker) {
        // Handle picker menu navigation with d-pad and selection/cancel
        const pressed = pressedButtons(newState);
        const prevPressed = pressedButtons(oldState);
        const justPressed = btn => pressed.includes(btn) && !prevPressed.includes(btn);
        let idx = store.picker.selectedIndex;
        const optionsLen = store.picker.options.length;
        let changed = false;

        if (justPressed("Left") || justPressed("Up")) {
            idx = (idx - 1 + optionsLen) % optionsLen;
            changed = true;
        } else if (justPressed("Right") || justPressed("Down")) {
            idx = (idx + 1) % optionsLen;
            changed = true;
        }
        if (changed) {
            store.picker.selectedIndex = idx;
            // Visually update active item
            // (handled by pickerMenu, but could be exposed via API if needed)
        }
        if (justPressed("A") || justPressed("Enter") || justPressed(" ")) {
            // Select current item
            const item = store.picker.options[idx];
            if (typeof store.picker.closeMenu === 'function') {
                store.picker.closeMenu();
            }
            store = {
                ...store,
                mode: "normal",
                picker: null
            };
            if (typeof store.onPickerSelect === 'function') {
                store.onPickerSelect(item, idx, store.picker.direction);
            }
            return;
        }
        if (justPressed("B") || justPressed("Escape")) {
            cancelAction(newState, oldState);
            return;
        }
        return;
    }

    // Handle number increment/decrement in normal mode with LB/RB
    if (newState.mode === "normal" && editorView) {
        const pressed = pressedButtons(newState);
        const prevPressed = pressedButtons(oldState);
        const justPressed = btn => pressed.includes(btn) && !prevPressed.includes(btn);

        if (justPressed("LB") || justPressed("RB")) {
            const state = editorView.state;
            const cursor = state.field(nodeTreeCursorField, false);
            if (cursor && cursor.getNode) {
                const node = cursor.getNode();
                if (isNumberNode(node)) {
                    const currentValue = getNumberNodeValue(node, state);
                    if (currentValue !== null) {
                        const newValue = justPressed("LB")
                            ? currentValue - 1
                            : currentValue + 1;
                        setNumberNodeValue(editorView, node, newValue);
                        return;
                    }
                }
            }
        }
    }

    let map = null;
    if (newState.mode === "normal") {
        map = {
            "LB+A": createNodeBefore,
            "RB+A": createNodeAfter,
            "B": cancelAction,
            "X": replaceNode,
            "Y": deleteNode,
            "Start": function runEvalNow(newState, oldState) {
                if (editorView) {
                    evalNow({ state: editorView.state, view: editorView });
                }
            },
            "Select": function toggleNavMode() {
                toggleNavigationMode();
            },
            "Back": function toggleNavMode(newState, oldState) {
                toggleNavigationMode();
            },
        };
    }

    if (map) {
        const pressed = pressedButtons(newState);
        if (pressed.length === 0) {
            return newState;
        }

        // Sort map keys by number of buttons in combination (descending)
        const sortedKeys = Object.keys(map).sort((a, b) => b.split("+").length - a.split("+").length);

        for (const key of sortedKeys) {
            const combo = key.split("+");
            const allPressed = combo.every(btn => pressed.includes(btn));
            const newPresses = combo.map(btn => newPress(btn, newState, oldState));
            const isNew = newPresses.some(Boolean);
            if (allPressed) {
                if (isNew) {
                    if (typeof map[key] === 'function') {
                        map[key](newState, oldState);
                    }
                    break;
                }
            }
        }
    }
}

function handlePickerNavigation(newState, oldState) {
    // If in picker mode, change active selection instead of navigating the editor
    if (newState.mode === "picker" && newState.picker) {
        console.debug("[gamepadControl] handlePickerNavigation: mode is 'picker', picker exists");
        const prevPressed = pressedButtons(oldState);
        const pressed = pressedButtons(newState);
        const justPressed = btn => pressed.includes(btn) && !prevPressed.includes(btn);
        let idx = newState.picker.selectedIndex;
        const optionsLen = newState.picker.options.length;
        let changed = false;

        if (justPressed("Left") || justPressed("Up")) {
            console.debug("[gamepadControl] D-pad Left/Up pressed in picker");
            idx = (idx - 1 + optionsLen) % optionsLen;
            changed = true;
        } else if (justPressed("Right") || justPressed("Down")) {
            console.debug("[gamepadControl] D-pad Right/Down pressed in picker");
            idx = (idx + 1) % optionsLen;
            changed = true;
        }
        if (changed) {
            console.debug(`[gamepadControl] Picker index changed to ${idx}`);
            store.picker.selectedIndex = idx;
            // Dispatch a custom event so the pickerMenu UI updates
            window.dispatchEvent(new CustomEvent('gamepadpickerinput', {
                detail: {
                    direction: justPressed("Left") || justPressed("Up") ? 'left' : 'right'
                }
            }));
        } else {
            console.debug("[gamepadControl] No picker index change");
        }
        return;
    } else {
        console.debug("[gamepadControl] handlePickerNavigation: mode is not 'picker' or picker missing");
    }
}

function handleGamepadPoll(currentStore, oldGamepadState) {
    console.debug(`[gamepadControl] handleGamepadPoll: mode=${currentStore.mode}`);

    if (currentStore.mode === "normal") {
        console.debug("[gamepadControl] Dispatching handleButtonNavigation");
        handleButtonNavigation(currentStore, oldGamepadState);
    } else if (currentStore.mode === "picker") {
        console.debug("[gamepadControl] Dispatching handlePickerNavigation");
        handlePickerNavigation(currentStore, oldGamepadState);
    }
    // Do not handle button presses in number-picker mode
    if (currentStore.mode !== "number-picker") {
        handleButtonPresses(currentStore, oldGamepadState);
        // Hide cursor on any gamepad input
        hideEditorCursor();
    }
    // store is already updated in loop()
}

function isNumberNode(node) {
    // Simple check: node.type.name === "Number" or similar
    return node && (node.type?.name === "Number" || node.type === "Number");
}

function getNumberNodeValue(node, state) {
    // Assumes node has from/to and state.doc
    if (!node || typeof node.from !== "number" || typeof node.to !== "number") return null;
    const text = state.doc.sliceString(node.from, node.to);
    const num = Number(text);
    return isNaN(num) ? null : num;
}

function setNumberNodeValue(editorView, node, value) {
    if (!node || typeof node.from !== "number" || typeof node.to !== "number") return;
    const doc = editorView.state.doc;
    const originalText = doc.sliceString(node.from, node.to);

    // Match leading/trailing whitespace
    const match = originalText.match(/^(\s*)(.*?)(\s*)$/);
    const leading = match ? match[1] : "";
    const trailing = match ? match[3] : "";

    const newText = `${leading}${value}${trailing}`;
    editorView.dispatch({
        changes: { from: node.from, to: node.to, insert: newText },
        selection: { anchor: node.from + leading.length },
        scrollIntoView: true,
        userEvent: "edit.number"
    });
}