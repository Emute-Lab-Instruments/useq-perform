import { dbg } from "../utils.mjs";

export function makeTabButton(tab) {
    dbg("Tabs", "makeTabButton", "Creating button for tab", tab);
    const $button = $('<button>', {
        class: `panel-nav-button ${tab.active ? 'active' : ''}`,
        id: `${tab.id}-button`,
        text: tab.name
    });
    dbg("Tabs", "makeTabButton", "Created button", $button[0]);
    return $button;
}


export function makeTabs(tabs) {
    dbg("Tabs", "makeTabs", "Starting with tabs", tabs);
    
    // Create navigation bar and window container
    const $nav = $('<div>', {
        class: 'panel-nav-bar'
    });
    dbg("Tabs", "makeTabs", "Created nav container", $nav[0]);

    const $window = $('<div>', {
        class: 'panel-window'
    });
    dbg("Tabs", "makeTabs", "Created window container", $window[0]);

    // Iterate over the tabs and create buttons + content
    tabs.forEach(tab => {
        dbg("Tabs", "makeTabs", "Processing tab", tab);
        
        // Create and add the nav button
        const $button = makeTabButton(tab);
        dbg("Tabs", "makeTabs", "Appending button to nav", $button[0]);
        $nav.append($button);

        // Add the tab content div
        const $content = $(tab.element);
        dbg("Tabs", "makeTabs", "Got content element", $content[0]);
        $content.toggleClass('active', tab.active);
        dbg("Tabs", "makeTabs", "Appending content to window", $content[0]);
        $window.append($content);

        // Add click handler to toggle tabs
        $button.on('click', () => {
            dbg("Tabs", "makeTabs", "Tab clicked", tab.name);
            // Deactivate all tabs within this window only
            $nav.find('.panel-nav-button').removeClass('active');
            $window.find('.panel-tab-content').removeClass('active');
            
            // Activate clicked tab
            $button.addClass('active');
            $content.addClass('active');
        });
    });

    return [$nav, $window];
}
