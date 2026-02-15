/**
 * Toolbar adapters - mount functions for toolbars without island dependency.
 *
 * This module provides the same API as the islands toolbar islands but
 * can be imported directly without requiring a separate script tag.
 */
import { render } from "solid-js/web";
import { TransportToolbar } from "../TransportToolbar";
import { MainToolbar } from "../MainToolbar";

const TRANSPORT_ROOT_ID = "panel-top-toolbar-root";
const MAIN_ROOT_ID = "panel-toolbar-root";

/**
 * Check if we're in a browser environment.
 */
function isBrowser(): boolean {
  return typeof document !== "undefined" && typeof window !== "undefined";
}

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

/**
 * Mount the transport toolbar.
 * Replaces the existing #panel-top-toolbar element if present.
 * In non-browser environments, this is a no-op.
 */
export function mountTransportToolbar(root?: HTMLElement): void {
  if (!isBrowser()) return;
  const el = root || ensureTransportRoot();
  render(() => <TransportToolbar />, el);
}

/**
 * Mount the main toolbar.
 * Replaces the existing #panel-toolbar element if present.
 * In non-browser environments, this is a no-op.
 */
export function mountMainToolbar(root?: HTMLElement): void {
  if (!isBrowser()) return;
  const el = root || ensureMainRoot();
  render(() => <MainToolbar />, el);
}
