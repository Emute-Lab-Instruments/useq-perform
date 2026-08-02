/**
 * The Machine — schematic layout model.
 *
 * Spec: `docs/specs/the-machine.md` §1 (the six ideas) and §2 (the scene).
 *
 * This module is **pure**: types, the canonical idea list, and the
 * derivations that turn real app state into what the schematic draws. It
 * subscribes to nothing and imports no store — `machineEvents.ts` owns all
 * wiring, `MachinePanel.tsx` owns all rendering.
 *
 * The honesty rule (the-machine.md §1.2) lives here as a shape constraint:
 * every field of `MachineSnapshot` is a projection of something the running
 * app actually reported. There is no time-based interpolation, no decay
 * curve, and no synthetic phase — if the app stops reporting, the snapshot
 * stops changing.
 */

import type { OutputHealth } from "../../../utils/outputHealthStore";
import type { Playground } from "../guide/guideTypes";

// ---------------------------------------------------------------------------
// Regions and ideas
// ---------------------------------------------------------------------------

/** The three regions of the scene, left to right (the-machine.md §2.1). */
export type MachineRegionId = "clock" | "program" | "outputs";

export const MACHINE_REGION_IDS: readonly MachineRegionId[] = [
  "clock",
  "program",
  "outputs",
];

export interface MachineRegion {
  id: MachineRegionId;
  title: string;
  /** One-line label rendered under the region in the scene. */
  caption: string;
}

export const MACHINE_REGIONS: readonly MachineRegion[] = [
  {
    id: "clock",
    title: "Clock",
    caption: "time flows in",
  },
  {
    id: "program",
    title: "Program",
    caption: "your expressions",
  },
  {
    id: "outputs",
    title: "Outputs",
    caption: "the jacks",
  },
];

/** Stable ids for the six ideas (the-machine.md §1.1), in reading order. */
export type MachineIdeaId =
  | "time-flows-in"
  | "expression-is-signal"
  | "values-land-on-outputs"
  | "wrapping-bends-time"
  | "state-remembers"
  | "breaking-doesnt-break-sound";

export interface MachineIdea {
  id: MachineIdeaId;
  /** 1-based position in the six-idea sequence. */
  ordinal: number;
  /** Which region of the scene reveals this idea when selected. */
  region: MachineRegionId;
  title: string;
  /**
   * The one-paragraph explanation shown when the region is selected
   * (the-machine.md §2.3). Deliberately mechanism-free — no passes, no node
   * graphs, no slots (§1.1).
   */
  explanation: string;
  /**
   * The chapter-0 section this idea corresponds to. Guide and schematic are
   * two renderings of the same six ideas; this is the link between them.
   */
  sectionId: string;
  /** The playground embedded alongside the explanation (§2.3). */
  playground: Playground;
}

/**
 * The six ideas, verbatim from the-machine.md §1.1, each with the smallest
 * example that shows it. Playground code is kept identical to the guide's
 * chapter-0 examples so the schematic and the chapter never drift apart —
 * `ch0-machine.test.ts` asserts that.
 */
export const MACHINE_IDEAS: readonly MachineIdea[] = [
  {
    id: "time-flows-in",
    ordinal: 1,
    region: "clock",
    title: "Time flows in",
    explanation:
      "A clock runs whether you are typing or not. It hands your code the " +
      "current time — `t` in seconds, and `beat` and `bar` as ramps that " +
      "climb from 0 to 1 and reset. Everything downstream is built from " +
      "those. You never advance time yourself; you describe what should " +
      "happen at each moment, and the clock supplies the moments.",
    sectionId: "machine-time",
    playground: {
      code: "(a1 t)",
      annotation: "t is the time, in seconds, right now",
      outputs: ["a1"],
      witnessRef: "t-is-real-valued-seconds",
    },
  },
  {
    id: "expression-is-signal",
    ordinal: 2,
    region: "program",
    title: "Your expression is a signal",
    explanation:
      "An expression is not a list of steps that runs once. It is a shape " +
      "the module re-reads at every instant. Write `bar` and you have not " +
      "asked for a number — you have described a ramp. Wrap it in `sin` and " +
      "you have described a curve. The code sits still; time moves through it.",
    sectionId: "machine-signal",
    playground: {
      code: "(a1 bar)",
      annotation: "One expression, re-read at every instant",
      outputs: ["a1"],
      bars: 2,
      witnessRef: "bar-phasor-formula",
    },
  },
  {
    id: "values-land-on-outputs",
    ordinal: 3,
    region: "outputs",
    title: "Values land on outputs",
    explanation:
      "`a1`–`a8` are the CV jacks, `d1`–`d8` the gate jacks. Naming one is " +
      "how you connect a signal to the outside world: `(a3 0.1)` means " +
      "“a3 now carries this signal”. Each output is independent — " +
      "assigning one leaves the others exactly as they were.",
    sectionId: "machine-outputs",
    playground: {
      code: "(a3 0.1)",
      annotation: "a3 goes from idle to running, and stays there",
      outputs: ["a3"],
      witnessRef: "output-assignment-and-health",
    },
  },
  {
    id: "wrapping-bends-time",
    ordinal: 4,
    region: "clock",
    title: "Wrapping bends time",
    explanation:
      "`fast`, `slow` and `offset` do not change what an expression means — " +
      "they change the clock it is handed. `(fast 2 t)` runs the inside on a " +
      "clock that moves twice as quickly, so at half a second it already " +
      "reads one second. Wrappers nest, and each layer bends the clock the " +
      "layer inside it sees.",
    sectionId: "machine-warps",
    playground: {
      code: "(a1 (fast 2 t))",
      annotation: "Inside the wrapper, time runs at double speed",
      outputs: ["a1"],
      witnessRef: "fast-is-pointwise-time-scaling",
    },
  },
  {
    id: "state-remembers",
    ordinal: 5,
    region: "program",
    title: "State remembers",
    explanation:
      "Most expressions forget everything between instants — ask them twice " +
      "at the same moment and you get the same answer twice. A few do not. " +
      "`integrate` accumulates, `defstate` keeps a value you update yourself, " +
      "and filters and envelopes carry memory internally. These are the " +
      "expressions whose answer depends on where the module has been, not " +
      "just what time it is.",
    sectionId: "machine-state",
    playground: {
      code: "(a1 (integrate 2))",
      annotation: "Climbs by 2 per second, because it remembers",
      outputs: ["a1"],
      bars: 2,
      witnessRef: "integrate-accumulates-rate-times-dt",
    },
  },
  {
    id: "breaking-doesnt-break-sound",
    ordinal: 6,
    region: "outputs",
    title: "Breaking code doesn't break sound",
    explanation:
      "When an expression fails to compile, the output does not go silent " +
      "and the module does not stop. The last version that worked keeps " +
      "running while you fix the new one. The schematic marks that output as " +
      "*holding* — broken, but still sounding — and the editor shows you what " +
      "went wrong. You cannot crash the gig.",
    sectionId: "machine-failure",
    playground: {
      code: "(a1 0.75)",
      annotation: "Break this and a1 keeps playing 0.75",
      outputs: ["a1"],
      witnessRef: "compile-error-keeps-active-program",
    },
  },
];

/** The ideas revealed by selecting a given region, in ordinal order. */
export function ideasForRegion(region: MachineRegionId): MachineIdea[] {
  return MACHINE_IDEAS.filter((idea) => idea.region === region);
}

// ---------------------------------------------------------------------------
// Snapshot — what the scene draws
// ---------------------------------------------------------------------------

/** Transport states the clock region renders (transport.machine.ts). */
export type MachineClockState = "playing" | "paused" | "stopped";

/**
 * Per-output row state. `running`/`idle` come straight from the engine's
 * health projection; `fallback` is the LKG state the-machine.md §2.2 asks to
 * be shown *distinctly* — broken, but still sounding.
 */
export type MachineRowState = OutputHealth;

export interface MachineProgramRow {
  /** Output name, e.g. "a1". */
  output: string;
  /**
   * The expression currently visualised for this output, or `null` when the
   * output is active but its text is not registered with the visualisation
   * store (health-only rows). Never invented.
   */
  expressionText: string | null;
  state: MachineRowState;
  /** Engine-supplied diagnostic message for `fallback`/`error` rows. */
  message?: string;
  /** Channel colour from the visualisation palette, or null. */
  colour: string | null;
  /**
   * Recent output values, oldest-first, normalised to 0..1 for drawing.
   * Empty when the runtime has not reported any samples for this output.
   */
  spark: number[];
}

export interface MachineClockSnapshot {
  state: MachineClockState;
  /** Bar position in 0..1, as reported by the sampler. */
  phase: number;
  /** Transport time in seconds, as reported by the visualisation store. */
  timeSeconds: number;
}

export interface MachineSnapshot {
  /**
   * False when no runtime can report anything (hardware-only / WASM
   * unavailable). The scene then renders visibly quiescent — the-machine.md
   * §1.2, §6.3, mirroring probes.md §1.6.3.
   */
  live: boolean;
  /** Short user-facing reason shown in the quiescent state. */
  quiescentReason: string | null;
  clock: MachineClockSnapshot;
  rows: MachineProgramRow[];
  /**
   * Monotonic counter incremented once per real evaluation event. The
   * program region keys its flash off changes to this number, so a flash can
   * only ever be caused by an eval that actually happened.
   */
  evalPulse: number;
}

/** The snapshot shown before anything has been reported. */
export const QUIESCENT_SNAPSHOT: MachineSnapshot = Object.freeze({
  live: false,
  quiescentReason: "No runtime — connect hardware or enable the browser engine",
  clock: Object.freeze({ state: "stopped", phase: 0, timeSeconds: 0 }),
  rows: Object.freeze([]) as unknown as MachineProgramRow[],
  evalPulse: 0,
}) as MachineSnapshot;

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

/** Canonical output ordering: analog, then digital, then serial, then q. */
const OUTPUT_FAMILY_ORDER = ["a", "d", "s", "q"];

export function compareOutputNames(a: string, b: string): number {
  const famA = OUTPUT_FAMILY_ORDER.indexOf(a[0]);
  const famB = OUTPUT_FAMILY_ORDER.indexOf(b[0]);
  if (famA !== famB) {
    // Unknown families sort last, in name order.
    if (famA === -1) return 1;
    if (famB === -1) return -1;
    return famA - famB;
  }
  const numA = Number.parseInt(a.slice(1), 10);
  const numB = Number.parseInt(b.slice(1), 10);
  if (Number.isFinite(numA) && Number.isFinite(numB) && numA !== numB) {
    return numA - numB;
  }
  return a.localeCompare(b);
}

/** Minimal read view of a rolling sample buffer (`src/lib/PastBuffer.ts`). */
export interface SampleWindow {
  readonly length: number;
  valueAt(index: number): number;
  timeAt(index: number): number;
}

/**
 * Reduce a rolling buffer to at most `maxPoints` values in 0..1, oldest
 * first. Returns `[]` for an empty buffer — an empty spark draws nothing,
 * which is the honest rendering of "no samples reported".
 *
 * Normalisation is min/max over the window with a floor on the range, so a
 * constant output draws a flat line at mid-height rather than exploding.
 */
export function sparkFromWindow(
  window: SampleWindow | null | undefined,
  maxPoints = 24,
): number[] {
  if (!window || window.length === 0) return [];
  const total = window.length;
  const count = Math.min(maxPoints, total);
  const raw: number[] = [];
  for (let i = 0; i < count; i++) {
    // Evenly spaced across the window, always including the newest sample.
    const index =
      count === 1 ? total - 1 : Math.round((i / (count - 1)) * (total - 1));
    const value = window.valueAt(index);
    raw.push(Number.isFinite(value) ? value : 0);
  }

  let min = Infinity;
  let max = -Infinity;
  for (const v of raw) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (!(range > 1e-9)) {
    // Constant (or single-sample) window — draw it centred.
    return raw.map(() => 0.5);
  }
  return raw.map((v) => (v - min) / range);
}

/** Build an SVG polyline `points` attribute from a normalised spark. */
export function sparkPoints(
  spark: readonly number[],
  width: number,
  height: number,
): string {
  if (spark.length === 0) return "";
  if (spark.length === 1) {
    const y = height - spark[0] * height;
    return `0,${y.toFixed(2)} ${width.toFixed(2)},${y.toFixed(2)}`;
  }
  return spark
    .map((v, i) => {
      const x = (i / (spark.length - 1)) * width;
      const y = height - v * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export interface DeriveRowsInput {
  /** `visStore.expressions` — outputs registered for visualisation. */
  expressions: Record<string, { expressionText: string; color: string | null }>;
  /** `outputHealth` — per-output health projected from active diagnostics. */
  health: Record<string, { health: OutputHealth; message?: string }>;
  /** Rolling sample window per output, or null when none has been reported. */
  sampleWindowFor: (output: string) => SampleWindow | null;
  /** Maximum spark points per jack. */
  maxSparkPoints?: number;
}

/**
 * One row per *active* output, where "active" means the app has told us
 * something real about it: it is registered with the visualisation store, or
 * it has a health entry that is not `idle`.
 *
 * An output that is merely `idle` with no registered expression is not a row
 * — drawing one would be inventing activity.
 */
export function deriveRows(input: DeriveRowsInput): MachineProgramRow[] {
  const names = new Set<string>();
  for (const name of Object.keys(input.expressions)) names.add(name);
  for (const [name, entry] of Object.entries(input.health)) {
    if (entry.health !== "idle") names.add(name);
  }

  return [...names].sort(compareOutputNames).map((output) => {
    const expr = input.expressions[output];
    const health = input.health[output];
    return {
      output,
      expressionText: expr?.expressionText ?? null,
      state: health?.health ?? "idle",
      message: health?.message,
      colour: expr?.color ?? null,
      spark: sparkFromWindow(
        input.sampleWindowFor(output),
        input.maxSparkPoints,
      ),
    };
  });
}

/** True when the row is running its last-known-good program (LKG). */
export function isHoldingLastGood(row: MachineProgramRow): boolean {
  return row.state === "fallback";
}

/** User-facing label for a row state. */
export function rowStateLabel(state: MachineRowState): string {
  switch (state) {
    case "running":
      return "running";
    case "fallback":
      return "holding last good";
    case "error":
      return "stopped";
    case "idle":
      return "idle";
  }
}

/**
 * Clock hand angle in degrees for a bar phase in 0..1, measured clockwise
 * from twelve o'clock.
 */
export function phaseAngleDegrees(phase: number): number {
  if (!Number.isFinite(phase)) return 0;
  const wrapped = ((phase % 1) + 1) % 1;
  return wrapped * 360;
}
