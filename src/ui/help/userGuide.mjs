import { makeTabs } from "../tabs.mjs";


export function makeUserGuide() {
    dbg("settings.mjs makeSettings: Creating settings panel");
    
   return makeTabs([
        {
            name: "General",
            id: "panel-settings-tab-general", 
            element: makeGeneralTab(),
            active: true
        },
        {
            name: "Themes",
            id: "panel-settings-tab-themes",
            element: makeThemeTab(),
            active: false
        },
        {
            name: "Keybindings", 
            id: "panel-settings-tab-keybindings",
            element: makeKeybindingsTab(),
            active: false
        },
    ]);
}