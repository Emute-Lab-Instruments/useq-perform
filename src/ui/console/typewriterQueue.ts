/**
 * Pure decision logic for the console typewriter animation queue.
 *
 * The console serializes typewriter-mode entries so only one types at a time
 * (console.md §1.5). A **burst pressure valve** prevents the queue from backing
 * up: when more than `BURST_THRESHOLD` entries are pending behind the active
 * one, they are all flushed (shown instantly) and animation resumes for later
 * arrivals.
 *
 * This module is intentionally state-free and DOM-free so it can be unit
 * tested in isolation from the SolidJS component that drives it.
 */

/** Max pending typewriter entries before the queue is flushed instantly. */
export const BURST_THRESHOLD = 3;

/** Minimal shape the queue logic needs from a console message. */
export interface QueueEntry {
  id: number;
}

export interface QueueState {
  /** Id of the entry currently typewriting, or null when idle. */
  activeId: number | null;
  /** Highest id flushed by the burst valve; entries `<= flushedUpToId` render instantly. */
  flushedUpToId: number;
}

/**
 * Compute the next queue state after the set of messages changes.
 *
 * - When idle, arms the first not-yet-flushed entry.
 * - When busy, flushes the backlog if it exceeds the threshold.
 * - Otherwise leaves the state unchanged.
 */
export function advanceQueue(
  messages: readonly QueueEntry[],
  state: QueueState,
  threshold = BURST_THRESHOLD,
): QueueState {
  if (state.activeId === null) {
    const firstNew = messages.find((m) => m.id > state.flushedUpToId);
    return firstNew ? { ...state, activeId: firstNew.id } : state;
  }

  const active = state.activeId;
  const pending = messages.filter((m) => m.id > active);
  if (pending.length > threshold) {
    return {
      activeId: null,
      flushedUpToId: pending[pending.length - 1].id,
    };
  }
  return state;
}

/**
 * Compute the next state when the active entry finishes typewriting:
 * advance to the next not-yet-flushed entry, or go idle.
 */
export function completeActive(
  messages: readonly QueueEntry[],
  finishedId: number,
  state: QueueState,
): QueueState {
  const next = messages.find(
    (m) => m.id > finishedId && m.id > state.flushedUpToId,
  );
  return { ...state, activeId: next ? next.id : null };
}
