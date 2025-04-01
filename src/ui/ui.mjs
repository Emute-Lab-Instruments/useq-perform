import { dbg } from "../utils.mjs";
import { initHelpPanel } from './help/help.mjs';
import { initIcons } from './icons.mjs';
import { initVisPanel } from "./serialVis.mjs";   
import { initConsolePanel } from "./console.mjs";
import { initEditorPanel } from "../editors/main.mjs";
import { initSettingsPanel } from "./settings/settings.mjs";
import { initToolbarPanel } from "./toolbar.mjs";
import { initSnippetsPanel } from "./snippets.mjs";
import { initVisLegend } from "./visLegend.mjs";
import { isPanelVisible } from "./utils.mjs";

// List of panels that support position toggling
const POSITION_TOGGLABLE_PANELS = [
    "#panel-help-docs",
    "#pannel-settings"
];

// Global ESC key handler
$(document).keydown((e) => {
    if (e.key === "Escape") {
        // Find any visible panel using the helper function
        const visiblePanel = $(".panel-aux").filter((_, el) => isPanelVisible(el)).first();
        
        if (visiblePanel.length) {
            dbg("ESC key pressed - closing visible panel:", visiblePanel.attr('id'));
            toggleAuxPanel("#" + visiblePanel.attr('id'));
            e.preventDefault();
            e.stopPropagation();
        }
    }
});

/**
 * Toggle the visibility of an auxiliary panel
 * @param {string} panelID - The CSS selector for the panel to toggle
 * @returns {boolean} - Whether the panel is now visible
 */
export function toggleAuxPanel(panelID) {
    dbg("UI", "toggleAuxPanel", `Toggling panel visibility for ${panelID}`);
    const $panel = $(panelID);
    if (!$panel.length) {
        dbg("UI", "toggleAuxPanel", `Panel ${panelID} not found in the DOM`);
        console.error(`Panel ${panelID} not found in the DOM`);
        return;
    }
    const panelElement = $panel[0];
    const isVisible = isPanelVisible(panelElement);
    dbg("UI", "toggleAuxPanel", `Panel ${panelID} current visibility: ${isVisible}`);
    
    if (!isVisible) {
        // First hide all panels with !important to override any CSS issues
        $(".panel-aux").each(function() {
            this.style.setProperty('display', 'none', 'important');
            this.style.setProperty('visibility', 'hidden', 'important');
            this.style.setProperty('opacity', '0', 'important');
            this.classList.remove('is-opening');
        });
        
        // Remove any existing position toggle buttons
        $('.panel-position-toggle').remove();
        
        // Mark the panel as opening to prevent double-click issues
        panelElement.classList.add('is-opening');
        
        // Show the requested panel with appropriate display value based on its default style
        dbg(`Opening panel ${panelID}`);
        
        // Set display first - use flex instead of block for panels that need it
        if (panelID === '#panel-documentation' || panelID === '#panel-help-docs') {
            panelElement.style.setProperty('display', 'flex', 'important');
        } else {
            panelElement.style.setProperty('display', 'block', 'important');
        }
        
        // Force a reflow to ensure transitions work
        panelElement.offsetHeight;
        
        // Then set visibility and opacity
        panelElement.style.setProperty('visibility', 'visible', 'important');
        panelElement.style.setProperty('opacity', '1', 'important');
        
        // Add position toggle button if this panel supports it
        if (POSITION_TOGGLABLE_PANELS.includes(panelID)) {
            setupPositionToggle(panelID);
        }
        
        // Remove the opening class after transition completes
        setTimeout(() => {
            panelElement.classList.remove('is-opening');
        }, 300); // slightly longer than the CSS transition
    } else {
        // Hide this panel with !important flags
        dbg(`Closing panel ${panelID}`);
        panelElement.style.setProperty('opacity', '0', 'important');
        panelElement.style.setProperty('visibility', 'hidden', 'important');
        panelElement.classList.remove('is-opening');
        
        // Remove the toggle button for this panel
        $(`.panel-position-toggle[data-for="${panelID}"]`).remove();
        
        // Immediately set display to none to force panel to be hidden
        setTimeout(() => {
            panelElement.style.setProperty('display', 'none', 'important');
        }, 200); // matches the transition duration in CSS
    }
    
    return !isVisible; // Return whether the panel is now visible
}

/**
 * Set up position toggle button for panels that support it
 * This allows switching between left, right, or centered positions
 */
function setupPositionToggle(panelID) {
    const positions = ['left', 'center', 'right'];
    const panel = $(panelID)[0];
    
    // Determine current position class, default to center
    let currentPosition = 'center';
    for (const pos of positions) {
        if (panel.classList.contains(pos)) {
            currentPosition = pos;
            break;
        }
    }
    
    // Create toggle button
    const toggleButton = document.createElement('button');
    toggleButton.className = 'panel-position-toggle';
    toggleButton.dataset.for = panelID;
    toggleButton.title = `Position: ${currentPosition} (click to toggle)`;
    toggleButton.innerHTML = getPositionIcon(currentPosition);
    
    // Add click handler
    toggleButton.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        // Cycle through positions: left -> center -> right -> left
        const currentIndex = positions.indexOf(currentPosition);
        const nextIndex = (currentIndex + 1) % positions.length;
        const nextPosition = positions[nextIndex];
        
        // Remove all position classes
        panel.classList.remove(...positions);
        
        // Add the new position class
        panel.classList.add(nextPosition);
        
        // Update button
        currentPosition = nextPosition;
        toggleButton.title = `Position: ${currentPosition} (click to toggle)`;
        toggleButton.innerHTML = getPositionIcon(currentPosition);
    });
    
    document.body.appendChild(toggleButton);
    
    // Position the toggle button relative to the panel
    const rect = panel.getBoundingClientRect();
    toggleButton.style.top = `${rect.top + 10}px`;
    toggleButton.style.left = `${rect.right - 40}px`;
}

/**
 * Get icon HTML for position toggle button
 */
function getPositionIcon(position) {
    if (position === 'left') {
        return '◀';
    } else if (position === 'right') {
        return '▶';
    } else {
        return '■';
    }
}

function initPanels(){
    // Initialize editor first so we can pass its instance to other panels
    const editor = initEditorPanel();
    
    // Initialize other panels
    initConsolePanel();
    initHelpPanel();
    initSettingsPanel();
    initToolbarPanel(editor);
    initVisPanel();
    initSnippetsPanel();
    // initVisLegend();
    
    return editor;
}

export function initUI() {
    const editor = initPanels();
    dbg("UI", "initUI", "UI components initialized");
    return editor;
}