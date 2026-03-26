/**
 * Screen Reader Announcer — accessibility feature.
 *
 * Provides an `aria-live` region for announcing action executions and keybinding
 * events to screen readers. Uses the standard "polite" live region pattern: a
 * visually hidden element whose `textContent` changes trigger screen reader
 * announcements without interrupting the current reading flow.
 *
 * Usage:
 *   announce("Evaluate expression")
 *   announce("Probe toggled on")
 *   announceAction("eval.now")  // looks up description from action registry
 */

import { actions, type ActionId } from "./actions.ts";

// ---------------------------------------------------------------------------
// Live region management
// ---------------------------------------------------------------------------

let liveRegion: HTMLElement | null = null;

/**
 * Initialise the aria-live announcement region. Safe to call multiple times —
 * subsequent calls are no-ops.
 */
export function initAnnouncer(): void {
  if (liveRegion) return;

  liveRegion = document.createElement("div");
  liveRegion.setAttribute("role", "status");
  liveRegion.setAttribute("aria-live", "polite");
  liveRegion.setAttribute("aria-atomic", "true");

  // Visually hidden but still accessible to screen readers.
  // Using clip-rect rather than display:none or visibility:hidden, which
  // would prevent screen readers from reading the content.
  liveRegion.style.cssText = [
    "position:absolute",
    "width:1px",
    "height:1px",
    "overflow:hidden",
    "clip:rect(0,0,0,0)",
    "white-space:nowrap",
    "border:0",
    "padding:0",
    "margin:-1px",
  ].join(";");

  document.body.appendChild(liveRegion);
}

// ---------------------------------------------------------------------------
// Announcement API
// ---------------------------------------------------------------------------

/**
 * Announce an arbitrary message to screen readers via the live region.
 *
 * The two-frame technique (clear then set) forces screen readers to re-announce
 * even if the same message is repeated.
 */
export function announce(message: string): void {
  if (!liveRegion) initAnnouncer();
  if (!liveRegion) return;

  // Clear first to force re-announcement of identical messages
  liveRegion.textContent = "";

  requestAnimationFrame(() => {
    liveRegion!.textContent = message;
  });
}

/**
 * Announce the description of a registered action by its ID.
 * Returns the description string, or undefined if the action is not found.
 */
export function announceAction(id: ActionId): string | undefined {
  const action = actions[id];
  if (!action) return undefined;

  announce(action.description);
  return action.description;
}

// ---------------------------------------------------------------------------
// Cleanup (for testing or teardown)
// ---------------------------------------------------------------------------

/**
 * Remove the live region from the DOM. Primarily useful for testing.
 */
export function destroyAnnouncer(): void {
  if (liveRegion) {
    liveRegion.remove();
    liveRegion = null;
  }
}
