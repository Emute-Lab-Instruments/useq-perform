/**
 * Development Mode Panel
 */

import { makeTabs } from './tabs.mjs';
import { setConnectedToModule, isConnectedToModule } from '../io/serialComms.mjs';
import { dbg } from '../utils.mjs';
import { el } from '../utils/dom.mjs';
import {
    startMockTimeGenerator, stopMockTimeGenerator,
    isMockTimeGeneratorRunning, getCurrentMockTime, resetMockTimeGenerator
} from '../io/mockTimeGenerator.mjs';
import {
    setControlValue, getControlValue, getControlDefinitions,
    resetAllControls, initializeMockControls
} from '../io/mockControlInputs.mjs';

export function makeDevMode() {
    dbg('Creating dev mode panel...');
    return makeTabs([
        { name: "Connection", id: "devmode-tab-connection", element: makeConnectionTab(), active: true },
        { name: "Debug", id: "devmode-tab-debug", element: makeDebugTab(), active: false }
    ]);
}

function makeConnectionTab() {
    const container = el('div', { class: 'devmode-tab-content', id: 'devmode-connection-content' });
    const statusSection = el('div', { class: 'devmode-section' });
    statusSection.appendChild(el('h3', { text: 'Connection Status' }));
    const statusDisplay = el('div', { class: 'devmode-status-display', id: 'devmode-connection-status' });
    statusSection.appendChild(statusDisplay);

    const controlsSection = el('div', { class: 'devmode-section' });
    controlsSection.appendChild(el('h3', { text: 'Mock Connection' }));
    const buttonContainer = el('div', { class: 'devmode-button-group' });
    const connectBtn = el('button', { class: 'devmode-button devmode-button-success', text: 'Connect', id: 'devmode-connect-btn' });
    const disconnectBtn = el('button', { class: 'devmode-button devmode-button-danger', text: 'Disconnect', id: 'devmode-disconnect-btn' });
    buttonContainer.appendChild(connectBtn);
    buttonContainer.appendChild(disconnectBtn);
    controlsSection.appendChild(buttonContainer);

    const infoSection = el('div', { class: 'devmode-section devmode-info' });
    infoSection.appendChild(el('p', { html: '<strong>Dev Mode Active:</strong> Mock the connection status to test expression evaluation without a physical uSEQ device.' }));

    container.appendChild(statusSection);
    container.appendChild(controlsSection);
    container.appendChild(infoSection);

    setupConnectionControls(connectBtn, disconnectBtn, statusDisplay);
    updateConnectionStatus(statusDisplay);
    return container;
}

function makeDebugTab() {
    const container = el('div', { class: 'devmode-tab-content', id: 'devmode-debug-content' });

    const timeGenSection = el('div', { class: 'devmode-section' });
    timeGenSection.appendChild(el('h3', { text: 'Mock Time Generator' }));
    const timeGenStatus = el('div', { class: 'devmode-status-display', id: 'devmode-timegen-status' });
    timeGenSection.appendChild(timeGenStatus);

    const timeGenControls = el('div', { class: 'devmode-button-group' });
    const startBtn = el('button', { class: 'devmode-button devmode-button-success', text: 'Start', id: 'devmode-timegen-start-btn' });
    const stopBtn = el('button', { class: 'devmode-button devmode-button-danger', text: 'Stop', id: 'devmode-timegen-stop-btn' });
    const resetBtn = el('button', { class: 'devmode-button', text: 'Reset', id: 'devmode-timegen-reset-btn' });
    timeGenControls.appendChild(startBtn);
    timeGenControls.appendChild(stopBtn);
    timeGenControls.appendChild(resetBtn);
    timeGenSection.appendChild(timeGenControls);

    const timeGenInfo = el('div', { class: 'devmode-info' });
    timeGenInfo.appendChild(el('p', { html: '<strong>Mock Time Generator:</strong> Simulates time updates from the uSEQ module.' }));
    timeGenSection.appendChild(timeGenInfo);

    container.appendChild(timeGenSection);
    container.appendChild(makeControlInputsSection());
    container.appendChild(makeConfigManagementSection());

    setupTimeGeneratorControls(startBtn, stopBtn, resetBtn, timeGenStatus);
    updateTimeGeneratorStatus(timeGenStatus);
    return container;
}

function makeControlInputsSection() {
    const section = el('div', { class: 'devmode-section' });
    section.appendChild(el('h3', { text: 'Mock Control Inputs' }));
    const controlsContainer = el('div', { class: 'devmode-controls-container' });
    const definitions = getControlDefinitions();
    for (const def of definitions) controlsContainer.appendChild(createControlSlider(def));
    section.appendChild(controlsContainer);

    const resetBtnEl = el('button', { class: 'devmode-button', text: 'Reset All', id: 'devmode-controls-reset-btn' });
    resetBtnEl.addEventListener('click', () => {
        resetAllControls();
        for (const def of definitions) {
            const slider = document.getElementById(`devmode-control-${def.name}`);
            const display = document.getElementById(`devmode-control-${def.name}-value`);
            const value = getControlValue(def.name);
            if (slider) slider.value = value;
            if (display) display.textContent = value.toFixed(2);
        }
    });
    section.appendChild(resetBtnEl);

    const info = el('div', { class: 'devmode-info' });
    info.appendChild(el('p', { html: '<strong>Mock Control Inputs:</strong> Simulates hardware control inputs.' }));
    section.appendChild(info);
    return section;
}

function createControlSlider(definition) {
    const { name, label, description, min, max, step } = definition;
    const row = el('div', { class: 'devmode-control-row' });
    if (description) row.title = description;
    row.appendChild(el('label', { for: `devmode-control-${name}`, class: 'devmode-control-label', text: label }));

    const sliderContainer = el('div', { class: 'devmode-control-slider-container' });
    const slider = el('input', { type: 'range', id: `devmode-control-${name}`, class: 'devmode-control-slider', min, max, step, value: getControlValue(name) });
    const valueDisplay = el('span', { class: 'devmode-control-value', id: `devmode-control-${name}-value`, text: getControlValue(name).toFixed(2) });
    slider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        setControlValue(name, value);
        valueDisplay.textContent = value.toFixed(2);
    });
    sliderContainer.appendChild(slider);
    sliderContainer.appendChild(valueDisplay);
    row.appendChild(sliderContainer);
    return row;
}

function setupTimeGeneratorControls(startBtn, stopBtn, resetBtnEl, statusDisplay) {
    startBtn.addEventListener('click', () => {
        startMockTimeGenerator();
        updateTimeGeneratorStatus(statusDisplay);
        updateTimeGeneratorButtonStates(startBtn, stopBtn, resetBtnEl);
        startStatusUpdateInterval(statusDisplay, startBtn, stopBtn, resetBtnEl);
    });
    stopBtn.addEventListener('click', () => {
        stopMockTimeGenerator();
        updateTimeGeneratorStatus(statusDisplay);
        updateTimeGeneratorButtonStates(startBtn, stopBtn, resetBtnEl);
    });
    resetBtnEl.addEventListener('click', () => {
        resetMockTimeGenerator();
        updateTimeGeneratorStatus(statusDisplay);
        updateTimeGeneratorButtonStates(startBtn, stopBtn, resetBtnEl);
    });
    updateTimeGeneratorButtonStates(startBtn, stopBtn, resetBtnEl);
}

function setupConnectionControls(connectBtn, disconnectBtn, statusDisplay) {
    connectBtn.addEventListener('click', async () => {
        setConnectedToModule(true);
        updateConnectionStatus(statusDisplay);
        updateButtonStates(connectBtn, disconnectBtn);
        try { await initializeMockControls(); } catch (e) { dbg('Failed to init mock controls:', e); }
        if (!isMockTimeGeneratorRunning()) startMockTimeGenerator();
    });
    disconnectBtn.addEventListener('click', () => {
        setConnectedToModule(false);
        updateConnectionStatus(statusDisplay);
        updateButtonStates(connectBtn, disconnectBtn);
        if (isMockTimeGeneratorRunning()) stopMockTimeGenerator();
    });
    updateButtonStates(connectBtn, disconnectBtn);
}

function updateConnectionStatus(statusDisplay) {
    const isConnected = isConnectedToModule();
    statusDisplay.className = 'devmode-status-display ' + (isConnected ? 'devmode-status-connected' : 'devmode-status-disconnected');
    statusDisplay.innerHTML = `<strong>${isConnected ? 'Connected (Mock)' : 'Disconnected'}</strong>`;
}

function updateButtonStates(connectBtn, disconnectBtn) {
    const isConnected = isConnectedToModule();
    connectBtn.disabled = isConnected;
    disconnectBtn.disabled = !isConnected;
}

function updateTimeGeneratorStatus(statusDisplay) {
    const isRunning = isMockTimeGeneratorRunning();
    const currentTime = getCurrentMockTime();
    statusDisplay.className = 'devmode-status-display ' + (isRunning ? 'devmode-status-connected' : 'devmode-status-disconnected');
    statusDisplay.innerHTML = `<strong>${isRunning ? `Running (t=${currentTime.toFixed(3)}s)` : 'Stopped'}</strong>`;
}

function updateTimeGeneratorButtonStates(startBtn, stopBtn, resetBtnEl) {
    const isRunning = isMockTimeGeneratorRunning();
    startBtn.disabled = isRunning;
    stopBtn.disabled = !isRunning;
    resetBtnEl.disabled = false;
}

let statusUpdateIntervalId = null;
function startStatusUpdateInterval(statusDisplay, startBtn, stopBtn, resetBtnEl) {
    if (statusUpdateIntervalId !== null) clearInterval(statusUpdateIntervalId);
    statusUpdateIntervalId = setInterval(() => {
        if (isMockTimeGeneratorRunning()) {
            updateTimeGeneratorStatus(statusDisplay);
        } else {
            clearInterval(statusUpdateIntervalId);
            statusUpdateIntervalId = null;
        }
    }, 100);
}

export function initDevMode() {
    addDevModeStyles();
    setupGlobalDevModeHandlers();
}

function addDevModeStyles() {
    if (document.getElementById('devmode-styles')) return;
    const style = document.createElement('style');
    style.id = 'devmode-styles';
    style.textContent = `
        .devmode-tab-content { padding: 16px; }
        .devmode-section { margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #e0e0e0; }
        .devmode-section:last-child { border-bottom: none; }
        .devmode-section h3 { margin-top: 0; margin-bottom: 12px; font-size: 14px; font-weight: 600; }
        .devmode-button-group { display: flex; gap: 8px; flex-wrap: wrap; }
        .devmode-button { padding: 6px 12px; border: 1px solid #ccc; border-radius: 4px; background: #f5f5f5; cursor: pointer; font-size: 12px; }
        .devmode-button:disabled { opacity: 0.5; cursor: not-allowed; }
        .devmode-button-success { background: #d4edda; border-color: #28a745; color: #155724; }
        .devmode-button-danger { background: #f8d7da; border-color: #dc3545; color: #721c24; }
        .devmode-status-display { padding: 8px 12px; border-radius: 4px; font-family: monospace; font-size: 13px; }
        .devmode-status-connected { background: #d4edda; color: #155724; border: 1px solid #28a745; }
        .devmode-status-disconnected { background: #f8d7da; color: #721c24; border: 1px solid #dc3545; }
        .devmode-info { background: #e7f3ff; padding: 12px; border-radius: 4px; font-size: 12px; line-height: 1.4; }
        .devmode-controls-container { margin: 12px 0; }
        .devmode-control-row { display: flex; align-items: center; margin-bottom: 12px; gap: 12px; }
        .devmode-control-label { min-width: 120px; font-size: 12px; font-weight: 500; }
        .devmode-control-slider-container { display: flex; align-items: center; gap: 8px; flex: 1; }
        .devmode-control-slider { flex: 1; height: 6px; }
        .devmode-control-value { min-width: 40px; text-align: right; font-family: monospace; font-size: 12px; }
    `;
    document.head.appendChild(style);
}

function makeConfigManagementSection() {
    const section = el('div', { class: 'devmode-section' });
    section.appendChild(el('h3', { text: 'Configuration Management' }));
    const statusDisplay = el('div', { class: 'devmode-status-display', id: 'devmode-config-status', text: 'Config server status: checking...' });
    section.appendChild(statusDisplay);

    checkConfigServerStatus(statusDisplay);

    const saveBtn = el('button', { class: 'devmode-button devmode-button-success', text: 'Save Config to Source File', id: 'devmode-save-config-btn' });
    saveBtn.addEventListener('click', async () => {
        try {
            const configManager = await import('../config/configManager.mjs');
            const result = await configManager.saveConfiguration({ includeDevMode: true, includeCode: false });
            if (result.success && result.method === 'websocket') {
                statusDisplay.className = 'devmode-status-display devmode-status-connected';
                statusDisplay.innerHTML = `<strong>Config saved to: ${result.path}</strong>`;
            }
        } catch (error) {
            console.error('Failed to save configuration:', error);
        }
    });
    section.appendChild(saveBtn);

    const info = el('div', { class: 'devmode-info', html: '<strong>Config Persistence:</strong> Saves settings to <code>src/config/default-config.json</code>.' });
    section.appendChild(info);
    return section;
}

async function checkConfigServerStatus(statusDisplay) {
    try {
        const configManager = await import('../config/configManager.mjs');
        const ws = await configManager.connectToConfigServer();
        if (ws) {
            statusDisplay.className = 'devmode-status-display devmode-status-connected';
            statusDisplay.innerHTML = '<strong>Config server: Connected</strong>';
        } else {
            statusDisplay.className = 'devmode-status-display devmode-status-disconnected';
            statusDisplay.innerHTML = '<strong>Config server: Not available</strong>';
        }
    } catch (error) {
        statusDisplay.className = 'devmode-status-display devmode-status-disconnected';
        statusDisplay.innerHTML = '<strong>Config server: Error</strong>';
    }
}

function setupGlobalDevModeHandlers() {
    dbg('Dev mode global handlers initialized');
}
