import { onCleanup } from "solid-js";

export interface PointerDragCallbacks {
  /** Called on pointerdown before tracking starts. Return false to cancel. */
  onStart?: (e: PointerEvent) => boolean | void;
  /** Called on every pointermove while dragging. dx/dy are deltas from start. */
  onMove: (e: PointerEvent, dx: number, dy: number) => void;
  /** Called on pointerup / pointercancel. */
  onEnd?: (e: PointerEvent) => void;
}

/**
 * Returns a pointerdown handler that tracks pointer drag via document-level
 * pointermove/pointerup with pointer capture.
 *
 * Designed for use in Solid JSX: `<div onPointerDown={drag} />`.
 */
export function usePointerDrag(callbacks: PointerDragCallbacks): (e: PointerEvent) => void {
  let startX = 0;
  let startY = 0;

  function onMove(e: PointerEvent) {
    callbacks.onMove(e, e.clientX - startX, e.clientY - startY);
  }

  function onUp(e: PointerEvent) {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onUp);
    callbacks.onEnd?.(e);
  }

  // Clean up listeners if the component unmounts mid-drag.
  onCleanup(() => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onUp);
  });

  return (e: PointerEvent) => {
    if (callbacks.onStart?.(e) === false) return;
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  };
}
