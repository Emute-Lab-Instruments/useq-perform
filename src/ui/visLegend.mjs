import { serialVisPaletteLight, serialVisPaletteDark } from './serialVis/utils.mjs';

let currentPalette = serialVisPaletteLight;
const legendPanel = document.createElement('div');

function createLegendPanel() {
    legendPanel.id = 'vis-legend';
    legendPanel.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: rgba(255, 255, 255, 0.9);
        border-radius: 4px;
        padding: 8px;
        min-width: 120px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        z-index: 1000;
    `;

    const addButton = document.createElement('button');
    addButton.textContent = '+';
    addButton.className = 'legend-add-button';
    addButton.style.cssText = `
        width: 24px;
        height: 24px;
        border: none;
        border-radius: 12px;
        background: #4CAF50;
        color: white;
        font-size: 16px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 4px auto;
    `;
    
    addButton.addEventListener('click', addNewEntry);
    legendPanel.appendChild(addButton);
}

function addNewEntry() {
    const entryContainer = document.createElement('div');
    entryContainer.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
    `;

    // Color picker dropdown
    const colorSelect = document.createElement('select');
    colorSelect.style.cssText = `
        width: 24px;
        height: 24px;
        padding: 0;
        border: none;
        cursor: pointer;
    `;

    // Add color options
    currentPalette.forEach((color, index) => {
        const option = document.createElement('option');
        option.value = color;
        option.style.backgroundColor = color;
        option.textContent = ' '; // Space to ensure the option has content
        colorSelect.appendChild(option);
    });

    // Color preview div that sits on top of the select
    const colorPreview = document.createElement('div');
    colorPreview.style.cssText = `
        width: 24px;
        height: 24px;
        border-radius: 4px;
        background-color: ${currentPalette[0]};
        pointer-events: none;
        position: absolute;
        margin-left: 0;
    `;

    // Text input
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.placeholder = 'Enter label';
    textInput.style.cssText = `
        flex-grow: 1;
        border: 1px solid #ccc;
        border-radius: 4px;
        padding: 4px;
        font-size: 12px;
    `;

    // Color selection container
    const colorContainer = document.createElement('div');
    colorContainer.style.position = 'relative';
    colorContainer.appendChild(colorSelect);
    colorContainer.appendChild(colorPreview);

    // Update color preview when selection changes
    colorSelect.addEventListener('change', () => {
        colorPreview.style.backgroundColor = colorSelect.value;
    });

    entryContainer.appendChild(colorContainer);
    entryContainer.appendChild(textInput);

    // Insert the new entry before the add button
    legendPanel.insertBefore(entryContainer, legendPanel.lastChild);
}

export function initVisLegend() {
    createLegendPanel();
    document.body.appendChild(legendPanel);
}

// Function to update the palette when theme changes
export function updateLegendPalette(isDarkTheme) {
    currentPalette = isDarkTheme ? serialVisPaletteDark : serialVisPaletteLight;
}