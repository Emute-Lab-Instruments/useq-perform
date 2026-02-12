import { render } from "solid-js/web";
import { CodeSnippetsTab } from "../ui/help/CodeSnippetsTab";

type API = {
  mount: (elementId: string) => void;
};

declare global {
  interface Window {
    __snippetsPanel?: API;
  }
}

const mountSnippetsPanel = (elementId: string) => {
  const el = document.getElementById(elementId);
  if (el) {
    el.innerHTML = "";
    render(() => <CodeSnippetsTab />, el);
  }
};

window.__snippetsPanel = {
  mount: mountSnippetsPanel,
};

// Auto-mount if the legacy panel-snippets element exists
if (document.getElementById("panel-snippets")) {
  mountSnippetsPanel("panel-snippets");
}
