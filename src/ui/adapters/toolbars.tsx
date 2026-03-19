/**
 * Toolbar adapters - mount functions for toolbars.
 *
 * Uses createSolidAdapter for mount lifecycle.
 */
import { TransportToolbar } from "../TransportToolbar";
import { MainToolbar } from "../MainToolbar";
import { createSolidAdapter } from "./createSolidAdapter";

const TRANSPORT_ROOT_ID = "panel-top-toolbar-root";
const MAIN_ROOT_ID = "panel-toolbar-root";

function ensureTransportRoot(): HTMLElement {
  const existing = document.getElementById(TRANSPORT_ROOT_ID);
  if (existing) return existing;

  const oldToolbar = document.getElementById("panel-top-toolbar");
  const el = document.createElement("div");
  el.id = TRANSPORT_ROOT_ID;

  if (oldToolbar) {
    oldToolbar.replaceWith(el);
  } else {
    document.body.prepend(el);
  }

  return el;
}

function ensureMainRoot(): HTMLElement {
  const existing = document.getElementById(MAIN_ROOT_ID);
  if (existing) return existing;

  const oldToolbar = document.getElementById("panel-toolbar");
  const el = document.createElement("div");
  el.id = MAIN_ROOT_ID;

  if (oldToolbar) {
    oldToolbar.replaceWith(el);
  } else {
    document.body.appendChild(el);
  }

  return el;
}

const transportAdapter = createSolidAdapter({
  containerId: TRANSPORT_ROOT_ID,
  ensureRoot: ensureTransportRoot,
  Component: () => <TransportToolbar />,
});

const mainAdapter = createSolidAdapter({
  containerId: MAIN_ROOT_ID,
  ensureRoot: ensureMainRoot,
  Component: () => <MainToolbar />,
});

/**
 * Mount the transport toolbar.
 * Replaces the existing #panel-top-toolbar element if present.
 * In non-browser environments, this is a no-op.
 */
export function mountTransportToolbar(root?: HTMLElement): void {
  transportAdapter.mount(root);
}

/**
 * Mount the main toolbar.
 * Replaces the existing #panel-toolbar element if present.
 * In non-browser environments, this is a no-op.
 */
export function mountMainToolbar(root?: HTMLElement): void {
  mainAdapter.mount(root);
}
