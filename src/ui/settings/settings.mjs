import { dbg } from "../../utils.mjs";
import { makeThemeTab } from "./themes.mjs";
import { makeGeneralTab } from "./general.mjs";
import { makeTabs } from "../tabs.mjs";

/**
 * Initialize the settings panel with all tabs
 */
export function makeSettings() {
    dbg("makeSettings");

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
    ]);
}

/**
 * Refresh the styling of form controls based on the current theme
 * This ensures all controls remain readable in both light and dark themes
 */
function refreshControlStyling() {
    const textColor = getComputedStyle(document.documentElement)
        .getPropertyValue("--text-primary")
        .trim();

    let isLightText = false;
    if (textColor.startsWith("#")) {
        const hex = textColor.substring(1);
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        const brightness = r * 0.299 + g * 0.587 + b * 0.114;
        isLightText = brightness > 128;
    } else if (textColor.startsWith("rgb")) {
        const rgb = textColor.match(/\d+/g);
        if (rgb && rgb.length >= 3) {
            const r = parseInt(rgb[0]);
            const g = parseInt(rgb[1]);
            const b = parseInt(rgb[2]);
            const brightness = r * 0.299 + g * 0.587 + b * 0.114;
            isLightText = brightness > 128;
        }
    }

    const isLightTheme = !isLightText;

    function setStyles(selector, styles) {
        document.querySelectorAll(selector).forEach(el => {
            Object.assign(el.style, styles);
        });
    }

    if (isLightTheme) {
        setStyles(".panel-text-input, .panel-number-input, .panel-select", {
            color: "#333",
            backgroundColor: "#f9f9f9",
            borderColor: "#ccc",
        });
        setStyles(".panel-checkbox", {
            accentColor: "var(--accent-color, #0066cc)",
            boxShadow: "0 0 2px rgba(0, 0, 0, 0.2)",
        });
        setStyles(".panel-section-title", { color: "var(--accent-color, #0066cc)" });
        setStyles(".key-binding", {
            backgroundColor: "#f0f0f0",
            border: "1px solid #ccc",
            color: "#333",
        });
    } else {
        setStyles(".panel-text-input, .panel-number-input, .panel-select", {
            color: "var(--text-primary)",
            backgroundColor: "var(--panel-control-bg)",
            borderColor: "var(--panel-border)",
        });
        setStyles(".panel-checkbox", {
            accentColor: "var(--accent-color, #00ff41)",
            boxShadow: "none",
        });
        setStyles(".panel-section-title", { color: "var(--accent-color, #00ff41)" });
        setStyles(".key-binding", {
            backgroundColor: "var(--panel-control-bg)",
            border: "none",
            color: "var(--text-primary)",
        });
    }
}
