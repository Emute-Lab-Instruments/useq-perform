import { render } from "solid-js/web";
import { ConsolePanel } from "../ui/console/ConsolePanel";

export const mountConsolePanel = (elementId: string) => {
  const el = document.getElementById(elementId);
  if (el) {
    render(() => <ConsolePanel maxHeight="100%" />, el);
  }
};

// Auto-mount if the element exists
if (document.getElementById("panel-console")) {
  mountConsolePanel("panel-console");
}
