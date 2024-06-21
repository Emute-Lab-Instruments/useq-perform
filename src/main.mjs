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
// import { DataTreeModule } from 'tabulator-tables';
import { Buffer } from 'buffer';
import { compileString } from 'squint-cljs';


const panelStates = {OFF:0,PANEL:1, FULLSCREEN: 2}

var interfaceStates={vidpanelState:panelStates.OFF, camOpened:false}


var serialport = null;
const encoder = new TextEncoder();
var consoleLines = []
//keep queue of recent MIDI values  
function uSEQ_Serial_Map(channel, value) {

}

class CircularBuffer {
  constructor(bufferLength) {
    this.buffer = [];
    this.pointer = 0;
    this.bufferLength = bufferLength;
  }
  
  push(element) {
    if(this.buffer.length === this.bufferLength) {
       this.buffer[this.pointer] = element;
    } else {
       this.buffer.push(element);
    }
    this.pointer = (this.pointer + 1) % this.bufferLength;
  }

  get(i) {
    return this.buffer[(this.pointer + i) % this.bufferLength];
  }
  
}

var serialBuffers = [];
for(let i=0; i < 8; i++) serialBuffers[i] = new CircularBuffer(100);
console.log(serialBuffers)



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
          // console.log("rcv...")
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
            // console.log(buffer.length)
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
                // console.log(byteArray)
                //look for start of message marker
                if (byteArray[0] == 31) {
                  if (byteArray.length > 1) {
                    //check message type
                    if (byteArray[1] == 0) {
                        serialReadMode = serialReadModes.SERIALSTREAM;
                    }else{
                      serialReadMode = serialReadModes.TEXT;
                    }
                  }else{
                    //wait for more data
                    processed = true
                  }
                }else{
                  //no marker, so try to find message start
                  let found=false;
                  for (let i = 0; i < byteArray.length - 1; i++) {
                    if (byteArray[i] === 31 ) {
                      found=true
                      byteArray = byteArray.slice(i);
                    }
                  }
                  if (!found) {
                    //lose data and wait for a message start
                    byteArray = byteArray.slice(byteArray.length)
                  }
                  //done for now, wait for more data
                  processed=true
                  break
                }
              }
              case serialReadModes.TEXT:
              {
                // console.log("text mode")
                //find end of line?
                let found=false;
                for (let i = 2; i < byteArray.length - 1; i++) {
                  if (byteArray[i] === 13 && byteArray[i + 1] === 10) {
                    found=true
                    let msg = new TextDecoder().decode(byteArray.slice(2,i))
                    // msg = encodeURIComponent(msg);
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
                if (byteArray.length < 11) {
                  //wait for more data incoming
                  processed=true;
                }else{
                  //read channel
                  const channel = byteArray[2];
                  // console.log("ch: " + channel)
                  //decode double
                  const buf = Buffer.from(byteArray);
                  const val = buf.readDoubleLE(3);
                  // console.log(val);
                  serialBuffers[channel-1].push(val);

                  //trim data
                  byteArray = byteArray.slice(11)
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
        reader.releaseLock();
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
  code = code.replaceAll('\n','')
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
                    },
                    {key:"Alt-Enter", run: evalQuantised}
                    // ,
                    // {key:"Alt-h", run: () => {console.log("help");}}
                  ])}

                  //$("#helppanel").toggle(300)
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

function drawSerialVis() {
  const palette = ['#00429d', '#45a5ad', '#ace397', '#fcbf5d', '#ff809f', '#ff005e', '#c9004c', '#93003a'];
  var c = document.getElementById("serialcanvas");
  var ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  const gap = c.width * 1.0 / serialBuffers[0].bufferLength;
  for(let ch=0; ch < 8; ch++) {
    ctx.beginPath();
    ctx.moveTo(0,c.height - (c.height * serialBuffers[ch].get(0)));
    
    for(let i=1; i < serialBuffers[ch].bufferLength-1; i++) {
      ctx.lineTo(gap*i, c.height - (c.height * serialBuffers[ch].get(i)));    
    }
    // ctx.closePath();
    ctx.strokeStyle = palette[ch];
    ctx.stroke();
  }
  window.requestAnimationFrame(drawSerialVis)  
}

function openCam(){
  let allMediaDevices=navigator.mediaDevices
  if (!allMediaDevices || !allMediaDevices.getUserMedia) {
     console.log("getUserMedia() not supported.");
     return;
  }
  allMediaDevices.getUserMedia({
     audio: false,
     video: { width: 1920, height: 1080 }
  })
  .then(function(vidStream) {
     var video = document.getElementById('videopanel');
     if ("srcObject" in video) {
        video.srcObject = vidStream;
     } else {
        video.src = window.URL.createObjectURL(vidStream);
     }
     video.onloadedmetadata = function(e) {
        video.play();
     };
  })
  .catch(function(e) {
     console.log(e.name + ": " + e.message);
  });
}

$(function() {
  $("#helppanel").hide();
  $("#vidcontainer").hide();
  $("#serialvis").hide();

  //test
  // console.log("float test")
  // // const f64bytes = new Uint8Array([71,95,90,28,231,68,254,64]);
  // const f64bytes = new Uint8Array([1, 51,51,51,51,51,51,243,63,]);
  
  // const buf = Buffer.from(f64bytes);
  // const val = buf.readDoubleLE(1);
  // console.log(val);
  console.log("squint test")
  const jscode = compileString("(+ 127 3)"
                             , {"context": "expr",
                                "elide-imports": true}
                            )
  console.log(jscode)


  if (!navigator.serial) {
    post("A Web Serial compatible browser such as Chrome, Edge or Opera is required, for connection to the uSEQ module")
    post("See https://caniuse.com/web-serial for more information")
  }else{
    navigator.serial.addEventListener('connect', e => {
      console.log(e);
      console.log("reconnected")
      // serialReader();
      // $("#btnConnect").hide(1000);
    
    });
    
    navigator.serial.addEventListener('disconnect', e => {
      // console.log(e);
      // $("#btnConnect").show(1000);
      post("uSEQ disconnected")
    });    
  }
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
      WebMidi.inputs.forEach(input => console.log(input.manufacturer, input.name));
      
      // Outputs
      WebMidi.outputs.forEach(output => console.log(output.manufacturer, output.name));
  
    }
  });


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
  }else if (urlParams.has("txt")) {
    const url = urlParams.get("txt")
    console.log("loading code " + url)
    $.ajax({
      url: url,
      type: "GET",
      data: {},
      error:function (xhr, ajaxOptions, thrownError){
        const transactionSpec = { changes: { from: 0, to: editor.state.doc.length, insert: "code not found" }};
        const transaction = editor.state.update(transactionSpec);
        editor.dispatch(transaction);  
        }
    }).then(function(data) {
      const transactionSpec = { changes: { from: 0, to: editor.state.doc.length, insert: data } };
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
      }).catch((err)=>{
        console.log(err)
        //connection failed
        post("Connection failed. See <a href=\"https://www.emutelabinstruments.co.uk/useqinfo/useq-editor/#troubleshooting\">https://www.emutelabinstruments.co.uk/useqinfo/useq-editor/#troubleshooting</a>")
      })
    })
    .catch((e) => {
      console.log("error selecting port")
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
  $("#helpButton").click(() => {
    $("#helppanel").toggle(100);
  });


  const toggleVid = () => {
    console.log("vid")
    console.log(interfaceStates)
    //open cam if needed
    if (!interfaceStates.camOpened) {
      openCam();
      interfaceStates.camOpened = true;
      console.log("open")
    }
    switch(interfaceStates.vidpanelState) {
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

  $(document).on("keydown", function(event) {
    if (event.altKey) {
      console.log(event);
      switch(event.key) {
        case 'h':console.log($("#helppanel")); $("#helppanel").toggle(100); break;
        case 'v':toggleVid(); break;
        // case 'o':loadFile(); break;
        // case 's':saveFile(); break;
        // case 'm':$("#docpanel").toggle(); break;
      }
    }
  });
  window.requestAnimationFrame(drawSerialVis);
});
