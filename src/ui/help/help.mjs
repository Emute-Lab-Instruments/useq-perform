import { dbg } from "../../utils.mjs";
import { makeTabs } from "../tabs.mjs";
import { makeUserGuide } from "./userGuide.mjs";
import { makeModuLispReference } from "./moduLispReference.mjs";
import { makeKeybindingsTab } from "./keybindings.mjs";


/**
 * Initialize the help tab within the help panel
 */

/**
 * Initialize the help panel with all tabs
 */
export async function makeHelp() {
    dbg("Help", "makeHelp", "Starting");

    const result = makeTabs([
        {
            name: "User Guide",
            id: "panel-help-tab-guide", 
            element: makeUserGuide(),
            active: true
        },
        {
            name: "ModuLisp Reference",
            id: "panel-help-tab-reference",
            element: await makeModuLispReference(),
            active: false
        },
        {
            name: "Keybindings", 
            id: "panel-settings-tab-keybindings",
            element: makeKeybindingsTab(),
            active: false
        }
    ]);
    
    return result;
}



