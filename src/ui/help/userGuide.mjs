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
    const preserveDimensions = ($element) => {
        const width = $element.width();
        const height = $element.height();
        return { width, height };
    };
    
    const applyDimensions = ($element, dimensions) => {
        $element.css({
            'min-width': `${dimensions.width}px`,
            'min-height': `${dimensions.height}px`,
            'width': `${dimensions.width}px`
        });
        return $element;
    };
    
    const resetDimensions = ($element) => {
        setTimeout(() => {
            $element.css({
                'min-width': '',
                'min-height': '',
                'width': ''
            });
        }, 300);
        return $element;
    };
    
    const createLoadingIndicator = () => {
        return $("<div class='loading-indicator'>Loading user guide...</div>");
    };
    
    const fetchGuideContent = (url) => {
        return new Promise((resolve, reject) => {
            $.get(url)
                .done(resolve)
                .fail(() => reject('Error loading user guide. Please try refreshing the page.'));
        });
    };
    
    const loadGuide = async (type) => {
        const url = `assets/userguide_${type}.html`;
        
        // Preserve current dimensions before any changes
        const dimensions = preserveDimensions($content);
        applyDimensions($content, dimensions);
        
        // Show loading indicator
        $content.html(createLoadingIndicator());
        
        try {
            // Get the new content
            const data = await fetchGuideContent(url);
            
            // Apply the transition
            $content.fadeOut(100, function() {
                $content.html(data);
                $content.fadeIn(100, function() {
                    resetDimensions($content);
                });
            });
        } catch (errorMessage) {
            $content.html(`<p>${errorMessage}</p>`);
            resetDimensions($content);
        }
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
