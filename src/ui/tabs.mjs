import { dbg } from "../utils.mjs";

export function makeTabButton(tab) {
    const classString = ['panel-tab-button', tab.active ? 'active' : ''].join(' ');

    dbg("Tabs", "makeTabButton", "Creating button for tab", tab);
    const $button = $('<button>', {
        class: classString,
        id: `${tab.id}-button`,
        text: tab.name
    });
    dbg("Tabs", "makeTabButton", "Created button", $button[0]);
    return $button;
}


export function makeTabs(tabs) {
    dbg("Tabs", "makeTabs", "Starting with tabs", tabs);

    // return a div containing nav-bar and tab-window
    const $container = $('<div>', {
        class: 'panel-tab-container'
    });

    // Create navigation bar and window container
    const $navBar = $('<div>', {
        class: 'panel-nav-bar'
    });
    dbg("Tabs", "makeTabs", "Created nav container", $navBar[0]);

    const $window = $('<div>', {
        class: 'panel-tab-window'
    });
    dbg("Tabs", "makeTabs", "Created window container", $window[0]);

    $container.append($navBar);
    $container.append($window);

    // Iterate over the tabs, create & append buttons to nav-bar and content to tab-window
    tabs.forEach(tab => {
        dbg("Tabs", "makeTabs", "Processing tab", tab);

        // Create and add the nav button
        const $button = makeTabButton(tab);
        dbg("Tabs", "makeTabs", "Appending button to nav", $button[0]);
        $navBar.append($button);

        // Add the tab content div
        const $content = $(tab.element);
        $content.addClass('panel-tab');

        dbg("Tabs", "makeTabs", "Got content element", $content[0]);
        dbg("Tabs", "makeTabs", "Content classes before toggle", $content.attr('class'));
        $content.toggleClass('active', tab.active);
        dbg("Tabs", "makeTabs", "Content classes after toggle", $content.attr('class'));
        dbg("Tabs", "makeTabs", "Appending content to window", $content[0]);
        $window.append($content);

        // Add click handler to toggle tabs
        $button.on('click', () => {
            try {
                dbg("Tabs", "makeTabs", "Tab clicked", tab.name);

                // Debug the current state of elements
                const $activeButtons = $navBar.find('.panel-tab-button.active');
                const $activeContents = $window.find('.panel-tab.active');

                // Deactivate all tabs within this window only
                $activeButtons.removeClass('active');
                $activeContents.removeClass('active');

                // Activate clicked tab
                $button.addClass('active');
                $content.addClass('active');
            } catch (error) {
                dbg("Tabs", "makeTabs", "Error in click handler", error);
                console.error("Error in tab click handler:", error);
                // Try to recover by forcing the display property
                try {
                    const $contentById = $(`#${tab.id.replace('-tab-', '-')}`);
                    $contentById.css('display', 'block');
                    dbg("Tabs", "makeTabs", "Recovered by forcing display property");
                } catch (e) {
                    console.error("Failed to recover:", e);
                }
            }
        });
    });

    return $container;
}
