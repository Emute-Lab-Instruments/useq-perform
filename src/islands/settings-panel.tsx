import { render } from "solid-js/web";
import { SettingsPanel } from "../ui/settings/SettingsPanel";

export const mountSettingsPanel = (elementId: string) => {
  const el = document.getElementById(elementId);
  if (el) {
    // Clear any existing mount to avoid duplicate trees on repeated bootstrap.
    el.innerHTML = "";
    render(() => <SettingsPanel />, el);
  }
};

// Auto-mount if the element exists
if (document.getElementById("panel-settings")) {
  mountSettingsPanel("panel-settings");
}
