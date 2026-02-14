import { render } from "solid-js/web";
import { HelpPanel } from "../ui/help/HelpPanel";

export const mountHelpPanel = (elementId: string) => {
  const el = document.getElementById(elementId);
  if (el) {
    // Clear existing content if any
    el.innerHTML = "";
    render(() => <HelpPanel />, el);
  }
};

// Auto-mount if the element exists and is empty or doesn't have our root
if (document.getElementById("panel-help")) {
  mountHelpPanel("panel-help");
}
