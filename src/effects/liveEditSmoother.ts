/**
 * One-pole lowpass filter for live-edit value streams.
 *
 * Smooths per-slot numeric values before they are sent to the WASM and hardware
 * runtimes, removing jitter from fast mouse/MIDI input without introducing
 * perceptible lag. The filter uses a time-based alpha coefficient so smoothing
 * is independent of event rate.
 *
 * The store always receives the raw value (immediate visual feedback); only the
 * runtime path is filtered.
 */

/** Smoothing time constant in milliseconds. Higher = more smoothing, more lag. */
const DEFAULT_TAU_MS = 200;

interface SlotState {
  smoothed: number;
  lastTime: number;
}

export function createLiveEditSmoother(tauMs = DEFAULT_TAU_MS) {
  const slots = new Map<string, SlotState>();

  function smooth(slotId: string, raw: number, nowMs: number): number {
    const prev = slots.get(slotId);
    if (!prev) {
      slots.set(slotId, { smoothed: raw, lastTime: nowMs });
      return raw;
    }
    const dt = nowMs - prev.lastTime;
    const alpha = dt <= 0 ? 1 : 1 - Math.exp(-dt / tauMs);
    const smoothed = alpha * raw + (1 - alpha) * prev.smoothed;
    prev.smoothed = smoothed;
    prev.lastTime = nowMs;
    return smoothed;
  }

  function reset(slotId: string): void {
    slots.delete(slotId);
  }

  function remove(slotId: string): void {
    slots.delete(slotId);
  }

  return { smooth, reset, remove };
}
