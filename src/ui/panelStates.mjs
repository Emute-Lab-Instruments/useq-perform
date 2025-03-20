/**
 * Panel States Module
 * 
 * Defines constants and state management for UI panels in the application
 */

/**
 * Enumeration of possible panel display states
 * @enum {number}
 */
export const panelStates = 
{
  /** Panel is hidden/closed */
  OFF: 0,
  
  /** Panel is visible in normal/docked mode */
  PANEL: 1,
  
  /** Panel is in fullscreen mode */
  FULLSCREEN: 2
};

/**
 * Current state of all interface panels and related UI elements
 * @type {Object}
 */
export var interfaceStates = {
  /** Current state of the video panel */
  vidpanelState: panelStates.OFF,
  
  /** Whether the camera has been initialized/opened */
  camOpened: false,
  
  /** Current state of the serial visualization panel */
  serialVisPanelState: panelStates.OFF,
  
  /** Current state of the help panel */
  helpPanelState: panelStates.OFF,

  /** Current state of the patches panel */
  patchesPanelState: panelStates.OFF
};

/**
 * Toggle the state of a specific panel
 * @param {string} panelType - The panel identifier in interfaceStates
 * @param {string} elementId - The DOM element ID of the panel
 * @returns {number} The new panel state
 */
export function togglePanelState(panelType, elementId) {
  // Validate that the panelType exists in interfaceStates
  if (!(panelType + 'State' in interfaceStates)) {
    console.error(`Panel type "${panelType}" not found in interfaceStates`);
    return -1;
  }

  const stateKey = panelType + 'State';
  const currentState = interfaceStates[stateKey];
  const $panel = $(`#${elementId}`);
  
  // Toggle between OFF and PANEL states
  if (currentState === panelStates.OFF) {
    interfaceStates[stateKey] = panelStates.PANEL;
    $panel.css('display', 'block');
    // Trigger reflow to ensure transition works
    $panel[0].offsetHeight;
    $panel.addClass('visible');
  } else if (currentState === panelStates.PANEL) {
    interfaceStates[stateKey] = panelStates.OFF;
    $panel.removeClass('visible');
    // Wait for transition to complete before hiding
    setTimeout(() => {
      if (interfaceStates[stateKey] === panelStates.OFF) {
        $panel.css('display', 'none');
      }
    }, 300); // Match the transition duration from CSS
  }

  return interfaceStates[stateKey];
}

/**
 * Set a specific panel to a particular state
 * @param {string} panelType - The panel identifier in interfaceStates
 * @param {number} state - The state to set (use panelStates constants)
 * @param {string} elementId - The DOM element ID of the panel
 */
export function setPanelState(panelType, state, elementId) {
  // Validate that the panelType exists in interfaceStates
  if (!(panelType + 'State' in interfaceStates)) {
    console.error(`Panel type "${panelType}" not found in interfaceStates`);
    return;
  }
  
  const stateKey = panelType + 'State';
  interfaceStates[stateKey] = state;
  
  // Update UI based on the new state
  if (state === panelStates.OFF) {
    $(`#${elementId}`).hide();
  } else if (state === panelStates.PANEL) {
    $(`#${elementId}`).show();
  } else if (state === panelStates.FULLSCREEN) {
    $(`#${elementId}`).show();
    // Additional styling for fullscreen could be added here
  }
}

