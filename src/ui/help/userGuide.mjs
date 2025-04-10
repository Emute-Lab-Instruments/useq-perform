import { makeTabs } from "../tabs.mjs";
import { dbg } from "../../utils.mjs";

export function makeUserGuide() {
    dbg("userGuide.mjs makeUserGuide: Creating user guide panel");

    // Create a container div for the user guide content
    const $container = $('<div id="userguide-container">');

    // Create a dropdown for beginner and advanced guides
    const $dropdown = $(
        '<div id="userguide-dropdown">' +
        '  <label for="userguide-select">Experience level: </label>' +
        '  <select id="userguide-select">' +
        '    <option value="beginner">Beginner</option>' +
        '    <option value="advanced">Advanced</option>' +
        '  </select>' +
        '</div>'
    );
    $container.append($dropdown);

    // Create a content area for the user guide
    const $content = $('<div id="userguide-content">Loading user guide...</div>');
    $container.append($content);

    // Initialize the dropdown functionality
    initUserGuideDropdown($dropdown, $content);

    return $container;
}

function initUserGuideDropdown($dropdown, $content) {
    const loadGuide = (type) => {
        const url = `assets/userguide_${type}.html`;
        $content.html("<div class='loading-indicator'>Loading user guide...</div>");

        $.get(url, function(data) {
            $content.html(data);
        }).fail(function() {
            $content.html('<p>Error loading user guide. Please try refreshing the page.</p>');
        });
    };

    // Set up dropdown change handler
    $dropdown.find('#userguide-select').on('change', (event) => {
        const selectedValue = event.target.value;
        dbg(`userGuide.mjs: Loading ${selectedValue} guide`);
        localStorage.setItem('useqExperienceLevel', selectedValue);
        loadGuide(selectedValue);
    });

    // Load the saved experience level or default to beginner
    const savedExperience = localStorage.getItem('useqExperienceLevel') || 'beginner';
    $dropdown.find('#userguide-select').val(savedExperience);
    loadGuide(savedExperience);
}
