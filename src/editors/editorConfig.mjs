// CODEMIRROR IMPORTS
import { EditorView, keymap, lineNumbers } from '@codemirror/view';

// NEXTJOURNAL (clojure-mode)
import { extension as eval_ext, cursor_node_string, top_level_string } from '@nextjournal/clojure-mode/extensions/eval-region';

// SERIAL COMMUNICATION
import { sendTouSEQ } from '../io/serialComms.mjs';
import { post } from '../io/console.mjs';

// UI STATE
import { interfaceStates, panelStates, togglePanelState, setPanelState } from '../ui/panelStates.mjs';
import { openCam } from '../ui/camera.mjs';
import { getUserSettings } from '../utils/persistentUserSettings.mjs';
import { fontSizeCompartment } from './state.mjs';

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
  togglePanelState('helpPanel', 'helppanel');
  return true;
}

/**
 * Toggle video panel visibility
 * @returns {boolean} True to indicate success
 */
export function toggleVid() {
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
export function toggleSerialVis() {
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

/**
 * Change editor font size
 * @param {EditorView} editor - The editor instance
 * @param {number} size - New font size in pixels
 */
export function changeFontSize(editor, size) {
  if (!editor) return;
  
  editor.dispatch({
    effects: fontSizeCompartment.reconfigure(
      EditorView.theme({
        ".cm-content": { fontSize: `${size}px` }
      })
    )
  });
}
