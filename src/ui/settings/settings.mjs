import { dbg } from "../../utils.mjs";
import { makeThemeTab } from "./themes.mjs";

import {
    activeUserSettings,
    updateUserSettings,
    resetUserSettings,
} from "../../utils/persistentUserSettings.mjs";
import { themes } from "../../editors/themes/themeManager.mjs";
import { setMainEditorTheme } from "../../editors/themes/themeManager.mjs";
import { setFontSize } from "../../editors/editorConfig.mjs";
import { EditorView } from "@codemirror/view";
// import { initThemeTab as makeThemeTab } from "./themes.mjs";
// import { initGeneralTab } from "./general.mjs";
// import { initKeybindingsTab as makeKeybindingsTab } from "./keybindings.mjs";

/**
 * Initialize the settings tab within the settings panel
 */


export function makeTabButton(tab) {
    return $('<button>', {
        class: `panel-nav-button ${tab.active ? 'active' : ''}`,
        id: `${tab.id}-button`,
        text: tab.name
    });
}


function makeTabs(tabs) {
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

function makeGeneralTab() {
    const $div = $('<div>', {
        class: 'panel-tab-content',
        id: 'panel-settings-general'
    });

    // Create a container for the content
    const $contentContainer = $('<div>', {
        class: 'panel-content-container'
    });

    // Load the userguide content from public directory using root-relative path
    $.get('/userguide.html')
        .done(html => {
            // Create a temporary container to parse the HTML
            const $mainContent = $(html).find('main');
            
            if ($mainContent.length) {
                // Copy the content to our container
                $div.html($mainContent.html());
            }
        })
        .fail(error => {
            console.error('Error loading userguide:', error);
            $div.html('<p>Error loading user guide content.</p>');
        });

    return $div; 
}

function makeKeybindingsTab() {
    const $div = $('<div>', {
        class: 'panel-tab-content',
        id: 'panel-settings-keybindings'
    });

    for (let i = 0; i < 10; i++) {
        const $button = $('<button>', {
            class: 'panel-button',
            text: `Keybinding Button ${i}`
        });
        $div.append($button);
    }

    return $div;
}



/**
 * Initialize the settings panel with all tabs
 */
export function makeSettings() {
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

/**
 * Refresh the styling of form controls based on the current theme
 * This ensures all controls remain readable in both light and dark themes
 */
function refreshControlStyling() {
    // Determine if we're using a light theme by checking the --text-primary variable
    const textColor = getComputedStyle(document.documentElement)
        .getPropertyValue("--text-primary")
        .trim();

    // Convert the color to RGB to check its brightness
    let isLightText = false;
    if (textColor.startsWith("#")) {
        // For hex color
        const hex = textColor.substring(1);
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        // Calculate perceived brightness (human eye favors green)
        const brightness = r * 0.299 + g * 0.587 + b * 0.114;
        isLightText = brightness > 128;
    } else if (textColor.startsWith("rgb")) {
        // For rgb color
        const rgb = textColor.match(/\d+/g);
        if (rgb && rgb.length >= 3) {
            const r = parseInt(rgb[0]);
            const g = parseInt(rgb[1]);
            const b = parseInt(rgb[2]);
            const brightness = r * 0.299 + g * 0.587 + b * 0.114;
            isLightText = brightness > 128;
        }
    }

    // If we have light text, we're in a dark theme, otherwise we're in a light theme
    const isLightTheme = !isLightText;

    // Adjust form control styles as needed
    if (isLightTheme) {
        // Light theme - ensure text on form controls is dark for contrast
        $(".panel-text-input, .panel-number-input, .panel-select").css({
            color: "#333",
            "background-color": "#f9f9f9",
            "border-color": "#ccc",
        });

        // Ensure checkboxes are visible against background
        $(".panel-checkbox").css({
            "accent-color": "var(--accent-color, #0066cc)",
            "box-shadow": "0 0 2px rgba(0, 0, 0, 0.2)",
        });

        // Make section titles and key bindings more visible in light mode
        $(".panel-section-title").css("color", "var(--accent-color, #0066cc)");
        $(".key-binding").css({
            "background-color": "#f0f0f0",
            border: "1px solid #ccc",
            color: "#333",
        });
    } else {
        // Dark theme - ensure form controls use the default dark theme styling
        $(".panel-text-input, .panel-number-input, .panel-select").css({
            color: "var(--text-primary)",
            "background-color": "var(--panel-control-bg)",
            "border-color": "var(--panel-border)",
        });

        // Reset checkbox styling
        $(".panel-checkbox").css({
            "accent-color": "var(--accent-color, #00ff41)",
            "box-shadow": "none",
        });

        // Reset section titles and key bindings
        $(".panel-section-title").css("color", "var(--accent-color, #00ff41)");
        $(".key-binding").css({
            "background-color": "var(--panel-control-bg)",
            border: "none",
            color: "var(--text-primary)",
        });
    }
}
