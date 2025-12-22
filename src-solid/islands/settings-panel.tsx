import { render } from "solid-js/web";
import { SettingsPanel } from "../ui/settings/SettingsPanel";

const mountSettingsPanel = (elementId: string) => {
  const el = document.getElementById(elementId);
  if (el) {
    render(() => <SettingsPanel />, el);
  }
};

// Expose to window for legacy integration
(window as any).mountSettingsPanel = mountSettingsPanel;

// Auto-mount if the element exists
if (document.getElementById("panel-settings")) {
  mountSettingsPanel("panel-settings");
}
