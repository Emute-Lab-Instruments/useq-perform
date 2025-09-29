import {activeUserSettings, updateUserSettings, resetUserSettings, getUserSettings} from "../../utils/persistentUserSettings.mjs";
import {themes} from "../../editors/themes/themeManager.mjs";
import { setMainEditorTheme } from "../../editors/themes/themeManager.mjs";
import { serialVisChannels } from "../serialVis/utils.mjs";

export function makeGeneralTab() {
    const $container = $('<div>').addClass('panel-tab-content');

    // Create main sections
    const $personalSection = createSection('Personal Settings');
    const $editorSection = createSection('Editor Settings');
    const $storageSection = createSection('Storage Settings');
    const $uiSection = createSection('UI Settings');
    
    // Add to container
    $container.append($personalSection, $editorSection, $storageSection, $uiSection);
    
    // Build personal settings
    buildPersonalSettings($personalSection);

    // Build editor settings
    buildEditorSettings($editorSection);

    // Build storage settings
    buildStorageSettings($storageSection);

    // Build UI settings
    buildUISettings($uiSection);

    // Add reset button at the bottom
    const $resetButtonContainer = $('<div>').addClass('panel-section');
    const $resetButton = $('<button>')
        .addClass('panel-button reset')
        .text('Reset All Settings')
        .on('click', () => {
            if (confirm('Are you sure you want to reset all settings to default values?')) {
                resetUserSettings();
                window.location.reload();
            }
        });
    
    $resetButtonContainer.append($resetButton);
    $container.append($resetButtonContainer);

    return $container;
}

/**
 * Create a settings section with a title
 */
function createSection(title) {
    const $section = $('<div>').addClass('panel-section');
    const $sectionTitle = $('<h3>')
        .addClass('panel-section-title')
        .text(title);
    $section.append($sectionTitle);
    return $section;
}

/**
 * Create a form row with label and control
 */
function createFormRow(labelText, $controlElement) {
    const $row = $('<div>').addClass('panel-row');
    const $label = $('<label>')
        .addClass('panel-label')
        .text(labelText);
    const $control = $('<div>')
        .addClass('panel-control')
        .append($controlElement);
    return $row.append($label, $control);
}

/**
 * Build the personal settings section
 */
function buildPersonalSettings($container) {
    const $nameInput = $('<input>')
        .attr('type', 'text')
        .addClass('panel-text-input')
        .val(activeUserSettings.name || '')
        .attr('placeholder', 'Enter your name')
        .on('change', () => {
            updateUserSettings({ name: $nameInput.val() });
        });
    
    $container.append(createFormRow('Your Name', $nameInput));
}

/**
 * Build the editor settings section
 */
function buildEditorSettings($container) {
    const $themeSelect = $('<select>').addClass('panel-select');
    
    Object.keys(themes).forEach(themeName => {
        $('<option>')
            .val(themeName)
            .text(themeName)
            .prop('selected', activeUserSettings.editor?.theme === themeName)
            .appendTo($themeSelect);
    });
    
    $themeSelect.on('change', () => {
        const newSettings = {
            editor: {
                ...activeUserSettings.editor,
                theme: $themeSelect.val()
            }
        };
        updateUserSettings(newSettings);
        setMainEditorTheme($themeSelect.val());
    });
    
    $container.append(createFormRow('Editor Theme', $themeSelect));

    const $fontSizeInput = $('<input>')
        .attr('type', 'number')
        .addClass('panel-number-input')
        .attr('min', 8)
        .attr('max', 32)
        .val(activeUserSettings.editor?.fontSize || 16)
        .on('change', () => {
            const fontSize = parseInt($fontSizeInput.val(), 10);
            if (fontSize >= 8 && fontSize <= 32) {
                const newSettings = {
                    editor: {
                        ...activeUserSettings.editor,
                        fontSize: fontSize
                    }
                };
                updateUserSettings(newSettings);
                const editor = EditorView.findFromDOM(document.querySelector("#panel-main-editor .cm-editor"));
                if (editor) {
                    setFontSize(editor, fontSize);
                }
            }
        });
    
    $container.append(createFormRow('Font Size', $fontSizeInput));
    
    const $preventBracketUnbalancingCheckbox = $('<input>')
        .attr('type', 'checkbox')
        .addClass('panel-checkbox')
        .prop('checked', activeUserSettings.editor?.preventBracketUnbalancing ?? true)
        .on('change', () => {
            const isChecked = $preventBracketUnbalancingCheckbox.prop('checked');
            console.log("Settings: preventBracketUnbalancing changed to:", isChecked);
            const currentSettings = getUserSettings();
            const newSettings = {
                editor: {
                    ...currentSettings.editor,
                    preventBracketUnbalancing: isChecked
                }
            };
            console.log("Settings: updating with:", newSettings);
            updateUserSettings(newSettings);
        });
    
    $container.append(createFormRow('Prevent bracket unbalancing', $preventBracketUnbalancingCheckbox));
}

/**
 * Build the storage settings section
 */
function buildStorageSettings($container) {
    const $saveLocallyCheckbox = $('<input>')
        .attr('type', 'checkbox')
        .addClass('panel-checkbox')
        .prop('checked', activeUserSettings.storage?.saveCodeLocally !== false)
        .on('change', () => {
            const newSettings = {
                storage: {
                    ...activeUserSettings.storage,
                    saveCodeLocally: $saveLocallyCheckbox.prop('checked')
                }
            };
            updateUserSettings(newSettings);
        });
    
    $container.append(createFormRow('Save Code Locally', $saveLocallyCheckbox));
    
    const $autoSaveCheckbox = $('<input>')
        .attr('type', 'checkbox')
        .addClass('panel-checkbox')
        .prop('checked', activeUserSettings.storage?.autoSaveEnabled !== false)
        .on('change', () => {
            const newSettings = {
                storage: {
                    ...activeUserSettings.storage,
                    autoSaveEnabled: $autoSaveCheckbox.prop('checked')
                }
            };
            updateUserSettings(newSettings);
            $autoSaveIntervalInput.prop('disabled', !$autoSaveCheckbox.prop('checked'));
        });
    
    $container.append(createFormRow('Auto-Save Enabled', $autoSaveCheckbox));
    
    const $autoSaveIntervalInput = $('<input>')
        .attr('type', 'number')
        .addClass('panel-number-input')
        .attr('min', 1000)
        .attr('max', 60000)
        .attr('step', 1000)
        .val(activeUserSettings.storage?.autoSaveInterval || 5000)
        .prop('disabled', !$autoSaveCheckbox.prop('checked'))
        .on('change', () => {
            const interval = parseInt($autoSaveIntervalInput.val(), 10);
            if (interval >= 1000 && interval <= 60000) {
                const newSettings = {
                    storage: {
                        ...activeUserSettings.storage,
                        autoSaveInterval: interval
                    }
                };
                updateUserSettings(newSettings);
            }
        });
    
    $container.append(createFormRow('Auto-Save Interval (ms)', $autoSaveIntervalInput));
}

/**
 * Build the UI settings section
 */
function buildUISettings($container) {
    const $consoleLinesInput = $('<input>')
        .attr('type', 'number')
        .addClass('panel-number-input')
        .attr('min', 100)
        .attr('max', 10000)
        .val(activeUserSettings.ui?.consoleLinesLimit || 1000)
        .on('change', () => {
            const lines = parseInt($consoleLinesInput.val(), 10);
            if (lines >= 100 && lines <= 10000) {
                const newSettings = {
                    ui: {
                        ...activeUserSettings.ui,
                        consoleLinesLimit: lines
                    }
                };
                updateUserSettings(newSettings);
            }
        });
    
    $container.append(createFormRow('Console Line Limit', $consoleLinesInput));

    // Expression tracking & gutter options
    const ui = activeUserSettings.ui || {};

    const $gutterEnabled = $('<input>')
        .attr('type', 'checkbox')
        .addClass('panel-checkbox')
        .prop('checked', ui.expressionGutterEnabled !== false)
        .on('change', () => {
            updateUserSettings({ ui: { ...activeUserSettings.ui, expressionGutterEnabled: $gutterEnabled.prop('checked') } });
        });
    $container.append(createFormRow('Show expression gutter bars', $gutterEnabled));

    const $lastTrackingEnabled = $('<input>')
        .attr('type', 'checkbox')
        .addClass('panel-checkbox')
        .prop('checked', ui.expressionLastTrackingEnabled !== false)
        .on('change', () => {
            updateUserSettings({ ui: { ...activeUserSettings.ui, expressionLastTrackingEnabled: $lastTrackingEnabled.prop('checked') } });
        });
    $container.append(createFormRow('Track last expression per type', $lastTrackingEnabled));

    const $clearButtonEnabled = $('<input>')
        .attr('type', 'checkbox')
        .addClass('panel-checkbox')
        .prop('checked', ui.expressionClearButtonEnabled !== false)
        .on('change', () => {
            updateUserSettings({ ui: { ...activeUserSettings.ui, expressionClearButtonEnabled: $clearButtonEnabled.prop('checked') } });
        });
    $container.append(createFormRow('Show clear (×) button on active expression', $clearButtonEnabled));

    // Gamepad picker style select
    const $pickerStyleSelect = $('<select>')
        .addClass('panel-select')
        .append($('<option>').val('grid').text('Grid (D-pad, nested)'))
        .append($('<option>').val('radial').text('Radial (dual sticks)'))
        .val((activeUserSettings.ui && activeUserSettings.ui.gamepadPickerStyle) || 'grid')
        .on('change', () => {
            const style = $pickerStyleSelect.val();
            updateUserSettings({ ui: { ...activeUserSettings.ui, gamepadPickerStyle: style } });
        });
    $container.append(createFormRow('Gamepad Picker Style', $pickerStyleSelect));

    const visual = activeUserSettings.visualisation || {};
    let updateMaskControlsState = () => {};

    const $offsetWrapper = $('<div>').addClass('panel-range-wrapper');
    const $offsetLabel = $('<span>').addClass('panel-range-value').text(`${visual.offsetSeconds?.toFixed?.(1) || '5.0'}s`);
    const $offsetSlider = $('<input>')
        .attr({ type: 'range', min: 0.5, max: 10, step: 0.5 })
        .addClass('panel-range-input')
        .val(visual.offsetSeconds ?? 5)
        .on('input', () => {
            const value = parseFloat($offsetSlider.val());
            $offsetLabel.text(`${value.toFixed(1)}s`);
        })
        .on('change', () => {
            const value = parseFloat($offsetSlider.val());
            updateUserSettings({ visualisation: { ...activeUserSettings.visualisation, offsetSeconds: value } });
        });
    $offsetWrapper.append($offsetSlider, $offsetLabel);
    $container.append(createFormRow('Visual offset window', $offsetWrapper));

    const $sampleCountInput = $('<input>')
        .attr({ type: 'number', min: 10, max: 400, step: 10 })
        .addClass('panel-number-input')
        .val(visual.sampleCount ?? 100)
        .on('change', () => {
            const value = parseInt($sampleCountInput.val(), 10);
            if (!Number.isNaN(value)) {
                updateUserSettings({ visualisation: { ...activeUserSettings.visualisation, sampleCount: value } });
            }
        });
    $container.append(createFormRow('Visual sample count', $sampleCountInput));

    const $lineWidthWrapper = $('<div>').addClass('panel-range-wrapper');
    const $lineWidthLabel = $('<span>').addClass('panel-range-value').text(`${visual.lineWidth?.toFixed?.(2) || '1.50'}px`);
    const $lineWidthSlider = $('<input>')
        .attr({ type: 'range', min: 0.5, max: 5, step: 0.1 })
        .addClass('panel-range-input')
        .val(visual.lineWidth ?? 1.5)
        .on('input', () => {
            const value = parseFloat($lineWidthSlider.val());
            $lineWidthLabel.text(`${value.toFixed(2)}px`);
        })
        .on('change', () => {
            const value = parseFloat($lineWidthSlider.val());
            updateUserSettings({ visualisation: { ...activeUserSettings.visualisation, lineWidth: value } });
        });
    $lineWidthWrapper.append($lineWidthSlider, $lineWidthLabel);
    $container.append(createFormRow('Waveform line width', $lineWidthWrapper));

    const parsedDigitalGap = Number.parseInt(visual.digitalLaneGap, 10);
    const rawDigitalGap = Number.isFinite(parsedDigitalGap) ? parsedDigitalGap : 4;
    const $digitalGapWrapper = $('<div>').addClass('panel-range-wrapper');
    const $digitalGapLabel = $('<span>').addClass('panel-range-value').text(`${Math.round(rawDigitalGap)}px`);
    const $digitalGapSlider = $('<input>')
        .attr({ type: 'range', min: 0, max: 40, step: 1 })
        .addClass('panel-range-input')
        .val(rawDigitalGap)
        .on('input', () => {
            const value = parseInt($digitalGapSlider.val(), 10) || 0;
            $digitalGapLabel.text(`${value}px`);
        })
        .on('change', () => {
            const value = parseInt($digitalGapSlider.val(), 10) || 0;
            updateUserSettings({ visualisation: { ...activeUserSettings.visualisation, digitalLaneGap: value } });
        });
    $digitalGapWrapper.append($digitalGapSlider, $digitalGapLabel);
    $container.append(createFormRow('Digital channel gap', $digitalGapWrapper));

    const offsetRangeLength = Math.max(1, (serialVisChannels?.length || 1));
    const maxCircularOffset = offsetRangeLength - 1;
    const rawCircularOffset = Number(visual.circularOffset ?? 0);
    const safeCircularOffset = ((rawCircularOffset % offsetRangeLength) + offsetRangeLength) % offsetRangeLength;
    const $circularOffsetWrapper = $('<div>').addClass('panel-range-wrapper');
    const $circularOffsetLabel = $('<span>').addClass('panel-range-value').text(`${safeCircularOffset}`);
    const $circularOffsetSlider = $('<input>')
        .attr({ type: 'range', min: 0, max: maxCircularOffset, step: 1 })
        .addClass('panel-range-input')
        .val(safeCircularOffset)
        .prop('disabled', maxCircularOffset === 0)
        .on('input', () => {
            const value = parseInt($circularOffsetSlider.val(), 10) || 0;
            $circularOffsetLabel.text(`${value}`);
        })
        .on('change', () => {
            const value = parseInt($circularOffsetSlider.val(), 10) || 0;
            updateUserSettings({ visualisation: { ...activeUserSettings.visualisation, circularOffset: value } });
        });
    $circularOffsetWrapper.append($circularOffsetSlider, $circularOffsetLabel);
    $container.append(createFormRow('Color circular offset', $circularOffsetWrapper));

    const $futureDashedCheckbox = $('<input>')
        .attr('type', 'checkbox')
        .addClass('panel-checkbox')
        .prop('checked', visual.futureDashed !== false)
        .on('change', () => {
            const value = $futureDashedCheckbox.prop('checked');
            updateUserSettings({ visualisation: { ...activeUserSettings.visualisation, futureDashed: value } });
            updateMaskControlsState(value);
        });
    $container.append(createFormRow('Show future mask/dashes', $futureDashedCheckbox));

    const $maskOpacityWrapper = $('<div>').addClass('panel-range-wrapper');
    const $maskOpacityLabel = $('<span>').addClass('panel-range-value').text(`${(visual.futureMaskOpacity ?? 0.35).toFixed(2)}`);
    const $maskOpacitySlider = $('<input>')
        .attr({ type: 'range', min: 0, max: 1, step: 0.05 })
        .addClass('panel-range-input')
        .val(visual.futureMaskOpacity ?? 0.35)
        .on('input', () => {
            const value = parseFloat($maskOpacitySlider.val());
            $maskOpacityLabel.text(value.toFixed(2));
        })
        .on('change', () => {
            const value = parseFloat($maskOpacitySlider.val());
            updateUserSettings({ visualisation: { ...activeUserSettings.visualisation, futureMaskOpacity: value } });
        });
    $maskOpacityWrapper.append($maskOpacitySlider, $maskOpacityLabel);
    $container.append(createFormRow('Future shading intensity', $maskOpacityWrapper));

    const $maskWidthWrapper = $('<div>').addClass('panel-range-wrapper');
    const $maskWidthLabel = $('<span>').addClass('panel-range-value').text(`${visual.futureMaskWidth ?? 12}px`);
    const $maskWidthSlider = $('<input>')
        .attr({ type: 'range', min: 4, max: 40, step: 1 })
        .addClass('panel-range-input')
        .val(visual.futureMaskWidth ?? 12)
        .on('input', () => {
            const value = parseInt($maskWidthSlider.val(), 10);
            $maskWidthLabel.text(`${value}px`);
        })
        .on('change', () => {
            const value = parseInt($maskWidthSlider.val(), 10);
            updateUserSettings({ visualisation: { ...activeUserSettings.visualisation, futureMaskWidth: value } });
        });
    $maskWidthWrapper.append($maskWidthSlider, $maskWidthLabel);
    $container.append(createFormRow('Future mask stripe width', $maskWidthWrapper));

    updateMaskControlsState = (enabled) => {
        const isEnabled = !!enabled;
        [$maskOpacitySlider, $maskWidthSlider].forEach(($input) => {
            $input.prop('disabled', !isEnabled);
            if (isEnabled) {
                $input.removeClass('panel-control-disabled');
            } else {
                $input.addClass('panel-control-disabled');
            }
            $input.attr('aria-disabled', isEnabled ? 'false' : 'true');
        });
        [$maskOpacityWrapper, $maskWidthWrapper].forEach(($wrapper) => {
            $wrapper.toggleClass('panel-range-wrapper--disabled', !isEnabled);
        });
    };

    updateMaskControlsState(visual.futureDashed !== false);
}
