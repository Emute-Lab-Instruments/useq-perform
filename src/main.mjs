import { default_extensions, complete_keymap } from '@nextjournal/clojure-mode';
// import {basicSetup} from "codemirror"
import { EditorView, drawSelection, keymap } from  '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
// import {javascript} from "@codemirror/lang-javascript"
import { syntaxHighlighting, defaultHighlightStyle, foldGutter, bracketMatching } from '@codemirror/language';
import { extension as eval_ext, cursor_node_string, top_level_string } from '@nextjournal/clojure-mode/extensions/eval-region';
import {WebMidi} from "webmidi";
import { marked } from "marked";


var serialport = null;
const encoder = new TextEncoder();
var consoleLines = []

async function serialReader() {
  if (serialport) {
    console.log("reading...");
    if (serialport.readable && !serialport.readable.locked) {
      console.log(serialport.readable)
      // const reader = serialport.readable.getReader();
      const textDecoder = new TextDecoderStream()
      const readableStreamClosed = serialport.readable.pipeTo(textDecoder.writable)
      const reader = textDecoder.readable.getReader()

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            // |reader| has been canceled.
            break;
          }
          if (value != "" && value != "\r\n") {
            console.log("rcv:" + value);
            const textEncoder = new TextEncoder();
            // const uint8Array = textEncoder.encode(value);
            // console.log(uint8Array);
            post(value);
          }
        }
      } catch (error) {
        console.log(error);
      } finally {
        reader.releaseLock();
        serialReader();
      }
    }else{
      console.log(serialport);
    }    
  }
}



function post(value) {
  consoleLines.push(marked.parse(value))
  if (consoleLines.length > 50) {
    consoleLines = consoleLines.slice(1);
  }
  // $("#console").html(consoleLines.join('<br>'));
  $("#console").html(consoleLines.join(''));
  $('#console').scrollTop($('#console')[0].scrollHeight - $('#console')[0].clientHeight);
}

function sendTouSEQ(code) {
  const writer = serialport.writable.getWriter();
  console.log("writing...")
  writer.write(encoder.encode(code)).then(() =>{
    writer.releaseLock();
    console.log("written")
  });

}


navigator.serial.addEventListener('connect', e => {
  console.log(e);
  console.log("reconnected")
  serialReader();
  $("#btnConnect").hide(1000);

});

navigator.serial.addEventListener('disconnect', e => {
  console.log(e);
  $("#btnConnect").show(1000);
  post("uSEQ disconnected")
});




let theme = EditorView.theme({
  ".cm-content": {whitespace: "pre-wrap",
                  passing: "10px 0",
                  flex: "1 1 0"},

  "&.cm-focused": {outline: "0 !important"},
  ".cm-line": {"padding": "0 9px",
               "line-height": "1.6",
               "font-size": "16px",
               "font-family": "var(--code-font)"},
  ".cm-matchingBracket": {"border-bottom": "1px solid var(--white-color)",
                          "color": "inherit"},
  ".cm-gutters": {background: "transparent",
                  border: "none"},
  ".cm-gutterElement": {"margin-left": "5px"},
  // only show cursor when focused
  ".cm-cursor": {visibility: "hidden"},
  "&.cm-focused .cm-cursor": {visibility: "visible"}
}, { dark: true });





let evalToplevel = function (opts) {
  console.log("eval top level")
  let state = opts.state;
  let code = top_level_string(state);
  console.log(code);
  sendTouSEQ(code);
  return true;
}

let useqExtension = ( opts ) => {
  return keymap.of([
    //{key: "Alt-Enter", run: evalCell},
                    {key: opts.modifier + "-Enter",
                      run: evalToplevel
                    }])}

const updateListenerExtension = EditorView.updateListener.of((update) => {
  if (update.docChanged) {
    // Handle the event here
    // You can access the updated document using `update.state.doc`
    window.localStorage.setItem("useqcode", update.state.doc.toString());
  }
});
                
let extensions = [keymap.of(complete_keymap),
  theme,
  foldGutter(),
  syntaxHighlighting(defaultHighlightStyle),
  drawSelection(),
  bracketMatching(),
...default_extensions,
  useqExtension({modifier: "Ctrl"}),
  updateListenerExtension];
                    
let state = EditorState.create({doc: "",
  extensions: extensions });




$(function() {

  WebMidi
  .enable()
  .then(onEnabled)
  .catch(err => alert(err));

  function onEnabled() {
    
    // Inputs
    WebMidi.inputs.forEach(input => console.log(input.manufacturer, input.name));
    
    // Outputs
    WebMidi.outputs.forEach(output => console.log(output.manufacturer, output.name));

  }


  var editor = new EditorView({
    state:state,
    extensions:extensions,
    parent: document.getElementById("lceditor")
  })

  //first, check if loading external file
  var urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has("gist")) {
    const gistid = urlParams.get("gist")
    console.log("loading gist " + gistid)
    $.ajax({
      url: "https://api.github.com/gists/" + gistid,
      type: "GET",
      data: {"accept":"application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
      error:function (xhr, ajaxOptions, thrownError){
        const transactionSpec = { changes: { from: 0, to: editor.state.doc.length, insert: "gist not found" }};
        const transaction = editor.state.update(transactionSpec);
        editor.dispatch(transaction);  
        }
    }).then(function(data) {
      const transactionSpec = { changes: { from: 0, to: editor.state.doc.length, insert: Object.entries(data.files)[0][1].content } };
      const transaction = editor.state.update(transactionSpec);
      editor.dispatch(transaction);  

  });
  }
  else{
    //load from local storage
    let txt =window.localStorage.getItem("useqcode");
    if (txt) {
      const transactionSpec = { changes: { from: 0, to: editor.state.doc.length, insert: txt } };
      // Create a transaction using the spec
      const transaction = editor.state.update(transactionSpec);
      // Dispatch the transaction to update the editor state
      editor.dispatch(transaction);  
    }
    }


  $("#btnConnect").on("click", function() {
    console.log("uSEQ-Perform: hello")
    console.log(navigator.serial);
    navigator.serial.requestPort()
    .then( (port) => {
      port.open({baudRate:115200}).then(() => {
        serialport = port;
        // serialReadTimer = setInterval(serialReader, 500);
        serialReader();
        $("#btnConnect").hide(1000);
      })
    })
    .catch((e) => {
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

  })

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
      const filehandle = await getNewFileHandle(ext,desc);
      writeFile(filehandle, fileContents);

    } 
    const fileData = {"text": editor.state.doc.toString(), "format_version": 1  };
    saveToFile(JSON.stringify(fileData), ".useq", "uSEQ Code")
  });
});
