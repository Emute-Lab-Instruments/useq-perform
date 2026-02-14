import { render } from "solid-js/web";
import { CodeSnippetsTab } from "../ui/help/CodeSnippetsTab";

export const mountSnippetsPanel = (elementId: string) => {
  const el = document.getElementById(elementId);
  if (el) {
    el.innerHTML = "";
    render(() => <CodeSnippetsTab />, el);
  }
};

// Auto-mount if the legacy panel-snippets element exists
if (document.getElementById("panel-snippets")) {
  mountSnippetsPanel("panel-snippets");
}
