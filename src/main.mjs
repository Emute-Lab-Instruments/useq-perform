//stuff

import { default_extensions, complete_keymap } from '@nextjournal/clojure-mode';
// import {basicSetup} from "codemirror"
import { EditorView, drawSelection, keymap } from  '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
// import {javascript} from "@codemirror/lang-javascript"
import { syntaxHighlighting, defaultHighlightStyle, foldGutter, bracketMatching } from '@codemirror/language';
import { extension as eval_ext, cursor_node_string, top_level_string } from '@nextjournal/clojure-mode/extensions/eval-region';
import {WebMidi} from "webmidi";
import { marked } from "marked";
import { DataTreeModule } from 'tabulator-tables';
import { Buffer } from 'buffer';


var serialport = null;
const encoder = new TextEncoder();
var consoleLines = []

// async function serialReader() {
//   if (serialport) {
//     console.log("reading...");
//     if (serialport.readable && !serialport.readable.locked) {
//       console.log(serialport.readable)
//       // const reader = serialport.readable.getReader({'mode':'byob'});
//       const textDecoder = new TextDecoderStream()
//       const readableStreamClosed = serialport.readable.pipeTo(textDecoder.writable)
//       const reader = textDecoder.readable.getReader()
//       //https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream/getReader
//       let serialValCounter=0;
//       try {
//         let txtbuffer="";
//         let serialInMsg = new Uint8Array(9);
//         while (true) {
//           const { value, done } = await reader.read();
//           if (done) {
//             // |reader| has been canceled.
//             console.log("reader done")
//             break;
//           }
//           // if (value != "" && value != "\r\n") {
//           console.log(value.length);            
//           const textEncoder = new TextEncoder();
//           const valBytes = textEncoder.encode(value);
//           // const valBytes = value;
//           for(let i=0; i < valBytes.length; i++) {
//             if (serialValCounter > 0) {
//               console.log(valBytes[i]);
//               serialInMsg[9-serialValCounter] = valBytes[i];
//               if (serialValCounter==1) {
//                 //decode
//                 console.log(serialInMsg);
//                 // const f64bytes = serialInMsg.slice(1);
//                 const buf = Buffer.from(serialInMsg);
//                 const val = buf.readDoubleLE(1);
//                 console.log(val);
//               }
//               serialValCounter--;
//             }else if (valBytes[i] == 31) {
//               serialValCounter = 9;
//             }else{
//               txtbuffer = txtbuffer + String.fromCharCode(valBytes[i]);
//             }
//           }
//           console.log(txtbuffer)
//           // post(txtbuffer);
//           txtbuffer = "";
//           // }
//         }
//         console.log(result)
//       } catch (error) {
//         console.log(error);
//       } finally {
//         reader.releaseLock();
//         serialReader();
//       }
//     }else{
//       console.log(serialport);
//     }    
//   }
// }

async function serialReader() {
  if (serialport) {
    console.log("reading...");
    let buffer = new Uint8Array(0);
    // let buffer = new ArrayBuffer(bufferSize);    
    if (serialport.readable && !serialport.readable.locked) {
      const reader = serialport.readable.getReader();
      // const textDecoder = new TextDecoderStream()
      // const readableStreamClosed = serialport.readable.pipeTo(textDecoder.writable)
      // const reader = textDecoder.readable.getReader()
      let serialReadModes = {"ANY":0, "TEXT":1,"SERIALSTREAM":2}
      let serialReadMode = serialReadModes.ANY;
      try {
        while (true) {
          const { value, done } = await reader.read();
          console.log("rcv...")
          if (done) {
            // |reader| has been canceled.
            break;
          }
          // buffer = value.buffer;
          // let charbuf = new Uint8Array(buffer)
          // console.log(charbuf);
          
          // // if (value != "" && value != "\r\n") {
          // //   console.log("rcv:" + value);
          // const textEncoder = new TextEncoder();
          // const txt = textEncoder.encode(buffer);
          // console.log( String.fromCharCode(txt));
          // //   post(value);
          // // }
          // buffer.clear();
          let byteArray = new Uint8Array(value.buffer);
          // console.log("Received data (bytes):", byteArray);
    
          // Display data as text
          // const text = new TextDecoder().decode(byteArray);
          // console.log("Received data (text):", text);   
          //if there's unconsumed data from the last read, then prepend to new data
          if (buffer.length > 0) {
            // console.log("prepending")
            console.log(buffer.length)
            let newBuffer = new Uint8Array(buffer.length+byteArray.length)
            newBuffer.set(buffer)
            newBuffer.set(byteArray, buffer.length)
            byteArray = newBuffer
          }
          // console.log("buf: " + byteArray.length)
          let processed=false;
          while (byteArray.length > 0) {
            //consume next val
            switch(serialReadMode) {
              case serialReadModes.ANY:
              {
                if (byteArray[0] == 31) {
                  serialReadMode = serialReadModes.SERIALSTREAM;
                }else{
                  serialReadMode = serialReadModes.TEXT;
                }
              }
              case serialReadModes.TEXT:
              {
                // console.log("text mode")
                //find end of line?
                let found=false;
                for (let i = 0; i < byteArray.length - 1; i++) {
                  if (byteArray[i] === 13 && byteArray[i + 1] === 10) {
                    found=true
                    let msg = new TextDecoder().decode(byteArray.slice(0,i))
                    console.log(msg)
                    post("uSEQ: " + msg)
                    byteArray = byteArray.slice(i+2);
                    console.log(byteArray)
                    serialReadMode = serialReadModes.ANY
                  }
                } 
                if (!found) {
                  processed = true;
                }         
                break;
              }
              case serialReadModes.SERIALSTREAM:
              {
                // console.log("serial stream")
                if (byteArray.length < 10) {
                  //wait for more data incoming
                  processed=true;
                }else{
                  //read channel
                  const channel = byteArray[1];
                  // console.log("ch: " + channel)
                  //decode double
                  const buf = Buffer.from(byteArray);
                  const val = buf.readDoubleLE(2);
                  // console.log(val);

                  //trim data
                  byteArray = byteArray.slice(10)
                  serialReadMode = serialReadModes.ANY;
                }
                break;
              }
            } //switch
            if (processed) {
              break;
            }
          }
          //carry through any remainder to the next read
          buffer = byteArray;
          // console.log("consumed")
          
        }
      } catch (error) {
        console.log(error);
      } finally {
        console.log("finally")
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
  code = code.replace('\n','')
  console.log(code);
  if (serialport && serialport.writable) {
    const writer = serialport.writable.getWriter();
    console.log("writing...")
    writer.write(encoder.encode(code)).then(() =>{
      writer.releaseLock();
      console.log("written")
    });
  }else{
    post("uSEQ not connected")
  }
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
  "&": {"height":"100%"},
  ".cm-wrap": {"height":"100%"},
  ".cm-content, .cm-gutter": {minHeight: "100%"},
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
  ".cm-scroller": { "overflow": "auto"},
  // only show cursor when focused
  ".cm-cursor": {visibility: "hidden"},
  "&.cm-focused .cm-cursor": {visibility: "visible"}
}, { dark: DataTreeModule });





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
  evalToplevel(opts, "@")
}
let evalQuantised = function (opts) {
  evalToplevel(opts)
}

let useqExtension = ( opts ) => {
  return keymap.of([
    //{key: "Alt-Enter", run: evalCell},
                    {key: opts.modifier + "-Enter",
                      run: evalNow
                    },{key:"Alt-Enter", run: evalQuantised}
                  ])}

const updateListenerExtension = EditorView.updateListener.of((update) => {
  if (update.docChanged && config.savelocal) {
    
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

var config={'savelocal':true}


$(function() {
  //test
  console.log("float test")
  // const f64bytes = new Uint8Array([71,95,90,28,231,68,254,64]);
  const f64bytes = new Uint8Array([1, 51,51,51,51,51,51,243,63,]);
  
  const buf = Buffer.from(f64bytes);
  const val = buf.readDoubleLE(1);
  console.log(val);


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
  if (urlParams.has('nosave')) {
    config.savelocal = false;
  }
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
    if (config.savelocal) {
      let txt =window.localStorage.getItem("useqcode");
      if (txt) {
        const transactionSpec = { changes: { from: 0, to: editor.state.doc.length, insert: txt } };
        // Create a transaction using the spec
        const transaction = editor.state.update(transactionSpec);
        // Dispatch the transaction to update the editor state
        editor.dispatch(transaction);  
      }
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
