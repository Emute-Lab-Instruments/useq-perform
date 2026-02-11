import { render } from "solid-js/web";
import { ConsolePanel } from "../ui/console/ConsolePanel";
import { addConsoleMessage, ConsoleMessageType } from "../utils/consoleStore";

const mountConsolePanel = (elementId: string) => {
  const el = document.getElementById(elementId);
  if (el) {
    render(() => <ConsolePanel maxHeight="100%" />, el);
  }
};

// Bridge for legacy code to post to Solid console
const postToSolidConsole = (content: string, type: ConsoleMessageType = "log") => {
  addConsoleMessage(content, type);
};

// Expose to window for legacy integration
(window as any).mountConsolePanel = mountConsolePanel;
(window as any).__solidConsolePost = postToSolidConsole;

// Auto-mount if the element exists
if (document.getElementById("panel-console")) {
  mountConsolePanel("panel-console");
}
