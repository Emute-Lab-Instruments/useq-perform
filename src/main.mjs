import { initUI } from './ui/ui.mjs';
import { checkForWebserialSupport } from './io/serialComms.mjs';
import { activeUserSettings } from './utils/persistentUserSettings.mjs';
import { post } from './io/console.mjs';
import { handleURLParameters } from './urlParams.mjs';
//       data: {

// Store editor instance globally 
let mainEditor = null;

// Main entry point
$(document).ready(() => {

  console.log("Hi");

  // Handle URL parameters
  handleURLParameters();

  // Initialize UI and get editor instance
  mainEditor = initUI();

  if (!checkForWebserialSupport()) {
    return;
  }

  
  // Display welcome messages
  post(`Hello, ${activeUserSettings.name}!`);
  post("Use the [connect] button to link to uSEQ");
});