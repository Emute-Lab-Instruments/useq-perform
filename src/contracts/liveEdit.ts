// src/contracts/liveEdit.ts
//
// Shared types for the live-edit feature.
// Spec: docs/specs/live-edit.md
//
// A live-edit is a literal value the user has marked as a runtime-tunable
// knob/toggle/picker. Three representations coexist (§1.4):
//
//   - Source: a `(live-edit ...)` wrapper in the document text.
//   - Slot:   the canonical current runtime value, keyed by `:id`.
//   - Widget: the rendered surface the user manipulates.
//
// The source is the canonical declaration; the slot is the canonical current
// value; the widget is a view onto the slot.

// ── Slot model ──────────────────────────────────────────────────────────────

/** §2.6 — type variants. */
export type SlotKind = "numeric" | "boolean" | "keyword" | "vector-element";

export type SlotValue = number | boolean | string;

/** §4.3 — visible widget states. */
export type SlotWidgetState =
  | "uninitialised"
  | "idle"
  | "editing"
  | "listening" // MIDI learn armed
  | "wasm-preview"
  | "error"
  | "runtime-disabled";

/**
 * The runtime slot for a live-edit. The slot is the canonical current value
 * (§1.4); the widget is a view onto the slot.
 *
 * `id`        — the wrapper's `:id` keyword arg. Short stable opaque string
 *               (default 4 chars URL-safe). Wire-level identity (no hashing).
 * `name`      — optional human-readable label. Defaults to `unnamed-<id>`
 *               in the panel; editable inline.
 * `seed`      — original literal frozen at mark-time (§2.1). Restored by
 *               `liveEdit.resetToSeed`.
 * `value`     — current value pushed to the runtime via `set-live-inputs`.
 * `min/max`   — numeric bounds; auto-inferred at mark-time (§3.4).
 * `step`      — drag granularity (§4.5). Defaults to `10^-precision`.
 * `precision` — display decimals; canonical knob (§4.5).
 * `options`   — keyword choices for enum slots (§2.6.3).
 * `range`     — document offset of the wrapper, used by the panel to map
 *               cards back to source.
 */
export interface LiveEditSlot {
  id: string;
  kind: SlotKind;
  name?: string;
  seed: SlotValue;
  value: SlotValue;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  options?: string[];
  state: SlotWidgetState;
  range: { from: number; to: number };
  /** Whether the current value differs from `seed` (§4.4). */
  modified?: boolean;
}

// ── Vector mark sub-mode (§3.7) ─────────────────────────────────────────────

export type VectorMarkState = "selected" | "deselected" | "non-markable";

export interface VectorMarkElement {
  range: { from: number; to: number };
  state: VectorMarkState;
}

export interface VectorMarkSession {
  vectorRange: { from: number; to: number };
  elements: VectorMarkElement[];
  /** Index into `elements` of the currently focused element. -1 if none. */
  focusIndex: number;
}

/** §3.7.1 — setting `liveEdit.vectorMarkDefault`. */
export type VectorMarkDefault = "all" | "none";

// ── Panel ordering (§5.1.3, §5.1.4) ─────────────────────────────────────────

export type PanelOrderMode = "document" | "custom";

export interface LiveEditPanelOrder {
  mode: PanelOrderMode;
  /** Ordered slot ids, present only when mode === "custom". */
  custom?: string[];
}

// ── Range inference (§3.4) ──────────────────────────────────────────────────

/**
 * Result of the at-mark range inference. Best-effort — the user has the
 * final say via the keyword args.
 */
export interface InferredRange {
  min: number;
  max: number;
  precision: number;
}
