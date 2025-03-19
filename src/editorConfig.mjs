// CODEMIRROR IMPORTS
import { EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
import { history, historyKeymap, deleteCharBackward, deleteCharForward } from '@codemirror/commands';
import { syntaxHighlighting, HighlightStyle, defaultHighlightStyle, foldGutter, bracketMatching } from '@codemirror/language';
import { tags } from "https://esm.sh/@lezer/highlight";

// NEXTJOURNAL (clojure-mode)
import { default_extensions, complete_keymap } from '@nextjournal/clojure-mode';
import { extension as eval_ext, cursor_node_string, top_level_string } from '@nextjournal/clojure-mode/extensions/eval-region';

// THEME IMPORTS
import { barf, cobalt, clouds, coolGlow, noctisLilac, ayuLight } from 'https://esm.sh/thememirror';

// SERIAL COMMUNICATION
import { sendTouSEQ } from './serialComms.mjs';
import { post } from './console.mjs';

// UI STATE
import { interfaceStates, panelStates, togglePanelState, setPanelState } from './panelStates.mjs';
import { openCam } from './openCam.mjs';
import { getConfig } from './configManager.mjs';

export { 
  themeCompartment, 
  fontSizeCompartment, 
  editorBaseTheme, 
  evalToplevel, 
  evalNow, 
  evalQuantised, 
  toggleHelp, 
  toggleVid, 
  toggleSerialVis, 
  useq_keymap, 
  areMatchingBracketChars, 
  complete_keymap_mod, 
  createEditorExtensions, 
  changeFontSize, 
  changeTheme, 
  createUpdateListener, 
  createPatchEditor 
};

const themeCompartment = new Compartment();
const fontSizeCompartment = new Compartment();

// Editor base theme
const editorBaseTheme = EditorView.baseTheme({
  "&": { "height": "100%" },
  ".cm-wrap": { "height": "100%" },
  ".cm-content, .cm-gutter": { minHeight: "100%" },
  ".cm-content": {
    whitespace: "pre-wrap",
    passing: "10px 0",
    flex: "1 1 0",
    caretColor: "var(--text-primary)"
  },
  "&.cm-focused": { outline: "0 !important" },
  ".cm-line": {
    "padding": "0 9px",
    "line-height": "1.6",
    "font-family": "var(--code-font)"
  },
  ".cm-matchingBracket": {
    "border-bottom": "1px solid var(--text-primary)",
    "color": "inherit"
  },
  ".cm-gutters": {
    background: "transparent",
    border: "none"
  },
  ".cm-gutterElement": { "margin-left": "5px" },
  ".cm-scroller": { "overflow": "auto" },
  ".cm-cursor": { visibility: "hidden" },
  "&.cm-focused .cm-cursor": { visibility: "visible" }
});

/**
 * Evaluate code at the top level, optionally with a prefix
 * @param {Object} opts - Editor options containing state
 * @param {string} [prefix=""] - Optional prefix to add to the code
 * @returns {boolean} True to indicate success
 */
function evalToplevel(opts, prefix = "") {
  let state = opts.state;
  let code = prefix + top_level_string(state);
  sendTouSEQ(code);
  return true;
}

/**
 * Evaluate code immediately (with @ prefix)
 * @param {Object} opts - Editor options
 * @returns {boolean} Result of evaluation
 */
function evalNow(opts) {
  return evalToplevel(opts, "@");
}

/**
 * Evaluate code with quantization (standard evaluation)
 * @param {Object} opts - Editor options
 * @returns {boolean} Result of evaluation
 */
function evalQuantised(opts) {
  return evalToplevel(opts);
}

/**
 * Toggle help panel visibility
 * @returns {boolean} True to indicate success
 */
function toggleHelp() {
  togglePanelState('helpPanel', 'helppanel');
  return true;
}

/**
 * Toggle video panel visibility
 * @returns {boolean} True to indicate success
 */
function toggleVid() {
  // Open cam if needed
  if (!interfaceStates.camOpened) {
    if (openCam()) {
      interfaceStates.camOpened = true;
    } else {
      post("There was an error opening the video camera");
      return false;
    }
  }
  
  if (interfaceStates.camOpened) {
    togglePanelState('vidpanel', 'vidcontainer');
  }
  
  return true;
}

/**
 * Toggle serial visualization panel
 * @returns {boolean} True to indicate success
 */
function toggleSerialVis() {
  const newState = togglePanelState('serialVisPanel', 'serialvis');
  
  // Apply additional styling if panel is visible
  if (newState === panelStates.PANEL) {
    $("#serialvis").css({
      'top': 0,
      'left': 0,
      'width': '100%',
      'height': '100%'
    });
  }
  
  return true;
}

// Custom keymap for the editor
const useq_keymap = [
  { key: "Ctrl-Enter", run: evalNow },
  { key: "Alt-Enter", run: evalQuantised },
  { key: "Alt-h", run: toggleHelp, preventDefault: true, stopPropagation: true },
  { key: "Alt-v", run: toggleVid, preventDefault: true, stopPropagation: true },
  { key: "Alt-g", run: toggleSerialVis, preventDefault: true, stopPropagation: true }
];

// Bracket related utilities and modified keymaps
const openingBracketChars = ["(", "[", "{"];
const closingBracketChars = [")", "]", "}"];
const bracketChars = openingBracketChars.concat(closingBracketChars);

/**
 * Check if two bracket characters match (open/close pair)
 * @param {string} char1 - First bracket character
 * @param {string} char2 - Second bracket character
 * @returns {boolean} True if characters form a matching bracket pair
 */
function areMatchingBracketChars(char1, char2) {
  // Works regardless of the order of char1 & char2
  // By checking to see that they're in the same index in the two arrays
  return Math.abs(bracketChars.indexOf(char1) - bracketChars.indexOf(char2)) == openingBracketChars.length;
}

// Modified keybindings to improve usability
const complete_keymap_mod = complete_keymap.map(binding => {
  switch (binding.key) {
    // Fix Del unbalancing parens
    case 'Delete':
      const originalRun = binding.run;
      return {
        ...binding,
        run: (view) => {
          const { state } = view;
          const { from } = state.selection.main;
          
          const nextChar = state.doc.sliceString(from, from + 1);
          if (bracketChars.includes(nextChar)) {
            const prevChar = state.doc.sliceString(from-1, from);
            if (areMatchingBracketChars(prevChar, nextChar)) {
              console.log("matching brackets");
              // We're in an empty pair, delete both
              // characters around the cursor
              view.dispatch({
                changes: { from: from - 1, to: from, insert: "" }
              });
              // NOTE: this is needed to avoid a blank space 
              // being inserted after the deleted brackets
              deleteCharForward(view);
              return true;
            }
            else{
              // Next char is a closing bracket in a non-empty
              // expression, do nothing
              return true; 
            }
          }
          // Next char isn't a closing bracket, delete normally
          return originalRun(view); // Run the original function
        }
      };
    // Change bindings for slurping and barfing 
    // (to avoid using arrows which are intercepted by some OSes)
    case 'Ctrl-ArrowRight':
      return { ...binding, key: 'Ctrl-]' };
    case 'Ctrl-ArrowLeft':
      return { ...binding, key: 'Ctrl-[' };
    case 'Ctrl-Alt-ArrowLeft':
      return { ...binding, key: 'Ctrl-;' };
    case 'Ctrl-Alt-ArrowRight':
      return { ...binding, key: "Ctrl-'" };
    default:
      return binding;
  }
});

/**
 * Create editor extensions based on configuration
 * @param {Object} config - Editor configuration object
 * @returns {Array} Array of editor extensions
 */
function createEditorExtensions(config) {
  return [
    keymap.of(useq_keymap),
    keymap.of(complete_keymap_mod),
    keymap.of(historyKeymap),
    history(),
    editorBaseTheme,
    foldGutter(),
    bracketMatching(),
    lineNumbers(),
    fontSizeCompartment.of(EditorView.theme({
      ".cm-content": { fontSize: `${config.fontSize || 16}px` }
    })),
    themeCompartment.of(baseThemes[config.currentTheme || 'light']),
    drawSelection(),
    ...default_extensions
  ];
}

/**
 * Change editor font size
 * @param {EditorView} editor - The editor instance
 * @param {number} size - New font size in pixels
 */
function changeFontSize(editor, size) {
  editor.dispatch({
    effects: fontSizeCompartment.reconfigure(EditorView.theme({
      ".cm-content": { fontSize: `${size}px` }
    }))
  });
}

/**
 * Change editor theme
 * @param {EditorView} editor - The editor instance
 * @param {string} themeName - Name of the theme ('light' or 'dark')
 */
function changeTheme(editor, themeName) {
  const theme = baseThemes[themeName];
  if (!theme) return;

  const extension = createTheme(theme);
  editor.dispatch({
    effects: themeCompartment.reconfigure(extension)
  });

  // Update all patch editors
  document.querySelectorAll('.patch-code').forEach(element => {
    const patchEditor = EditorView.findFromDOM(element);
    if (patchEditor) {
      patchEditor.dispatch({
        effects: themeCompartment.reconfigure(extension)
      });
    }
  });
}

/**
 * Create update listener extension for auto-save
 * @param {Object} config - Configuration object with storage settings
 * @returns {Extension} Editor extension for document change handling
 */
function createUpdateListener(config) {
  return EditorView.updateListener.of((update) => {
    if (update.docChanged && config.savelocal) {
      window.localStorage.setItem("useqcode", update.state.doc.toString());
    }
  });
}

/**
 * Create a CodeMirror editor instance for a patch code block
 * @param {HTMLElement} element - The DOM element to attach the editor to
 * @param {string} code - The initial code content
 * @returns {EditorView} The created editor view instance
 */
function createPatchEditor(element, code) {
  const currentTheme = baseThemes[getConfig('editor').currentTheme || 'light'];
  const isDark = currentTheme.extension?.some(ext => 
    ext.extension?.value === true && 
    ext.extension?.source?.toString().includes('darkTheme')
  );

  const state = EditorState.create({
    doc: code,
    extensions: [
      ...default_extensions,
      EditorView.editable.of(false), // Make it read-only
      EditorState.readOnly.of(true),
      themeCompartment.of(currentTheme),
      EditorView.theme({
        "&": { 
          maxHeight: "400px",
          borderColor: isDark ? "rgba(255,255,255,0.2)" : "#e9ecef"
        },
        ".cm-scroller": { overflow: "auto" },
        ".cm-content": { padding: "0.8em" },
        "&.cm-editor": {
          borderWidth: "1px",
          borderStyle: "solid",
          borderRadius: "4px"
        }
      })
    ]
  });

  return new EditorView({
    state: state,
    parent: element
  });
}