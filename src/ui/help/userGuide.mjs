import { makeTabs } from "../tabs.mjs";
import { dbg } from "../../utils.mjs";


export function makeUserGuide() {
    dbg("settings.mjs makeSettings: Creating settings panel");
    
    // Create a container div for the user guide content
    const $container = $('<div>');
    
    // Load the HTML content using jQuery ajax
    $.get("/userguide.html", function(data) {
        $container.html(data);
    });

    return $container;
}