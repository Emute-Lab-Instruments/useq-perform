// NEXTJOURNAL (clojure-mode)
import { compileString } from 'squint-cljs';
import { WebMidi } from "webmidi";
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { createIcons, Cable, Save, File, SwatchBook, AArrowDown, AArrowUp, CircleHelp } from 'lucide';

// Import our modular components
import { 
  createEditorExtensions, 
  changeFontSize, 
  changeTheme,
  themes,
  createUpdateListener
} from './editorConfig.mjs';

import { 
  loadConfig, 
  saveConfig, 
  updateConfig,
  getConfig
} from './configManager.mjs';

import { openCam } from './openCam.mjs';
import { upgradeCheck } from './upgradeCheck.mjs';
import { post, sendTouSEQ, setSerialPort, getSerialPort, serialReader, serialMapFunctions } from './serialComms.mjs';
import { drawSerialVis } from './serialVis.mjs';
import { interfaceStates, panelStates } from './panelStates.mjs';

export { createEditor, connectToSerialPort, setupMIDI, defSerialMap, midictrl };

// Global variables
let editor = null;
let config = { savelocal: true };

// MIDI control functions
serialMapFunctions[0] = (buffer) => {
  // Example MIDI mapping function - can be activated via user code
  // if (WebMidi.outputs[0]) {
  //   WebMidi.outputs[0].sendControlChange(1, 1, {channels:[1]})
  // }
}

function defSerialMap(idx, func) {
  serialMapFunctions[idx] = func.bind({ midictrl: midictrl });
  console.log("added defserial", idx);
}

function midictrl(devIdx, chan, ctrlNum, val) {
  if (WebMidi.outputs[devIdx]) {
    WebMidi.outputs[devIdx].sendControlChange(ctrlNum, val, { channels: [chan] });
  }
}

// Function to evaluate code passed from Clojure/Squint
const scopedEval = (scope, script) => Function(`"use strict"; ${script}`).bind(scope)();

/**
 * Creates and configures the editor instance
 */
function createEditor() {
  // Load configuration
  const appConfig = loadConfig();
  config.savelocal = appConfig.storage.savelocal;
  
  // Create base extensions
  const extensions = [
    ...createEditorExtensions(appConfig.editor),
    createUpdateListener(appConfig.storage)
  ];
  
  // Create editor state with empty starting text
  const editorEmptyStartingText = Array(100).fill("\n").join("");
  const state = EditorState.create({
    doc: editorEmptyStartingText,
    extensions: extensions
  });
  
  // Create and return the editor view
  return new EditorView({
    state: state,
    parent: document.getElementById("lceditor")
  });
}

/**
 * Connect to the serial port for uSEQ communication
 */
function connectToSerialPort(port) {
  port.open({ baudRate: 115200 }).then(() => {
    setSerialPort(port);
    serialReader();
    $("#btnConnect").hide(1000);
    console.log("checking version");
    sendTouSEQ("@(useq-report-firmware-info)", upgradeCheck);
  }).catch((err) => {
    console.log(err);
    //connection failed
    post("Connection failed. See <a href=\"https://www.emutelabinstruments.co.uk/useqinfo/useq-editor/#troubleshooting\">https://www.emutelabinstruments.co.uk/useqinfo/useq-editor/#troubleshooting</a>");
  });
}

/**
 * Sets up MIDI input/output devices
 */
function setupMIDI() {
  navigator.requestMIDIAccess().then((access) => {
    WebMidi
      .enable()
      .then(onEnabled)
      .catch(err => alert(err));
      
    function onEnabled() {
      // Log MIDI Inputs
      console.log("MIDI Inputs");
      WebMidi.inputs.forEach(input => console.log(input.manufacturer, input.name));
      
      // Log MIDI Outputs
      console.log("MIDI Outputs");
      WebMidi.outputs.forEach(output => console.log(output.manufacturer, output.name));
    }
  });
}

// Document ready function - Main entry point
$(function () {
  // Initialize UI
  $("#helppanel").hide();
  $("#vidcontainer").hide();
  $("#serialvis").hide();
  
  // Check for Web Serial API support
  if (!navigator.serial) {
    post("A Web Serial compatible browser such as Chrome, Edge or Opera is required, for connection to the uSEQ module");
    post("See https://caniuse.com/web-serial for more information");
  } else {
    // Set up serial connection event listeners
    navigator.serial.addEventListener('connect', e => {
      console.log(e);
      let port = getSerialPort();
      if (port) {
        post("uSEQ plugged in, use the connect button to re-connect");
      }
    });
    
    navigator.serial.addEventListener('disconnect', e => {
      $("#btnConnect").show(1000);
      post("uSEQ disconnected");
    });
  }
  
  // Create editor instance
  editor = createEditor();
  
  // Initialize icons
  createIcons({
    icons: {
      Cable, Save, File, SwatchBook, AArrowDown, AArrowUp, CircleHelp
    }
  });
  
  // Handle URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  
  if (urlParams.has('nosave')) {
    config.savelocal = false;
    updateConfig('storage', { savelocal: false });
  }
  
  // Load code from various sources
  if (urlParams.has("gist")) {
    // Load from GitHub Gist
    const gistid = urlParams.get("gist");
    console.log("loading gist " + gistid);
    $.ajax({
      url: "https://api.github.com/gists/" + gistid,
      type: "GET",
      data: { "accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      error: function (xhr, ajaxOptions, thrownError) {
        const transactionSpec = { changes: { from: 0, to: editor.state.doc.length, insert: "gist not found" } };
        const transaction = editor.state.update(transactionSpec);
        editor.dispatch(transaction);
      }
    }).then(function (data) {
      const transactionSpec = { changes: { from: 0, to: editor.state.doc.length, insert: Object.entries(data.files)[0][1].content } };
      const transaction = editor.state.update(transactionSpec);
      editor.dispatch(transaction);
    });
  } else if (urlParams.has("txt")) {
    // Load from text URL
    const url = urlParams.get("txt");
    console.log("loading code " + url);
    $.ajax({
      url: url,
      type: "GET",
      data: {},
      error: function (xhr, ajaxOptions, thrownError) {
        const transactionSpec = { changes: { from: 0, to: editor.state.doc.length, insert: "code not found" } };
        const transaction = editor.state.update(transactionSpec);
        editor.dispatch(transaction);
      }
    }).then(function (data) {
      const transactionSpec = { changes: { from: 0, to: editor.state.doc.length, insert: data } };
      const transaction = editor.state.update(transactionSpec);
      editor.dispatch(transaction);
    });
  } else {
    // Load from local storage
    if (config.savelocal) {
      let txt = window.localStorage.getItem("useqcode");
      if (txt) {
        const transactionSpec = { changes: { from: 0, to: editor.state.doc.length, insert: txt } };
        const transaction = editor.state.update(transactionSpec);
        editor.dispatch(transaction);
      }
    }
  }
  
  // Set up UI event handlers
  $("#increaseFontButton").on("click", () => {
    const editorConfig = getConfig('editor');
    editorConfig.fontSize++;
    changeFontSize(editor, editorConfig.fontSize);
    updateConfig('editor', { fontSize: editorConfig.fontSize });
  });
  
  $("#decreaseFontButton").on("click", () => {
    const editorConfig = getConfig('editor');
    editorConfig.fontSize--;
    changeFontSize(editor, editorConfig.fontSize);
    updateConfig('editor', { fontSize: editorConfig.fontSize });
  });
  
  $("#btnConnect").on("click", function () {
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
    const transactionSpec = { changes: { from: 0, to: editor.state.doc.length, insert: data['text'] } };
    const transaction = editor.state.update(transactionSpec);
    editor.dispatch(transaction);
  });
  
  $("#saveButton").on("click", async () => {
    async function saveToFile(fileContents, ext, desc) {
      async function getNewFileHandle(ext, desc) {
        const options = {
          suggestedName: "untitled" + ext,
          types: [
            {
              description: desc,
              accept: {
                'text/plain': ['.txt', ext],
              },
            },
          ],
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
      writeFile(filehandle, fileContents);
    }
    
    const fileData = { "text": editor.state.doc.toString(), "format_version": 1 };
    saveToFile(JSON.stringify(fileData), ".useq", "uSEQ Code");
  });
  
  $("#helpButton").click(() => {
    $("#helppanel").toggle(100);
  });
  
  $("#themeButton").on("click", async () => {
    const editorConfig = getConfig('editor');
    editorConfig.currentTheme = (editorConfig.currentTheme + 1) % themes.length;
    changeTheme(editor, editorConfig.currentTheme);
    updateConfig('editor', { currentTheme: editorConfig.currentTheme });
  });
  
  // Start animation loop for serial visualization
  window.requestAnimationFrame(drawSerialVis);
  
  // Display welcome messages
  post("Hello!");
  post("Use the [connect] button to link to uSEQ");
});