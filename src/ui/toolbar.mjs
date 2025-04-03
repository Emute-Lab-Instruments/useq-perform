import { dbg } from "../utils.mjs";
import { saveUserSettings, activeUserSettings } from "../utils/persistentUserSettings.mjs";
import { setFontSize } from "../editors/editorConfig.mjs";
import { connectToSerialPort, setConnectedToModule } from "../io/serialComms.mjs";


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


export function makeToolbar(editor) {
    // Store editor reference
    editorInstance = editor;

    setConnectedToModule(false);
    
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
        dbg("uSEQ-Perform: hello");
        navigator.serial.requestPort()
            .then((port) => {
                connectToSerialPort(port).then(connected => {
                    setConnectedToModule(connected);
                });
            })
            .catch((e) => {
                console.log("error selecting port", e);
            });
    });

    $("#button-settings").on("click", function() {
        toggleAuxPanel("#panel-settings");
    });

    $("#button-help").on("click", function() {
        toggleAuxPanel("#panel-help");
    });
    
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