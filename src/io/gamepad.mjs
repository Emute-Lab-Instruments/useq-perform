/**
 * Gamepad Support Module
 *
 * Provides support for gamepad input using the native browser Gamepad API.
 * Simplified interface for handling a single gamepad controller.
 */
import { dbg } from "../utils.mjs";
import { post } from "./console.mjs";

// Constants for input processing
const AXIS_DEADZONE = 0.1;
const BUTTON_THRESHOLD = 0.1;

// Button mapping for more readable code
const BUTTON_MAP = {
  0: 'A',
  1: 'B',
  2: 'X',
  3: 'Y',
  4: 'LB',
  5: 'RB',
  6: 'LT',
  7: 'RT',
  8: 'Back',
  9: 'Start',
  10: 'LeftStickPress',
  11: 'RightStickPress',
  12: 'Up',
  13: 'Down',
  14: 'Left',
  15: 'Right'
};

// Axis mapping for more readable code
const AXIS_MAP = {
  0: 'LeftStickX',
  1: 'LeftStickY',
  2: 'RightStickX',
  3: 'RightStickY'
};

// State tracking
let primaryGamepadIndex = null;
let previousState = null;

/**
 * Initialize gamepad support
 * @returns {boolean} Whether gamepad support was successfully initialized
 */
export function initGamepad() {
  // Check API support
  if (!navigator.getGamepads) {
    post("**Warning**: Gamepad API is not supported in this browser.");
    return false;
  }

  // Set up event listeners
  window.addEventListener("gamepadconnected", handleGamepadConnected);
  window.addEventListener("gamepaddisconnected", handleGamepadDisconnected);

  // Check for already connected gamepads
  const connectedGamepads = navigator.getGamepads();
  for (let i = 0; i < connectedGamepads.length; i++) {
    if (connectedGamepads[i]) {
      handleGamepadConnected({ gamepad: connectedGamepads[i] });
      break; // Only use the first connected gamepad
    }
  }

  post("Gamepad support initialized. Connect a controller to begin.");
  return true;
}

/**
 * Handle gamepad connected event
 * @param {GamepadEvent} event - The gamepad connection event
 */
function handleGamepadConnected(event) {
  const gamepad = event.gamepad || event.detail.gamepad;
  
  // If we don't have a primary gamepad yet, use this one
  if (primaryGamepadIndex === null) {
    primaryGamepadIndex = gamepad.index;
    
    // Initialize previous state
    previousState = createEmptyState();
    
    post(`**Gamepad Connected**: ${gamepad.id} (index: ${gamepad.index})`);
    dbg("Primary gamepad connected:", gamepad);
  }
}

/**
 * Handle gamepad disconnected event
 * @param {GamepadEvent} event - The gamepad disconnection event
 */
function handleGamepadDisconnected(event) {
  const gamepad = event.gamepad;
  
  // If this was our primary gamepad, clear it
  if (primaryGamepadIndex === gamepad.index) {
    post(`**Primary Gamepad Disconnected**: ${gamepad.id}`);
    primaryGamepadIndex = null;
    previousState = null;
    
    // Try to find another connected gamepad to use
    const connectedGamepads = navigator.getGamepads();
    for (let i = 0; i < connectedGamepads.length; i++) {
      if (connectedGamepads[i] && i !== gamepad.index) {
        handleGamepadConnected({ gamepad: connectedGamepads[i] });
        break;
      }
    }
  }
}

/**
 * Create an empty gamepad state object
 * @returns {Object} Empty state object
 */
function createEmptyState() {
  // Create buttons object with all possible buttons initialized
  const buttons = {};
  Object.values(BUTTON_MAP).forEach(buttonName => {
    buttons[buttonName] = {
      pressed: false,
      value: 0
    };
  });
  
  // Create axes object with all possible axes initialized
  const axes = {};
  Object.values(AXIS_MAP).forEach(axisName => {
    axes[axisName] = 0;
  });
  
  return {
    connected: false,
    id: "",
    index: null,
    timestamp: Date.now(),
    buttons,
    axes,
    events: []
  };
}

/**
 * Apply deadzone to an axis value
 * @param {number} value - The raw axis value
 * @returns {number} The processed axis value
 */
function applyDeadzone(value) {
  return Math.abs(value) < AXIS_DEADZONE ? 0 : value;
}

/**
 * Check if a button is pressed (above threshold)
 * @param {GamepadButton} button - The button to check
 * @returns {boolean} Whether the button is considered pressed
 */
function isButtonPressed(button) {
  return button.value >= BUTTON_THRESHOLD;
}

/**
 * Poll for gamepad state and return the current state
 * @param {Function} [handler] - Optional handler function to process the state
 * @returns {Object} Current gamepad state with any new events
 */
export function pollGamepad(handler = null) {
  // If we don't have a primary gamepad, return empty state
  if (primaryGamepadIndex === null) {
    const emptyState = createEmptyState();
    if (handler) handler(emptyState);
    return emptyState;
  }
  
  // Get the gamepad data
  const gamepads = navigator.getGamepads();
  const gamepad = gamepads[primaryGamepadIndex];
  
  // If the gamepad is no longer connected, return disconnected state
  if (!gamepad) {
    const emptyState = createEmptyState();
    if (handler) handler(emptyState);
    return emptyState;
  }
  
  // Start with a complete state including all possible buttons and axes
  const currentState = createEmptyState();
  
  // Update base properties
  currentState.connected = true;
  currentState.id = gamepad.id || "";
  currentState.index = gamepad.index;
  currentState.timestamp = Date.now();
  
  // Process buttons - only update values for buttons that exist on this gamepad
  for (let i = 0; i < gamepad.buttons.length; i++) {
    const buttonName = BUTTON_MAP[i] || `Button${i}`;
    const buttonValue = gamepad.buttons[i].value;
    const isPressed = isButtonPressed(gamepad.buttons[i]);
    
    // Record current state - the button already exists in the state with defaults
    currentState.buttons[buttonName] = {
      pressed: isPressed,
      value: buttonValue
    };
    
    // Check for changes from previous state
    if (previousState && previousState.connected) {
      const prevButton = previousState.buttons[buttonName];
      if (prevButton) {
        // Button press
        if (isPressed && !prevButton.pressed) {
          currentState.events.push({
            type: 'buttonPressed',
            button: buttonName,
            value: buttonValue,
            timestamp: currentState.timestamp
          });
        }
        // Button release
        else if (!isPressed && prevButton.pressed) {
          currentState.events.push({
            type: 'buttonReleased',
            button: buttonName,
            value: buttonValue,
            timestamp: currentState.timestamp
          });
        }
        // Value change while pressed
        else if (isPressed && 
                Math.abs(buttonValue - prevButton.value) > BUTTON_THRESHOLD) {
          currentState.events.push({
            type: 'buttonValueChanged',
            button: buttonName,
            value: buttonValue,
            previousValue: prevButton.value,
            timestamp: currentState.timestamp
          });
        }
      }
    }
  }
  
  // Process axes - only update values for axes that exist on this gamepad
  for (let i = 0; i < gamepad.axes.length; i++) {
    const axisName = AXIS_MAP[i] || `Axis${i}`;
    const rawValue = gamepad.axes[i];
    const axisValue = applyDeadzone(rawValue);
    
    // Record current state - the axis already exists in the state with defaults
    currentState.axes[axisName] = axisValue;
    
    // Check for changes from previous state
    if (previousState && previousState.connected) {
      const prevValue = previousState.axes[axisName];
      if (Math.abs(axisValue - prevValue) > AXIS_DEADZONE) {
        currentState.events.push({
          type: 'axisChanged',
          axis: axisName,
          value: axisValue,
          previousValue: prevValue,
          timestamp: currentState.timestamp
        });
      }
    }
  }
  
  // Update previous state
  previousState = currentState;
  
  // Call the handler if provided
  if (handler) {
    handler(currentState);
  }
  
  return currentState;
}

/**
 * Check if a gamepad is currently connected
 * @returns {boolean} Whether a gamepad is connected
 */
export function isGamepadConnected() {
  return primaryGamepadIndex !== null;
}

/**
 * Get the index of the primary gamepad
 * @returns {number|null} The index of the primary gamepad or null if none connected
 */
export function getPrimaryGamepadIndex() {
  return primaryGamepadIndex;
}
