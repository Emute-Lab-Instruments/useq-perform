import { dbg } from "../utils.mjs";
import { saveUserSettings, activeUserSettings } from "../utils/persistentUserSettings.mjs";
import { setFontSize, toggleSerialVis } from "../editors/editorConfig.mjs";
import { toggleConnect, sendTouSEQ, isConnectedToModule } from "../io/serialComms.mjs";
import { devmode } from "../urlParams.mjs";


let editorInstance = null;


function toggleAuxPanel(panelID) {
    const panel = $(panelID);

    if (panel.is(":visible")) { 
        $(`.panel-aux`).hide();
    } else {
        $(`.panel-aux`).hide();
        panel.show();
        
        // Make sure the panel has an expand toggle button
        ensurePanelHasExpandToggle(panel);
        
        // Make sure the panel has a close button
        ensurePanelHasCloseButton(panel);
    }
}

// Toggle expanded state of panel
function togglePanelExpand(panelElement) {
    const panel = $(panelElement);
    panel.toggleClass('panel-expanded');
    
    // Update the button's icon based on the panel's state
    const isExpanded = panel.hasClass('panel-expanded');
    const toggleButton = panel.find('.panel-expand-toggle');
    const iconElement = toggleButton.find('.expand-icon');
    
    // First remove the old icon element
    iconElement.remove();
    
    // Create a new icon element with the correct icon name
    const newIcon = $(`<i class="expand-icon" data-lucide="${isExpanded ? 'chevron-right' : 'chevron-left'}"></i>`);
    toggleButton.append(newIcon);
    
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
    const panelId = panel.attr('id');
    
    // Check if button already exists
    if (panel.find('.panel-expand-toggle').length === 0) {
        const toggleButton = $(`
            <div class="panel-expand-toggle" data-panel="${panelId}" title="Toggle expand panel">
                <i class="expand-icon" data-lucide="chevron-left"></i>
            </div>
        `);
        
        // Append button to the panel
        panel.append(toggleButton);
        
        // Add click event handler
        toggleButton.on('click', function(e) {
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
    const panelId = panel.attr('id');
    
    // Check if button already exists
    if (panel.find('.panel-close-button').length === 0) {
        const closeButton = $(`
            <button class="panel-close-button" data-panel="${panelId}" title="Close panel">
                <i class="close-icon" data-lucide="x"></i>
            </button>
        `);
        
        // Append button to the panel
        panel.append(closeButton);
        
        // Add click event handler
        closeButton.on('click', function(e) {
            e.stopPropagation();
            $(`.panel-aux`).hide();
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
    const $devModeButton = $('<a>', {
        class: 'toolbar-button',
        id: 'button-devmode',
        title: 'Dev Mode Tools',
        html: '<i data-lucide="wrench"></i>'
    });
    
    // Find the last toolbar row and add the button there
    const $lastToolbarRow = $('.toolbar-row').last();
    $lastToolbarRow.append($devModeButton);
    
    // Initialize the Lucide icon
    if (window.lucide) {
        window.lucide.createIcons();
    }
    
    dbg("Dev mode button added to toolbar");
}

export function makeToolbar(editor) {
    // Store editor reference
    editorInstance = editor;
    
    // Add dev mode button if dev mode is active
    if (devmode) {
        addDevModeButton();
    }
    
    // Set up UI event handlers
    $("#button-increase-font").on("click", () => {
        activeUserSettings.editor.fontSize++;
        setFontSize(editorInstance, activeUserSettings.editor.fontSize);
        saveUserSettings();
    });
    
    $("#button-decrease-font").on("click", () => {
        activeUserSettings.editor.fontSize--;
        setFontSize(editorInstance, activeUserSettings.editor.fontSize);
        saveUserSettings();
    });
    
    $("#button-connect").on("click", function() {
        toggleConnect();
    });


    $("#button-graph").on("click", function() {
        toggleSerialVis();
    });

    $("#button-settings").on("click", function() {
        toggleAuxPanel("#panel-settings");
    });

    $("#button-help").on("click", function() {
        toggleAuxPanel("#panel-help");
    });

    // Dev mode button - only set up handler if dev mode is active
    if (devmode) {
        $("#button-devmode").on("click", function() {
            toggleAuxPanel("#panel-devmode");
        });
        dbg("Dev mode button handler registered");
    }
    
    $("#button-load").on("click", async () => {
        let fileHandle;
        [fileHandle] = await window.showOpenFilePicker();
        const file = await fileHandle.getFile();
        const contents = await file.text();
        const data = JSON.parse(contents);
        const transactionSpec = { changes: { from: 0, to: editorInstance.state.doc.length, insert: data['text'] } };
        const transaction = editorInstance.state.update(transactionSpec);
        editorInstance.dispatch(transaction);
    });
    
    $("#button-save").on("click", async () => {
        const fileData = { 
            "text": editorInstance.state.doc.toString(),
            "format_version": 1 
        };
        await saveToFile(JSON.stringify(fileData), ".useq", "uSEQ Code");
    });
    
    // Initialize expand toggles and close buttons for all existing panels when the UI is first loaded
    $('.panel-aux').each(function() {
        ensurePanelHasExpandToggle($(this));
        ensurePanelHasCloseButton($(this));
    });

    // Setup top playback toolbar interactions
    initPlaybackToolbar();
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

function setPlaybackState(state) {
    playbackState = state;
    updatePlaybackUI();
}

function updatePlaybackUI() {
    const $play = $('#button-play');
    const $pause = $('#button-pause');
    const $stop = $('#button-stop');
    const $rewind = $('#button-rewind');
    const $clear = $('#button-clear');

    // Reset classes
    [$play, $pause, $stop, $rewind, $clear].forEach($b => $b.removeClass('primary disabled'));

    // If not connected, gray out all controls
    if (!isConnected) {
        [$play, $pause, $stop, $rewind, $clear].forEach($b => $b.addClass('disabled'));
        return;
    }

    switch (playbackState) {
        case PlaybackState.Playing:
            $play.addClass('primary disabled');
            // pause, stop, rewind, clear enabled
            break;
        case PlaybackState.Paused:
            $pause.addClass('primary disabled');
            // play, stop, rewind, clear enabled
            break;
        case PlaybackState.Stopped:
        default:
            $stop.addClass('primary disabled');
            // play enabled, pause disabled; rewind, clear enabled
            $pause.addClass('disabled');
            break;
    }
}

function initPlaybackToolbar() {
    const $play = $('#button-play');
    const $pause = $('#button-pause');
    const $stop = $('#button-stop');
    const $rewind = $('#button-rewind');
    const $clear = $('#button-clear');

    if (!($play.length && $pause.length && $stop.length && $rewind.length)) {
        return; // Top toolbar not present
    }

    // Initial connection state
    try {
        isConnected = !!isConnectedToModule();
    } catch (e) { isConnected = false; }

    // Initial state
    updatePlaybackUI();

    $play.on('click', () => {
        if ($play.hasClass('disabled')) return;
        sendTouSEQ('(useq-play)');
        setPlaybackState(PlaybackState.Playing);
    });

    $pause.on('click', () => {
        if ($pause.hasClass('disabled')) return;
        sendTouSEQ('(useq-pause)');
        setPlaybackState(PlaybackState.Paused);
    });

    $stop.on('click', () => {
        if ($stop.hasClass('disabled')) return;
        sendTouSEQ('(useq-stop)');
        setPlaybackState(PlaybackState.Stopped);
    });

    $rewind.on('click', () => {
        if ($rewind.hasClass('disabled')) return;
        sendTouSEQ('(useq-rewind)');
        // After rewind, consider state stopped
        setPlaybackState(PlaybackState.Stopped);
    });

    $clear.on('click', () => {
        if ($clear.hasClass('disabled')) return;
        sendTouSEQ('(useq-clear-outs)');
    });

    // React to connection status changes
    window.addEventListener('useq-connection-changed', (e) => {
        isConnected = !!(e && e.detail && e.detail.connected);
        updatePlaybackUI();
    });
}
