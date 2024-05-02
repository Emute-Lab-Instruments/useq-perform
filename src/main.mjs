import { default_extensions, complete_keymap } from '@nextjournal/clojure-mode';
// import {basicSetup} from "codemirror"
import { EditorView, drawSelection, keymap } from  '@codemirror/view';
// import {javascript} from "@codemirror/lang-javascript"
import { syntaxHighlighting, defaultHighlightStyle, foldGutter, bracketMatching } from '@codemirror/language';
import { extension as eval_ext, cursor_node_string, top_level_string } from '@nextjournal/clojure-mode/extensions/eval-region';

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
          // Do something with |value|...
          // console.log("read:")
          if (value != "") {
            console.log(value);
            consoleLines.push(value)
            if (consoleLines.length > 50) {
              consoleLines = consoleLines.slice(1)
            }
            $("#console").html(consoleLines.join('<br>'));
            $('#console').scrollTop($('#console')[0].scrollHeight - $('#console')[0].clientHeight);
          }
        }
      } catch (error) {
        console.log(error);
      } finally {
        reader.releaseLock();
        serialReader();
      }
    }    
  }
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
});

navigator.serial.addEventListener('disconnect', e => {
  console.log(e);
});



import { EditorState } from  '@codemirror/state';

let theme = EditorView.theme({
  ".cm-content": {whitespace: "pre-wrap",
                  passing: "10px 0",
                  flex: "1 1 0"},

  "&.cm-focused": {outline: "0 !important"},
  ".cm-line": {"padding": "0 9px",
               "line-height": "1.6",
               "font-size": "16px",
               "font-family": "var(--code-font)"},
  ".cm-matchingBracket": {"border-bottom": "1px solid var(--teal-color)",
                          "color": "inherit"},
  ".cm-gutters": {background: "transparent",
                  border: "none"},
  ".cm-gutterElement": {"margin-left": "5px"},
  // only show cursor when focused
  ".cm-cursor": {visibility: "hidden"},
  "&.cm-focused .cm-cursor": {visibility: "visible"}
});





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
                    
let state = EditorState.create({doc: "(d2 (sqr (fast 2 bar)))",
  extensions: extensions });




$(function() {
  var editor = new EditorView({
    state:state,
    extensions:extensions,
    parent: document.getElementById("lceditor")
  })

  let txt =window.localStorage.getItem("useqcode");
  if (txt) {
    
    const transactionSpec = { changes: { from: 0, to: editor.state.doc.length, insert: txt } };
    // Create a transaction using the spec
    const transaction = editor.state.update(transactionSpec);
    // Dispatch the transaction to update the editor state
    editor.dispatch(transaction);  
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
