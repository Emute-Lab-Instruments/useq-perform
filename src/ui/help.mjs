import { toggleAuxPanel } from './ui.mjs';

export function initHelpPanel(){
    console.log("Initializing help panel");
    // Mac shortcut toggle
    let isMac = /Mac/.test(navigator.platform);
    
    // Remove previous handlers if any
    $("#button-help").off("click");
    
    // Add click handler directly using addEventListener for more reliable triggering
    document.getElementById("button-help").addEventListener("click", function(e) {
        console.log("Help button clicked - direct event listener");
        
        // Use the shared toggleAuxPanel function instead of custom logic
        toggleAuxPanel("#panel-help");
        
        // Apply theme styling after panel is open
        if (window.getComputedStyle(document.getElementById("panel-help")).display !== 'none') {
            adjustHelpPanelForTheme();
        }
        
        // Prevent event bubbling issues
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Set initial OS-specific keybinding class
    if(isMac) {
        $("#panel-help").addClass("show-mac");
    }
    
    // Mac toggle functionality
    $("#macToggle").on("change", function() {
        $("#panel-help").toggleClass("show-mac");
    });
    
    // Verify the panel exists in DOM
    if ($("#panel-help").length === 0) {
        console.error("Help panel element not found in DOM!");
    } else {
        console.log("Help panel found in DOM:", $("#panel-help")[0]);
    }
    
    // Verify button exists
    if ($("#button-help").length === 0) {
        console.error("Help button not found in DOM!");
    } else {
        console.log("Help button found in DOM:", $("#button-help")[0]);
    }
}

/**
 * Adjust help panel elements to ensure readability based on current theme
 */
function adjustHelpPanelForTheme() {
    console.log("Adjusting help panel theme");
    // Determine if we're using a light theme by checking the --text-primary variable
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim();
    
    // Convert the color to RGB to check its brightness
    let isLightText = false;
    if (textColor.startsWith('#')) {
        // For hex color
        const hex = textColor.substring(1);
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        // Calculate perceived brightness
        const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
        isLightText = brightness > 128;
    } else if (textColor.startsWith('rgb')) {
        // For rgb color
        const rgb = textColor.match(/\d+/g);
        if (rgb && rgb.length >= 3) {
            const r = parseInt(rgb[0]);
            const g = parseInt(rgb[1]);
            const b = parseInt(rgb[2]);
            const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
            isLightText = brightness > 128;
        }
    }
    
    // If we have light text, we're in a dark theme, otherwise we're in a light theme
    const isLightTheme = !isLightText;
    console.log("Current theme is:", isLightTheme ? "light" : "dark");
    
    if (isLightTheme) {
        // Adjust key bindings for better visibility in light theme
        $('.key-binding').css({
            'background-color': '#f0f0f0',
            'color': '#333',
            'border': '1px solid #ccc',
            'box-shadow': '0 1px 2px rgba(0,0,0,0.1)'
        });
        
        // Make help section headings more visible
        $('#panel-help b').css({
            'color': 'var(--accent-color, #0066cc)'
        });
        
        // Ensure tip icons are visible
        $('.tip-icon').css({
            'color': 'var(--accent-color-secondary, #ff9800)'
        });
    } else {
        // Dark theme - reset to default styles
        $('.key-binding').css({
            'background-color': 'var(--panel-control-bg)',
            'color': 'var(--text-primary)',
            'border': 'none',
            'box-shadow': 'none'
        });
        
        $('#panel-help b').css({
            'color': 'var(--accent-color, #00ff41)'
        });
        
        $('.tip-icon').css({
            'color': 'var(--accent-color-secondary, #ff9800)'
        });
    }
}