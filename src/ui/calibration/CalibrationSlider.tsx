// src/ui/calibration/CalibrationSlider.tsx
//
// CV calibration adjust slider (docs/specs/calibration.md §4).
//
// Range ±50 cents around target. Snap-to-zero detent at ~0.3 cents.
// Mouse drag, mouse scroll, keyboard arrows. Gamepad axis is hinted via
// the `data-gamepad-target="cal-slider"` attribute — actual gamepad
// dispatch is wired in higher layers (gii8.60 / state machine).
//
// All gestures emit *delta* events via `onAdjust`. The cumulative offset
// lives in the parent (CalibrationTakeover); this component is dumb.

import { onCleanup, onMount } from "solid-js";
import { CALIBRATION_SLIDER_RANGE_CENTS } from "../../contracts/hardware";

const SNAP_ZERO_TOLERANCE_CENTS = 0.3;

export interface CalibrationSliderProps {
  /** Cumulative offset in cents (from parent, single source of truth). */
  offsetCents: number;
  /** Emitted as a *delta* every gesture. Parent integrates. */
  onAdjust: (deltaCents: number) => void;
  /** Emitted when the slider crosses the snap-zero detent. */
  onSnapZero: () => void;
}

export function CalibrationSlider(props: CalibrationSliderProps) {
  let trackRef: HTMLDivElement | undefined;
  let rootRef: HTMLDivElement | undefined;
  let dragging = false;
  let dragLastClientX = 0;

  const range = CALIBRATION_SLIDER_RANGE_CENTS;

  const inDetent = () => Math.abs(props.offsetCents) <= SNAP_ZERO_TOLERANCE_CENTS;

  /** Emit a delta and trigger snap-zero callback if we cross the detent. */
  const emitDelta = (delta: number) => {
    if (delta === 0) return;
    const before = props.offsetCents;
    const after = before + delta;
    props.onAdjust(delta);
    // Crossed into the detent on this gesture.
    const wasOutside = Math.abs(before) > SNAP_ZERO_TOLERANCE_CENTS;
    const nowInside = Math.abs(after) <= SNAP_ZERO_TOLERANCE_CENTS;
    if (wasOutside && nowInside) props.onSnapZero();
  };

  /** Map current client X to an absolute cents value, then emit delta. */
  const dragToClientX = (clientX: number) => {
    if (!trackRef) return;
    const rect = trackRef.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width; // 0..1
    const clamped = Math.max(0, Math.min(1, ratio));
    const targetCents = (clamped - 0.5) * 2 * range;
    const delta = targetCents - props.offsetCents;
    emitDelta(delta);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!rootRef) return;
    e.preventDefault();
    rootRef.focus();
    dragging = true;
    dragLastClientX = e.clientX;
    rootRef.setPointerCapture?.(e.pointerId);
    // Click on track jumps the handle to that position (§4.2 mouse click).
    dragToClientX(e.clientX);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return;
    e.preventDefault();
    dragLastClientX = e.clientX;
    dragToClientX(e.clientX);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    rootRef?.releasePointerCapture?.(e.pointerId);
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? -1 : 1; // wheel up = increase
    const step = e.shiftKey ? 0.1 : 1;
    emitDelta(dir * step);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    let step = 0;
    switch (e.key) {
      case "ArrowLeft":
        step = e.shiftKey ? -0.1 : e.ctrlKey ? -10 : -1;
        break;
      case "ArrowRight":
        step = e.shiftKey ? 0.1 : e.ctrlKey ? 10 : 1;
        break;
      case "Home":
        // Snap-to-zero shortcut.
        emitDelta(-props.offsetCents);
        if (inDetent()) props.onSnapZero();
        e.preventDefault();
        return;
      default:
        return;
    }
    e.preventDefault();
    emitDelta(step);
  };

  onMount(() => {
    // Auto-focus the slider so arrow keys work immediately on entry (§3.4).
    rootRef?.focus();
  });

  onCleanup(() => {
    dragging = false;
  });

  // Position of handle as 0..100% along the track.
  const handlePctX = () => {
    const clamped = Math.max(-range, Math.min(range, props.offsetCents));
    return ((clamped + range) / (2 * range)) * 100;
  };

  return (
    <div
      ref={rootRef}
      class="cal-slider"
      role="slider"
      tabIndex={0}
      aria-label="Calibration offset"
      aria-valuemin={-range}
      aria-valuemax={range}
      aria-valuenow={Math.round(props.offsetCents * 10) / 10}
      aria-valuetext={`${props.offsetCents.toFixed(1)} cents`}
      data-gamepad-target="cal-slider"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
    >
      <div class="cal-slider-track" ref={trackRef}>
        <div class="cal-slider-detent" />
        <div class="cal-slider-centre-tick" />
        <div
          class={`cal-slider-handle${inDetent() ? " cal-detent" : ""}`}
          style={{ left: `${handlePctX()}%` }}
        />
      </div>
      <div class="cal-slider-range-label">±{range}¢</div>
    </div>
  );
}
