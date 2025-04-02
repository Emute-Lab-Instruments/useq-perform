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
                const $activeButtons = $nav.find('.panel-nav-button.active');
                const $activeContents = $window.find('.panel-tab-content.active');
                
                // Find content by ID to ensure we have the right element
                const $contentById = $(`#${tab.id.replace('-tab-', '-')}`);
                
                dbg("Tabs", "makeTabs", "Current state:", {
                    activeButtons: $activeButtons.length,
                    activeContents: $activeContents.length,
                    buttonIds: $activeButtons.map((i, el) => $(el).attr('id')).get(),
                    contentIds: $activeContents.map((i, el) => $(el).attr('id')).get(),
                    contentElement: $content[0],
                    contentById: $contentById[0],
                    contentParent: $content.parent()[0],
                    contentInWindow: $window.find(`#${tab.id.replace('-tab-', '-')}`).length
                });
                
                // Deactivate all tabs within this window only
                $nav.find('.panel-nav-button').removeClass('active');
                $window.find('.panel-tab-content').removeClass('active');
                
                // Debug after deactivation
                dbg("Tabs", "makeTabs", "After deactivation:", {
                    activeButtons: $nav.find('.panel-nav-button.active').length,
                    activeContents: $window.find('.panel-tab-content.active').length,
                    contentClasses: $content.attr('class'),
                    contentByIdClasses: $contentById.attr('class')
                });
                
                // Activate clicked tab
                $button.addClass('active');
                $contentById.addClass('active');
                
                // Debug after activation
                dbg("Tabs", "makeTabs", "After activation:", {
                    activeButtons: $nav.find('.panel-nav-button.active').length,
                    activeContents: $window.find('.panel-tab-content.active').length,
                    buttonClasses: $button.attr('class'),
                    contentClasses: $contentById.attr('class'),
                    buttonId: $button.attr('id'),
                    contentId: $contentById.attr('id'),
                    contentElement: $contentById[0],
                    contentParent: $contentById.parent()[0],
                    contentDisplay: $contentById.css('display'),
                    contentVisibility: $contentById.css('visibility'),
                    contentOpacity: $contentById.css('opacity'),
                    contentInWindow: $window.find(`#${tab.id.replace('-tab-', '-')}`).length
                });
                
                // Force a reflow to ensure the display property is updated
                $contentById[0].offsetHeight;
                
                // Double-check the content is visible
                if ($contentById.hasClass('active') && $contentById.css('display') === 'none') {
                    dbg("Tabs", "makeTabs", "Content has active class but is still hidden, forcing display");
                    $contentById.css('display', 'block');
                }
                
                // Trigger a custom event for tab change
                dbg("Tabs", "makeTabs", "Triggering tabchange event", tab.id);
                $window.trigger('tabchange', [tab.id]);
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

    // return a div containing nav and window
    const $container = $('<div>', {
        class: 'panel-tabs-container'
    });
    $container.append($nav, $window);
    return $container;
}
