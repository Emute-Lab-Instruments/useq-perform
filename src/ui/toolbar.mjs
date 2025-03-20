import { saveUserSettings, activeUserSettings } from "../utils/persistentUserSettings.mjs";
import { changeFontSize } from "../editors/editorConfig.mjs";
import { connectToSerialPort } from "../io/serialComms.mjs";
import { interfaceStates, panelStates } from "./panelStates.mjs";

let editorInstance = null;

export function initToolbarPanel(editor) {
    // Store editor reference
    editorInstance = editor;
    
    // Set up UI event handlers
    $("#increaseFontButton").on("click", () => {
        activeUserSettings.editor.fontSize++;
        changeFontSize(editorInstance, activeUserSettings.editor.fontSize);
        saveUserSettings();
    });
    
    $("#decreaseFontButton").on("click", () => {
        activeUserSettings.editor.fontSize--;
        changeFontSize(editorInstance, activeUserSettings.editor.fontSize);
        saveUserSettings();
    });
    
    $("#btnConnect").on("click", function() {
        console.log("uSEQ-Perform: hello");
        navigator.serial.requestPort()
            .then((port) => {
                connectToSerialPort(port);
            })
            .catch((e) => {
                console.log("error selecting port");
            });
    });
    
    $("#loadButton").on("click", async () => {
        let fileHandle;
        [fileHandle] = await window.showOpenFilePicker();
        const file = await fileHandle.getFile();
        const contents = await file.text();
        const data = JSON.parse(contents);
        const transactionSpec = { changes: { from: 0, to: editorInstance.state.doc.length, insert: data['text'] } };
        const transaction = editorInstance.state.update(transactionSpec);
        editorInstance.dispatch(transaction);
    });
    
    $("#saveButton").on("click", async () => {
        const fileData = { 
            "text": editorInstance.state.doc.toString(),
            "format_version": 1 
        };
        await saveToFile(JSON.stringify(fileData), ".useq", "uSEQ Code");
    });
    
    $("#helpButton").click(() => {
        if (interfaceStates.helpPanelState === panelStates.OFF) {
            $("#panel-help").show(100);
            interfaceStates.helpPanelState = panelStates.PANEL;
        } else {
            $("#panel-help").hide(100);
            interfaceStates.helpPanelState = panelStates.OFF;
        }
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