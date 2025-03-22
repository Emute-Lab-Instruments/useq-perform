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
import { toggleAuxPanel } from "../ui/ui.mjs";
import { showDocumentationForSymbol as showDocForSymbol } from "../ui/documentation.mjs";

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

export function toggleSerialVis() {
  console.log("Toggling serial visualization");
  $("#panel-vis").toggle();
  $("#serialcanvas").toggle();
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
        console.log("matching brackets");
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

// Documentation panel toggle
export function toggleDocumentation() {
  toggleAuxPanel("#panel-documentation");
  return true;
}

// Show documentation for symbol at cursor
export function showDocumentationForSymbol(view) {
  showDocForSymbol(view);
  return true;
}
