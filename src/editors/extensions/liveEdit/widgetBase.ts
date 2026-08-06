import { Facet } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";

import type {
  LiveEditSlot,
  SlotValue,
  SlotWidgetState,
} from "../../../contracts/liveEdit.ts";

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
/** Knob sweep, 7 o'clock (min) to 5 o'clock (max), passing over 12. §4.2.
 *  7 o'clock = -150° from 12; 5 o'clock = +150° from 12; total sweep = 300°.
 *  At t=0.5 the indicator points to 12 o'clock (midpoint of [min, max]). */
const KNOB_SWEEP_DEG = 300;
const KNOB_START_DEG = -150;
export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Map a numeric value into the knob's sweep, returning degrees relative to
 * the 12 o'clock indicator orientation we use in CSS (rotate(0deg) points
 * up). 12 o'clock = midpoint of [min, max]; 7 o'clock = min; 5 o'clock = max.
 */
export function valueToKnobAngle(
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
export abstract class LiveEditBaseWidget extends WidgetType {
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
export const DEFAULT_FINE_DRAG_RATIO = 0.1;

/**
 * Get the step for this slot, defaulting to 10^-precision per §4.5.
 */
export function slotStep(slot: LiveEditSlot): number {
  if (typeof slot.step === "number" && slot.step > 0) return slot.step;
  const precision = typeof slot.precision === "number" ? slot.precision : 2;
  return Math.pow(10, -precision);
}

/**
 * Snap a value to the nearest step boundary per §4.5.
 */
export function snapToStep(value: number, step: number, min: number): number {
  if (step <= 0) return value;
  return min + Math.round((value - min) / step) * step;
}
