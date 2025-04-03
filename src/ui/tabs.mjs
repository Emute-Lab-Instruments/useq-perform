import { dbg } from "../utils.mjs";

export function makeTabButton(tab) {
    const classString = ['panel-tab-button', tab.active ? 'active' : ''].join(' ');

    const $button = $('<button>', {
        class: classString,
        id: `${tab.id}-button`,
        text: tab.name
    });
    return $button;
}


export function makeTabs(tabs) {

    // return a div containing nav-bar and tab-window
    const $container = $('<div>', {
        class: 'panel-tab-container'
    });

    // Create navigation bar and window container
    const $navBar = $('<div>', {
        class: 'panel-nav-bar'
    });

    const $window = $('<div>', {
        class: 'panel-tab-window'
    });

    $container.append($navBar);
    $container.append($window);

    // Iterate over the tabs, create & append buttons to nav-bar and content to tab-window
    tabs.forEach(tab => {

        // Create and add the nav button
        const $button = makeTabButton(tab);
        $navBar.append($button);

        // Add the tab content div
        const $content = $(tab.element);
        $content.addClass('panel-tab');

        $content.toggleClass('active', tab.active);
        $window.append($content);

        // Add click handler to toggle tabs
        $button.on('click', () => {
            try {

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
                console.error("Error in tab click handler:", error);
                // Try to recover by forcing the display property
                try {
                    const $contentById = $(`#${tab.id.replace('-tab-', '-')}`);
                    $contentById.css('display', 'block');
                } catch (e) {
                    console.error("Failed to recover:", e);
                }
            }
        });
    });

    return $container;
}
