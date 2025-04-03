import { initUI } from './ui/ui.mjs';
import { checkForWebserialSupport } from './io/serialComms.mjs';
import { activeUserSettings } from './utils/persistentUserSettings.mjs';
import { post } from './io/console.mjs';
import { handleURLParameters } from './urlParams.mjs';
//       data: {

// Main entry point
$(document).ready(() => {
  // Handle URL parameters
  handleURLParameters();

  if (!checkForWebserialSupport()) {
    return;
  }
  
  initUI();

  // Display welcome messages
  post(`Hello, ${activeUserSettings.name}!`);
  post('Click the <span style="color: var(--accent-color); font-weight: bold; display: inline;">[connect]</span> button to link to uSEQ');
});