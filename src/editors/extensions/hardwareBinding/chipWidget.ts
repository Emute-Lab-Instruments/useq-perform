/**
 * Hardware-binding inline chip widget (gii8.56).
 *
 * Spec: docs/specs/hardware-bindings.md
 *   §3.1 — folded chip layout (glyph + input id + status dot)
 *   §3.2 — `on-button` lifecycle 3-segment indicator
 *   §3.5 — fired-pulse animation (~50 ms ramp up, ~150 ms decay)
 *   §3.6 — error state (warning glyph + altered halo tone)
 *   §6.1 — disabled tone when bindings are inert
 *
 * Bindings live in source as wrapper forms (`(on-press :sw1 ...)`,
 * `(on-toggle :sw1 (lambda (s) ...))`, etc.). This extension folds each
 * wrapper's source range to a compact inline chip carrying the input
 * identity + last-fire state. The data shape is `BindingChip[]` from
 * `@src/contracts/hardware`; the editor host pushes chips via the
 * `setBindingChips` effect.
 *
 * No runtime wiring is performed here — this is the visual surface only.
 * Test-fire (§5) is stubbed to a one-shot click handler that calls an
 * optional callback so storybook stories can demonstrate the gesture.
 *
 * Theme classes are prefixed `cm-binding-*`.
 */

import {
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";

import type {
  BindingChip,
  BindingEventKind,
  HardwareInputKind,
  LifecyclePhase,
} from "../../../contracts/hardware.ts";

// ─── Effect / state field ────────────────────────────────────────────────────

/** Replace the current chip set. Sender pushes the full list each time. */
export const setBindingChipsEffect = StateEffect.define<BindingChip[]>();

/** Imperative API used by the editor harness / future runtime wiring. */
export function setBindingChips(view: EditorView, chips: BindingChip[]): void {
  view.dispatch({ effects: setBindingChipsEffect.of(chips) });
}

const bindingChipsField = StateField.define<BindingChip[]>({
  create() {
    return [];
  },
  update(chips, tr) {
    for (const e of tr.effects) {
      if (e.is(setBindingChipsEffect)) return e.value;
    }
    if (tr.docChanged) {
      // Doc edits invalidate ranges. The host is expected to push a fresh
      // chip set on the next tick; until then, drop chips so we don't
      // decorate stale ranges.
      return chips.length === 0 ? chips : [];
    }
    return chips;
  },
});

// ─── Glyph + indicator helpers ───────────────────────────────────────────────

const KIND_GLYPH: Record<HardwareInputKind, string> = {
  switch: "▇",
  toggle: "▇",
  "encoder-click": "◓",
  gate: "⤓",
};

/** Visual decoration for the click-to-test stub callback. */
export interface ChipFireCallback {
  (chip: BindingChip): void;
}

// Module-level fire callback so the harness/stories can hook in without
// threading the callback through the StateField. Storybook stories don't set
// it; chips remain visually interactive but emit no real fire.
let fireCallback: ChipFireCallback | null = null;
export function setBindingChipFireCallback(cb: ChipFireCallback | null): void {
  fireCallback = cb;
}

const PULSE_DURATION_MS = 200;

function isPulsing(chip: BindingChip, now: number): boolean {
  if (chip.lastFireMs <= 0) return false;
  return now - chip.lastFireMs < PULSE_DURATION_MS;
}

// ─── Widget ──────────────────────────────────────────────────────────────────

class BindingChipWidget extends WidgetType {
  constructor(readonly chip: BindingChip) {
    super();
  }

  eq(other: BindingChipWidget): boolean {
    const a = this.chip;
    const b = other.chip;
    return (
      a.inputId === b.inputId &&
      a.inputKind === b.inputKind &&
      a.event === b.event &&
      a.lastFireMs === b.lastFireMs &&
      a.lastPhase === b.lastPhase &&
      a.error === b.error &&
      a.disabled === b.disabled &&
      a.range.from === b.range.from &&
      a.range.to === b.range.to
    );
  }

  toDOM(): HTMLElement {
    const chip = this.chip;
    const root = document.createElement("span");
    root.className = `cm-binding-chip cm-binding-chip--${eventClass(chip.event)}`;
    root.setAttribute("role", "button");
    root.setAttribute(
      "aria-label",
      `binding ${chip.event} ${chip.inputId}${
        chip.error ? " (error)" : chip.disabled ? " (disabled)" : ""
      }`,
    );
    if (chip.disabled) root.classList.add("cm-binding-chip--disabled");
    if (chip.error) root.classList.add("cm-binding-chip--error");
    if (chip.lastFireMs > 0) {
      root.setAttribute("data-fired-at", String(chip.lastFireMs));
    }

    const glyph = document.createElement("span");
    glyph.className = "cm-binding-chip__glyph";
    glyph.textContent = KIND_GLYPH[chip.inputKind];
    root.appendChild(glyph);

    const label = document.createElement("span");
    label.className = "cm-binding-chip__label";
    label.textContent = chip.inputId;
    root.appendChild(label);

    const status = renderStatus(chip);
    root.appendChild(status);

    // Test-fire stub: §5.1 specifies click-and-hold, but for the
    // visual-first storybook pass we treat any click on the chip as a
    // one-off "fire" — emits via the optional module-level callback.
    root.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      if (chip.disabled) return;
      fireCallback?.(chip);
    });

    return root;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function eventClass(event: BindingEventKind): string {
  switch (event) {
    case "on-press":
      return "press";
    case "on-release":
      return "release";
    case "on-button":
      return "button";
    case "on-toggle":
      return "toggle";
  }
}

function renderStatus(chip: BindingChip): HTMLElement {
  const status = document.createElement("span");
  status.className = "cm-binding-chip__status";

  if (chip.error) {
    const warn = document.createElement("span");
    warn.className = "cm-binding-chip__warning";
    warn.textContent = "⚠";
    warn.title = chip.error;
    status.appendChild(warn);
    return status;
  }

  if (chip.event === "on-button") {
    status.classList.add("cm-binding-chip__status--lifecycle");
    const phases: LifecyclePhase[] = ["press", "hold", "release"];
    for (const p of phases) {
      const seg = document.createElement("span");
      const active = chip.lastPhase === p;
      seg.className = `cm-binding-chip__phase cm-binding-chip__phase--${p}${
        active ? " cm-binding-chip__phase--active" : ""
      }`;
      seg.textContent = active ? "●" : "○";
      status.appendChild(seg);
    }
    return status;
  }

  const dot = document.createElement("span");
  dot.className = "cm-binding-chip__dot";
  dot.textContent = "●";
  status.appendChild(dot);
  return status;
}

// ─── Decoration build ────────────────────────────────────────────────────────

function buildDecorations(view: EditorView): DecorationSet {
  const chips = view.state.field(bindingChipsField, false);
  if (!chips || chips.length === 0) return Decoration.none;

  const docLen = view.state.doc.length;
  // RangeSetBuilder requires sorted-by-from input.
  const sorted = [...chips].sort((a, b) => a.range.from - b.range.from);
  const builder = new RangeSetBuilder<Decoration>();
  for (const chip of sorted) {
    const from = Math.max(0, Math.min(chip.range.from, docLen));
    const to = Math.max(0, Math.min(chip.range.to, docLen));
    if (to <= from) continue;
    builder.add(
      from,
      to,
      Decoration.replace({ widget: new BindingChipWidget(chip) }),
    );
  }
  return builder.finish();
}

// ─── ViewPlugin ──────────────────────────────────────────────────────────────

const bindingChipsPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    /** Active rAF id while any chip is mid-pulse. */
    private rafId: number | null = null;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
      this.scheduleIfPulsing(view);
    }

    update(u: ViewUpdate): void {
      const chipsChanged =
        u.startState.field(bindingChipsField, false) !==
        u.state.field(bindingChipsField, false);
      if (u.docChanged || u.viewportChanged || chipsChanged) {
        this.decorations = buildDecorations(u.view);
        this.scheduleIfPulsing(u.view);
      }
    }

    destroy(): void {
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    }

    /**
     * Re-render on rAF while any chip's pulse window is open. The widget DOM
     * carries `data-fired-at` so a CSS keyframe drives the visual decay; this
     * loop just keeps `eq()` honest by forcing a rebuild when the pulse ends
     * (so the dim state appears even if no other update lands).
     */
    private scheduleIfPulsing(view: EditorView): void {
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      const chips = view.state.field(bindingChipsField, false);
      if (!chips || chips.length === 0) return;
      const now = performance.now();
      const anyPulsing = chips.some((c) => isPulsing(c, now));
      if (!anyPulsing) return;
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        // Rebuild — widget eq() still returns true so DOM is reused, but the
        // builder runs again next time a chip's pulse window closes naturally.
        this.decorations = buildDecorations(view);
        this.scheduleIfPulsing(view);
      });
    }
  },
  { decorations: (v) => v.decorations },
);

// ─── Theme ───────────────────────────────────────────────────────────────────

const bindingChipTheme = EditorView.baseTheme({
  ".cm-binding-chip": {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    padding: "1px 6px",
    borderRadius: "10px",
    fontSize: "0.85em",
    fontFamily: "inherit",
    lineHeight: "1.4",
    verticalAlign: "baseline",
    backgroundColor: "rgba(120, 200, 220, 0.10)",
    border: "1px solid rgba(120, 200, 220, 0.40)",
    color: "rgba(220, 240, 245, 0.92)",
    cursor: "pointer",
    userSelect: "none",
  },
  ".cm-binding-chip--press": {
    borderColor: "rgba(120, 200, 220, 0.55)",
  },
  ".cm-binding-chip--release": {
    borderColor: "rgba(150, 180, 220, 0.55)",
  },
  ".cm-binding-chip--button": {
    borderColor: "rgba(180, 200, 130, 0.55)",
  },
  ".cm-binding-chip--toggle": {
    borderColor: "rgba(220, 180, 120, 0.55)",
  },
  ".cm-binding-chip__glyph": {
    fontSize: "0.95em",
    opacity: "0.85",
  },
  ".cm-binding-chip__label": {
    fontWeight: "500",
    letterSpacing: "0.01em",
  },
  ".cm-binding-chip__status": {
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
    marginLeft: "2px",
  },
  ".cm-binding-chip__dot": {
    fontSize: "0.85em",
    color: "rgba(220, 240, 245, 0.45)",
    transition: "color 150ms linear, text-shadow 150ms linear",
  },
  // Pulse animation (§3.5): when data-fired-at is present, run the keyframes
  // once. The browser re-runs the animation when the attribute value changes.
  ".cm-binding-chip[data-fired-at] .cm-binding-chip__dot": {
    animation: "cm-binding-chip-pulse 200ms linear",
    color: "rgba(255, 255, 255, 0.95)",
  },
  "@keyframes cm-binding-chip-pulse": {
    "0%": {
      color: "rgba(120, 240, 200, 1.0)",
      textShadow: "0 0 6px rgba(120, 240, 200, 0.8)",
    },
    "25%": {
      color: "rgba(120, 240, 200, 1.0)",
      textShadow: "0 0 6px rgba(120, 240, 200, 0.8)",
    },
    "100%": {
      color: "rgba(220, 240, 245, 0.45)",
      textShadow: "none",
    },
  },
  // Lifecycle indicator (§3.2)
  ".cm-binding-chip__status--lifecycle": {
    fontSize: "0.75em",
    letterSpacing: "0.05em",
  },
  ".cm-binding-chip__phase": {
    color: "rgba(220, 240, 245, 0.30)",
    transition: "color 120ms linear",
  },
  ".cm-binding-chip__phase--active": {
    color: "rgba(180, 220, 130, 1.0)",
    textShadow: "0 0 4px rgba(180, 220, 130, 0.7)",
  },
  // Error state (§3.6)
  ".cm-binding-chip--error": {
    borderColor: "rgba(255, 130, 120, 0.65)",
    backgroundColor: "rgba(255, 130, 120, 0.10)",
  },
  ".cm-binding-chip__warning": {
    color: "rgba(255, 180, 120, 1.0)",
    fontSize: "0.95em",
    cursor: "help",
  },
  // Disabled state (§6.1)
  ".cm-binding-chip--disabled": {
    opacity: "0.45",
    cursor: "default",
    borderStyle: "dashed",
  },
});

// ─── Public factory ──────────────────────────────────────────────────────────

/**
 * Create the hardware-binding chip extension.
 *
 * Push chip data via `setBindingChips(view, chips)`.
 * Optionally wire test-fire via `setBindingChipFireCallback(cb)`.
 */
export function createHardwareBindingExtension(): Extension[] {
  return [bindingChipsField, bindingChipsPlugin, bindingChipTheme];
}
