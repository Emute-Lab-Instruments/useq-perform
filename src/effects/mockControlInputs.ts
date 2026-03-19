/**
 * Mock Control Inputs
 *
 * Simulates the hardware control inputs (CV inputs, switches, etc.) that would
 * normally come from the uSEQ module. These can be manually controlled via sliders
 * in the devmode panel to test code that uses control inputs.
 */

import { dbg } from '../lib/debug.ts';
import { evalInUseqWasm } from '../runtime/wasmInterpreter.ts';

/** Known control input names */
export type ControlName = 'ain1' | 'ain2' | 'din1' | 'din2' | 'swm' | 'swt';

/** Callback signature for value change listeners */
export type ValueChangeListener = (name: ControlName, newValue: number, oldValue: number) => void;

/** Control type for UI display */
export type ControlType = 'continuous' | 'binary' | 'ternary';

/** Control definition for UI display */
export interface ControlDefinition {
    name: ControlName;
    label: string;
    description: string;
    type: ControlType;
    min: number;
    max: number;
    step: number;
    default: number;
}

// Control input state
const controlValues: Record<ControlName, number> = {
    ain1: 0.5,  // CV input 1 (0-1)
    ain2: 0.5,  // CV input 2 (0-1)
    din1: 0,    // Pulse input 1 (0 or 1)
    din2: 0,    // Pulse input 2 (0 or 1)
    swm: 0,     // Momentary switch (0 or 1)
    swt: 0.5    // Toggle switch (0, 0.5, or 1)
};

function normaliseControlName(name: string): string | null {
    if (typeof name !== 'string') {
        return null;
    }
    const trimmed = name.trim();
    if (!trimmed) {
        return null;
    }
    const sanitised = trimmed.replace(/[^a-z0-9-]/gi, '');
    if (!sanitised) {
        return null;
    }
    return sanitised;
}

function formatControlValueLiteral(value: number): string {
    if (!Number.isFinite(value)) {
        return '0';
    }
    if (Number.isInteger(value)) {
        return String(value);
    }
    return value.toFixed(6).replace(/\.0+$/, '').replace(/0+$/, '').replace(/\.$/, '');
}

// Listeners for value changes
const valueChangeListeners = new Set<ValueChangeListener>();

/**
 * Set a control input value
 */
export function setControlValue(name: ControlName, value: number): void {
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
 */
export function getControlValue(name: ControlName): number {
    return controlValues[name] ?? 0;
}

/**
 * Get all control values
 */
export function getAllControlValues(): Record<ControlName, number> {
    return { ...controlValues };
}

/**
 * Reset all controls to default values
 */
export function resetAllControls(): void {
    setControlValue('ain1', 0.5);
    setControlValue('ain2', 0.5);
    setControlValue('din1', 0);
    setControlValue('din2', 0);
    setControlValue('swm', 0);
    setControlValue('swt', 0.5);
}

/**
 * Add a listener for value changes
 */
export function addValueChangeListener(callback: ValueChangeListener): void {
    valueChangeListeners.add(callback);
}

/**
 * Remove a value change listener
 */
export function removeValueChangeListener(callback: ValueChangeListener): void {
    valueChangeListeners.delete(callback);
}

/**
 * Notify all listeners of a value change
 */
function notifyValueChanged(name: ControlName, newValue: number, oldValue: number): void {
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
 */
async function updateInterpreterValue(name: string, value: number): Promise<void> {
    try {
        const normalised = normaliseControlName(name);
        if (!normalised) {
            dbg(`mockControlInputs: refusing to define invalid control name "${name}"`);
            return;
        }

        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            dbg(`mockControlInputs: control ${normalised} value ${value} is not finite`);
            return;
        }

        const literal = formatControlValueLiteral(numericValue);

        // Represent hardware input functions as zero-arg functions that return the latest mock value.
        await evalInUseqWasm(`(defn ${normalised} () ${literal})`);
    } catch (error) {
        dbg(`mockControlInputs: failed to update interpreter for ${name}: ${error}`);
    }
}

/**
 * Initialize all mock control values in the WASM interpreter
 */
export async function initializeMockControls(): Promise<void> {
    dbg('mockControlInputs: initializing mock controls in interpreter');

    for (const [name, value] of Object.entries(controlValues)) {
        await updateInterpreterValue(name, value);
    }
}

/**
 * Get control metadata for UI display
 */
export function getControlDefinitions(): ControlDefinition[] {
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
