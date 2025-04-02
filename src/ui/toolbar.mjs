import { dbg } from "../utils.mjs";
import { saveUserSettings, activeUserSettings } from "../utils/persistentUserSettings.mjs";
import { setFontSize } from "../editors/editorConfig.mjs";
import { connectToSerialPort } from "../io/serialComms.mjs";


let editorInstance = null;

function toggleAuxPanel(panelID) {
    const panel = $(panelID);

    if (panel.is(":visible")) { 
        $(`.panel-aux`).hide();
    } else {
        $(`.panel-aux`).hide();
        panel.show();
    }
}

export function makeToolbar(editor) {
    // Store editor reference
    editorInstance = editor;
    
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
                connectToSerialPort(port);
            })
            .catch((e) => {
                dbg("error selecting port");
            });
    });

    $("#button-settings").on("click", function() {
        toggleAuxPanel("#panel-settings");
    });

    $("#button-help").on("click", function() {
        toggleAuxPanel("#panel-help");
    });
    
    // FIXME reinstate
    // $("#button-load").on("click", async () => {
    //     let fileHandle;
    //     [fileHandle] = await window.showOpenFilePicker();
    //     const file = await fileHandle.getFile();
    //     const contents = await file.text();
    //     const data = JSON.parse(contents);
    //     const transactionSpec = { changes: { from: 0, to: editorInstance.state.doc.length, insert: data['text'] } };
    //     const transaction = editorInstance.state.update(transactionSpec);
    //     editorInstance.dispatch(transaction);
    // });
    
    // $("#button-save").on("click", async () => {
    //     const fileData = { 
    //         "text": editorInstance.state.doc.toString(),
    //         "format_version": 1 
    //     };
    //     await saveToFile(JSON.stringify(fileData), ".useq", "uSEQ Code");
    // });
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