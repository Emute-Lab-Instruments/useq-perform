// NEXTJOURNAL (clojure-mode)
import { default_extensions, complete_keymap } from '@nextjournal/clojure-mode';
import { extension as eval_ext, cursor_node_string, top_level_string } from '@nextjournal/clojure-mode/extensions/eval-region';
// CODEMIRROR
import { EditorView, drawSelection, keymap } from  '@codemirror/view';
import { history, historyKeymap } from '@codemirror/commands';
import { Compartment, EditorState } from '@codemirror/state';
import { syntaxHighlighting, defaultHighlightStyle, foldGutter, bracketMatching } from '@codemirror/language';
// OTHERS
import {WebMidi} from "webmidi";
import { compileString } from 'squint-cljs';
import { openCam } from './openCam.mjs';
import { upgradeCheck } from './upgradeCheck.mjs';
import { post, sendTouSEQ, setSerialPort, getSerialPort, serialReader, serialMapFunctions } from './serialComms.mjs';
import { drawSerialVis } from './serialVis.mjs';
import { interfaceStates, panelStates } from './panelStates.mjs';
 

serialMapFunctions[0] = (buffer) => {
  // if (WebMidi.outputs[0]) {
  //   WebMidi.outputs[0].sendControlChange(1, 1, {channels:[1]})
  // }
}

var defSerialMap = (idx, func) => {
  serialMapFunctions[idx] = func;
  console.log("added defserial")
}
// defSerialMap(0, (buf)=>{console.log(0)})

var midictrl = (devIdx, chan, ctrlNum, val ) =>{
  if (WebMidi.outputs[devIdx]) {
    WebMidi.outputs[devIdx].sendControlChange(ctrlNum, val, {channels:[chan]})
  }
}

const jscode = compileString("(js/defSerialMap 0 (fn [buf] (js/midictrl 0 1 1 17)))",
  {
    "context": "expr",
    "elide-imports": true
  });
// console.log(jscode);
// jQuery.globalEval(jscode);
const scopedEval = (scope, script) => Function(`"use strict"; ${script}`).bind(scope)();

// scopedEval({defSerialMap:defSerialMap, midictrl:midictrl}, 'this.defSerialMap(0, (buf)=>{this.midictrl(0, 1, 1, buf.last(0))})')

// eval(jscode)





//keep queue of recent MIDI values  
function uSEQ_Serial_Map(channel, value) {
}

let theme = EditorView.theme({
  "&": {"height":"100%"},
  ".cm-wrap": {"height":"100%"},
  ".cm-content, .cm-gutter": {minHeight: "100%"},
  ".cm-content": {whitespace: "pre-wrap",
                  passing: "10px 0",
                  flex: "1 1 0"},

  "&.cm-focused": {outline: "0 !important"},
  ".cm-line": {"padding": "0 9px",
               "line-height": "1.6",
               "font-size": "24px",
               "font-family": "var(--code-font)"},
  ".cm-matchingBracket": {"border-bottom": "1px solid var(--white-color)",
                          "color": "inherit"},
  ".cm-gutters": {background: "transparent",
                  border: "none"},
  ".cm-gutterElement": {"margin-left": "5px"},
  ".cm-scroller": { "overflow": "auto"},
  // only show cursor when focused
  ".cm-cursor": {visibility: "hidden"},
  "&.cm-focused .cm-cursor": {visibility: "visible"}
}, {});





let evalToplevel = function (opts, prefix="") {
  let state = opts.state;
  let code = prefix + top_level_string(state);
  console.log(code);
  // let utf8Encode = new TextEncoder();
  // console.log(utf8Encode.encode(code));
  sendTouSEQ(code);
  return true;
}

let evalNow = function (opts) {
  console.log("Hello from evalNow");
  evalToplevel(opts, "@")
}

let evalQuantised = function (opts) {
  evalToplevel(opts)
}
// console.log("keymap")
// console.log(complete_keymap)

function toggleHelp() {
  console.log($("#helppanel")); 
  $("#helppanel").toggle(100);
  return true
}

function toggleVid() {
  console.log("vid");
  console.log(interfaceStates);
  //open cam if needed
  if (!interfaceStates.camOpened) {
    if (openCam()) {
      interfaceStates.camOpened = true;
    }
    else {
      post("There was an error opening the video camera");
    }
  }
  if (interfaceStates.camOpened) {
    switch (interfaceStates.vidpanelState) {
      case panelStates.OFF:
        $("#vidcontainer").show();
        interfaceStates.vidpanelState = panelStates.PANEL;
        break;
      case panelStates.PANEL:
        $("#vidcontainer").hide();
        interfaceStates.vidpanelState = panelStates.OFF;
        break;
      // case panelStates.FULLSCREEN:
      //   break;
    }
  }
  return true
}

function toggleSerialVis() {
  console.log("vis");
  console.log(interfaceStates);
  switch (interfaceStates.serialVisPanelState) {
    case panelStates.OFF:
      $("#serialvis").show();
      $("#serialvis").css('top', 0);
      $("#serialvis").css('left', 0);
      $("#serialvis").css('width', '100%');
      $("#serialvis").css('height', '100%');
      interfaceStates.serialVisPanelState = panelStates.PANEL;
      break;
    case panelStates.PANEL:
      $("#serialvis").hide();
      interfaceStates.serialVisPanelState = panelStates.OFF;
      break;
  }
  return true
}


let useq_keymap = [
  {key: "Ctrl-Enter", run: evalNow}
  ,{key:"Alt-Enter", run: evalQuantised}
  ,{key:"Alt-h", run: toggleHelp, preventDefault:true, stopPropagation:true}
  ,{key:"Alt-v", run: toggleVid, preventDefault:true, stopPropagation:true}
  ,{key:"Alt-g", run: toggleSerialVis, preventDefault:true, stopPropagation:true}
];


const updateListenerExtension = EditorView.updateListener.of((update) => {
  if (update.docChanged && config.savelocal) {
    
    // Handle the event here
    // You can access the updated document using `update.state.doc`
    window.localStorage.setItem("useqcode", update.state.doc.toString());
  }
});


let extensions = [
  keymap.of(useq_keymap),
  keymap.of(complete_keymap),
  keymap.of(historyKeymap),
  history(),
  theme,
  foldGutter(),
  syntaxHighlighting(defaultHighlightStyle),
  drawSelection(),
  updateListenerExtension,
  ...default_extensions
];

let state = EditorState.create({doc: "",
  extensions: extensions });

var config={'savelocal':true}

$(function () {
  $("#helppanel").hide();
  $("#vidcontainer").hide();
  $("#serialvis").hide();

  // console.log("squint test");
  // const jscode = compileString("(+ 127 3)",
  //   {
  //     "context": "expr",
  //     "elide-imports": true
  //   }
  // );
  // console.log(jscode);


  if (!navigator.serial) {
    post("A Web Serial compatible browser such as Chrome, Edge or Opera is required, for connection to the uSEQ module");
    post("See https://caniuse.com/web-serial for more information");
  } else {
    navigator.serial.addEventListener('connect', e => {
      console.log(e);
      console.log("reconnected");
      // serialReader();
      // $("#btnConnect").hide(1000);
    });

    navigator.serial.addEventListener('disconnect', e => {
      // console.log(e);
      // $("#btnConnect").show(1000);
      post("uSEQ disconnected");
    });
  }
  setupMIDI();


  var editor = createEditor();


  //first, check if loading external file
  var urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('nosave')) {
    config.savelocal = false;
  }
  if (urlParams.has("gist")) {
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
  }

  else {
    //load from local storage
    if (config.savelocal) {
      let txt = window.localStorage.getItem("useqcode");
      if (txt) {
        const transactionSpec = { changes: { from: 0, to: editor.state.doc.length, insert: txt } };
        // Create a transaction using the spec
        const transaction = editor.state.update(transactionSpec);
        // Dispatch the transaction to update the editor state
        editor.dispatch(transaction);
      }
    }
  }



  $("#btnConnect").on("click", function () {
    console.log("uSEQ-Perform: hello");
    console.log(navigator.serial);
    navigator.serial.requestPort()
      .then((port) => {
        port.open({ baudRate: 115200 }).then(() => {
          setSerialPort(port);
          // serialReadTimer = setInterval(serialReader, 500);
          serialReader();
          $("#btnConnect").hide(1000);
          console.log("checking version");
          sendTouSEQ("@(useq-report-firmware-info)", upgradeCheck);
        }).catch((err) => {
          console.log(err);
          //connection failed
          post("Connection failed. See <a href=\"https://www.emutelabinstruments.co.uk/useqinfo/useq-editor/#troubleshooting\">https://www.emutelabinstruments.co.uk/useqinfo/useq-editor/#troubleshooting</a>");
        });
      })
      .catch((e) => {
        console.log("error selecting port");
        // The user didn't select a port.
      });
  });

  $("#loadButton").on("click", async () => {
    let fileHandle;
    [fileHandle] = await window.showOpenFilePicker();
    const file = await fileHandle.getFile();
    const contents = await file.text();
    const data = JSON.parse(contents);
    const transactionSpec = { changes: { from: 0, to: editor.state.doc.length, insert: data['text'] } };
    // Create a transaction using the spec
    const transaction = editor.state.update(transactionSpec);
    // Dispatch the transaction to update the editor state
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
      // fileHandle is an instance of FileSystemFileHandle..
      async function writeFile(fileHandle, contents) {
        // Create a FileSystemWritableFileStream to write to.
        const writable = await fileHandle.createWritable();
        // Write the contents of the file to the stream.
        await writable.write(contents);
        // Close the file and write the contents to disk.
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


  // $(document).on("keydown", function (event) {
  //   if (event.altKey) {
  //     console.log(event);
  //     switch (event.key) {
  //       // case 'h': console.log($("#helppanel")); $("#helppanel").toggle(100); break;
  //       case 'v': toggleVid(); break;
  //       case 'g': toggleSerialVis(); break;
  //       // case 'o':loadFile(); break;
  //       // case 's':saveFile(); break;
  //       // case 'm':$("#docpanel").toggle(); break;
  //     }
  //   }
  // });
  window.requestAnimationFrame(drawSerialVis);
});

function createEditor() {
  return new EditorView({
    state: state,
    extensions: extensions,
    parent: document.getElementById("lceditor")
  });
}

function setupMIDI() {
  navigator.requestMIDIAccess().then((access) => {
    // Get lists of available MIDI controllers
    // const inputs = access.inputs.values();
    // const outputs = access.outputs.values();
    // …
    WebMidi
      .enable()
      .then(onEnabled)
      .catch(err => alert(err));

    function onEnabled() {

      // Inputs
      console.log("MIDI Inputs");
      WebMidi.inputs.forEach(input => console.log(input.manufacturer, input.name));

      // Outputs
      console.log("MIDI Outputs");
      WebMidi.outputs.forEach(output => console.log(output.manufacturer, output.name));

    }
  });
}