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
    
    const $title = $('<h3>').text('Debug Information');
    const $info = $('<div>', {
        class: 'devmode-debug-info'
    });
    
    const $placeholder = $('<p>').text('Debug tools will be added here in future updates.');
    
    $container.append($title, $info, $placeholder);
    
    return $container;
}

/**
 * Set up event handlers for connection controls
 * @param {jQuery} $connectBtn Connect button
 * @param {jQuery} $disconnectBtn Disconnect button  
 * @param {jQuery} $statusDisplay Status display element
 */
function setupConnectionControls($connectBtn, $disconnectBtn, $statusDisplay) {
    $connectBtn.on('click', () => {
        dbg('Dev mode: Setting connection to true');
        setConnectedToModule(true);
        updateConnectionStatus($statusDisplay);
        updateButtonStates($connectBtn, $disconnectBtn);
    });
    
    $disconnectBtn.on('click', () => {
        dbg('Dev mode: Setting connection to false');
        setConnectedToModule(false);
        updateConnectionStatus($statusDisplay);
        updateButtonStates($connectBtn, $disconnectBtn);
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