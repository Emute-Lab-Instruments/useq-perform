import { post } from './io/console.mjs';
import { activeUserSettings } from "./utils/persistentUserSettings.mjs";
import { dbg, toggleDbg } from "./utils.mjs";

export let devmode = false;

export function handleURLParameters() {
  const urlParams = new URLSearchParams(window.location.search);

  dbg("URL Parameters: ", urlParams);

  if (urlParams.has("debug") && urlParams.get("debug") === "true") {
    toggleDbg();
    dbg("Debug mode enabled");
  } 
  if (urlParams.has("devmode") && urlParams.get("devmode") === "true") {
    devmode = true;
    dbg("Dev mode enabled");
  }

  if (urlParams.has("nosave")) {
    activeUserSettings.storage.saveCodeLocally = false;
    updateUserSettings("storage", { saveCodeLocally: false });
  }

  // Load code from various sources
  if (urlParams.has("gist")) {
    // Load from GitHub Gist
    const gistid = urlParams.get("gist");
    dbg("loading gist " + gistid);
    $.ajax({
      url: "https://api.github.com/gists/" + gistid,
      type: "GET",
      data: {
        accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      error: function (xhr, ajaxOptions, thrownError) {
        const transactionSpec = {
          changes: {
            from: 0,
            to: mainEditor.state.doc.length,
            insert: "gist not found",
          },
        };
        const transaction = mainEditor.state.update(transactionSpec);
        mainEditor.dispatch(transaction);
      },
    }).then(function (data) {
      const transactionSpec = {
        changes: {
          from: 0,
          to: mainEditor.state.doc.length,
          insert: Object.entries(data.files)[0][1].content,
        },
      };
      const transaction = mainEditor.state.update(transactionSpec);
      mainEditor.dispatch(transaction);
    });
  } else if (urlParams.has("txt")) {
    // Load from text URL
    const url = urlParams.get("txt");
    dbg("loading code " + url);
    $.ajax({
      url: url,
      type: "GET",
      data: {},
      error: function (xhr, ajaxOptions, thrownError) {
        const transactionSpec = {
          changes: {
            from: 0,
            to: mainEditor.state.doc.length,
            insert: "code not found",
          },
        };
        const transaction = mainEditor.state.update(transactionSpec);
        mainEditor.dispatch(transaction);
      },
    }).then(function (data) {
      const transactionSpec = {
        changes: { from: 0, to: mainEditor.state.doc.length, insert: data },
      };
      const transaction = mainEditor.state.update(transactionSpec);
      mainEditor.dispatch(transaction);
    });
  } else {
    // Load from local storage
    if (activeUserSettings.storage.saveCodeLocally) {
      let txt = window.localStorage.getItem("codeStorageKey");
      if (txt) {
        const transactionSpec = {
          changes: { from: 0, to: mainEditor.state.doc.length, insert: txt },
        };
        const transaction = mainEditor.state.update(transactionSpec);
        mainEditor.dispatch(transaction);
      }
    }
  }
}
