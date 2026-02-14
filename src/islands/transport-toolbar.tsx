// src/islands/transport-toolbar.tsx
import { render } from "solid-js/web";
import { TransportToolbar } from "../ui/TransportToolbar";

const rootId = "panel-top-toolbar-root";

function ensureRootElement() {
  const existing = document.getElementById(rootId);
  if (existing) return existing;

  // We want to replace the existing #panel-top-toolbar if it exists
  const oldToolbar = document.getElementById("panel-top-toolbar");
  const el = document.createElement("div");
  el.id = rootId;

  if (oldToolbar) {
    oldToolbar.replaceWith(el);
  } else {
    document.body.prepend(el);
  }

  return el;
}

export function mountTransportToolbar(root?: HTMLElement) {
  const el = root || ensureRootElement();
  render(() => <TransportToolbar />, el);
}

// Auto-mount for backward compatibility (islands are still loaded as separate scripts)
mountTransportToolbar();
