import { initHelpPanel } from './help.mjs';
import { initIcons } from './icons.mjs';
import { initVisPanel } from "./serialVis.mjs";   
import { initConsolePanel } from "./console.mjs";
import { initEditorPanel } from "../editors/main.mjs";
import { initSettingsPanel } from "./settings.mjs";
import { initToolbarPanel } from "./toolbar.mjs";
import { initThemePanel } from "./themes.mjs";
import { initSnippetsPanel } from "./snippets.mjs";
import { initDocumentationPanel } from "./documentation.mjs";

// List of panels that support position toggling
const POSITION_TOGGLABLE_PANELS = [
    "#panel-help",
    "#panel-settings",
    "#panel-documentation"
];

/**
 * Toggle the visibility of an auxiliary panel
 * @param {string} panelID - The CSS selector for the panel to toggle
 * @returns {boolean} - Whether the panel is now visible
 */
export function toggleAuxPanel(panelID) {
    console.log(`toggleAuxPanel called for ${panelID}`);
    const $panel = $(panelID);
    
    if (!$panel.length) {
        console.error(`Panel ${panelID} not found in the DOM`);
        return;
    }
    
    // Directly check if panel has display block style to determine visibility
    const isVisible = window.getComputedStyle($panel[0]).display !== 'none';
    
    console.log(`Panel ${panelID} current visibility (computed style):`, isVisible, 
                `display=${window.getComputedStyle($panel[0]).display}`,
                `opacity=${window.getComputedStyle($panel[0]).opacity}`,
                `visibility=${window.getComputedStyle($panel[0]).visibility}`);
    
    if (!isVisible) {
        // First hide all panels with !important to override any CSS issues
        $(".panel-aux").each(function() {
            this.style.setProperty('display', 'none', 'important');
            this.style.setProperty('visibility', 'hidden', 'important');
            this.style.setProperty('opacity', '0', 'important');
        });
        
        // Remove any existing position toggle buttons
        $('.panel-position-toggle').remove();
        
        // Show the requested panel - using inline styles with !important to override any CSS
        console.log(`Opening panel ${panelID}`);
        $panel[0].style.setProperty('display', 'block', 'important');
        
        // Force a reflow to ensure transitions work
        $panel[0].offsetHeight;
        
        $panel[0].style.setProperty('visibility', 'visible', 'important');
        $panel[0].style.setProperty('opacity', '1', 'important');
        
        // Add position toggle button if this panel supports it
        if (POSITION_TOGGLABLE_PANELS.includes(panelID)) {
            setupPositionToggle(panelID);
        }
    } else {
        // Hide this panel with !important flags
        console.log(`Closing panel ${panelID}`);
        $panel[0].style.setProperty('opacity', '0', 'important');
        $panel[0].style.setProperty('visibility', 'hidden', 'important');
        
        // Remove the toggle button for this panel
        $(`.panel-position-toggle[data-for="${panelID}"]`).remove();
        
        // Immediately set display to none to force panel to be hidden
        setTimeout(() => {
            $panel[0].style.setProperty('display', 'none', 'important');
        }, 50);
    }
    
    return !isVisible; // Return whether the panel is now visible
}

/**
 * Toggle the position of a panel between side and centered
 * @param {string} panelID - The CSS selector for the panel to toggle position
 */
export function togglePanelPosition(panelID) {
    const $panel = $(panelID);
    
    if (!$panel.length) {
        console.error(`Panel ${panelID} not found in the DOM`);
        return;
    }
    
    console.log(`Toggling position for panel ${panelID}`);
    
    // Toggle the centered class
    $panel.toggleClass('centered');
    
    // Update the icon to match the current state
    const $toggleBtn = $(`.panel-position-toggle[data-for="${panelID}"]`);
    if ($toggleBtn.length) {
        const isCentered = $panel.hasClass('centered');
        $toggleBtn.attr('title', isCentered ? 'Dock to side' : 'Center panel');
        $toggleBtn.find('i').attr('data-lucide', isCentered ? 'panel-right' : 'layout');
        // Refresh the Lucide icon
        if (window.lucide) {
            window.lucide.createIcons();
        }
        
        // Update button position after position toggle
        setTimeout(() => updateToggleButtonPosition(panelID), 10);
    }
}

/**
 * Set up the position toggle button for a panel
 * @param {string} panelID - The CSS selector for the panel
 */
function setupPositionToggle(panelID) {
    const $panel = $(panelID);
    
    // Add position-togglable class if not already present
    if (!$panel.hasClass('position-togglable')) {
        $panel.addClass('position-togglable');
    }
    
    // Remove any existing toggle button
    $panel.find('.panel-position-toggle').remove();
    $('body > .panel-position-toggle[data-for="' + panelID + '"]').remove();
    
    // Create the position toggle button
    const isCentered = $panel.hasClass('centered');
    const toggleButton = $(`
        <div class="panel-position-toggle" data-for="${panelID}" title="${isCentered ? 'Dock to side' : 'Center panel'}">
            <i data-lucide="${isCentered ? 'panel-right' : 'layout'}"></i>
        </div>
    `);
    
    // Add click handler
    toggleButton.on('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePanelPosition(panelID);
    });
    
    // Add the button to the body instead of the panel so it doesn't scroll
    $('body').append(toggleButton);
    
    // Initialize the Lucide icon
    if (window.lucide) {
        window.lucide.createIcons();
    }
    
    // Position the button correctly
    updateToggleButtonPosition(panelID);
    
    // Add resize listener to update button position if window is resized
    $(window).off('resize.positionToggle').on('resize.positionToggle', () => {
        updateToggleButtonPosition(panelID);
    });
}

/**
 * Update the position of the toggle button for a panel
 * @param {string} panelID - The CSS selector for the panel
 */
function updateToggleButtonPosition(panelID) {
    const $panel = $(panelID);
    const $button = $(`.panel-position-toggle[data-for="${panelID}"]`);
    
    if ($panel.length && $button.length) {
        const panelRect = $panel[0].getBoundingClientRect();
        
        if ($panel.hasClass('centered')) {
            // For centered panel, position at the left edge
            $button.css({
                'left': `${panelRect.left}px`
            });
        } else {
            // For side panel, position just at the left border
            $button.css({
                'left': `${panelRect.left}px`
            });
        }
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
    initThemePanel();
    initVisPanel();
    initSnippetsPanel();
    initDocumentationPanel();
    
    return editor;
}

export function initUI() {
    initIcons();
    const editor = initPanels();
    return editor;
}