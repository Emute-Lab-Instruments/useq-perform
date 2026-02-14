import { makeTabs } from "../tabs.mjs";
import { dbg } from "../../utils.mjs";
import { el } from "../../utils/dom.mjs";

export function makeUserGuide() {
    dbg("userGuide.mjs makeUserGuide: Creating user guide panel");

    const container = el('div', { id: 'userguide-container' });

    const dropdown = document.createElement('div');
    dropdown.id = 'userguide-dropdown';
    dropdown.innerHTML =
        '  <label for="userguide-select">Experience level: </label>' +
        '  <select id="userguide-select">' +
        '    <option value="beginner">Beginner</option>' +
        '    <option value="advanced">Advanced</option>' +
        '  </select>';
    container.appendChild(dropdown);

    const content = el('div', { id: 'userguide-content', text: 'Loading user guide...' });
    container.appendChild(content);

    initUserGuideDropdown(dropdown, content);

    return container;
}

function initUserGuideDropdown(dropdown, content) {
    const fetchGuideContent = (url) => {
        return fetch(url)
            .then(response => {
                if (!response.ok) throw new Error('Error loading user guide');
                return response.text();
            });
    };

    const loadGuide = async (type) => {
        const url = `assets/userguide_${type}.html`;

        content.innerHTML = '<div class="loading-indicator">Loading user guide...</div>';

        try {
            const data = await fetchGuideContent(url);
            content.innerHTML = data;
        } catch (error) {
            content.innerHTML = '<p>Error loading user guide. Please try refreshing the page.</p>';
        }
    };

    const select = dropdown.querySelector('#userguide-select');
    if (select) {
        select.addEventListener('change', (event) => {
            const selectedValue = event.target.value;
            dbg(`userGuide.mjs: Loading ${selectedValue} guide`);
            localStorage.setItem('useqExperienceLevel', selectedValue);
            loadGuide(selectedValue);
        });
    }

    const savedExperience = localStorage.getItem('useqExperienceLevel') || 'beginner';
    if (select) select.value = savedExperience;
    loadGuide(savedExperience);
}
