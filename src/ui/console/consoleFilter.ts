/**
 * View-only filtering for the console panel (console.md §1.8).
 *
 * Pure decision logic: filtering never drops messages from the store, it only
 * computes the visible slice. `stripHtml` lives here too so the filter match,
 * the copy affordance, and the component share one plain-text definition.
 */

import type { ConsoleMessage, ConsoleMessageType } from "../../utils/consoleStore.ts";

/** Per-type visibility toggles for the console filter row. */
export type ConsoleFilters = Record<ConsoleMessageType, boolean>;

export const CONSOLE_TYPES: ConsoleMessageType[] = ["log", "warn", "error", "wasm"];

export function allFiltersOn(): ConsoleFilters {
  return { log: true, warn: true, error: true, wasm: true };
}

/** True when any toggle is off or the query is non-empty. */
export function isFilterActive(filters: ConsoleFilters, query: string): boolean {
  return CONSOLE_TYPES.some((t) => !filters[t]) || query.trim().length > 0;
}

/** Strip entry HTML (inline markdown output) down to plain text. */
export function stripHtml(html: string): string {
  const tmp = document.createElement("span");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
}

/**
 * Compute the visible messages for the current filter state: per-type toggles
 * plus a case-insensitive substring match against each entry's stripped text.
 * Returns a new array; the caller's array and the message store are untouched.
 */
export function filterMessages(
  messages: readonly ConsoleMessage[],
  filters: ConsoleFilters,
  query: string,
): ConsoleMessage[] {
  const q = query.trim().toLowerCase();
  return messages.filter((m) => {
    if (!filters[m.type]) return false;
    if (!q) return true;
    return stripHtml(m.content).toLowerCase().includes(q);
  });
}
