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
  RangeSetBuilder,
  StateEffect,
  StateField,
  Text,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

import type { LiveEditSlot } from "../../../contracts/liveEdit.ts";
import { PickerWidget, ToggleWidget } from "./choiceWidgets.ts";
import { KnobWidget, SliderWidget } from "./numericWidgets.ts";
import {
  clamp,
  LiveEditBaseWidget,
  liveEditWidgetConfigFacet,
  type LiveEditWidgetConfig,
} from "./widgetBase.ts";
import { liveEditTheme } from "./widgetTheme.ts";

export type { LiveEditWidgetConfig } from "./widgetBase.ts";

const SCALAR_WIDGET_VARIANT: "knob" | "slider" = "knob";

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
