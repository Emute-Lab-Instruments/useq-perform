// NEXTJOURNAL (clojure-mode)
import { compileString } from 'squint-cljs';
import { WebMidi } from "webmidi";
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { setupMIDI, defSerialMap, midictrl } from './midi.mjs';

import { 
  createEditorExtensions, 
  changeFontSize, 
  changeTheme,
  themes,
  createUpdateListener
} from './editorConfig.mjs';

import { 
  loadUserSettings, 
  saveConfig, 
  updateUserSettings,
  getUserSettings
} from './configManager.mjs';

import { sendTouSEQ, setSerialPort, getSerialPort, serialReader, serialMapFunctions, connectToSerialPort } from './serialComms.mjs';
import { post } from './console.mjs';
import { drawSerialVis } from './serialVis.mjs';
import { interfaceStates, panelStates } from './panelStates.mjs';

// Global variables
let editor = null;
let config = { saveCodeLocally: true };



// Function to evaluate code passed from Clojure/Squint
const scopedEval = (scope, script) => Function(`"use strict"; ${script}`).bind(scope)();

/**
 * Creates and configures the editor instance
 */
export function createEditor() {
// ...existing code...
}

export { setupMIDI, defSerialMap, midictrl, connectToSerialPort };

// Document ready function - Main entry point
$(function () {
  // Initialize UI


  
  
  
  

  
  
});