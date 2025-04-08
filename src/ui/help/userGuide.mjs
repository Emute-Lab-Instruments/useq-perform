import { makeTabs } from "../tabs.mjs";
import { dbg } from "../../utils.mjs";
import { themeRecipes } from "../../editors/themes/builtinThemes.mjs";

export function makeUserGuide() {
    dbg("userGuide.mjs makeUserGuide: Creating user guide panel");
    
    // Create a container div for the user guide content
    const $container = $('<div id="userguide-container">');
    
    // Add a loading indicator
    const $loading = $('<div class="loading-indicator">Loading user guide...</div>');
    $container.append($loading);
    
    // Load the HTML content using jQuery ajax
    $.get("/userguide.html", function(data) {
        $container.html(data);
        
        // Initialize the experience selector buttons
        initExperienceSelector($container);
    }).fail(function() {
        $container.html('<p>Error loading user guide. Please try refreshing the page.</p>');
    });

    return $container;
}

function initExperienceSelector($container) {
    // Wait a short time to ensure DOM elements are ready
    setTimeout(() => {
        const beginnerBtn = $container.find('#beginner-button')[0];
        const advancedBtn = $container.find('#advanced-button')[0];
        
        if (beginnerBtn && advancedBtn) {
            dbg("userGuide.mjs: Experience selector buttons found, initializing");
            
            // Manual click event trigger since the embedded script might not run
            const savedExperience = localStorage.getItem('useqExperienceLevel');
            if (savedExperience === 'advanced') {
                advancedBtn.click();
            } else {
                beginnerBtn.click();
            }
        } else {
            dbg("userGuide.mjs: Experience selector buttons not found");
        }
    }, 300);
}

// This function can be called when the theme changes
export function updateUserGuideTheme(themeName) {
    const theme = themeRecipes[themeName];
    if (!theme) return;
    
    // Update any theme-specific styles for the user guide
    // This will be called by the theme manager when theme changes
    dbg("userGuide.mjs: Updating user guide theme to", themeName);
    
    const $container = $('#userguide-container');
    if ($container.length > 0) {
        // Force a reload of the user guide to apply new theme variables
        const currentContent = $container.html();
        $container.html('<div class="loading-indicator">Updating theme...</div>');
        
        // Short timeout to ensure the DOM updates
        setTimeout(() => {
            $container.html(currentContent);
            initExperienceSelector($container);
        }, 100);
    }
}
