import { default_extensions, complete_keymap } from '@nextjournal/clojure-mode';
// import {basicSetup} from "codemirror"
import { EditorView, drawSelection, keymap } from  '@codemirror/view';
// import {javascript} from "@codemirror/lang-javascript"
import { syntaxHighlighting, defaultHighlightStyle, foldGutter, bracketMatching } from '@codemirror/language';
import { extension as eval_ext, cursor_node_string, top_level_string } from '@nextjournal/clojure-mode/extensions/eval-region';
// import {extension as eval_ext } from '@nextjournal/clojure-mode/extensions/eval-region';


var serialport = null;
const encoder = new TextEncoder();


$(function() {
  $("#btnConnect").on("click", function() {
    console.log("uSEQ-Perform: hello")
    console.log(navigator.serial);
    navigator.serial.requestPort()
    .then( (port) => {
      port.open({baudRate:115200}).then(() => {
        serialport = port;
        console.log("open, writing...");
        console.log(port.writable);
      })
    })
    .catch((e) => {
      // The user didn't select a port.
    });
  });
  
  $("#btnEval").on("click", function() {
    console.log("eval");
    console.log(top_level_string(state));
  });
});

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
                
let extensions = [keymap.of(complete_keymap),
  theme,
  foldGutter(),
  syntaxHighlighting(defaultHighlightStyle),
  drawSelection(),
  bracketMatching(),
...default_extensions,
  useqExtension({modifier: "Ctrl"})];
                    
let state = EditorState.create({doc: "\n\n(d2 (sqr (fast 2 bar)))",
  extensions: extensions });

let editor = new EditorView({
  state:state,
  extensions:extensions,
  parent: document.body
})



