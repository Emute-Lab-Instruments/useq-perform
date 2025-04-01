import { dbg } from "../../utils.mjs";
import { toggleAuxPanel } from '../ui.mjs';
import { adjustDocPanelForTheme, initModuLispReferenceTab } from './documentation.mjs';

/**
 * Initialize the help tab within the help panel
 */
export function initHelpTab(container) {
    // dbg("Help Tab", "initHelpTab", "Starting initialization of the help tab");
    // let isMac = /Mac/.test(navigator.platform);
    // dbg("Help Tab", "initHelpTab", `Detected platform: ${isMac ? 'Mac' : 'Other'}`);
    // if(isMac) {
    //     $("#panel-help-docs").addClass("show-mac");
    //     dbg("Help Tab", "initHelpTab", "Added 'show-mac' class to help panel");
    // }
    // $("#macToggle").on("change", function() {
    //     $("#panel-help-docs").toggleClass("show-mac");
    //     dbg("Help Tab", "initHelpTab", "Toggled 'show-mac' class on help panel");
    // });
}

/**
 * Initialize the help panel with all tabs
 */
export function initHelpPanel() {
    dbg("Help Panel", "initHelpPanel", "Starting initialization of the help panel");
    initHelpTab(document.querySelector("#panel-help-guide"));
    initModuLispReferenceTab(document.querySelector("#panel-help-reference"));
    dbg("Help Panel", "initHelpPanel", "Initialized help and documentation tabs");
    $("#button-help").off("click");
    document.getElementById("button-help").addEventListener("click", function(e) {
        dbg("Help Panel", "initHelpPanel", "Help button clicked");
        const $panel = $('#panel-help-docs');
        $panel.find('.panel-tab[data-tab="help"]').click();
        toggleAuxPanel("#panel-help-docs");
        if (window.getComputedStyle(document.getElementById("panel-help-docs")).display !== 'none') {
            adjustHelpPanelForTheme();
            dbg("Help Panel", "initHelpPanel", "Adjusted help panel for theme");
        }
        e.preventDefault();
        e.stopPropagation();
    });
    setupTabs();
    dbg("Help Panel", "initHelpPanel", "Completed initialization of the help panel");
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