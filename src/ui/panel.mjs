/**
 * Base class for screen panels
 */

import { initKeybindingsTab } from "./settings/keybindings.mjs";


/**
 * Class representing a tab within a panel
 */
export class PanelTab {
    /**
     * Create a new Tab
     * @param {string} name - Display name of the tab
     * @param {string} id - DOM ID of the tab element
     * @param {string} contents - HTML content for the tab
     */
    constructor(name, id, contents) {
        this.name = name;
        this.id = id;
        this.contents = contents;
        this.button = this.createButton();     // Create tab button element
        this.container = this.createContainer(); // Create content container element
    }

    /**
     * Create the button element for the tab
     * @returns {HTMLElement} - The button element that triggers tab switching
     */
    createButton() {
        const button = document.createElement('div');
        button.className = 'panel-tab';
        button.id = `${this.id}-tab`;
        button.textContent = this.name;
        return button;
    }

    /**
     * Create the contents container for the tab
     * @returns {HTMLElement} - The container element that holds tab content
     */
    createContainer() {
        const container = document.createElement('div');
        container.className = 'panel-tab-content';
        container.id = `${this.id}-content`;
        container.innerHTML = this.contents;
        return container;
    }
}


export class Panel {
    /**
     * Create a new Panel
     * @param {string} name - Display name of the panel
     * @param {string} id - DOM ID of the panel element
     */
    constructor(name, id, parent, tabs = []) {
        this.name = name;
        this.id = id;
        this.parent = parent;
        this.tabs = tabs;
    }

    /**
     * Get the panel's DOM element
     * @returns {HTMLElement|null}
     */
    getElement() {
        return document.querySelector(`#${this.id}`);
    }

    setDisplay(show) {
        const panel = this.getElement();
        if (panel) {
            panel.classList.toggle('hidden', !show);
        }
    }

    /**
     * Initialize the panel
     */
    init() {
        const element = this.getElement();
        if (element) {
            element.classList.add('hidden');
            element.classList.add('panel-aux');
            element.id = this.id;
        }

        element.appendChild(tabSection());
        element.appendChild(tabContent());
    }
}

/**
 * Class for auxiliary panels (help, settings, etc.)
 */
export class AuxPanel extends Panel {
    /**
     * List of auxiliary panels in the application
     * @type {AuxPanel[]}
     */
    static appAuxPanels = [];

    /**
     * Create a new auxiliary panel
     * @param {string} name - Display name of the panel
     * @param {string} id - DOM ID of the panel element
     */
    constructor(name, id, tabs) {
        super(name, id, tabs);
        AuxPanel.appAuxPanels.push(this);
    }

    setDisplay(show) {
        // Only one aux panel should be on at a time
        if (show) {
            AuxPanel.appAuxPanels.forEach(panel => {
                if (panel !== this) {
                    panel.setDisplay(false);
                }
            })
        }
        super.setDisplay(show);
    }

    /**
     * Set panel display state
     * @param {boolean} show - True to show panel, false to hide
     */
    setDisplay(show) {
        const panel = this.getElement();
        if (panel) {
            panel.classList.toggle('hidden', !show);
        }
    }


    init() {
        // Initialize the panel
        this.initTabs();
    }

    populate(container) {
        // Populate the panel with tabs
        , this.tabs);
    }

    /**
     * Set up tab switching functionality
     */
    initTabs() {

        const panel = this.getElement();
        const tabs = panel.querySelectorAll('.panel-tab');
        const contents = panel.querySelectorAll('.panel-tab-content');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabId = tab.id.replace(`${this.id}-tab-`, '');
                
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                contents.forEach(content => {
                    content.classList.toggle('active', 
                        content.id === `${this.id}-${tabId}`);
                });
            });
        });
    }

    populate(container) {
        addTabs(container, this.tabs);
    }
}


function makeGeneralContents() {
    return `
    <p>General settings for the application.</p>
        Lorem ipsum dolor sit amet, consectetur adipiscing elit.
        Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
        Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.
        Duis aute irure dolor in reprehenderit in voluptate velit esse.
        Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia.
    `;
}

export const settingsPanel = new AuxPanel(
    "Settings",
    "panel-settings",
    [
        new PanelTab("General", "panel-settings-general", makeGeneralContents()
    ),
        // new PanelTab("Keybindings", "panel-settings-keybindings", keybindingsTab),
        // new PanelTab("Themes", "panel-settings-theme", themesTab)
    ]
);


function makeUserGuideContents() {
    return `
    <p>General aoeuaoeusettings for the application.</p>
        Lor        em ipsum dolor sit amet, consectetur adipiscing elit.
        Sed do eiioeiaoeuausmod tempor incididunt ut labore et dolore magna aliqua.
        Ut enim HELOOOOOOOOOOOOOOOOOOOOOOOOO.
        Duis aute irure dolor in reprehenderit in voluptate velit esse.
        Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia.
    `;
}

export const HelpPanel = new AuxPanel(
    "Settings",
    "panel-settings",
    [
        new PanelTab("User Guide", "panel-help-userGuide", makeUserGuideContents()),
        // new PanelTab("Keybindings", "panel-settings-keybindings", keybindingsTab),
        // new PanelTab("Themes", "panel-settings-theme", themesTab)
    ]
);