import { createMainEditor } from './editors/main.mjs';
import { initUI } from './ui/ui.mjs';
import { checkForWebserialSupport } from './io/serialComms.mjs';
import { deleteLocalStorage } from './utils/persistentUserSettings.mjs';
import { post } from './io/console.mjs';

// Store editor instance globally 
let editor = null;

// Main entry point
$(document).ready(() => {

  // Initialize UI and get editor instance
  editor = initUI();

  if (!checkForWebserialSupport()) {
    return;
  }

   // Handle URL parameters
   const urlParams = new URLSearchParams(window.location.search);
  
   if (urlParams.has('nosave')) {
     config.saveCodeLocally = false;
     updateUserSettings('storage', { saveCodeLocally: false });
   }


   // Load code from various sources
  if (urlParams.has("gist")) {
    // Load from GitHub Gist
    const gistid = urlParams.get("gist");
    console.log("loading gist " + gistid);
    $.ajax({
      url: "https://api.github.com/gists/" + gistid,
      type: "GET",
      data: { "accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      error: function (xhr, ajaxOptions, thrownError) {
        const transactionSpec = { changes: { from: 0, to: editor.state.doc.length, insert: "gist not found" } };
        const transaction = editor.state.update(transactionSpec);
        editor.dispatch(transaction);
      }
    }).then(function (data) {
      const transactionSpec = { changes: { from: 0, to: editor.state.doc.length, insert: Object.entries(data.files)[0][1].content } };
      const transaction = editor.state.update(transactionSpec);
      editor.dispatch(transaction);
    });
  } else if (urlParams.has("txt")) {
    // Load from text URL
    const url = urlParams.get("txt");
    console.log("loading code " + url);
    $.ajax({
      url: url,
      type: "GET",
      data: {},
      error: function (xhr, ajaxOptions, thrownError) {
        const transactionSpec = { changes: { from: 0, to: editor.state.doc.length, insert: "code not found" } };
        const transaction = editor.state.update(transactionSpec);
        editor.dispatch(transaction);
      }
    }).then(function (data) {
      const transactionSpec = { changes: { from: 0, to: editor.state.doc.length, insert: data } };
      const transaction = editor.state.update(transactionSpec);
      editor.dispatch(transaction);
    });
  } else {
    // Load from local storage
    if (config.saveCodeLocally) {
      let txt = window.localStorage.getItem("codeStorageKey");
      if (txt) {
        const transactionSpec = { changes: { from: 0, to: editor.state.doc.length, insert: txt } };
        const transaction = editor.state.update(transactionSpec);
        editor.dispatch(transaction);
      }
    }
  }

  // Display welcome messages
  post("Hello!");
  post("Use the [connect] button to link to uSEQ");
});