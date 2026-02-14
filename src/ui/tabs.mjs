import { dbg } from "../utils.mjs";
import { el } from "../utils/dom.mjs";

export function makeTabButton(tab) {
    const classString = ['panel-tab-button', tab.active ? 'active' : ''].join(' ').trim();

    const button = el('button', {
        class: classString,
        id: `${tab.id}-button`,
        text: tab.name
    });
    return button;
}


export function makeTabs(tabs) {

    // return a div containing nav-bar and tab-window
    const container = el('div', { class: 'panel-tab-container' });

    // Create navigation bar and window container
    const navBar = el('div', { class: 'panel-nav-bar' });
    const tabWindow = el('div', { class: 'panel-tab-window' });

    container.appendChild(navBar);
    container.appendChild(tabWindow);

    // Iterate over the tabs, create & append buttons to nav-bar and content to tab-window
    tabs.forEach(tab => {

        // Create and add the nav button
        const button = makeTabButton(tab);
        navBar.appendChild(button);

        // Add the tab content div
        const content = tab.element;
        content.classList.add('panel-tab');

        if (tab.active) {
            content.classList.add('active');
        } else {
            content.classList.remove('active');
        }
        tabWindow.appendChild(content);

        // Add click handler to toggle tabs
        button.addEventListener('click', () => {
            try {
                // Deactivate all tabs within this window only
                navBar.querySelectorAll('.panel-tab-button.active').forEach(b => b.classList.remove('active'));
                tabWindow.querySelectorAll('.panel-tab.active').forEach(c => c.classList.remove('active'));

                // Activate clicked tab
                button.classList.add('active');
                content.classList.add('active');
            } catch (error) {
                console.error("Error in tab click handler:", error);
                // Try to recover by forcing the display property
                try {
                    const contentById = document.getElementById(tab.id.replace('-tab-', '-'));
                    if (contentById) contentById.style.display = 'block';
                } catch (e) {
                    console.error("Failed to recover:", e);
                }
            }
        });
    });

    return container;
}
