import type { EditorView } from "@codemirror/view";

import {
  clamp,
  DEFAULT_FINE_DRAG_RATIO,
  LiveEditBaseWidget,
  liveEditWidgetConfigFacet,
  slotStep,
  snapToStep,
  valueToKnobAngle,
} from "./widgetBase.ts";

// ── Knob (numeric scalar / vector-element) ──────────────────────────────────

export class KnobWidget extends LiveEditBaseWidget {
  protected override renderControl(wrapper: HTMLElement, view: EditorView): void {
    const min = typeof this.slot.min === "number" ? this.slot.min : 0;
    const max = typeof this.slot.max === "number" ? this.slot.max : 1;
    const step = slotStep(this.slot);
    const fineDragRatio = DEFAULT_FINE_DRAG_RATIO;

    const knob = document.createElement("span");
    knob.className = "cm-live-edit-knob";
    knob.setAttribute("role", "slider");
    knob.setAttribute("tabindex", "0");
    knob.setAttribute("aria-valuemin", String(min));
    knob.setAttribute("aria-valuemax", String(max));
    knob.setAttribute("aria-valuenow", String(this.localValue));

    // Modified-from-seed tick (§4.4).
    if (this.slot.modified && typeof this.slot.seed === "number") {
      const tick = document.createElement("span");
      tick.className = "cm-live-edit-knob-seed-tick";
      const seedAngle = valueToKnobAngle(this.slot.seed, min, max);
      tick.style.transform = `rotate(${seedAngle}deg)`;
      knob.appendChild(tick);
    }

    // Indicator line (center-to-edge).
    const indicator = document.createElement("span");
    indicator.className = "cm-live-edit-knob-indicator";
    const v =
      typeof this.localValue === "number"
        ? this.localValue
        : Number(this.localValue) || 0;
    const angle = valueToKnobAngle(v, min, max);
    indicator.style.transform = `rotate(${angle}deg)`;
    knob.appendChild(indicator);

    /** Helper to update the knob visual + value and emit the change. */
    const updateValue = (next: number): void => {
      this.localValue = next;
      const a = valueToKnobAngle(next, min, max);
      indicator.style.transform = `rotate(${a}deg)`;
      knob.setAttribute("aria-valuenow", String(next));
      this.refreshReadout(wrapper);
      view.state.facet(liveEditWidgetConfigFacet).onValueChange?.(this.slot.id, next);
    };

    // §4.6.1: Cmd/Ctrl + click — reset to seed.
    knob.addEventListener("mousedown", (ev) => {
      if (ev.metaKey || ev.ctrlKey) {
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof this.slot.seed === "number") {
          updateValue(this.slot.seed);
        }
        return;
      }

      // §4.6.1: Mouse drag with step snapping (§4.5) and Shift fine control.
      ev.preventDefault();
      ev.stopPropagation();
      const startY = ev.clientY;
      const startVal = typeof this.localValue === "number"
        ? this.localValue
        : Number(this.localValue) || 0;
      const range = max - min;
      // Suppress the indicator's CSS transition during drag so the knob tracks
      // the cursor without playing catch-up.
      knob.classList.add("is-dragging");
      const onMove = (mv: MouseEvent): void => {
        const dy = startY - mv.clientY; // up = increase
        // §4.6.1: Shift + drag — fine control (scale step by fineDragRatio).
        const ratio = mv.shiftKey ? fineDragRatio : 1;
        // 200 px traverses the full range.
        const delta = (dy / 200) * range * ratio;
        // §4.5: snap to :step
        const raw = startVal + delta;
        const snapped = snapToStep(raw, step, min);
        const next = clamp(snapped, min, max);
        updateValue(next);
      };
      const onUp = (): void => {
        knob.classList.remove("is-dragging");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        window.removeEventListener("blur", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      // Safety nets for releases the document-level mouseup misses
      // (drag off-window, browser focus change, OS-level pointer cancel).
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
      window.addEventListener("blur", onUp);
    });

    // §4.6.1: Scroll wheel — step by :step per notch.
    knob.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const currentVal = typeof this.localValue === "number"
        ? this.localValue
        : Number(this.localValue) || 0;
      const effectiveStep = ev.shiftKey ? step * fineDragRatio : step;
      const direction = ev.deltaY < 0 ? 1 : -1;
      const next = clamp(currentVal + direction * effectiveStep, min, max);
      updateValue(next);
    });

    // §4.6.2: Keyboard arrows — step by :step for scalars.
    knob.addEventListener("keydown", (ev) => {
      const currentVal = typeof this.localValue === "number"
        ? this.localValue
        : Number(this.localValue) || 0;
      const effectiveStep = ev.shiftKey ? step * fineDragRatio : step;

      if (ev.key === "ArrowUp" || ev.key === "ArrowRight") {
        ev.preventDefault();
        const next = clamp(currentVal + effectiveStep, min, max);
        updateValue(next);
      } else if (ev.key === "ArrowDown" || ev.key === "ArrowLeft") {
        ev.preventDefault();
        const next = clamp(currentVal - effectiveStep, min, max);
        updateValue(next);
      }
    });

    // §4.6.1: Right-click — context menu placeholder.
    knob.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      // Dispatch a custom event for the context menu handler to pick up.
      // The context menu UI (rename, edit range, unmark, MIDI learn) is
      // rendered by the panel/adapter layer, not the widget itself.
      wrapper.dispatchEvent(
        new CustomEvent("liveEditContextMenu", {
          detail: { slotId: this.slot.id, x: ev.clientX, y: ev.clientY },
          bubbles: true,
        }),
      );
    });

    wrapper.appendChild(knob);
  }
}
// ── Slider (numeric scalar — alternative variant) ───────────────────────────

export class SliderWidget extends LiveEditBaseWidget {
  protected override renderControl(wrapper: HTMLElement, view: EditorView): void {
    const min = typeof this.slot.min === "number" ? this.slot.min : 0;
    const max = typeof this.slot.max === "number" ? this.slot.max : 1;
    const step = slotStep(this.slot);
    const fineDragRatio = DEFAULT_FINE_DRAG_RATIO;

    const track = document.createElement("span");
    track.className = "cm-live-edit-slider";
    track.setAttribute("role", "slider");
    track.setAttribute("tabindex", "0");
    track.setAttribute("aria-valuemin", String(min));
    track.setAttribute("aria-valuemax", String(max));
    track.setAttribute("aria-valuenow", String(this.localValue));

    // Modified-from-seed tick on the track.
    if (this.slot.modified && typeof this.slot.seed === "number") {
      const tick = document.createElement("span");
      tick.className = "cm-live-edit-slider-seed-tick";
      const seedT = clamp((this.slot.seed - min) / (max - min || 1), 0, 1);
      tick.style.left = `${seedT * 100}%`;
      track.appendChild(tick);
    }

    const handle = document.createElement("span");
    handle.className = "cm-live-edit-slider-handle";
    const v =
      typeof this.localValue === "number"
        ? this.localValue
        : Number(this.localValue) || 0;
    const t = clamp((v - min) / (max - min || 1), 0, 1);
    handle.style.left = `${t * 100}%`;
    track.appendChild(handle);

    /** Helper to update slider visual + value and emit the change. */
    const updateValue = (next: number): void => {
      this.localValue = next;
      const ratio = clamp((next - min) / (max - min || 1), 0, 1);
      handle.style.left = `${ratio * 100}%`;
      track.setAttribute("aria-valuenow", String(next));
      this.refreshReadout(wrapper);
      view.state.facet(liveEditWidgetConfigFacet).onValueChange?.(this.slot.id, next);
    };

    // §4.6.1: Cmd/Ctrl + click — reset to seed.
    track.addEventListener("mousedown", (ev) => {
      if (ev.metaKey || ev.ctrlKey) {
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof this.slot.seed === "number") {
          updateValue(this.slot.seed);
        }
        return;
      }

      ev.preventDefault();
      ev.stopPropagation();
      const rect = track.getBoundingClientRect();
      const range = max - min;
      const apply = (clientX: number, shiftKey: boolean): void => {
        const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
        const raw = min + ratio * range;
        // §4.5: snap to step; §4.6.1: Shift fine control
        const effectiveStep = shiftKey ? step * fineDragRatio : step;
        const snapped = snapToStep(raw, effectiveStep, min);
        const next = clamp(snapped, min, max);
        updateValue(next);
      };
      apply(ev.clientX, ev.shiftKey);
      const onMove = (mv: MouseEvent): void => apply(mv.clientX, mv.shiftKey);
      const onUp = (): void => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    // §4.6.1: Scroll wheel — step by :step per notch.
    track.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const currentVal = typeof this.localValue === "number"
        ? this.localValue
        : Number(this.localValue) || 0;
      const effectiveStep = ev.shiftKey ? step * fineDragRatio : step;
      const direction = ev.deltaY < 0 ? 1 : -1;
      const next = clamp(currentVal + direction * effectiveStep, min, max);
      updateValue(next);
    });

    // §4.6.2: Keyboard arrows — step by :step.
    track.addEventListener("keydown", (ev) => {
      const currentVal = typeof this.localValue === "number"
        ? this.localValue
        : Number(this.localValue) || 0;
      const effectiveStep = ev.shiftKey ? step * fineDragRatio : step;

      if (ev.key === "ArrowUp" || ev.key === "ArrowRight") {
        ev.preventDefault();
        const next = clamp(currentVal + effectiveStep, min, max);
        updateValue(next);
      } else if (ev.key === "ArrowDown" || ev.key === "ArrowLeft") {
        ev.preventDefault();
        const next = clamp(currentVal - effectiveStep, min, max);
        updateValue(next);
      }
    });

    // §4.6.1: Right-click — context menu.
    track.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      wrapper.dispatchEvent(
        new CustomEvent("liveEditContextMenu", {
          detail: { slotId: this.slot.id, x: ev.clientX, y: ev.clientY },
          bubbles: true,
        }),
      );
    });

    wrapper.appendChild(track);
  }
}
