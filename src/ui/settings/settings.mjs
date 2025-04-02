import { dbg } from "../../utils.mjs";

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
    const button = document.createElement("button");
    button.className = `panel-nav-button ${tab.active ? 'active' : ''}`;
    button.id = `${tab.id}-button`;
    button.textContent = tab.name;
    return button;
}

function makeGeneralTab() {
    const div = document.createElement('div');
    div.className = 'panel-tab-content';
    div.id = 'panel-settings-general';

    // Create a container for the content
    const contentContainer = document.createElement('div');
    contentContainer.className = 'panel-content-container';

    // Load the userguide content from public directory using root-relative path
    fetch('/userguide.html')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.text();
        })
        .then(html => {
            // Create a temporary container to parse the HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            
            // Get the main content from the userguide
            const mainContent = doc.querySelector('main');
            if (mainContent) {
                // Copy the content to our container
                contentContainer.innerHTML = mainContent.innerHTML;
                
                // Add some basic styling to make it fit in the settings panel
                contentContainer.style.padding = '1rem';
                contentContainer.style.overflowY = 'auto';
                contentContainer.style.maxHeight = '100%';
            }
        })
        .catch(error => {
            console.error('Error loading userguide:', error);
            contentContainer.innerHTML = '<p>Error loading user guide content.</p>';
        });

    div.appendChild(contentContainer);
    return div;
}

function makeKeybindingsTab() {
    const div = document.createElement('div');
    div.className = 'panel-tab-content';
    div.id = 'panel-settings-keybindings';

    // Create a container for the buttons
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'panel-buttons-container';

    for (let i = 0; i < 10; i++) {
        const button = document.createElement('button');
        button.className = 'panel-button';
        button.textContent = `Keybinding Button ${i}`;
        buttonContainer.appendChild(button);
    }

    div.appendChild(buttonContainer);
    return div;
}



/**
 * Initialize the settings panel with all tabs
 */
export function makeSettings() {
    dbg("settings.mjs makeSettings: Creating settings panel");

    const panel = document.createElement("div");
    panel.className = "aux-panel tabs-panel";
    const nav = document.createElement("div");
    nav.className = "panel-nav-bar";
    const window = document.createElement("div");
    window.className = "panel-window";

    const tabs = [
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
    ];

    dbg("settings.mjs makeSettings: Creating tabs:", tabs.map(t => t.name));

    // Create and append each tab button individually
    tabs.forEach(tab => {
        // Tab Button
        const button = makeTabButton(tab);
        nav.appendChild(button);

        // Tab Content
        const element = tab.element;
        element.className = `panel-tab-content ${tab.active ? "active" : ""}`;
        console.log("settings.mjs makeSettings: Adding tab element:", element);
        window.appendChild(element);

        button.addEventListener("click", () => {
            // disable all active elements in both the nav and the window
            Array.from(nav.children).forEach(button => {
                button.classList.remove("active");
            });
            Array.from(window.children).forEach(element => {
                element.classList.remove("active");
            });

            tab.element.classList.add("active");
            button.classList.add("active");
        });
    });

    // Create and append each tab element individually  
    tabs.forEach(tab => {
        
    });

    // Add the nav and window to the panel
    panel.appendChild(nav);
    panel.appendChild(window);

    dbg("settings.mjs makeSettings: Settings panel created");
    return panel;
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
