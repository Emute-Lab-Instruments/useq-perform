import { post } from '../utils/consoleStore.ts';
import { activeUserSettings } from "./utils/persistentUserSettings.ts";
import { dbg, toggleDbg } from "./utils.ts";

export let devmode = false;
export let disableWebSerial = false;
export let noModuleMode = false;

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

  if (urlParams.has("disableWebSerial") && urlParams.get("disableWebSerial") === "true") {
    disableWebSerial = true;
    dbg("WebSerial disabled via URL parameter");
  }

  if (urlParams.has("noModuleMode") && urlParams.get("noModuleMode") === "true") {
    noModuleMode = true;
    dbg("No-module mode enabled");
    post("**Info**: Running in no-module mode. Expressions evaluate via the in-browser uSEQ interpreter.");
  }

  if (urlParams.has("nosave")) {
    activeUserSettings.storage.saveCodeLocally = false;
  }
}
