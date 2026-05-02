// src/contracts/hardware.ts
//
// Shared types for hardware bindings (button/toggle/encoder events) and the
// CV 1V/oct calibration takeover.
// Specs: docs/specs/hardware-bindings.md, docs/specs/calibration.md.

// ── Hardware bindings (hardware-bindings.md) ─────────────────────────────

/**
 * Input-id keyword identifying a physical control on the connected variant.
 * Examples: ":sw1", ":sw2", ":swr", ":in1". The leading colon is part of the
 * source representation; in this type it is included verbatim (the editor
 * does not strip it). See §2.4 for the variant-by-variant list.
 */
export type HardwareInputId = string;

/** Visual kind drives chip glyph (§3.1). */
export type HardwareInputKind = "switch" | "toggle" | "encoder-click" | "gate";

/** §2.1 — the four wrapper forms. */
export type BindingEventKind = "on-press" | "on-release" | "on-button" | "on-toggle";

/** §3.2 — phase indicator for `on-button` lifecycle bindings. */
export type LifecyclePhase = "press" | "hold" | "release";

/**
 * Data shape a single inline binding chip needs to render (§3.1, §3.2, §3.6).
 *
 * `inputId` / `inputKind` — identity; drive the glyph + label.
 * `event`               — wrapper kind; controls dot vs 3-segment indicator.
 * `range`               — document offsets of the wrapper form.
 * `lastFireMs`          — timestamp of last fire (browser performance.now()).
 *                         The pulse animation derives from `now - lastFireMs`.
 *                         `0` if never fired this session.
 * `lastPhase`           — for on-button only; which phase last fired.
 * `error`               — diagnostic message from last fire (if it errored).
 *                         Renders the warning glyph instead of the dot.
 * `disabled`            — master switch off (§6.1) or runtime detached.
 */
export interface BindingChip {
  inputId: HardwareInputId;
  inputKind: HardwareInputKind;
  event: BindingEventKind;
  range: { from: number; to: number };
  lastFireMs: number;
  lastPhase?: LifecyclePhase;
  error?: string;
  disabled: boolean;
}

// ── Calibration (calibration.md) ─────────────────────────────────────────

/**
 * Per-output status as reported by the firmware on takeover entry (§2.3).
 */
export type CalibrationStatus =
  | { kind: "uncalibrated" }
  | { kind: "calibrated"; date: string } // ISO date string
  | { kind: "partial"; savedOctaves: number[] };

/**
 * One row in the pre-flight picker (§2.2).
 */
export interface CalibrationOutput {
  /** e.g. "a1", "a2", "a3", "a4". */
  id: string;
  status: CalibrationStatus;
}

/** §1.4 — the five fixed octave points (0V, 1V, 2V, 3V, 4V). */
export type CalibrationOctaveIndex = 0 | 1 | 2 | 3 | 4;

/** §3.2, §5.3 — per-step status drives the progress ribbon glyphs. */
export type CalibrationStepStatus = "pending" | "saved" | "skipped";

/**
 * Live calibration session — the state the takeover overlay renders against.
 * The state machine driving this lives in a separate bead (gii8.60); the UI
 * just observes this shape and emits user gestures back as commands.
 *
 * The session is per-output. Multi-output batch is deferred (§10).
 */
export interface CalibrationSession {
  output: string;
  /** Current octave the user is tuning. */
  step: CalibrationOctaveIndex;
  /**
   * Cumulative offset in cents for the current step, mirrored locally for
   * display. The wire protocol is delta-based; firmware is authoritative
   * (§4.5). The slider reads/writes this value.
   */
  offsetCents: number;
  /** Per-step status. Keys are `0..4` mapping to volts. */
  stepStatus: Record<CalibrationOctaveIndex, CalibrationStepStatus>;
  /** Awaiting firmware ack on a save-point send. */
  saving: boolean;
  /** Mid-takeover firmware rejection (§7.2). Cleared on retry/abort. */
  error?: string;
  /** User has hit Abort and is at the inline confirm prompt (§6.2). */
  abortConfirm: boolean;
  /** Final ack received; banner shows next-output picker (§5.4). */
  complete: boolean;
}

/**
 * Target voltage for each octave step. Used by the takeover header
 * ("0.000 V", "1.000 V", …).
 */
export const CALIBRATION_TARGET_VOLTS: Record<CalibrationOctaveIndex, number> = {
  0: 0,
  1: 1,
  2: 2,
  3: 3,
  4: 4,
};

/** §4.1 — slider extent ±50 cents around the target. */
export const CALIBRATION_SLIDER_RANGE_CENTS = 50;
