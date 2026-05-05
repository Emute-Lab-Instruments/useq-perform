/**
 * Live-edit inline widgets (gii8.39).
 *
 * Replaces `(live-edit ...)` source ranges with inline interactive controls
 * (knob / toggle / picker). Widgets update local visual state on interaction
 * and call an optional `onValueChange` callback so the store and runtime can
 * be updated. When no callback is provided the widgets remain visual-only.
 *
 * Spec: docs/specs/live-edit.md §2.4 (folding), §2.6 (type variants), §4
 * (widget shape, states, drag, popover, value readout, modified-from-seed).
 *
 * Architecture mirrors `holeWidget.ts`:
 *   - StateField holds the current `LiveEditSlot[]` (source of truth for
 *     positions / kinds / states / values).
 *   - ViewPlugin emits `Decoration.replace` over each slot's `range`,
 *     carrying a per-kind `WidgetType` instance.
 *   - `setLiveEditSlots(view, slots)` is the imperative push API used by the
 *     scenario harness post-mount.
 *   - Theme via `EditorView.baseTheme(...)` with `.cm-live-edit-*` class
 *     prefix to avoid clashing with other extensions.
 */

import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import {
  Facet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  Text,
  type Extension,
} from "@codemirror/state";

import type {
  LiveEditSlot,
  SlotValue,
  SlotWidgetState,
} from "../../../contracts/liveEdit.ts";

// ─── Widget configuration ────────────────────────────────────────────────────

/**
 * Configuration passed to `createLiveEditWidgetsExtension`.
 * All fields are optional — omitting them leaves the widgets visual-only.
 */
export interface LiveEditWidgetConfig {
  /**
   * Called whenever a widget value changes via user interaction.
   * The bridge module wires this to `store.setValue(id, value)`.
   */
  onValueChange?: (slotId: string, value: SlotValue) => void;
}

/**
 * Facet that carries the widget configuration for a specific editor instance.
 * Using a facet instead of a module-level variable ensures each editor view
 * holds its own config, fixing the silent-overwrite bug when multiple editors
 * coexist (Inspector, Storybook, etc.).
 *
 * The combiner keeps only the last provided value so a single
 * `liveEditWidgetConfigFacet.of(config)` in the extensions array wins cleanly.
 */
export const liveEditWidgetConfigFacet = Facet.define<
  LiveEditWidgetConfig,
  LiveEditWidgetConfig
>({
  combine: (vals) => vals[vals.length - 1] ?? {},
});

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * §10.4 — `liveEdit.scalarWidget`. The full setting integration is out of
 * scope for the first visual pass; flip this constant to test the slider
 * variant in stories.
 */
const SCALAR_WIDGET_VARIANT: "knob" | "slider" = "knob";

/** Knob sweep, 7 o'clock to 5 o'clock. §4.2. */
const KNOB_SWEEP_DEG = 270;
const KNOB_START_DEG = -135; // 7 o'clock relative to 12 o'clock north

// ─── State plumbing ──────────────────────────────────────────────────────────

const setSlotsEffect = StateEffect.define<LiveEditSlot[]>();

/** The list of slots the view should render. Default empty. */
export const liveEditSlotsField = StateField.define<LiveEditSlot[]>({
  create() {
    return [];
  },
  update(slots, tr) {
    for (const e of tr.effects) {
      if (e.is(setSlotsEffect)) {
        return e.value;
      }
    }
    return slots;
  },
});

/** Imperative push API — used by the scenario harness post-mount. */
export function setLiveEditSlots(
  view: EditorView,
  slots: LiveEditSlot[],
): void {
  view.dispatch({ effects: setSlotsEffect.of(slots) });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Map a numeric value into the knob's 270° sweep, returning degrees relative
 * to the 12 o'clock indicator orientation we use in CSS (rotate(0deg) points
 * up). 12 o'clock = midpoint of [min, max]; 7 o'clock = min; 5 o'clock = max.
 */
function valueToKnobAngle(
  value: number,
  min: number,
  max: number,
): number {
  if (!isFinite(min) || !isFinite(max) || max <= min) return 0;
  const t = clamp((value - min) / (max - min), 0, 1);
  return KNOB_START_DEG + t * KNOB_SWEEP_DEG;
}

/** Format a numeric value for the readout per `:precision`. §4.2.1. */
function formatNumeric(value: number, precision?: number): string {
  const p = typeof precision === "number" && precision >= 0 ? precision : 2;
  return value.toFixed(Math.min(p, 8));
}

function formatReadout(slot: LiveEditSlot): string {
  switch (slot.kind) {
    case "boolean":
      return slot.value ? "on" : "off";
    case "keyword":
      // Stored as a keyword name string (e.g. "up"). Display with leading colon.
      return `:${String(slot.value)}`;
    case "numeric":
    case "vector-element":
      return formatNumeric(
        typeof slot.value === "number" ? slot.value : Number(slot.value) || 0,
        slot.precision,
      );
    default:
      return String(slot.value);
  }
}

function applyStateClasses(el: HTMLElement, state: SlotWidgetState): void {
  // Wipe any previous state classes and apply just the current one.
  for (const cls of [
    "is-idle",
    "is-editing",
    "is-listening",
    "is-uninitialised",
    "is-wasm-preview",
    "is-error",
    "is-runtime-disabled",
  ]) {
    el.classList.remove(cls);
  }
  switch (state) {
    case "idle":
      el.classList.add("is-idle");
      break;
    case "editing":
      el.classList.add("is-editing");
      break;
    case "listening":
      el.classList.add("is-listening");
      break;
    case "uninitialised":
      el.classList.add("is-uninitialised");
      break;
    case "wasm-preview":
      el.classList.add("is-wasm-preview");
      break;
    case "error":
      el.classList.add("is-error");
      break;
    case "runtime-disabled":
      el.classList.add("is-runtime-disabled");
      break;
  }
}

/** Append a small state-badge glyph to the wrapper based on state. */
function appendStateBadge(
  wrapper: HTMLElement,
  state: SlotWidgetState,
): void {
  let badgeText = "";
  let title = "";
  switch (state) {
    case "uninitialised":
      badgeText = "⏳";
      title = "Uninitialised — slot not yet allocated on the runtime.";
      break;
    case "wasm-preview":
      badgeText = "WASM";
      title = "WASM preview only — hardware not synced.";
      break;
    case "error":
      badgeText = "!";
      title = "Live-edit failed compile validation.";
      break;
    case "runtime-disabled":
      badgeText = "∅";
      title = "No runtime — read-only.";
      break;
    case "listening":
      // No glyph — the pulsing halo carries the meaning.
      break;
    default:
      break;
  }
  if (!badgeText) return;
  const badge = document.createElement("span");
  badge.className = "cm-live-edit-badge";
  badge.textContent = badgeText;
  badge.title = title;
  wrapper.appendChild(badge);
}

// ─── Per-kind widget classes ─────────────────────────────────────────────────

/**
 * Base class — shares wrapper construction, state styling, readout, and
 * (for visual feedback) local mutable value. Each subclass implements the
 * actual control surface in `renderControl()`.
 */
abstract class LiveEditBaseWidget extends WidgetType {
  /**
   * Local visual-only mirror of the slot value. Updated on drag / click so
   * the widget repaints; never propagated to any runtime store.
   */
  protected localValue: SlotValue;

  constructor(readonly slot: LiveEditSlot) {
    super();
    this.localValue = slot.value;
  }

  eq(other: LiveEditBaseWidget): boolean {
    if (this.constructor !== other.constructor) return false;
    return (
      this.slot.id === other.slot.id &&
      this.slot.kind === other.slot.kind &&
      this.slot.value === other.slot.value &&
      this.slot.state === other.slot.state &&
      this.slot.modified === other.slot.modified &&
      this.slot.min === other.slot.min &&
      this.slot.max === other.slot.max &&
      this.slot.step === other.slot.step &&
      this.slot.precision === other.slot.precision &&
      sameOptions(this.slot.options, other.slot.options)
    );
  }

  ignoreEvent(): boolean {
    // Let mouse events through so click/drag works.
    return false;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = `cm-live-edit cm-live-edit--${this.slot.kind}`;
    wrapper.setAttribute(
      "aria-label",
      `live-edit ${this.slot.id} (${this.slot.kind})`,
    );
    if (this.slot.modified) wrapper.classList.add("is-modified");
    applyStateClasses(wrapper, this.slot.state);

    this.renderControl(wrapper, view);
    this.renderReadout(wrapper);
    appendStateBadge(wrapper, this.slot.state);

    return wrapper;
  }

  /** Subclass-specific control surface, appended to the wrapper. */
  protected abstract renderControl(wrapper: HTMLElement, view: EditorView): void;

  protected renderReadout(wrapper: HTMLElement): void {
    const readout = document.createElement("span");
    readout.className = "cm-live-edit-readout";
    readout.textContent = formatReadout({
      ...this.slot,
      value: this.localValue,
    });
    wrapper.appendChild(readout);
  }

  /** Helper for subclasses to refresh the always-on value readout. */
  protected refreshReadout(wrapper: HTMLElement): void {
    const readout = wrapper.querySelector(
      ".cm-live-edit-readout",
    ) as HTMLElement | null;
    if (!readout) return;
    readout.textContent = formatReadout({
      ...this.slot,
      value: this.localValue,
    });
  }
}

function sameOptions(a?: string[], b?: string[]): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ── Shared constants (§10.14, §10.15) ───────────────────────────────────────

/** Fine-drag step multiplier when Shift is held (§4.6.1, §10.15). */
const DEFAULT_FINE_DRAG_RATIO = 0.1;

/**
 * Get the step for this slot, defaulting to 10^-precision per §4.5.
 */
function slotStep(slot: LiveEditSlot): number {
  if (typeof slot.step === "number" && slot.step > 0) return slot.step;
  const precision = typeof slot.precision === "number" ? slot.precision : 2;
  return Math.pow(10, -precision);
}

/**
 * Snap a value to the nearest step boundary per §4.5.
 */
function snapToStep(value: number, step: number, min: number): number {
  if (step <= 0) return value;
  return min + Math.round((value - min) / step) * step;
}

// ── Knob (numeric scalar / vector-element) ──────────────────────────────────

class KnobWidget extends LiveEditBaseWidget {
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
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
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

class SliderWidget extends LiveEditBaseWidget {
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

// ── Toggle (boolean) ────────────────────────────────────────────────────────

class ToggleWidget extends LiveEditBaseWidget {
  protected override renderControl(wrapper: HTMLElement, view: EditorView): void {
    const pill = document.createElement("span");
    pill.className = "cm-live-edit-toggle";
    pill.setAttribute("role", "switch");
    pill.setAttribute("tabindex", "0");

    const update = (): void => {
      const on = Boolean(this.localValue);
      pill.classList.toggle("is-on", on);
      pill.classList.toggle("is-off", !on);
      pill.setAttribute("aria-checked", String(on));
      pill.textContent = on ? "● on" : "off ●";
    };
    update();

    const toggle = (): void => {
      this.localValue = !this.localValue;
      update();
      this.refreshReadout(wrapper);
      view.state.facet(liveEditWidgetConfigFacet).onValueChange?.(this.slot.id, this.localValue as boolean);
    };

    // §4.6.1: Cmd/Ctrl + click — reset to seed.
    pill.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.metaKey || ev.ctrlKey) {
        this.localValue = this.slot.seed;
        update();
        this.refreshReadout(wrapper);
        view.state.facet(liveEditWidgetConfigFacet).onValueChange?.(this.slot.id, this.localValue as boolean);
        return;
      }
      toggle();
    });

    // §4.6.2: Keyboard arrows — toggle booleans.
    pill.addEventListener("keydown", (ev) => {
      if (
        ev.key === "ArrowUp" || ev.key === "ArrowDown" ||
        ev.key === "ArrowLeft" || ev.key === "ArrowRight" ||
        ev.key === " " || ev.key === "Enter"
      ) {
        ev.preventDefault();
        toggle();
      }
    });

    // §4.6.1: Right-click — context menu.
    pill.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      wrapper.dispatchEvent(
        new CustomEvent("liveEditContextMenu", {
          detail: { slotId: this.slot.id, x: ev.clientX, y: ev.clientY },
          bubbles: true,
        }),
      );
    });

    wrapper.appendChild(pill);
  }

  protected override renderReadout(): void {
    // Toggle's pill already names the state; the readout would be redundant
    // and visually busy on a single line. Skip per pragmatic visual judgement
    // (spec §4.2.1 mandates an always-on readout — but the pill itself is
    // the readout for booleans).
    // TODO(gii8.39): revisit once the spec clarifies whether the pill counts
    // as the readout or whether a duplicate "on/off" string belongs alongside.
  }
}

// ── Picker (keyword enum) ───────────────────────────────────────────────────

class PickerWidget extends LiveEditBaseWidget {
  protected override renderControl(wrapper: HTMLElement, view: EditorView): void {
    const row = document.createElement("span");
    row.className = "cm-live-edit-picker";
    row.setAttribute("role", "listbox");
    row.setAttribute("tabindex", "0");

    const options =
      this.slot.options && this.slot.options.length > 0
        ? this.slot.options
        : [String(this.slot.value)];

    /** Update all segments to reflect the current localValue. */
    const refreshSegments = (): void => {
      for (const child of Array.from(row.children) as HTMLElement[]) {
        const childOpt = child.dataset.option ?? "";
        const isSelected = childOpt === String(this.localValue);
        child.classList.toggle("is-selected", isSelected);
        child.setAttribute("aria-selected", String(isSelected));
        child.textContent = `:${childOpt} ${isSelected ? "●" : "○"}`;
      }
    };

    /** Select an option by value. */
    const selectOption = (opt: string): void => {
      this.localValue = opt;
      refreshSegments();
      this.refreshReadout(wrapper);
      view.state.facet(liveEditWidgetConfigFacet).onValueChange?.(this.slot.id, opt);
    };

    for (const opt of options) {
      const seg = document.createElement("span");
      seg.className = "cm-live-edit-picker-option";
      seg.dataset.option = opt;
      const filled = opt === String(this.localValue);
      seg.classList.toggle("is-selected", filled);
      seg.textContent = `:${opt} ${filled ? "●" : "○"}`;
      seg.setAttribute("role", "option");
      seg.setAttribute("aria-selected", String(filled));

      // §4.6.1: Cmd/Ctrl + click — reset to seed.
      seg.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.metaKey || ev.ctrlKey) {
          selectOption(String(this.slot.seed));
          return;
        }
        selectOption(opt);
      });

      row.appendChild(seg);
    }

    // §4.6.2: Keyboard arrows — cycle enums.
    row.addEventListener("keydown", (ev) => {
      const currentIdx = options.indexOf(String(this.localValue));
      if (ev.key === "ArrowRight" || ev.key === "ArrowUp") {
        ev.preventDefault();
        const nextIdx = (currentIdx + 1) % options.length;
        selectOption(options[nextIdx]);
      } else if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") {
        ev.preventDefault();
        const prevIdx = (currentIdx - 1 + options.length) % options.length;
        selectOption(options[prevIdx]);
      }
    });

    // §4.6.1: Scroll wheel — cycle options.
    row.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const currentIdx = options.indexOf(String(this.localValue));
      const direction = ev.deltaY < 0 ? 1 : -1;
      const nextIdx = (currentIdx + direction + options.length) % options.length;
      selectOption(options[nextIdx]);
    });

    // §4.6.1: Right-click — context menu.
    row.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      wrapper.dispatchEvent(
        new CustomEvent("liveEditContextMenu", {
          detail: { slotId: this.slot.id, x: ev.clientX, y: ev.clientY },
          bubbles: true,
        }),
      );
    });

    wrapper.appendChild(row);
  }

  protected override renderReadout(wrapper: HTMLElement): void {
    // For pickers the segmented row already shows the current option clearly.
    // Skip the readout to avoid visual noise (cf. ToggleWidget).
    void wrapper;
  }
}

// ─── Decoration build ────────────────────────────────────────────────────────

function widgetFor(slot: LiveEditSlot): LiveEditBaseWidget {
  switch (slot.kind) {
    case "boolean":
      return new ToggleWidget(slot);
    case "keyword":
      return new PickerWidget(slot);
    case "numeric":
      return SCALAR_WIDGET_VARIANT === "slider"
        ? new SliderWidget(slot)
        : new KnobWidget(slot);
    case "vector-element":
      // Vector elements are knobs regardless of the global scalar setting —
      // sliders inline in a `[1 2 3]` row would be visually too tall.
      return new KnobWidget(slot);
    default:
      return new KnobWidget(slot);
  }
}

export function buildDecorations(slots: LiveEditSlot[], doc: Text): DecorationSet {
  const docLen = doc.length;
  if (slots.length === 0) return Decoration.none;

  // Sort by `from` for RangeSetBuilder ordering requirement.
  const sorted = [...slots].sort((a, b) => a.range.from - b.range.from);
  const builder = new RangeSetBuilder<Decoration>();

  let lastTo = -1;
  for (const slot of sorted) {
    const from = clamp(slot.range.from, 0, docLen);
    const to = clamp(slot.range.to, 0, docLen);
    if (to <= from) continue;
    // Drop overlapping ranges to satisfy RangeSetBuilder ordering.
    if (from < lastTo) continue;
    // CodeMirror forbids Decoration.replace() spanning line breaks in
    // StateField-sourced decorations. Live-edit wrappers are always
    // single-line (formatting.md §3.7); drop any multi-line range.
    if (doc.lineAt(from).number !== doc.lineAt(to - 1).number) {
      console.warn(
        `[liveEdit] Dropping multi-line slot "${slot.id}" (line ${doc.lineAt(from).number}–${doc.lineAt(to - 1).number}). Live-edit wrappers must be single-line.`,
      );
      continue;
    }
    builder.add(
      from,
      to,
      Decoration.replace({
        widget: widgetFor(slot),
      }),
    );
    lastTo = to;
  }

  return builder.finish();
}

// ─── ViewPlugin ──────────────────────────────────────────────────────────────

const liveEditDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      const slots = view.state.field(liveEditSlotsField, false) ?? [];
      this.decorations = buildDecorations(slots, view.state.doc);
    }
    update(u: ViewUpdate): void {
      const oldSlots = u.startState.field(liveEditSlotsField, false);
      const newSlots = u.state.field(liveEditSlotsField, false);
      if (u.docChanged || oldSlots !== newSlots) {
        this.decorations = buildDecorations(
          newSlots ?? [],
          u.state.doc,
        );
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// ─── Theme ───────────────────────────────────────────────────────────────────

const liveEditTheme = EditorView.baseTheme({
  // ── Wrapper ────────────────────────────────────────────────────────────────
  ".cm-live-edit": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "0 4px",
    borderRadius: "6px",
    fontFamily: "inherit",
    fontSize: "0.95em",
    lineHeight: "1",
    verticalAlign: "baseline",
    backgroundColor: "rgba(120, 200, 255, 0.08)",
    border: "1px solid rgba(120, 200, 255, 0.25)",
    color: "rgba(220, 235, 255, 0.95)",
    cursor: "default",
    userSelect: "none",
  },
  ".cm-live-edit.is-modified": {
    backgroundColor: "rgba(255, 200, 120, 0.12)",
    borderColor: "rgba(255, 200, 120, 0.45)",
  },
  ".cm-live-edit.is-editing": {
    boxShadow: "0 0 0 2px rgba(120, 200, 255, 0.5)",
  },
  ".cm-live-edit.is-listening": {
    animation: "cm-live-edit-listening-pulse 1s ease-in-out infinite",
  },
  ".cm-live-edit.is-uninitialised": {
    opacity: "0.55",
  },
  ".cm-live-edit.is-wasm-preview": {
    borderStyle: "dashed",
  },
  ".cm-live-edit.is-error": {
    backgroundColor: "rgba(255, 100, 100, 0.12)",
    borderColor: "rgba(255, 100, 100, 0.6)",
    color: "rgba(255, 200, 200, 0.95)",
  },
  ".cm-live-edit.is-runtime-disabled": {
    opacity: "0.45",
    filter: "grayscale(0.6)",
  },
  // 1 Hz pulse halo for `listening` state.
  "@keyframes cm-live-edit-listening-pulse": {
    "0%, 100%": {
      boxShadow: "0 0 0 0 rgba(255, 220, 100, 0.8)",
    },
    "50%": {
      boxShadow: "0 0 0 4px rgba(255, 220, 100, 0.0)",
    },
  },

  // ── Readout ────────────────────────────────────────────────────────────────
  ".cm-live-edit-readout": {
    fontFamily: "monospace",
    fontSize: "0.9em",
    fontVariantNumeric: "tabular-nums",
    color: "inherit",
    minWidth: "2.2em",
    textAlign: "left",
  },

  // ── State badges ───────────────────────────────────────────────────────────
  ".cm-live-edit-badge": {
    fontSize: "0.7em",
    padding: "1px 4px",
    borderRadius: "4px",
    backgroundColor: "rgba(255, 220, 120, 0.25)",
    color: "rgba(255, 240, 200, 0.95)",
    fontWeight: "600",
    letterSpacing: "0.04em",
  },
  ".cm-live-edit.is-error .cm-live-edit-badge": {
    backgroundColor: "rgba(255, 100, 100, 0.35)",
    color: "rgba(255, 230, 230, 1)",
  },

  // ── Knob ───────────────────────────────────────────────────────────────────
  ".cm-live-edit-knob": {
    position: "relative",
    display: "inline-block",
    width: "1em",
    height: "1em",
    borderRadius: "50%",
    background: "rgba(120, 200, 255, 0.18)",
    border: "1px solid rgba(120, 200, 255, 0.55)",
    cursor: "ns-resize",
    flex: "0 0 auto",
  },
  ".cm-live-edit.is-modified .cm-live-edit-knob": {
    background: "rgba(255, 200, 120, 0.22)",
    borderColor: "rgba(255, 200, 120, 0.7)",
  },
  ".cm-live-edit-knob-indicator": {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: "2px",
    height: "55%",
    marginLeft: "-1px",
    marginTop: "-2px",
    backgroundColor: "rgba(220, 240, 255, 0.95)",
    transformOrigin: "1px 2px", // origin near center of knob (rotation pivot)
    borderRadius: "1px",
  },
  ".cm-live-edit.is-modified .cm-live-edit-knob-indicator": {
    backgroundColor: "rgba(255, 220, 160, 1)",
  },
  ".cm-live-edit-knob-seed-tick": {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: "2px",
    height: "30%",
    marginLeft: "-1px",
    marginTop: "-1px",
    backgroundColor: "rgba(255, 255, 255, 0.45)",
    transformOrigin: "1px 1px",
    borderRadius: "1px",
    pointerEvents: "none",
  },

  // ── Slider ─────────────────────────────────────────────────────────────────
  ".cm-live-edit-slider": {
    position: "relative",
    display: "inline-block",
    width: "5em",
    height: "0.5em",
    borderRadius: "3px",
    background: "rgba(120, 200, 255, 0.18)",
    border: "1px solid rgba(120, 200, 255, 0.45)",
    cursor: "ew-resize",
    flex: "0 0 auto",
    verticalAlign: "middle",
  },
  ".cm-live-edit-slider-handle": {
    position: "absolute",
    top: "50%",
    width: "0.6em",
    height: "0.9em",
    marginLeft: "-0.3em",
    marginTop: "-0.45em",
    backgroundColor: "rgba(220, 240, 255, 0.95)",
    borderRadius: "2px",
  },
  ".cm-live-edit-slider-seed-tick": {
    position: "absolute",
    top: "-2px",
    width: "2px",
    height: "calc(100% + 4px)",
    marginLeft: "-1px",
    backgroundColor: "rgba(255, 255, 255, 0.5)",
    pointerEvents: "none",
  },

  // ── Toggle ─────────────────────────────────────────────────────────────────
  ".cm-live-edit-toggle": {
    display: "inline-block",
    padding: "1px 8px",
    borderRadius: "10px",
    fontSize: "0.85em",
    fontFamily: "monospace",
    cursor: "pointer",
    border: "1px solid rgba(120, 200, 255, 0.45)",
    backgroundColor: "rgba(120, 200, 255, 0.14)",
    color: "rgba(220, 235, 255, 0.9)",
  },
  ".cm-live-edit-toggle.is-on": {
    backgroundColor: "rgba(120, 220, 150, 0.22)",
    borderColor: "rgba(120, 220, 150, 0.6)",
    color: "rgba(220, 255, 220, 1)",
  },
  ".cm-live-edit-toggle.is-off": {
    backgroundColor: "rgba(180, 180, 180, 0.14)",
    borderColor: "rgba(180, 180, 180, 0.45)",
    color: "rgba(220, 220, 220, 0.85)",
  },

  // ── Picker ─────────────────────────────────────────────────────────────────
  ".cm-live-edit-picker": {
    display: "inline-flex",
    gap: "2px",
    fontFamily: "monospace",
    fontSize: "0.85em",
  },
  ".cm-live-edit-picker-option": {
    padding: "1px 6px",
    border: "1px solid rgba(120, 200, 255, 0.4)",
    borderRadius: "4px",
    cursor: "pointer",
    backgroundColor: "rgba(120, 200, 255, 0.06)",
    color: "rgba(220, 235, 255, 0.8)",
  },
  ".cm-live-edit-picker-option.is-selected": {
    backgroundColor: "rgba(120, 200, 255, 0.3)",
    borderColor: "rgba(120, 200, 255, 0.85)",
    color: "rgba(240, 250, 255, 1)",
  },
});

// ─── Public factory ──────────────────────────────────────────────────────────

/**
 * Compose the live-edit widgets extension: state field + decorations view
 * plugin + base theme. Returned as an array so the caller can spread directly
 * into a CodeMirror extension list.
 *
 * @param config - Optional configuration. Provide `onValueChange` to connect
 *   widget interactions to the live-edit store (or any other value sink).
 *   Without a config the widgets remain visual-only.
 */
export function createLiveEditWidgetsExtension(config?: LiveEditWidgetConfig): Extension[] {
  return [
    liveEditWidgetConfigFacet.of(config ?? {}),
    liveEditSlotsField,
    liveEditDecorations,
    liveEditTheme,
  ];
}
