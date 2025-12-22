// src-solid/islands/main-toolbar.tsx
import { render } from "solid-js/web";
import { MainToolbar } from "../ui/MainToolbar";

const rootId = "panel-toolbar-root";

function ensureRootElement() {
  const existing = document.getElementById(rootId);
  if (existing) return existing;

  // We want to replace the existing #panel-toolbar if it exists
  const oldToolbar = document.getElementById("panel-toolbar");
  const el = document.createElement("div");
  el.id = rootId;
  
  if (oldToolbar) {
    oldToolbar.replaceWith(el);
  } else {
    // If not found, we might want to append it where it would normally be
    // but for now let's just prepend to body or similar
    document.body.appendChild(el);
  }
  
  return el;
}

const root = ensureRootElement();

render(() => <MainToolbar />, root);
