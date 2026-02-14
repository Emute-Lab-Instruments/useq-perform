import {activeUserSettings, updateUserSettings, resetUserSettings, getUserSettings} from "../../utils/persistentUserSettings.mjs";
import {themes} from "../../editors/themes/themeManager.mjs";
import { setMainEditorTheme } from "../../editors/themes/themeManager.mjs";
import { serialVisChannels } from "../serialVis/utils.mjs";
import { el } from "../../utils/dom.mjs";

export function makeGeneralTab() {
    const container = el('div', { class: 'panel-tab-content' });

    const personalSection = createSection('Personal Settings');
    const editorSection = createSection('Editor Settings');
    const storageSection = createSection('Storage Settings');
    const uiSection = createSection('UI Settings');

    container.appendChild(personalSection);
    container.appendChild(editorSection);
    container.appendChild(storageSection);
    container.appendChild(uiSection);

    buildPersonalSettings(personalSection);
    buildEditorSettings(editorSection);
    buildStorageSettings(storageSection);
    buildUISettings(uiSection);
    buildConfigurationSection(container);

    const resetButtonContainer = el('div', { class: 'panel-section' });
    const resetButton = el('button', { class: 'panel-button reset', text: 'Reset All Settings' });
    resetButton.addEventListener('click', () => {
        if (confirm('Are you sure you want to reset all settings to default values?')) {
            resetUserSettings();
            window.location.reload();
        }
    });
    resetButtonContainer.appendChild(resetButton);
    container.appendChild(resetButtonContainer);

    return container;
}

function createSection(title) {
    const section = el('div', { class: 'panel-section' });
    section.appendChild(el('h3', { class: 'panel-section-title', text: title }));
    return section;
}

function createFormRow(labelText, controlElement) {
    const row = el('div', { class: 'panel-row' });
    row.appendChild(el('label', { class: 'panel-label', text: labelText }));
    const control = el('div', { class: 'panel-control' });
    control.appendChild(controlElement);
    row.appendChild(control);
    return row;
}

function buildPersonalSettings(container) {
    const nameInput = el('input', { type: 'text', class: 'panel-text-input', placeholder: 'Enter your name', value: activeUserSettings.name || '' });
    nameInput.addEventListener('change', () => {
        updateUserSettings({ name: nameInput.value });
    });
    container.appendChild(createFormRow('Your Name', nameInput));
}

function buildEditorSettings(container) {
    const themeSelect = el('select', { class: 'panel-select' });
    Object.keys(themes).forEach(themeName => {
        const opt = el('option', { value: themeName, text: themeName });
        if (activeUserSettings.editor?.theme === themeName) opt.selected = true;
        themeSelect.appendChild(opt);
    });
    themeSelect.addEventListener('change', () => {
        updateUserSettings({ editor: { ...activeUserSettings.editor, theme: themeSelect.value } });
        setMainEditorTheme(themeSelect.value);
    });
    container.appendChild(createFormRow('Editor Theme', themeSelect));

    const fontSizeInput = el('input', { type: 'number', class: 'panel-number-input', min: 8, max: 32, value: activeUserSettings.editor?.fontSize || 16 });
    fontSizeInput.addEventListener('change', () => {
        const fontSize = parseInt(fontSizeInput.value, 10);
        if (fontSize >= 8 && fontSize <= 32) {
            updateUserSettings({ editor: { ...activeUserSettings.editor, fontSize } });
        }
    });
    container.appendChild(createFormRow('Font Size', fontSizeInput));

    const bracketCheckbox = el('input', { type: 'checkbox', class: 'panel-checkbox' });
    bracketCheckbox.checked = activeUserSettings.editor?.preventBracketUnbalancing ?? true;
    bracketCheckbox.addEventListener('change', () => {
        const currentSettings = getUserSettings();
        updateUserSettings({ editor: { ...currentSettings.editor, preventBracketUnbalancing: bracketCheckbox.checked } });
    });
    container.appendChild(createFormRow('Prevent bracket unbalancing', bracketCheckbox));
}

function buildStorageSettings(container) {
    const saveLocallyCheckbox = el('input', { type: 'checkbox', class: 'panel-checkbox' });
    saveLocallyCheckbox.checked = activeUserSettings.storage?.saveCodeLocally !== false;
    saveLocallyCheckbox.addEventListener('change', () => {
        updateUserSettings({ storage: { ...activeUserSettings.storage, saveCodeLocally: saveLocallyCheckbox.checked } });
    });
    container.appendChild(createFormRow('Save Code Locally', saveLocallyCheckbox));

    const autoSaveIntervalInput = el('input', { type: 'number', class: 'panel-number-input', min: 1000, max: 60000, step: 1000, value: activeUserSettings.storage?.autoSaveInterval || 5000 });

    const autoSaveCheckbox = el('input', { type: 'checkbox', class: 'panel-checkbox' });
    autoSaveCheckbox.checked = activeUserSettings.storage?.autoSaveEnabled !== false;
    autoSaveCheckbox.addEventListener('change', () => {
        updateUserSettings({ storage: { ...activeUserSettings.storage, autoSaveEnabled: autoSaveCheckbox.checked } });
        autoSaveIntervalInput.disabled = !autoSaveCheckbox.checked;
    });
    container.appendChild(createFormRow('Auto-Save Enabled', autoSaveCheckbox));

    autoSaveIntervalInput.disabled = !autoSaveCheckbox.checked;
    autoSaveIntervalInput.addEventListener('change', () => {
        const interval = parseInt(autoSaveIntervalInput.value, 10);
        if (interval >= 1000 && interval <= 60000) {
            updateUserSettings({ storage: { ...activeUserSettings.storage, autoSaveInterval: interval } });
        }
    });
    container.appendChild(createFormRow('Auto-Save Interval (ms)', autoSaveIntervalInput));
}

function buildUISettings(container) {
    const consoleLinesInput = el('input', { type: 'number', class: 'panel-number-input', min: 100, max: 10000, value: activeUserSettings.ui?.consoleLinesLimit || 1000 });
    consoleLinesInput.addEventListener('change', () => {
        const lines = parseInt(consoleLinesInput.value, 10);
        if (lines >= 100 && lines <= 10000) {
            updateUserSettings({ ui: { ...activeUserSettings.ui, consoleLinesLimit: lines } });
        }
    });
    container.appendChild(createFormRow('Console Line Limit', consoleLinesInput));

    const ui = activeUserSettings.ui || {};

    const gutterEnabled = el('input', { type: 'checkbox', class: 'panel-checkbox' });
    gutterEnabled.checked = ui.expressionGutterEnabled !== false;
    gutterEnabled.addEventListener('change', () => {
        updateUserSettings({ ui: { ...activeUserSettings.ui, expressionGutterEnabled: gutterEnabled.checked } });
    });
    container.appendChild(createFormRow('Show expression gutter bars', gutterEnabled));

    const lastTrackingEnabled = el('input', { type: 'checkbox', class: 'panel-checkbox' });
    lastTrackingEnabled.checked = ui.expressionLastTrackingEnabled !== false;
    lastTrackingEnabled.addEventListener('change', () => {
        updateUserSettings({ ui: { ...activeUserSettings.ui, expressionLastTrackingEnabled: lastTrackingEnabled.checked } });
    });
    container.appendChild(createFormRow('Track last expression per type', lastTrackingEnabled));

    const clearButtonEnabled = el('input', { type: 'checkbox', class: 'panel-checkbox' });
    clearButtonEnabled.checked = ui.expressionClearButtonEnabled !== false;
    clearButtonEnabled.addEventListener('change', () => {
        updateUserSettings({ ui: { ...activeUserSettings.ui, expressionClearButtonEnabled: clearButtonEnabled.checked } });
    });
    container.appendChild(createFormRow('Show clear (x) button on active expression', clearButtonEnabled));

    const pickerStyleSelect = el('select', { class: 'panel-select' });
    const gridOpt = el('option', { value: 'grid', text: 'Grid (D-pad, nested)' });
    const radialOpt = el('option', { value: 'radial', text: 'Radial (dual sticks)' });
    pickerStyleSelect.appendChild(gridOpt);
    pickerStyleSelect.appendChild(radialOpt);
    pickerStyleSelect.value = (ui.gamepadPickerStyle) || 'grid';
    pickerStyleSelect.addEventListener('change', () => {
        updateUserSettings({ ui: { ...activeUserSettings.ui, gamepadPickerStyle: pickerStyleSelect.value } });
    });
    container.appendChild(createFormRow('Gamepad Picker Style', pickerStyleSelect));

    const visual = activeUserSettings.visualisation || {};
    let updateMaskControlsState = () => {};

    // Offset slider
    const offsetWrapper = el('div', { class: 'panel-range-wrapper' });
    const offsetLabel = el('span', { class: 'panel-range-value', text: `${visual.offsetSeconds?.toFixed?.(1) || '5.0'}s` });
    const offsetSlider = el('input', { type: 'range', class: 'panel-range-input', min: 0.5, max: 10, step: 0.5, value: visual.offsetSeconds ?? 5 });
    offsetSlider.addEventListener('input', () => { offsetLabel.textContent = `${parseFloat(offsetSlider.value).toFixed(1)}s`; });
    offsetSlider.addEventListener('change', () => { updateUserSettings({ visualisation: { ...activeUserSettings.visualisation, offsetSeconds: parseFloat(offsetSlider.value) } }); });
    offsetWrapper.appendChild(offsetSlider);
    offsetWrapper.appendChild(offsetLabel);
    container.appendChild(createFormRow('Visual offset window', offsetWrapper));

    // Sample count
    const sampleCountInput = el('input', { type: 'number', class: 'panel-number-input', min: 10, max: 400, step: 10, value: visual.sampleCount ?? 100 });
    sampleCountInput.addEventListener('change', () => {
        const value = parseInt(sampleCountInput.value, 10);
        if (!Number.isNaN(value)) updateUserSettings({ visualisation: { ...activeUserSettings.visualisation, sampleCount: value } });
    });
    container.appendChild(createFormRow('Visual sample count', sampleCountInput));

    // Line width slider
    const lineWidthWrapper = el('div', { class: 'panel-range-wrapper' });
    const lineWidthLabel = el('span', { class: 'panel-range-value', text: `${visual.lineWidth?.toFixed?.(2) || '1.50'}px` });
    const lineWidthSlider = el('input', { type: 'range', class: 'panel-range-input', min: 0.5, max: 5, step: 0.1, value: visual.lineWidth ?? 1.5 });
    lineWidthSlider.addEventListener('input', () => { lineWidthLabel.textContent = `${parseFloat(lineWidthSlider.value).toFixed(2)}px`; });
    lineWidthSlider.addEventListener('change', () => { updateUserSettings({ visualisation: { ...activeUserSettings.visualisation, lineWidth: parseFloat(lineWidthSlider.value) } }); });
    lineWidthWrapper.appendChild(lineWidthSlider);
    lineWidthWrapper.appendChild(lineWidthLabel);
    container.appendChild(createFormRow('Waveform line width', lineWidthWrapper));

    // Digital gap slider
    const parsedDigitalGap = Number.parseInt(visual.digitalLaneGap, 10);
    const rawDigitalGap = Number.isFinite(parsedDigitalGap) ? parsedDigitalGap : 4;
    const digitalGapWrapper = el('div', { class: 'panel-range-wrapper' });
    const digitalGapLabel = el('span', { class: 'panel-range-value', text: `${Math.round(rawDigitalGap)}px` });
    const digitalGapSlider = el('input', { type: 'range', class: 'panel-range-input', min: 0, max: 40, step: 1, value: rawDigitalGap });
    digitalGapSlider.addEventListener('input', () => { digitalGapLabel.textContent = `${parseInt(digitalGapSlider.value, 10) || 0}px`; });
    digitalGapSlider.addEventListener('change', () => { updateUserSettings({ visualisation: { ...activeUserSettings.visualisation, digitalLaneGap: parseInt(digitalGapSlider.value, 10) || 0 } }); });
    digitalGapWrapper.appendChild(digitalGapSlider);
    digitalGapWrapper.appendChild(digitalGapLabel);
    container.appendChild(createFormRow('Digital channel gap', digitalGapWrapper));

    // Circular offset slider
    const offsetRangeLength = Math.max(1, (serialVisChannels?.length || 1));
    const maxCircularOffset = offsetRangeLength - 1;
    const rawCircularOffset = Number(visual.circularOffset ?? 0);
    const safeCircularOffset = ((rawCircularOffset % offsetRangeLength) + offsetRangeLength) % offsetRangeLength;
    const circularOffsetWrapper = el('div', { class: 'panel-range-wrapper' });
    const circularOffsetLabel = el('span', { class: 'panel-range-value', text: `${safeCircularOffset}` });
    const circularOffsetSlider = el('input', { type: 'range', class: 'panel-range-input', min: 0, max: maxCircularOffset, step: 1, value: safeCircularOffset });
    if (maxCircularOffset === 0) circularOffsetSlider.disabled = true;
    circularOffsetSlider.addEventListener('input', () => { circularOffsetLabel.textContent = `${parseInt(circularOffsetSlider.value, 10) || 0}`; });
    circularOffsetSlider.addEventListener('change', () => { updateUserSettings({ visualisation: { ...activeUserSettings.visualisation, circularOffset: parseInt(circularOffsetSlider.value, 10) || 0 } }); });
    circularOffsetWrapper.appendChild(circularOffsetSlider);
    circularOffsetWrapper.appendChild(circularOffsetLabel);
    container.appendChild(createFormRow('Color circular offset', circularOffsetWrapper));

    // Future dashed checkbox
    const futureDashedCheckbox = el('input', { type: 'checkbox', class: 'panel-checkbox' });
    futureDashedCheckbox.checked = visual.futureDashed !== false;
    futureDashedCheckbox.addEventListener('change', () => {
        updateUserSettings({ visualisation: { ...activeUserSettings.visualisation, futureDashed: futureDashedCheckbox.checked } });
        updateMaskControlsState(futureDashedCheckbox.checked);
    });
    container.appendChild(createFormRow('Show future mask/dashes', futureDashedCheckbox));

    // Mask opacity slider
    const maskOpacityWrapper = el('div', { class: 'panel-range-wrapper' });
    const maskOpacityLabel = el('span', { class: 'panel-range-value', text: `${(visual.futureMaskOpacity ?? 0.35).toFixed(2)}` });
    const maskOpacitySlider = el('input', { type: 'range', class: 'panel-range-input', min: 0, max: 1, step: 0.05, value: visual.futureMaskOpacity ?? 0.35 });
    maskOpacitySlider.addEventListener('input', () => { maskOpacityLabel.textContent = parseFloat(maskOpacitySlider.value).toFixed(2); });
    maskOpacitySlider.addEventListener('change', () => { updateUserSettings({ visualisation: { ...activeUserSettings.visualisation, futureMaskOpacity: parseFloat(maskOpacitySlider.value) } }); });
    maskOpacityWrapper.appendChild(maskOpacitySlider);
    maskOpacityWrapper.appendChild(maskOpacityLabel);
    container.appendChild(createFormRow('Future shading intensity', maskOpacityWrapper));

    // Mask width slider
    const maskWidthWrapper = el('div', { class: 'panel-range-wrapper' });
    const maskWidthLabel = el('span', { class: 'panel-range-value', text: `${visual.futureMaskWidth ?? 12}px` });
    const maskWidthSlider = el('input', { type: 'range', class: 'panel-range-input', min: 4, max: 40, step: 1, value: visual.futureMaskWidth ?? 12 });
    maskWidthSlider.addEventListener('input', () => { maskWidthLabel.textContent = `${parseInt(maskWidthSlider.value, 10)}px`; });
    maskWidthSlider.addEventListener('change', () => { updateUserSettings({ visualisation: { ...activeUserSettings.visualisation, futureMaskWidth: parseInt(maskWidthSlider.value, 10) } }); });
    maskWidthWrapper.appendChild(maskWidthSlider);
    maskWidthWrapper.appendChild(maskWidthLabel);
    container.appendChild(createFormRow('Future mask stripe width', maskWidthWrapper));

    updateMaskControlsState = (enabled) => {
        const isEnabled = !!enabled;
        [maskOpacitySlider, maskWidthSlider].forEach(input => {
            input.disabled = !isEnabled;
            input.classList.toggle('panel-control-disabled', !isEnabled);
            input.setAttribute('aria-disabled', isEnabled ? 'false' : 'true');
        });
        [maskOpacityWrapper, maskWidthWrapper].forEach(wrapper => {
            wrapper.classList.toggle('panel-range-wrapper--disabled', !isEnabled);
        });
    };

    updateMaskControlsState(visual.futureDashed !== false);
}

function buildConfigurationSection(container) {
    const loadConfigManager = async () => {
        try {
            return await import('../../config/configManager.mjs');
        } catch (error) {
            console.error('Failed to load config manager:', error);
            return null;
        }
    };

    const section = createSection('Configuration Management');

    const infoText = el('p', { class: 'panel-info-text', html: `
        Export your current settings to a file, or import settings from a previously saved configuration.
        In dev mode with the config server running, configurations can be saved directly to the source directory.
    ` });
    section.appendChild(infoText);

    const exportBtn = el('button', { class: 'panel-button', text: 'Export Configuration' });
    exportBtn.addEventListener('click', async () => {
        const configManager = await loadConfigManager();
        if (!configManager) { alert('Failed to load configuration manager'); return; }
        try {
            const result = await configManager.saveConfiguration({
                includeCode: false,
                includeDevMode: window.location.search.includes('devmode=true')
            });
            if (result.method === 'websocket') {
                alert(`Configuration saved to:\n${result.path}\n\nYou can now commit this file to git!`);
            } else if (result.method === 'filesystem-api') {
                alert(`Configuration saved to:\n${result.name}`);
            } else if (result.method === 'download') {
                alert('Configuration downloaded.\n\nCopy the file to:\nsrc/config/default-config.json\n\nto make changes persist across builds.');
            }
        } catch (error) {
            console.error('Export error:', error);
            alert(`Failed to export configuration:\n${error.message}`);
        }
    });

    const importBtn = el('button', { class: 'panel-button', text: 'Import Configuration' });
    importBtn.addEventListener('click', async () => {
        const configManager = await loadConfigManager();
        if (!configManager) { alert('Failed to load configuration manager'); return; }
        try {
            const config = await configManager.loadConfigurationFromFile();
            const preview = configManager.previewConfiguration(config);
            let confirmMessage = 'Apply this configuration?\n\n';
            if (preview.hasChanges) {
                confirmMessage += 'Changes:\n' + preview.diffs.join('\n') + '\n\n';
            } else {
                confirmMessage += 'No changes detected.\n\n';
            }
            confirmMessage += 'The page will reload to apply changes.';
            if (confirm(confirmMessage)) {
                configManager.importConfiguration(config);
                window.location.reload();
            }
        } catch (error) {
            console.error('Import error:', error);
            alert(`Failed to import configuration:\n${error.message}`);
        }
    });

    const buttonGroup = el('div', { class: 'panel-button-group' });
    buttonGroup.appendChild(exportBtn);
    buttonGroup.appendChild(importBtn);
    section.appendChild(buttonGroup);
    container.appendChild(section);
}
