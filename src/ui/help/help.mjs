import { dbg } from "../../utils.mjs";
import { toggleAuxPanel } from '../ui.mjs';
import { adjustDocPanelForTheme, initDocumentationTab } from './documentation.mjs';

/**
 * Initialize the help tab within the help panel
 */
export function initHelpTab() {
    dbg("Initializing help tab");
    
    // Mac shortcut toggle
    let isMac = /Mac/.test(navigator.platform);
    
    // Set initial OS-specific keybinding class
    if(isMac) {
        $("#panel-help-docs").addClass("show-mac");
    }
    
    // Mac toggle functionality
    $("#macToggle").on("change", function() {
        $("#panel-help-docs").toggleClass("show-mac");
    });
}

/**
 * Initialize the help panel with all tabs
 */
export function initHelpPanel() {
    dbg("Initializing help panel");
    
    // Initialize both tabs
    initHelpTab();
    initDocumentationTab();
    
    // Remove previous handlers if any
    $("#button-help").off("click");
    
    // Add click handler directly using addEventListener for more reliable triggering
    document.getElementById("button-help").addEventListener("click", function(e) {
        dbg("Help button clicked - direct event listener");
        
        // Switch to help tab
        const $panel = $('#panel-help-docs');
        $panel.find('.panel-tab[data-tab="help"]').click();
        
        // Use the shared toggleAuxPanel function
        toggleAuxPanel("#panel-help-docs");
        
        // Apply theme styling after panel is open
        if (window.getComputedStyle(document.getElementById("panel-help-docs")).display !== 'none') {
            adjustHelpPanelForTheme();
        }
        
        e.preventDefault();
        e.stopPropagation();
    });

    // Set up tab functionality
    setupTabs();
}

/**
 * Set up tab switching functionality for the help panel
 */
function setupTabs() {
    const panel = document.getElementById('panel-help-docs');
    const tabs = panel.querySelectorAll('.panel-tab');
    const contents = panel.querySelectorAll('.panel-tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            
            // Update tab states
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Update content states
            contents.forEach(content => {
                if (content.dataset.tab === tabId) {
                    content.classList.add('active');
                    // Call appropriate theme adjustment based on active tab
                    if (tabId === 'help') {
                        adjustHelpPanelForTheme();
                    } else if (tabId === 'documentation') {
                        adjustDocPanelForTheme();
                    }
                } else {
                    content.classList.remove('active');
                }
            });
        });
    });
}

/**
 * Adjust help panel elements to ensure readability based on current theme
 */
function adjustHelpPanelForTheme() {
    dbg("Adjusting help panel theme");
    // Determine if we're using a light theme by checking the --text-primary variable
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim();
    
    // Convert the color to RGB to check its brightness
    let isLightText = false;
    if (textColor.startsWith('#')) {
        // For hex color
        const hex = textColor.substring(1);
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        // Calculate perceived brightness
        const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
        isLightText = brightness > 128;
    } else if (textColor.startsWith('rgb')) {
        // For rgb color
        const rgb = textColor.match(/\d+/g);
        if (rgb && rgb.length >= 3) {
            const r = parseInt(rgb[0]);
            const g = parseInt(rgb[1]);
            const b = parseInt(rgb[2]);
            const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
            isLightText = brightness > 128;
        }
    }
    
    // If we have light text, we're in a dark theme, otherwise we're in a light theme
    const isLightTheme = !isLightText;
    dbg("Current theme is:", isLightTheme ? "light" : "dark");
    
    if (isLightTheme) {
        // Adjust key bindings for better visibility in light theme
        $('.key-binding').css({
            'background-color': '#f0f0f0',
            'color': '#333',
            'border': '1px solid #ccc',
            'box-shadow': '0 1px 2px rgba(0,0,0,0.1)'
        });
        
        // Make help section headings more visible
        $('#panel-help b').css({
            'color': 'var(--accent-color, #0066cc)'
        });
        
        // Ensure tip icons are visible
        $('.tip-icon').css({
            'color': 'var(--accent-color-secondary, #ff9800)'
        });
    } else {
        // Dark theme - reset to default styles
        $('.key-binding').css({
            'background-color': 'var(--panel-control-bg)',
            'color': 'var(--text-primary)',
            'border': 'none',
            'box-shadow': 'none'
        });
        
        $('#panel-help b').css({
            'color': 'var(--accent-color, #00ff41)'
        });
        
        $('.tip-icon').css({
            'color': 'var(--accent-color-secondary, #ff9800)'
        });
    }
}