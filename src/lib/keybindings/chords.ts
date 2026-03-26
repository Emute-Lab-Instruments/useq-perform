/**
 * Chord State — reactive signal for tracking pending chord leader keys.
 *
 * CodeMirror handles multi-stroke (chord) bindings internally via its
 * keymap system. This module provides a reactive signal that the future
 * keyboard visualiser (Phase 4) will consume to show chord mode state.
 *
 * For now this is a placeholder — the signal is exported but not yet
 * wired into CodeMirror's internal prefix-matching state (which is
 * private API). Phase 4 will add the integration.
 */

import { createSignal } from "solid-js";

// ---------------------------------------------------------------------------
// Pending chord signal
// ---------------------------------------------------------------------------

/**
 * Reactive signal: which leader key is currently pending, or null if no
 * chord sequence is active.
 *
 * Example values:
 *   null      — no chord active (normal mode)
 *   "Alt-e"   — structural editing chord leader pressed, awaiting second stroke
 *   "Alt-o"   — observe/probe chord leader pressed, awaiting second stroke
 */
const [pendingChord, setPendingChord] = createSignal<string | null>(null);

export { pendingChord, setPendingChord };
