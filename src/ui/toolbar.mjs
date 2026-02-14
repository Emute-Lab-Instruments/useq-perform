import { dbg } from "../utils.mjs";
import { saveUserSettings, activeUserSettings } from "../utils/persistentUserSettings.mjs";
import { setFontSize, toggleSerialVis } from "../editors/editorConfig.mjs";
import { toggleConnect, sendTouSEQ, isConnectedToModule, getSerialPort } from "../io/serialComms.mjs";
import { devmode } from "../urlParams.mjs";
import { initToolbarBarProgress } from "./toolbarBarProgress.mjs";
import { startMockTimeGenerator, stopMockTimeGenerator, resumeMockTimeGenerator, resetMockTimeGenerator } from "../io/mockTimeGenerator.mjs";
import { evalInUseqWasm } from "../io/useqWasmInterpreter.mjs";

const TOP_TOOLBAR_ID = "panel-top-toolbar";
const TOP_TOOLBAR_HEIGHT_VAR = "--top-toolbar-height";

let topToolbarResizeObserver = null;
let topToolbarResizeListener = null;


let editorInstance = null;

function hideAllAuxPanels() {
    document.querySelectorAll(".panel-aux").forEach(el => el.style.display = "none");
}

function toggleAuxPanel(panelID) {
    const panel = document.querySelector(panelID);
    if (!panel) return;

    if (panel.offsetParent !== null) {
        hideAllAuxPanels();
    } else {
        hideAllAuxPanels();
        panel.style.display = "";

        // Make sure the panel has an expand toggle button
        ensurePanelHasExpandToggle(panel);

        // Make sure the panel has a close button
        ensurePanelHasCloseButton(panel);
    }
}

// Toggle expanded state of panel
function togglePanelExpand(panelElement) {
    panelElement.classList.toggle('panel-expanded');

    // Update the button's icon based on the panel's state
    const isExpanded = panelElement.classList.contains('panel-expanded');
    const toggleButton = panelElement.querySelector('.panel-expand-toggle');
    const iconElement = toggleButton ? toggleButton.querySelector('.expand-icon') : null;

    // First remove the old icon element
    if (iconElement) iconElement.remove();

    // Create a new icon element with the correct icon name
    const newIcon = document.createElement('i');
    newIcon.className = 'expand-icon';
    newIcon.setAttribute('data-lucide', isExpanded ? 'chevron-right' : 'chevron-left');
    if (toggleButton) toggleButton.appendChild(newIcon);

    // Force the Lucide icon to render immediately
    if (window.lucide) {
        window.lucide.createIcons({
            attrs: {
                class: ['expand-icon']
            }
        });
    }
}

// Add expand toggle button to panel if it doesn't exist
function ensurePanelHasExpandToggle(panel) {
    const panelId = panel.getAttribute('id');

    // Check if button already exists
    if (!panel.querySelector('.panel-expand-toggle')) {
        const toggleButton = document.createElement('div');
        toggleButton.className = 'panel-expand-toggle';
        toggleButton.setAttribute('data-panel', panelId);
        toggleButton.title = 'Toggle expand panel';
        toggleButton.innerHTML = '<i class="expand-icon" data-lucide="chevron-left"></i>';

        // Append button to the panel
        panel.appendChild(toggleButton);

        // Add click event handler
        toggleButton.addEventListener('click', function(e) {
            e.stopPropagation();
            togglePanelExpand(panel);
        });

        // Initialize Lucide icon
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }
}

// Add close button to panel if it doesn't exist
function ensurePanelHasCloseButton(panel) {
    const panelId = panel.getAttribute('id');

    // Check if button already exists
    if (!panel.querySelector('.panel-close-button')) {
        const closeButton = document.createElement('button');
        closeButton.className = 'panel-close-button';
        closeButton.setAttribute('data-panel', panelId);
        closeButton.title = 'Close panel';
        closeButton.innerHTML = '<i class="close-icon" data-lucide="x"></i>';

        // Append button to the panel
        panel.appendChild(closeButton);

        // Add click event handler
        closeButton.addEventListener('click', function(e) {
            e.stopPropagation();
            hideAllAuxPanels();
        });

        // Initialize Lucide icon
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }
}

/**
 * Dynamically add dev mode button to toolbar when dev mode is active
 */
function addDevModeButton() {
    dbg("Adding dev mode button to toolbar");

    // Create the dev mode button
    const devModeButton = document.createElement('a');
    devModeButton.className = 'toolbar-button';
    devModeButton.id = 'button-devmode';
    devModeButton.title = 'Dev Mode Tools';
    devModeButton.innerHTML = '<i data-lucide="wrench"></i>';

    // Find the last toolbar row and add the button there
    const toolbarRows = document.querySelectorAll('.toolbar-row');
    const lastToolbarRow = toolbarRows[toolbarRows.length - 1];
    if (lastToolbarRow) lastToolbarRow.appendChild(devModeButton);

    // Initialize the Lucide icon
    if (window.lucide) {
        window.lucide.createIcons();
    }

    dbg("Dev mode button added to toolbar");
}

function addClickHandler(id, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", handler);
}

export function makeToolbar(editor) {
    // Store editor reference
    editorInstance = editor;

    // Add dev mode button if dev mode is active
    if (devmode) {
        addDevModeButton();
    }

    // Set up UI event handlers
    addClickHandler("button-increase-font", () => {
        activeUserSettings.editor.fontSize++;
        setFontSize(editorInstance, activeUserSettings.editor.fontSize);
        saveUserSettings();
    });

    addClickHandler("button-decrease-font", () => {
        activeUserSettings.editor.fontSize--;
        setFontSize(editorInstance, activeUserSettings.editor.fontSize);
        saveUserSettings();
    });

    addClickHandler("button-connect", () => {
        toggleConnect();
    });

    addClickHandler("button-graph", () => {
        toggleSerialVis();
    });

    addClickHandler("button-settings", () => {
        toggleAuxPanel("#panel-settings");
    });

    addClickHandler("button-help", () => {
        toggleAuxPanel("#panel-help");
    });

    // Dev mode button - only set up handler if dev mode is active
    if (devmode) {
        addClickHandler("button-devmode", () => {
            toggleAuxPanel("#panel-devmode");
        });
        dbg("Dev mode button handler registered");
    }

    const transportRow = document.querySelector('#panel-top-toolbar .toolbar-row');
    initToolbarBarProgress(transportRow);
    initTopToolbarHeightTracking();

    addClickHandler("button-load", async () => {
        let fileHandle;
        [fileHandle] = await window.showOpenFilePicker();
        const file = await fileHandle.getFile();
        const contents = await file.text();
        const data = JSON.parse(contents);
        const transactionSpec = { changes: { from: 0, to: editorInstance.state.doc.length, insert: data['text'] } };
        const transaction = editorInstance.state.update(transactionSpec);
        editorInstance.dispatch(transaction);
    });

    addClickHandler("button-save", async () => {
        const fileData = {
            "text": editorInstance.state.doc.toString(),
            "format_version": 1
        };
        await saveToFile(JSON.stringify(fileData), ".useq", "uSEQ Code");
    });

    // Initialize expand toggles and close buttons for all existing panels when the UI is first loaded
    document.querySelectorAll('.panel-aux').forEach(panel => {
        ensurePanelHasExpandToggle(panel);
        ensurePanelHasCloseButton(panel);
    });

    // Setup top playback toolbar interactions
    initPlaybackToolbar();
}

function initTopToolbarHeightTracking() {
    updateTopToolbarHeight();

    if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
            updateTopToolbarHeight();
        });
    } else {
        setTimeout(() => {
            updateTopToolbarHeight();
        }, 0);
    }

    const toolbar = document.getElementById(TOP_TOOLBAR_ID);
    if (!toolbar) {
        return;
    }

    if (typeof ResizeObserver !== "undefined") {
        if (topToolbarResizeObserver) {
            topToolbarResizeObserver.disconnect();
        }
        topToolbarResizeObserver = new ResizeObserver(() => {
            updateTopToolbarHeight();
        });
        topToolbarResizeObserver.observe(toolbar);
    }

    if (!topToolbarResizeListener) {
        topToolbarResizeListener = () => {
            updateTopToolbarHeight();
        };
        window.addEventListener("resize", topToolbarResizeListener, { passive: true });
    }
}

function updateTopToolbarHeight() {
    const toolbar = document.getElementById(TOP_TOOLBAR_ID);
    if (!toolbar) {
        document.documentElement.style.setProperty(TOP_TOOLBAR_HEIGHT_VAR, "0px");
        return;
    }
    const rect = toolbar.getBoundingClientRect();
    const candidateHeights = [rect && rect.height, toolbar.offsetHeight, toolbar.scrollHeight];
    let measuredHeight = 0;
    for (const candidate of candidateHeights) {
        if (typeof candidate === "number" && candidate > measuredHeight) {
            measuredHeight = candidate;
        }
    }
    if (measuredHeight <= 0 && typeof window !== "undefined" && window.getComputedStyle) {
        const computed = window.getComputedStyle(toolbar);
        const parsed = parseFloat(computed.height || "0");
        if (!Number.isNaN(parsed) && parsed > 0) {
            measuredHeight = parsed;
        }
    }
    const resolvedHeight = Number.isFinite(measuredHeight) ? Math.ceil(measuredHeight) : 0;
    document.documentElement.style.setProperty(
        TOP_TOOLBAR_HEIGHT_VAR,
        `${Math.max(0, resolvedHeight)}px`
    );
}

async function saveToFile(fileContents, ext, desc) {
    async function getNewFileHandle(ext, desc) {
        const options = {
            suggestedName: "untitled" + ext,
            types: [{
                description: desc,
                accept: {
                    'text/plain': ['.txt', ext],
                },
            }],
        };
        const handle = await window.showSaveFilePicker(options);
        return handle;
    }

    async function writeFile(fileHandle, contents) {
        const writable = await fileHandle.createWritable();
        await writable.write(contents);
        await writable.close();
    }

    const filehandle = await getNewFileHandle(ext, desc);
    await writeFile(filehandle, fileContents);
}

// --- Playback toolbar state & handlers ---

const PlaybackState = Object.freeze({
    Stopped: 'stopped',
    Playing: 'playing',
    Paused: 'paused',
});

let playbackState = PlaybackState.Stopped;
let isConnected = false;

function isWasmInterpreterEnabled() {
    try {
        return activeUserSettings?.wasm?.enabled ?? true;
    } catch (e) {
        return true;
    }
}

function syncWasmTransportState(state) {
    if (!isWasmInterpreterEnabled()) {
        return;
    }

    switch (state) {
        case 'playing':
            evalInUseqWasm('(useq-play)');
            break;
        case 'paused':
            evalInUseqWasm('(useq-pause)');
            break;
        case 'stopped':
            evalInUseqWasm('(useq-stop)');
            break;
        default:
            break;
    }
}

function setPlaybackState(state) {
    playbackState = state;
    updatePlaybackUI();
}

// Query transport state from hardware and update UI
async function queryTransportState() {
    if (!isConnected) return;

    try {
        const response = await sendTouSEQ('(useq-get-transport-state)', (text) => {
            const state = text.trim().replace(/"/g, ''); // Remove quotes from string response
            switch (state) {
                case 'playing':
                    setPlaybackState(PlaybackState.Playing);
                    syncWasmTransportState('playing');
                    break;
                case 'paused':
                    setPlaybackState(PlaybackState.Paused);
                    syncWasmTransportState('paused');
                    break;
                case 'stopped':
                    setPlaybackState(PlaybackState.Stopped);
                    syncWasmTransportState('stopped');
                    break;
                default:
                    dbg('Unknown transport state from hardware:', state);
            }
        });
    } catch (error) {
        dbg('Failed to query transport state:', error);
    }
}

// Handle transport state pushed from hardware via JSON meta
function handleTransportStatePush(event) {
    const detail = event?.detail;
    const meta = detail?.response?.meta;

    if (meta && typeof meta.transport === 'string') {
        const state = meta.transport;
        switch (state) {
            case 'playing':
                setPlaybackState(PlaybackState.Playing);
                syncWasmTransportState('playing');
                break;
            case 'paused':
                setPlaybackState(PlaybackState.Paused);
                syncWasmTransportState('paused');
                break;
            case 'stopped':
                setPlaybackState(PlaybackState.Stopped);
                syncWasmTransportState('stopped');
                break;
            default:
                dbg('Unknown transport state in meta:', state);
        }
    }
}

function updatePlaybackUI() {
    const play = document.getElementById('button-play');
    const pause = document.getElementById('button-pause');
    const stop = document.getElementById('button-stop');
    const rewind = document.getElementById('button-rewind');
    const clear = document.getElementById('button-clear');

    const buttons = [play, pause, stop, rewind, clear];

    // Reset classes
    buttons.forEach(b => { if (b) { b.classList.remove('primary', 'disabled'); } });

    if (!isConnected && !isWasmInterpreterEnabled()) {
        buttons.forEach(b => { if (b) b.classList.add('disabled'); });
        if (stop) stop.classList.add('primary');
        return;
    }

    switch (playbackState) {
        case PlaybackState.Playing:
            if (play) play.classList.add('primary', 'disabled');
            // pause, stop, rewind, clear enabled
            break;
        case PlaybackState.Paused:
            if (pause) pause.classList.add('primary', 'disabled');
            // play, stop, rewind, clear enabled
            break;
        case PlaybackState.Stopped:
        default:
            if (stop) stop.classList.add('primary', 'disabled');
            // play enabled, pause disabled; rewind, clear enabled
            if (pause) pause.classList.add('disabled');
            break;
    }
}

function initPlaybackToolbar() {
    const play = document.getElementById('button-play');
    const pause = document.getElementById('button-pause');
    const stop = document.getElementById('button-stop');
    const rewind = document.getElementById('button-rewind');
    const clear = document.getElementById('button-clear');

    if (!(play && pause && stop && rewind)) {
        return; // Top toolbar not present
    }

    // Initial connection state
    try {
        isConnected = !!isConnectedToModule();
    } catch (e) { isConnected = false; }

    // Hardware boots in "playing" state by default
    playbackState = PlaybackState.Playing;
    updatePlaybackUI();

    const sendTransportCommand = (cmd) => {
        if (isConnected) {
            sendTouSEQ(cmd);
        }
        if (isWasmInterpreterEnabled()) {
            evalInUseqWasm(cmd);
        }
    };

    play.addEventListener('click', () => {
        if (play.classList.contains('disabled')) return;

        sendTransportCommand('(useq-play)');

        // If not connected to real hardware (disconnected OR mock connection)
        // and WASM is enabled, we need to drive the time generator
        const isRealConnection = isConnected && !!getSerialPort();

        if (!isRealConnection && isWasmInterpreterEnabled()) {
            if (playbackState === PlaybackState.Paused) {
                resumeMockTimeGenerator();
            } else {
                startMockTimeGenerator();
            }
        }
        setPlaybackState(PlaybackState.Playing);
    });

    pause.addEventListener('click', () => {
        if (pause.classList.contains('disabled')) return;

        sendTransportCommand('(useq-pause)');

        const isRealConnection = isConnected && !!getSerialPort();

        if (!isRealConnection && isWasmInterpreterEnabled()) {
            stopMockTimeGenerator();
        }
        setPlaybackState(PlaybackState.Paused);
    });

    stop.addEventListener('click', () => {
        if (stop.classList.contains('disabled')) return;

        sendTransportCommand('(useq-stop)');

        const isRealConnection = isConnected && !!getSerialPort();

        if (!isRealConnection && isWasmInterpreterEnabled()) {
            stopMockTimeGenerator();
            resetMockTimeGenerator();
        }
        setPlaybackState(PlaybackState.Stopped);
    });

    rewind.addEventListener('click', () => {
        if (rewind.classList.contains('disabled')) return;

        sendTransportCommand('(useq-rewind)');

        const isRealConnection = isConnected && !!getSerialPort();

        if (!isRealConnection && isWasmInterpreterEnabled()) {
            resetMockTimeGenerator();
        }
        // After rewind, consider state stopped
        setPlaybackState(PlaybackState.Stopped);
    });

    if (clear) {
        clear.addEventListener('click', () => {
            if (clear.classList.contains('disabled')) return;

            sendTransportCommand('(useq-clear)');
        });
    }

    // React to connection status changes
    window.addEventListener('useq-connection-changed', (e) => {
        isConnected = !!(e && e.detail && e.detail.connected);

        // Ensure mock time generator is stopped when connected so it doesn't interfere
        // with hardware time updates or lack thereof (when paused)
        // ONLY if it is a real hardware connection!
        const isRealConnection = isConnected && !!getSerialPort();

        if (isRealConnection) {
            stopMockTimeGenerator();
        }

        updatePlaybackUI();
    });

    // Listen for protocol ready event to query state
    window.addEventListener('useq-protocol-ready', () => {
        if (isConnected) {
            queryTransportState();
        }
    });

    // Listen for transport state updates pushed from hardware via JSON meta
    window.addEventListener('useq-json-meta', handleTransportStatePush);
}
