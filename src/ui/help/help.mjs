import { dbg } from "../../utils.mjs";
import { makeUserGuide } from "./userGuide.mjs";
import { makeModuLispReference } from "./moduLispReference.mjs";

/**
 * Initialize the help tab within the help panel
 */
export function initHelpTab(container) {
    // dbg("Help Tab", "initHelpTab", "Starting initialization of the help tab");
    // let isMac = /Mac/.test(navigator.platform);
    // dbg("Help Tab", "initHelpTab", `Detected platform: ${isMac ? 'Mac' : 'Other'}`);
    // if(isMac) {
    //     $("#panel-help").addClass("show-mac");
    //     dbg("Help Tab", "initHelpTab", "Added 'show-mac' class to help panel");
    // }
    // $("#macToggle").on("change", function() {
    //     $("#panel-help").toggleClass("show-mac");
    //     dbg("Help Tab", "initHelpTab", "Toggled 'show-mac' class on help panel");
    // });
}

/**
 * Initialize the help panel with all tabs
 */
export function makeHelpPanel(container) {

    return makeTabs([
        {
            name: "User Guide",
            id: "panel-help-tab-guide",
            element: makeUserGuide(),
        },
        {
            name: "ModuLisp Reference",
            id: "panel-help-tab-reference",
            element: makeModuLispReference(),
        },
    ]);

    // initHelpTab(document.querySelector("#panel-help-guide"));
    // initModuLispReferenceTab(document.querySelector("#panel-help-reference"));
    // $("#button-help").click(() => toggleAuxPanel("#panel-help"));
    // setupTabs(container);
}






/**
 * Set up tab switching functionality for the help panel
 */
function setupTabs(container) {
    const panel = container;
    const tabs = panel.querySelectorAll('.panel-tab');
    const contents = panel.querySelectorAll('.panel-tab-content');

    dbg("setupTabs", "Initializing tab setup", { panel, tabs, contents });

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.id.replace('panel-help-tab-', '');

            dbg("setupTabs", "Tab clicked", { tabId });

            // Update tab states
            tabs.forEach(t => {
                t.classList.remove('active');
                dbg("setupTabs", "Removing active class from tab", { tab: t });
            });
            tab.classList.add('active');
            dbg("setupTabs", "Added active class to tab", { tab });

            // Update content states
            contents.forEach(content => {
                if (content.id === `panel-help-${tabId}`) {
                    content.classList.add('active');
                    dbg("setupTabs", "Added active class to content", { content });
                } else {
                    content.classList.remove('active');
                    dbg("setupTabs", "Removed active class from content", { content });
                }
            });
        });
    });

    dbg("setupTabs", "Tab setup complete");
}