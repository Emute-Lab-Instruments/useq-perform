/**
 * Development Mode Panel
 * 
 * Provides development tools and controls that are only available when
 * the ?devmode=true URL parameter is set. This includes connection mocking,
 * expression tracking debugging, and other development utilities.
 */

import { makeTabs } from './tabs.mjs';
import { setConnectedToModule, isConnectedToModule } from '../io/serialComms.mjs';
import { dbg } from '../utils.mjs';
import {
    startMockTimeGenerator,
    stopMockTimeGenerator,
    isMockTimeGeneratorRunning,
    getCurrentMockTime,
    resetMockTimeGenerator
} from '../io/mockTimeGenerator.mjs';
import {
    setControlValue,
    getControlValue,
    getControlDefinitions,
    resetAllControls,
    initializeMockControls
} from '../io/mockControlInputs.mjs';

/**
 * Create the main dev mode panel with tabs
 * @returns {jQuery} The dev mode panel element
 */
export function makeDevMode() {
    dbg('Creating dev mode panel...');
    
    const tabs = [
        {
            name: "Connection",
            id: "devmode-tab-connection",
            element: makeConnectionTab(),
            active: true
        },
        // Future tabs can be added here
        {
            name: "Debug",
            id: "devmode-tab-debug", 
            element: makeDebugTab(),
            active: false
        }
    ];
    
    return makeTabs(tabs);
}

/**
 * Create the connection control tab
 * @returns {jQuery} The connection tab element
 */
function makeConnectionTab() {
    const $container = $('<div>', {
        class: 'devmode-tab-content',
        id: 'devmode-connection-content'
    });
    
    // Connection status section
    const $statusSection = $('<div>', {
        class: 'devmode-section'
    });
    
    const $statusTitle = $('<h3>').text('Connection Status');
    const $statusDisplay = $('<div>', {
        class: 'devmode-status-display',
        id: 'devmode-connection-status'
    });
    
    // Connection toggle controls
    const $controlsSection = $('<div>', {
        class: 'devmode-section'
    });
    
    const $controlsTitle = $('<h3>').text('Mock Connection');
    const $buttonContainer = $('<div>', {
        class: 'devmode-button-group'
    });
    
    const $connectBtn = $('<button>', {
        class: 'devmode-button devmode-button-success',
        text: 'Connect',
        id: 'devmode-connect-btn'
    });
    
    const $disconnectBtn = $('<button>', {
        class: 'devmode-button devmode-button-danger', 
        text: 'Disconnect',
        id: 'devmode-disconnect-btn'
    });
    
    // Info section
    const $infoSection = $('<div>', {
        class: 'devmode-section devmode-info'
    });
    
    const $infoText = $('<p>').html(`
        <strong>Dev Mode Active:</strong> Mock the connection status to test expression evaluation 
        without a physical uSEQ device. When "connected", expression gutter bars will activate 
        when you evaluate code with Ctrl+Enter.
    `);
    
    // Assemble the tab
    $statusSection.append($statusTitle, $statusDisplay);
    $buttonContainer.append($connectBtn, $disconnectBtn);
    $controlsSection.append($controlsTitle, $buttonContainer);
    $infoSection.append($infoText);
    
    $container.append($statusSection, $controlsSection, $infoSection);
    
    // Set up event handlers
    setupConnectionControls($connectBtn, $disconnectBtn, $statusDisplay);
    
    // Update initial status
    updateConnectionStatus($statusDisplay);
    
    return $container;
}

/**
 * Create the debug information tab
 * @returns {jQuery} The debug tab element
 */
function makeDebugTab() {
    const $container = $('<div>', {
        class: 'devmode-tab-content',
        id: 'devmode-debug-content'
    });

    // Mock Time Generator section
    const $timeGenSection = $('<div>', {
        class: 'devmode-section'
    });

    const $timeGenTitle = $('<h3>').text('Mock Time Generator');

    const $timeGenStatus = $('<div>', {
        class: 'devmode-status-display',
        id: 'devmode-timegen-status'
    });

    // Control buttons
    const $timeGenControls = $('<div>', {
        class: 'devmode-button-group'
    });

    const $startBtn = $('<button>', {
        class: 'devmode-button devmode-button-success',
        text: 'Start',
        id: 'devmode-timegen-start-btn'
    });

    const $stopBtn = $('<button>', {
        class: 'devmode-button devmode-button-danger',
        text: 'Stop',
        id: 'devmode-timegen-stop-btn'
    });

    const $resetBtn = $('<button>', {
        class: 'devmode-button',
        text: 'Reset',
        id: 'devmode-timegen-reset-btn'
    });

    // Info section
    const $timeGenInfo = $('<div>', {
        class: 'devmode-info'
    });

    const $infoText = $('<p>').html(`
        <strong>Mock Time Generator:</strong> Simulates the time updates that normally come from
        the uSEQ module. When running, the serialVis will advance at ~60fps using wall-clock time,
        starting from t=0.
    `);

    // Assemble the section
    $timeGenControls.append($startBtn, $stopBtn, $resetBtn);
    $timeGenInfo.append($infoText);
    $timeGenSection.append($timeGenTitle, $timeGenStatus, $timeGenControls, $timeGenInfo);

    $container.append($timeGenSection);

    // Mock Control Inputs section
    const $controlsSection = makeControlInputsSection();
    $container.append($controlsSection);

    // Set up event handlers
    setupTimeGeneratorControls($startBtn, $stopBtn, $resetBtn, $timeGenStatus);

    // Update initial status
    updateTimeGeneratorStatus($timeGenStatus);

    return $container;
}

/**
 * Create the control inputs section with sliders
 * @returns {jQuery} The control inputs section element
 */
function makeControlInputsSection() {
    const $section = $('<div>', {
        class: 'devmode-section'
    });

    const $title = $('<h3>').text('Mock Control Inputs');

    const $controlsContainer = $('<div>', {
        class: 'devmode-controls-container'
    });

    // Create sliders for each control
    const definitions = getControlDefinitions();
    for (const def of definitions) {
        const $controlRow = createControlSlider(def);
        $controlsContainer.append($controlRow);
    }

    // Reset button
    const $resetBtn = $('<button>', {
        class: 'devmode-button',
        text: 'Reset All',
        id: 'devmode-controls-reset-btn'
    });

    $resetBtn.on('click', () => {
        dbg('Dev mode: Resetting all control inputs');
        resetAllControls();
        // Update all slider displays
        for (const def of definitions) {
            const $slider = $(`#devmode-control-${def.name}`);
            const $display = $(`#devmode-control-${def.name}-value`);
            const value = getControlValue(def.name);
            $slider.val(value);
            $display.text(value.toFixed(2));
        }
    });

    // Info section
    const $info = $('<div>', {
        class: 'devmode-info'
    });

    const $infoText = $('<p>').html(`
        <strong>Mock Control Inputs:</strong> Simulates the hardware control inputs
        (CV inputs, pulse inputs, switches) that would normally come from the uSEQ module.
        Use the sliders to change values and test code that uses these controls.
    `);

    $info.append($infoText);
    $section.append($title, $controlsContainer, $resetBtn, $info);

    return $section;
}

/**
 * Create a slider control for a single input
 * @param {object} definition - Control definition
 * @returns {jQuery} The control row element
 */
function createControlSlider(definition) {
    const { name, label, description, min, max, step, default: defaultValue } = definition;

    const $row = $('<div>', {
        class: 'devmode-control-row'
    });

    const $label = $('<label>', {
        for: `devmode-control-${name}`,
        class: 'devmode-control-label'
    }).text(label);

    const $sliderContainer = $('<div>', {
        class: 'devmode-control-slider-container'
    });

    const $slider = $('<input>', {
        type: 'range',
        id: `devmode-control-${name}`,
        class: 'devmode-control-slider',
        min: min,
        max: max,
        step: step,
        value: getControlValue(name)
    });

    const $valueDisplay = $('<span>', {
        class: 'devmode-control-value',
        id: `devmode-control-${name}-value`
    }).text(getControlValue(name).toFixed(2));

    // Handle slider changes
    $slider.on('input', (e) => {
        const value = parseFloat(e.target.value);
        setControlValue(name, value);
        $valueDisplay.text(value.toFixed(2));
    });

    $sliderContainer.append($slider, $valueDisplay);
    $row.append($label, $sliderContainer);

    // Add tooltip if available
    if (description) {
        $row.attr('title', description);
    }

    return $row;
}

/**
 * Set up event handlers for time generator controls
 * @param {jQuery} $startBtn Start button
 * @param {jQuery} $stopBtn Stop button
 * @param {jQuery} $resetBtn Reset button
 * @param {jQuery} $statusDisplay Status display element
 */
function setupTimeGeneratorControls($startBtn, $stopBtn, $resetBtn, $statusDisplay) {
    // Start button
    $startBtn.on('click', () => {
        dbg('Dev mode: Starting mock time generator');
        startMockTimeGenerator();
        updateTimeGeneratorStatus($statusDisplay);
        updateTimeGeneratorButtonStates($startBtn, $stopBtn, $resetBtn);

        // Start periodic status updates while running
        startStatusUpdateInterval($statusDisplay, $startBtn, $stopBtn, $resetBtn);
    });

    // Stop button
    $stopBtn.on('click', () => {
        dbg('Dev mode: Stopping mock time generator');
        stopMockTimeGenerator();
        updateTimeGeneratorStatus($statusDisplay);
        updateTimeGeneratorButtonStates($startBtn, $stopBtn, $resetBtn);
    });

    // Reset button
    $resetBtn.on('click', () => {
        dbg('Dev mode: Resetting mock time generator');
        resetMockTimeGenerator();
        updateTimeGeneratorStatus($statusDisplay);
        updateTimeGeneratorButtonStates($startBtn, $stopBtn, $resetBtn);
    });

    // Update initial button states
    updateTimeGeneratorButtonStates($startBtn, $stopBtn, $resetBtn);
}

/**
 * Set up event handlers for connection controls
 * @param {jQuery} $connectBtn Connect button
 * @param {jQuery} $disconnectBtn Disconnect button
 * @param {jQuery} $statusDisplay Status display element
 */
function setupConnectionControls($connectBtn, $disconnectBtn, $statusDisplay) {
    $connectBtn.on('click', async () => {
        console.log('=== DEVMODE: Connect button clicked ===');
        dbg('Dev mode: Setting connection to true');
        setConnectedToModule(true);
        updateConnectionStatus($statusDisplay);
        updateButtonStates($connectBtn, $disconnectBtn);

        // Initialize mock control inputs in the WASM interpreter
        try {
            console.log('Initializing mock controls...');
            await initializeMockControls();
            dbg('Dev mode: Mock controls initialized');
            console.log('Mock controls initialized successfully');
        } catch (error) {
            dbg(`Dev mode: Failed to initialize mock controls: ${error}`);
            console.error('Failed to initialize mock controls:', error);
        }

        // Automatically start the time generator when connecting
        if (!isMockTimeGeneratorRunning()) {
            console.log('Starting mock time generator...');
            dbg('Dev mode: Auto-starting time generator with connection');
            const started = startMockTimeGenerator();
            console.log('Mock time generator start result:', started);
        } else {
            console.log('Mock time generator already running');
        }
    });

    $disconnectBtn.on('click', () => {
        dbg('Dev mode: Setting connection to false');
        setConnectedToModule(false);
        updateConnectionStatus($statusDisplay);
        updateButtonStates($connectBtn, $disconnectBtn);

        // Automatically stop the time generator when disconnecting
        if (isMockTimeGeneratorRunning()) {
            dbg('Dev mode: Auto-stopping time generator with disconnection');
            stopMockTimeGenerator();
        }
    });

    // Update initial button states
    updateButtonStates($connectBtn, $disconnectBtn);
}

/**
 * Update the connection status display
 * @param {jQuery} $statusDisplay Status display element
 */
function updateConnectionStatus($statusDisplay) {
    const isConnected = isConnectedToModule();
    
    const statusClass = isConnected ? 'devmode-status-connected' : 'devmode-status-disconnected';
    const statusText = isConnected ? 'Connected (Mock)' : 'Disconnected';
    const statusIcon = isConnected ? '🟢' : '🔴';
    
    $statusDisplay.removeClass('devmode-status-connected devmode-status-disconnected')
                  .addClass(statusClass)
                  .html(`${statusIcon} <strong>${statusText}</strong>`);
}

/**
 * Update button states based on connection status
 * @param {jQuery} $connectBtn Connect button
 * @param {jQuery} $disconnectBtn Disconnect button
 */
function updateButtonStates($connectBtn, $disconnectBtn) {
    const isConnected = isConnectedToModule();

    $connectBtn.prop('disabled', isConnected);
    $disconnectBtn.prop('disabled', !isConnected);
}

/**
 * Update the time generator status display
 * @param {jQuery} $statusDisplay Status display element
 */
function updateTimeGeneratorStatus($statusDisplay) {
    const isRunning = isMockTimeGeneratorRunning();
    const currentTime = getCurrentMockTime();

    const statusClass = isRunning ? 'devmode-status-connected' : 'devmode-status-disconnected';
    const statusText = isRunning ? `Running (t=${currentTime.toFixed(3)}s)` : 'Stopped';
    const statusIcon = isRunning ? '▶️' : '⏸️';

    $statusDisplay.removeClass('devmode-status-connected devmode-status-disconnected')
                  .addClass(statusClass)
                  .html(`${statusIcon} <strong>${statusText}</strong>`);
}

/**
 * Update time generator button states
 * @param {jQuery} $startBtn Start button
 * @param {jQuery} $stopBtn Stop button
 * @param {jQuery} $resetBtn Reset button
 */
function updateTimeGeneratorButtonStates($startBtn, $stopBtn, $resetBtn) {
    const isRunning = isMockTimeGeneratorRunning();

    $startBtn.prop('disabled', isRunning);
    $stopBtn.prop('disabled', !isRunning);
    $resetBtn.prop('disabled', false); // Reset always enabled
}

let statusUpdateIntervalId = null;

/**
 * Start periodic status updates while the generator is running
 * @param {jQuery} $statusDisplay Status display element
 * @param {jQuery} $startBtn Start button
 * @param {jQuery} $stopBtn Stop button
 * @param {jQuery} $resetBtn Reset button
 */
function startStatusUpdateInterval($statusDisplay, $startBtn, $stopBtn, $resetBtn) {
    // Clear any existing interval
    if (statusUpdateIntervalId !== null) {
        clearInterval(statusUpdateIntervalId);
    }

    // Update every 100ms while running
    statusUpdateIntervalId = setInterval(() => {
        if (isMockTimeGeneratorRunning()) {
            updateTimeGeneratorStatus($statusDisplay);
        } else {
            // Stop the interval if the generator stopped
            clearInterval(statusUpdateIntervalId);
            statusUpdateIntervalId = null;
        }
    }, 100);
}

/**
 * Initialize dev mode functionality
 * This is called when the dev mode panel is created
 */
export function initDevMode() {
    dbg('Initializing dev mode functionality');
    
    // Add dev mode specific styles to the page
    addDevModeStyles();
    
    // Set up any global dev mode behaviors
    setupGlobalDevModeHandlers();
}

/**
 * Add dev mode specific CSS styles
 */
function addDevModeStyles() {
    const styles = `
        <style id="devmode-styles">
        .devmode-tab-content {
            padding: 16px;
        }
        
        .devmode-section {
            margin-bottom: 20px;
            padding-bottom: 16px;
            border-bottom: 1px solid #e0e0e0;
        }
        
        .devmode-section:last-child {
            border-bottom: none;
        }
        
        .devmode-section h3 {
            margin-top: 0;
            margin-bottom: 12px;
            font-size: 14px;
            font-weight: 600;
            color: var(--text-color);
        }
        
        .devmode-button-group {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }
        
        .devmode-button {
            padding: 6px 12px;
            border: 1px solid #ccc;
            border-radius: 4px;
            background: #f5f5f5;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.2s ease;
        }
        
        .devmode-button:hover:not(:disabled) {
            background: #e8e8e8;
        }
        
        .devmode-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .devmode-button-success {
            background: #d4edda;
            border-color: #28a745;
            color: #155724;
        }
        
        .devmode-button-success:hover:not(:disabled) {
            background: #c3e6cb;
        }
        
        .devmode-button-danger {
            background: #f8d7da;
            border-color: #dc3545;
            color: #721c24;
        }
        
        .devmode-button-danger:hover:not(:disabled) {
            background: #f5c6cb;
        }
        
        .devmode-status-display {
            padding: 8px 12px;
            border-radius: 4px;
            font-family: monospace;
            font-size: 13px;
        }
        
        .devmode-status-connected {
            background: #d4edda;
            color: #155724;
            border: 1px solid #28a745;
        }
        
        .devmode-status-disconnected {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #dc3545;
        }
        
        .devmode-info {
            background: #e7f3ff;
            padding: 12px;
            border-radius: 4px;
            font-size: 12px;
            line-height: 1.4;
        }
        
        .devmode-debug-info {
            font-family: monospace;
            font-size: 11px;
            background: #f8f9fa;
            padding: 8px;
            border-radius: 4px;
            max-height: 200px;
            overflow-y: auto;
        }

        .devmode-controls-container {
            margin: 12px 0;
        }

        .devmode-control-row {
            display: flex;
            align-items: center;
            margin-bottom: 12px;
            gap: 12px;
        }

        .devmode-control-label {
            min-width: 120px;
            font-size: 12px;
            font-weight: 500;
            color: var(--text-color);
        }

        .devmode-control-slider-container {
            display: flex;
            align-items: center;
            gap: 8px;
            flex: 1;
        }

        .devmode-control-slider {
            flex: 1;
            height: 6px;
            border-radius: 3px;
            background: #ddd;
            outline: none;
            -webkit-appearance: none;
        }

        .devmode-control-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: var(--accent-color, #00ff41);
            cursor: pointer;
        }

        .devmode-control-slider::-moz-range-thumb {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: var(--accent-color, #00ff41);
            cursor: pointer;
            border: none;
        }

        .devmode-control-value {
            min-width: 40px;
            text-align: right;
            font-family: monospace;
            font-size: 12px;
            color: var(--text-color);
        }
        </style>
    `;
    
    // Only add styles if they don't already exist
    if ($('#devmode-styles').length === 0) {
        $('head').append(styles);
    }
}

/**
 * Set up global dev mode event handlers
 */
function setupGlobalDevModeHandlers() {
    // Future global handlers can be added here
    dbg('Dev mode global handlers initialized');
}