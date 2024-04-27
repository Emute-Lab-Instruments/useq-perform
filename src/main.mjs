import { default_extensions, complete_keymap } from '@nextjournal/clojure-mode';
// import {basicSetup} from "codemirror"
import { EditorView, drawSelection, keymap } from  '@codemirror/view';
// import {javascript} from "@codemirror/lang-javascript"
import { syntaxHighlighting, defaultHighlightStyle, foldGutter, bracketMatching } from '@codemirror/language';


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



let extensions = [keymap.of(complete_keymap),
  theme,
  foldGutter(),
  syntaxHighlighting(defaultHighlightStyle),
  drawSelection(),
  bracketMatching(),
...default_extensions];

let state = EditorState.create({doc: "... some clojure code...",
                extensions: extensions });

let editor = new EditorView({
  state:state,
  extensions:extensions,
  parent: document.body
})

                // let editor = new EditorView({
                //   extensions: [basicSetup, javascript()],
                //   parent: document.body
                // })
                                