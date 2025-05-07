import { initGamepad, pollGamepad } from "../io/gamepad.mjs"
import { navigateIn, navigateNext, navigateOut, navigatePrev } from "./extensions/structure/navigation.mjs";
import { nodeTreeCursorField, getTrimmedRange } from "./extensions/structure.mjs";


let editorView = null;

export function initGamepadControl(view) {
    editorView = view;
    initGamepad();
    requestAnimationFrame(loop);
}

function loop() {
    const poll = pollGamepad();
    handleGamepadPoll(poll);
    requestAnimationFrame(loop);
}

let store = {
    mode: "normal", // also create, edit, move, etc
}

// functionalities to implement:
// navigation DONE
// deletion
// insertion
// duplication
// moving
// toggling collapse

function newPress(buttonName, newState, oldState) {
    return newState.buttons[buttonName].pressed && !oldState.buttons[buttonName].pressed;
}


function handleButtonNavigation(newState, oldState) {
    let action = null;
    let buttonThatTriggered = "NONE";
    const map = {
        "Up": navigateOut,
        "Down": navigateIn,
        "Left": navigatePrev,
        "Right": navigateNext
    };

    for (const [button, handler] of Object.entries(map)) {
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
    // return a state where the mode has been changed to "create",
    // so that next time around the handleGamepadPoll (and, subsequently, the handleButtonPresses) will be delegated to the create mode handler
    // this will be a menu that will allow the user to select the type of node to create, which will then be inserted 
}

function replaceNode(newState, oldState) {
    // like createNode with direction set to "replace"
}

function createNodeBefore(newState, oldState) {
    // like createNode with direction set to "before"
}

function createNodeAfter(newState, oldState) {
    // like createNode with direction set to "after"
}

function cancelAction(newState, oldState) {
    // pop one level of the context stack
    // so, if we were in "create" mode, then we go back to "normal" mode
    // if we were N number of layers deep into nested menus, then we pop to the previous layer
    // close any windows that were associated with the popped layers
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
    let map = null;

    if (newState.mode === "normal") {
        map = {
            "LB+A": createNodeBefore,
            "RB+A": createNodeAfter,
            "B": cancelAction,
            "X": replaceNode,
            "Y": deleteNode,
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

function handleGamepadPoll(newPoll) {
    newPoll = { ...store, ...newPoll };
    handleButtonNavigation(newPoll, store);
    handleButtonPresses(newPoll, store);
    store = { ...store, ...newPoll };
}