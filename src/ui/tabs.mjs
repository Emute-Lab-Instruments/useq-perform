export function makeTabButton(tab) {
    return $('<button>', {
        class: `panel-nav-button ${tab.active ? 'active' : ''}`,
        id: `${tab.id}-button`,
        text: tab.name
    });
}


export function makeTabs(tabs) {
    dbg("makeTabs");
    // Create navigation bar and window container
    const $nav = $('<div>', {
        class: 'panel-nav-bar'
    });

    const $window = $('<div>', {
        class: 'panel-window'
    });

    // Iterate over the tabs and create buttons + content
    tabs.forEach(tab => {
        // Create and add the nav button
        const $button = makeTabButton(tab);
        $nav.append($button);

        // Add the tab content div
        const $content = $(tab.element);
        $content.toggleClass('active', tab.active);
        $window.append($content);

        // Add click handler to toggle tabs
        $button.on('click', () => {
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
