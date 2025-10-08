/**
 * Mock Control Inputs
 *
 * Simulates the hardware control inputs (CV inputs, switches, etc.) that would
 * normally come from the uSEQ module. These can be manually controlled via sliders
 * in the devmode panel to test code that uses control inputs.
 */

import { dbg } from '../utils.mjs';
import { evalInUseqWasm } from './useqWasmInterpreter.mjs';

// Control input state
const controlValues = {
    ain1: 0.5,  // CV input 1 (0-1)
    ain2: 0.5,  // CV input 2 (0-1)
    din1: 0,    // Pulse input 1 (0 or 1)
    din2: 0,    // Pulse input 2 (0 or 1)
    swm: 0,     // Momentary switch (0 or 1)
    swt: 0.5    // Toggle switch (0, 0.5, or 1)
};

// Listeners for value changes
const valueChangeListeners = new Set();

/**
 * Set a control input value
 * @param {string} name - Control name (ain1, ain2, din1, din2, swm, swt)
 * @param {number} value - Value to set (0-1)
 */
export function setControlValue(name, value) {
    if (!(name in controlValues)) {
        dbg(`mockControlInputs: unknown control "${name}"`);
        return;
    }

    const oldValue = controlValues[name];
    controlValues[name] = value;

    dbg(`mockControlInputs: ${name} = ${value}`);

    // Notify listeners
    notifyValueChanged(name, value, oldValue);

    // Update the WASM interpreter with mock values
    // We do this by defining the control as a signal in the interpreter
    updateInterpreterValue(name, value);
}

/**
 * Get a control input value
 * @param {string} name - Control name
 * @returns {number} Current value
 */
export function getControlValue(name) {
    return controlValues[name] ?? 0;
}

/**
 * Get all control values
 * @returns {object} Object with all control values
 */
export function getAllControlValues() {
    return { ...controlValues };
}

/**
 * Reset all controls to default values
 */
export function resetAllControls() {
    setControlValue('ain1', 0.5);
    setControlValue('ain2', 0.5);
    setControlValue('din1', 0);
    setControlValue('din2', 0);
    setControlValue('swm', 0);
    setControlValue('swt', 0.5);
}

/**
 * Add a listener for value changes
 * @param {function} callback - Called with (name, newValue, oldValue)
 */
export function addValueChangeListener(callback) {
    valueChangeListeners.add(callback);
}

/**
 * Remove a value change listener
 * @param {function} callback - The callback to remove
 */
export function removeValueChangeListener(callback) {
    valueChangeListeners.delete(callback);
}

/**
 * Notify all listeners of a value change
 * @param {string} name - Control name
 * @param {number} newValue - New value
 * @param {number} oldValue - Previous value
 */
function notifyValueChanged(name, newValue, oldValue) {
    for (const listener of valueChangeListeners) {
        try {
            listener(name, newValue, oldValue);
        } catch (error) {
            dbg(`mockControlInputs: listener error: ${error}`);
        }
    }
}

/**
 * Update the WASM interpreter with a mock control value
 * We do this by defining the control as a constant signal
 * @param {string} name - Control name
 * @param {number} value - Value to set
 */
async function updateInterpreterValue(name, value) {
    try {
        // Define the control as a signal in the interpreter
        // This makes it available for use in expressions
        await evalInUseqWasm(`(defsig ${name} ${value})`);
    } catch (error) {
        dbg(`mockControlInputs: failed to update interpreter for ${name}: ${error}`);
    }
}

/**
 * Initialize all mock control values in the WASM interpreter
 */
export async function initializeMockControls() {
    dbg('mockControlInputs: initializing mock controls in interpreter');

    for (const [name, value] of Object.entries(controlValues)) {
        await updateInterpreterValue(name, value);
    }
}

/**
 * Get control metadata for UI display
 * @returns {Array} Array of control definitions
 */
export function getControlDefinitions() {
    return [
        {
            name: 'ain1',
            label: 'CV Input 1',
            description: 'Analog CV input 1 (0-1)',
            type: 'continuous',
            min: 0,
            max: 1,
            step: 0.01,
            default: 0.5
        },
        {
            name: 'ain2',
            label: 'CV Input 2',
            description: 'Analog CV input 2 (0-1)',
            type: 'continuous',
            min: 0,
            max: 1,
            step: 0.01,
            default: 0.5
        },
        {
            name: 'din1',
            label: 'Pulse Input 1',
            description: 'Digital gate/trigger input 1',
            type: 'binary',
            min: 0,
            max: 1,
            step: 1,
            default: 0
        },
        {
            name: 'din2',
            label: 'Pulse Input 2',
            description: 'Digital gate/trigger input 2',
            type: 'binary',
            min: 0,
            max: 1,
            step: 1,
            default: 0
        },
        {
            name: 'swm',
            label: 'Momentary Switch',
            description: 'Momentary push button',
            type: 'binary',
            min: 0,
            max: 1,
            step: 1,
            default: 0
        },
        {
            name: 'swt',
            label: 'Toggle Switch',
            description: 'Three-position toggle switch',
            type: 'ternary',
            min: 0,
            max: 1,
            step: 0.5,
            default: 0.5
        }
    ];
}
