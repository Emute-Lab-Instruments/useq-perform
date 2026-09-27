// src/ui/toolbar/BpmControl.tsx
//
// Pure view: the transport toolbar's tempo chip (transport.md §1.7.3).
// Shows the runtime BPM and lets the user change it by
//   - click → inline text edit (Enter commits, Escape/blur cancels),
//   - vertical pointer drag (commit on release),
//   - mouse wheel / ArrowUp / ArrowDown (commit after a short settle).
// Values are clamped to [min, max] and rounded to 0.1 BPM. The component
// never takes focus without a user gesture: drag and wheel scrubs leave focus
// where it was (normally the editor), and ending a text edit returns focus to
// the element that owned it before the edit started.

import { Show, createSignal, onCleanup, onMount } from "solid-js";

export const BPM_MIN = 20;
export const BPM_MAX = 300;

/** Pixels of vertical drag per 1 BPM step. */
const DRAG_PX_PER_STEP = 4;
/** Pointer travel (px) before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD_PX = 3;
/** Quiet period after the last wheel/arrow step before committing. */
const SETTLE_MS = 350;

export interface BpmControlProps {
  /** Current BPM reported by the runtime. */
  bpm: number;
  /** Commit a new tempo to the active runtime(s). */
  onCommit: (bpm: number) => void;
  min?: number;
  max?: number;
}

/** Whole numbers render bare; fractional bpm gets one decimal. */
export function formatBpm(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function clampBpm(value: number, min = BPM_MIN, max = BPM_MAX): number {
  const rounded = Math.round(value * 10) / 10;
  return Math.min(max, Math.max(min, rounded));
}

/** Parse user text; returns null for anything that is not a finite number. */
export function parseBpm(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function BpmControl(props: BpmControlProps) {
  const min = () => props.min ?? BPM_MIN;
  const max = () => props.max ?? BPM_MAX;

  // Local preview while scrubbing; null means "show the runtime value".
  const [preview, setPreview] = createSignal<number | null>(null);
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal("");

  let chipRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;
  let restoreFocusTo: Element | null = null;
  let settleTimer: number | undefined;

  const shown = () => preview() ?? props.bpm;

  const commit = (value: number) => {
    const next = clampBpm(value, min(), max());
    setPreview(null);
    if (next !== props.bpm) props.onCommit(next);
  };

  const scheduleCommit = (value: number) => {
    setPreview(clampBpm(value, min(), max()));
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      settleTimer = undefined;
      const pending = preview();
      if (pending !== null) commit(pending);
    }, SETTLE_MS);
  };

  const step = (delta: number) => scheduleCommit(shown() + delta);

  // ── Text editing ──────────────────────────────────────────────
  const startEditing = () => {
    setDraft(formatBpm(shown()));
    setEditing(true);
    queueMicrotask(() => {
      inputRef?.focus();
      inputRef?.select();
    });
  };

  /**
   * End the text edit. Keyboard endings (Enter/Escape) hand focus back to
   * whatever owned it before; a blur ending leaves focus where the user put it.
   */
  const finishEditing = (apply: boolean, restoreFocus: boolean) => {
    if (!editing()) return;
    const parsed = apply ? parseBpm(draft()) : null;
    setEditing(false);
    if (parsed !== null) commit(parsed);
    const target = restoreFocusTo;
    restoreFocusTo = null;
    if (restoreFocus && target instanceof HTMLElement && target.isConnected) {
      target.focus();
    }
  };

  const onInputKeyDown = (e: KeyboardEvent) => {
    // Keep keys typed into the field away from the chip and global handlers.
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      finishEditing(true, true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finishEditing(false, true);
    }
  };

  // ── Pointer drag / click ──────────────────────────────────────
  let pointerStartY = 0;
  let pointerStartValue = 0;
  let dragging = false;
  let activePointer: number | null = null;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    // Keep focus where it is (normally the editor) during a scrub.
    e.preventDefault();
    restoreFocusTo = document.activeElement;
    activePointer = e.pointerId;
    pointerStartY = e.clientY;
    pointerStartValue = shown();
    dragging = false;
    chipRef?.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (activePointer !== e.pointerId) return;
    const dy = pointerStartY - e.clientY;
    if (!dragging && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    dragging = true;
    const perStep = e.shiftKey ? 0.1 : 1;
    const steps = Math.trunc(dy / DRAG_PX_PER_STEP);
    setPreview(clampBpm(pointerStartValue + steps * perStep, min(), max()));
  };

  const onPointerUp = (e: PointerEvent) => {
    if (activePointer !== e.pointerId) return;
    activePointer = null;
    chipRef?.releasePointerCapture?.(e.pointerId);
    if (dragging) {
      dragging = false;
      const pending = preview();
      if (pending !== null) commit(pending);
      return;
    }
    startEditing();
  };

  const onPointerCancel = (e: PointerEvent) => {
    if (activePointer !== e.pointerId) return;
    activePointer = null;
    dragging = false;
    setPreview(null);
  };

  // ── Keyboard on the chip (spinbutton semantics) ───────────────
  const onChipKeyDown = (e: KeyboardEvent) => {
    const big = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      step(big);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      step(-big);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      restoreFocusTo = document.activeElement;
      startEditing();
    }
  };

  // Wheel needs a non-passive listener so the page does not scroll.
  const onWheel = (e: WheelEvent) => {
    if (editing() || e.deltaY === 0) return;
    e.preventDefault();
    const perStep = e.shiftKey ? 0.1 : 1;
    step(e.deltaY < 0 ? perStep : -perStep);
  };

  onMount(() => {
    chipRef?.addEventListener("wheel", onWheel, { passive: false });
  });

  onCleanup(() => {
    chipRef?.removeEventListener("wheel", onWheel);
    window.clearTimeout(settleTimer);
  });

  return (
    <div
      ref={chipRef}
      class="bpm-display"
      classList={{ "bpm-editing": editing(), "bpm-scrubbing": preview() !== null }}
      role="spinbutton"
      tabIndex={editing() ? -1 : 0}
      aria-label="Tempo (BPM)"
      aria-valuenow={shown()}
      aria-valuemin={min()}
      aria-valuemax={max()}
      aria-valuetext={`${formatBpm(shown())} BPM`}
      title={`Tempo: ${formatBpm(shown())} BPM. Click to type a value, drag up/down or scroll to adjust (Shift for fine steps).`}
      onPointerDown={(e) => { if (!editing()) onPointerDown(e); }}
      onMouseDown={(e) => { if (!editing()) e.preventDefault(); }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={(e) => { if (!editing()) onChipKeyDown(e); }}
    >
      <Show
        when={editing()}
        fallback={<span class="bpm-value">{formatBpm(shown())}</span>}
      >
        <input
          ref={inputRef}
          class="bpm-input"
          type="text"
          inputMode="decimal"
          aria-label="New tempo in BPM"
          value={draft()}
          size={5}
          onInput={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={onInputKeyDown}
          onBlur={() => finishEditing(false, false)}
          onPointerDown={(e) => e.stopPropagation()}
        />
      </Show>
      <span class="bpm-unit">BPM</span>
    </div>
  );
}
