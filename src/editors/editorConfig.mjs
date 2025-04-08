// CODEMIRROR IMPORTS
import { EditorView, keymap, lineNumbers } from "@codemirror/view";

// NEXTJOURNAL (clojure-mode)
import {
  extension as eval_ext,
  cursor_node_string,
  top_level_string,
} from "@nextjournal/clojure-mode/extensions/eval-region";

// SERIAL COMMUNICATION
import { sendTouSEQ } from "../io/serialComms.mjs";
import { post } from "../io/console.mjs";

// UI STATE
import { openCam } from "../ui/camera.mjs";
import { getUserSettings } from "../utils/persistentUserSettings.mjs";
import { fontSizeCompartment } from "./state.mjs";

import { showDocumentationForSymbol as showDocForSymbol } from "../ui/help/moduLispReference.mjs";
import { dbg } from "../utils.mjs";

export function evalToplevel(opts, prefix = "") {
  let state = opts.state;
  let code = prefix + top_level_string(state);
  sendTouSEQ(code);
  return true;
}

export function evalNow(opts) {
  return evalToplevel(opts, "@");
}

export function evalQuantised(opts) {
  return evalToplevel(opts);
}

export function toggleHelp() {
  $("#helppanel").toggle();
  return true;
}

// Track camera state
let isCameraOpen = false;

/**
 * Toggle video panel visibility
 * @returns {boolean} True to indicate success
 */
export function toggleVid() {
  // Open cam if needed
  if (!isCameraOpen) {
    if (openCam()) {
      isCameraOpen = true;
    } else {
      post("There was an error opening the video camera");
      return false;
    }
  }

  if (isCameraOpen) {
    $("#vidcontainer").toggle();
  }

  return true;
}

/**
 * Toggle serial visualization panel
 * @returns {boolean} True to indicate success
 */
export function toggleSerialVisInternal() {
  const $visPanel = $("#panel-vis");
  const isVisible = $visPanel.css("display") !== "none";
  $visPanel.css("display", isVisible ? "none" : "block");
  return true;
}

/**
 * Get panel visibility status
 * @param {jQuery} panel - The panel element
 * @returns {boolean} True if panel is visible
 */
export function isPanelVisible(panel) {
  return panel.is(":visible");
}

/**
 * Generate panel styles based on visibility state
 * @param {boolean} makeVisible - Whether to make the panel visible
 * @returns {Object} CSS properties to apply
 */
export function getPanelStyles(makeVisible) {
  if (!makeVisible) {
    return { "display": "none" };
  }
  
  return {
    "display": "block",
    "z-index": "200", 
    "position": "fixed",
    "height": "100%",
    "width": "100%",
    "left": "0%",
    "top": "0%",
    "opacity": "0.7",
    "pointer-events": "none"
  };
}

/**
 * Calculate canvas dimensions based on window size
 * @returns {Object} Canvas width and height
 */
export function getCanvasDimensions() {
  return {
    width: window.innerWidth,
    height: window.innerHeight
  };
}

/**
 * Generate canvas styles
 * @returns {Object} CSS properties for canvas
 */
export function getCanvasStyles() {
  return {
    "display": "block",
    "width": "100%",
    "height": "100%",
    "background-color": "transparent",
    "position": "absolute", // Ensure canvas is positioned absolutely within panel
    "top": "0",
    "left": "0"
  };
}

/**
 * Toggle serial visualization panel with improved visibility
 * @returns {boolean} True to indicate success
 */
export function toggleSerialVis() {
  dbg("Toggling serial visualization");
  const $panel = $("#panel-vis");
  const $canvas = $("#serialcanvas");
  
  const isVisible = isPanelVisible($panel);
  dbg(`Panel visibility before: ${isVisible}`);
  
  // Apply styles based on desired state
  const panelStyles = getPanelStyles(!isVisible);
  $panel.css(panelStyles);
  
  // If making visible, ensure canvas is properly sized and styled
  if (!isVisible) {
    // Apply dimensions to canvas
    const dimensions = getCanvasDimensions();
    $canvas.attr("width", dimensions.width);
    $canvas.attr("height", dimensions.height);
    
    // Apply proper styles to canvas
    const canvasStyles = getCanvasStyles();
    $canvas.css(canvasStyles);
    
    // Force canvas to be in front with high z-index
    $canvas.css("z-index", "1000");
    
    // Ensure canvas is in the DOM and visible
    if ($canvas.parent().length === 0) {
      $panel.append($canvas);
    }
    
    // Force repaint of canvas
    $canvas[0].getContext('2d').clearRect(0, 0, dimensions.width, dimensions.height);

    
    dbg("Panel and canvas should now be visible");
  }
  
  // Debug canvas state after changes
  setTimeout(() => {
    dbg(`Canvas display after: ${$canvas.css("display")}`);
    dbg(`Canvas dimensions: ${$canvas.width()}x${$canvas.height()}`);
    dbg(`Canvas is in DOM: ${$canvas.parent().length > 0}`);
  }, 10);
  
  return true;
}

/**
 * Change editor font size
 * @param {EditorView} editor - The editor instance
 * @param {number} size - New font size in pixels
 */
export function setFontSize(editor, size) {
  if (!editor) return;

  editor.dispatch({
    effects: fontSizeCompartment.reconfigure(
      EditorView.theme({
        ".cm-content, .cm-cursor, .cm-gutters, .cm-lineNumbers": {
          fontSize: `${size}px`,
          lineHeight: `${Math.ceil(size * 1.5)}px`
        },
        ".cm-gutters .cm-lineNumber": {
          display: "flex",
          alignItems: "center",
          height: "100%"
        }
      })
    ),
  });
}

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
export function areMatchingBracketChars(char1, char2) {
  const idx1 = openingBracketChars.indexOf(char1);
  if (idx1 >= 0) {
    return char2 === closingBracketChars[idx1];
  }
  const idx2 = closingBracketChars.indexOf(char1);
  if (idx2 >= 0) {
    return char2 === openingBracketChars[idx2];
  }
  return false;
}

// FIXME do something about Ctrl-Del too
export function makeDeleteWrapper(originalRun) {
  return (view) => {
    const { state } = view;
    const { from } = state.selection.main;

    const nextChar = state.doc.sliceString(from, from + 1);
    if (bracketChars.includes(nextChar)) {
      const prevChar = state.doc.sliceString(from - 1, from);
      if (areMatchingBracketChars(prevChar, nextChar)) {
        dbg("matching brackets");
        // We're in an empty pair, delete both
        // characters around the cursor
        view.dispatch({
          changes: { from: from - 1, to: from, insert: "" },
        });
        // NOTE: this is needed to avoid a blank space
        // being inserted after the deleted brackets
        deleteCharForward(view);
        return true;
      } else {
        // Next char is a closing bracket in a non-empty
        // expression, do nothing
        return true;
      }
    }
    // Next char isn't a closing bracket, delete normally
    return originalRun(view); // Run the original function
  };
}

// ModuLisp Reference panel toggle
export function toggleDocumentation() {
  toggleAuxPanel("#panel-documentation");
  return true;
}

// Show ModuLisp Reference for symbol at cursor
export function showDocumentationForSymbol(view) {
  showDocForSymbol(view);
  return true;
}
