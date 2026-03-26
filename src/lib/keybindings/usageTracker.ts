// src/lib/keybindings/usageTracker.ts
//
// Session-scoped usage heatmap tracker. Records action invocations in memory
// and provides a per-key count map for the keyboard visualiser overlay.
// Not persisted — resets on page reload.

import type { ActionId } from "./actions.ts";
import { defaultKeyBindings } from "./defaults.ts";

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const counts = new Map<ActionId, number>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Record a single invocation of an action. */
export function recordAction(action: ActionId): void {
  counts.set(action, (counts.get(action) ?? 0) + 1);
}

/** Snapshot of per-action invocation counts. */
export function getActionCounts(): Map<ActionId, number> {
  return new Map(counts);
}

/**
 * Derive a per-key count map from the per-action counts by mapping through
 * the default bindings. When multiple actions share a key (e.g. chord leader),
 * counts are summed. Returns only keys with count > 0.
 */
export function heatmapByKey(): Map<string, number> {
  const result = new Map<string, number>();
  for (const binding of defaultKeyBindings) {
    const count = counts.get(binding.action) ?? 0;
    if (count > 0) {
      result.set(binding.key, (result.get(binding.key) ?? 0) + count);
    }
  }
  return result;
}

/** Reset all usage counts (e.g. for testing or manual reset). */
export function resetUsage(): void {
  counts.clear();
}
