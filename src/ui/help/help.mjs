import { dbg } from "../../utils.mjs";
import { toggleAuxPanel } from '../ui.mjs';
import { adjustDocPanelForTheme, initDocumentationTab } from './documentation.mjs';

/**
 * Initialize the help tab within the help panel
 */
export function initHelpTab() {
    dbg("User Guide", "initHelpTab", "Initializing user guide tab");
    
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
    dbg("Help Panel", "initHelpPanel", "Initializing help panel with User Guide and ModuLisp Reference tabs");
    
    // Initialize both tabs
    initHelpTab();
    initDocumentationTab();
    
    // Remove previous handlers if any
    $("#button-help").off("click");
    
    // Add click handler directly using addEventListener for more reliable triggering
    document.getElementById("button-help").addEventListener("click", function(e) {
        dbg("Help button clicked - direct event listener");
        
        // Switch to User Guide tab by default
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