import {initGamepad, pollGamepad } from "../io/gamepad.mjs"
import { navigateIn, navigateNext, navigateOut, navigatePrev } from "./extensions/structure/navigation.mjs";


let editorView = null;

export function initGamepadControl(view) {
    editorView = view;
    initGamepad();
    requestAnimationFrame(loop);
}

function loop(){
    handleGamepadPoll(pollGamepad());
    requestAnimationFrame(loop);
}

let store = {
    mode: "normal", // also edit, move, etc
}

// functionalities to implement:
// navigation
// deletion
// insertion
// duplication
// moving
// toggling collapse

function newPress(buttonName, newState, oldState){
    let test = newState.buttons[buttonName].pressed && !oldState.buttons[buttonName].pressed;
    if (test)
    {
        console.log(`${buttonName} pressed at time ${newState.timestamp}`)
    }
    return test;
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
        } else {
            console.log(`Button ${buttonThatTriggered} resulted in null transaction.`);
        }
    }
}

function normalModeHandler(newState, oldState) {
    handleButtonNavigation(newState, oldState);
}

function handleButtonPresses(newState, oldState) {

}

function handleGamepadPoll(newPoll) {
//     {
//     "timestamp": 1746628659831,
//     "buttons": {
//         "A": {
//             "pressed": true,
//             "value": 1
//         },
//         "B": {
//             "pressed": false,
//             "value": 0
//         },
//         "X": {
//             "pressed": true,
//             "value": 1
//         },
//         "Y": {
//             "pressed": false,
//             "value": 0
//         },
//         "LB": {
//             "pressed": false,
//             "value": 0
//         },
//         "RB": {
//             "pressed": false,
//             "value": 0
//         },
//         "LT": {
//             "pressed": false,
//             "value": 0
//         },
//         "RT": {
//             "pressed": false,
//             "value": 0
//         },
//         "Back": {
//             "pressed": false,
//             "value": 0
//         },
//         "Start": {
//             "pressed": false,
//             "value": 0
//         },
//         "LeftStickPress": {
//             "pressed": false,
//             "value": 0
//         },
//         "RightStickPress": {
//             "pressed": false,
//             "value": 0
//         },
//         "Up": {
//             "pressed": false,
//             "value": 0
//         },
//         "Down": {
//             "pressed": false,
//             "value": 0
//         },
//         "Left": {
//             "pressed": false,
//             "value": 0
//         },
//         "Right": {
//             "pressed": false,
//             "value": 0
//         },
//         "Button16": {
//             "pressed": false,
//             "value": 0
//         }
//     },
//     "axes": {
//         "LeftStickX": 0,
//         "LeftStickY": 0,
//         "RightStickX": 0,
//         "RightStickY": 0
//     },
//     "events": []
// }

    handleButtonNavigation(newPoll, store);
    handleButtonPresses(newPoll, store);

    store = {...store, ...newPoll};
}