import { dbg } from "../../utils.mjs";
import { makeTabs } from "../tabs.mjs";
import { makeUserGuide } from "./userGuide.mjs";
import { makeModuLispReference } from "./moduLispReference.mjs";

/**
 * Initialize the help tab within the help panel
 */

/**
 * Initialize the help panel with all tabs
 */
export async function makeHelp() {
    dbg("Help", "makeHelp", "Starting");
    
    // Create a placeholder container for the ModuLisp reference
    const $moduLispPlaceholder = $('<div>', {
        class: 'panel-tab-content',
        id: 'panel-help-reference'
    });
    
    const tabs = [
        {
            name: "User Guide",
            id: "panel-help-tab-guide",
            element: makeUserGuide(),
            active: true
        },
        {
            name: "ModuLisp Reference",
            id: "panel-help-tab-reference",
            element: $moduLispPlaceholder,
            active: false
        },
    ];
    dbg("Help", "makeHelp", "Created tabs array", tabs);

    const result = makeTabs(tabs);
    dbg("Help", "makeHelp", "Created tabs", result);
    
    // Load the ModuLisp reference content asynchronously
    try {
        const $moduLispContent = await makeModuLispReference();
        $moduLispPlaceholder.replaceWith($moduLispContent);
        dbg("Help", "makeHelp", "Loaded ModuLisp reference content");
    } catch (error) {
        dbg("Help", "makeHelp", "Error loading ModuLisp reference", error);
        $moduLispPlaceholder.html('<div class="error-message">Failed to load ModuLisp reference</div>');
    }
    
    return result;

    // initHelpTab(document.querySelector("#panel-help-guide"));
    // initModuLispReferenceTab(document.querySelector("#panel-help-reference"));
    // $("#button-help").click(() => toggleAuxPanel("#panel-help"));
    // setupTabs(container);
}



