/**
 * Data model for the unified user guide.
 * See docs/USER_GUIDE_SPEC.md for full specification.
 */

// ---------------------------------------------------------------------------
// Domain
// ---------------------------------------------------------------------------

/** Top-level grouping: language (ModuLisp) vs editor (uSEQ Perform tool). */
export type GuideDomain = "language" | "editor";

// ---------------------------------------------------------------------------
// Signal visualisation (shared with MiniVis)
// ---------------------------------------------------------------------------

/** A signal function for the probe oscilloscope. */
export interface VisSignal {
  /** Label shown in the probe legend (e.g. "a1", "d1: >0.3"). */
  label: string;
  /** Pure function: phase (0→1 over one bar) → value (0→1). */
  fn: (phase: number) => number;
  /** If true, rendered as a binary gate in a horizontal lane. */
  digital?: boolean;
  /**
   * Output channel this signal belongs to (e.g. "a1", "d2").
   * Determines the color via the gutter rail color system.
   * If omitted, falls back to matching from the label or using
   * the default palette.
   */
  channel?: string;
}

// ---------------------------------------------------------------------------
// Playground
// ---------------------------------------------------------------------------

/** An interactive code example with editor + probe. */
export interface Playground {
  /** ModuLisp source shown in the editor. */
  code: string;
  /** One-line description displayed above the editor. */
  annotation?: string;
  /** Static fallback signals — rendered immediately before WASM loads. */
  signals?: VisSignal[];
  /**
   * Output names to extract for live WASM probing (e.g. ["a1", "d1"]).
   * When set, the LiveProbe evaluates these outputs through the WASM
   * interpreter as the user edits code.
   */
  outputs?: string[];
  /**
   * How many bars the probe x-axis should span.  Defaults to 1.
   * Use 2 for examples with `(fast 2 bar)` to show a full cycle,
   * 4 for `(slow 4 bar)` or phrase-level signals, etc.
   * The static `signals` lambdas receive phase in 0→1 regardless;
   * for multi-bar windows phase 0→1 maps to 0→bars.
   */
  bars?: number;
}

// ---------------------------------------------------------------------------
// Content blocks
// ---------------------------------------------------------------------------

export interface ProseBlock {
  type: "prose";
  /** Text with backtick `code` spans and *italic* spans. */
  text: string;
}

export interface PlaygroundBlock {
  type: "playground";
  playground: Playground;
}

export interface DeepDiveBlock {
  type: "deep-dive";
  /** Title shown on the collapsed header (e.g. "What is a phasor?"). */
  title: string;
  /** Content revealed when expanded. */
  content: ContentBlock[];
}

export interface TryItBlock {
  type: "try-it";
  /** Prompt text suggesting a specific experiment. */
  text: string;
}

export interface TipBlock {
  type: "tip";
  /** Informational note text. */
  text: string;
}

export interface ReferenceRow {
  /** Function or operator name. */
  name: string;
  /** Brief signature or usage pattern. */
  signature: string;
  /** One-line description. */
  description: string;
}

export interface ReferenceTableBlock {
  type: "reference-table";
  rows: ReferenceRow[];
}

/** Union of all content block types that can appear inside a section. */
export type ContentBlock =
  | ProseBlock
  | PlaygroundBlock
  | DeepDiveBlock
  | TryItBlock
  | TipBlock
  | ReferenceTableBlock;

// ---------------------------------------------------------------------------
// Section & Chapter
// ---------------------------------------------------------------------------

/** A section within a chapter — collapsed by default, expandable. */
export interface Section {
  /** Unique identifier (e.g. "phasor", "multiplication"). */
  id: string;
  /** Section title (e.g. "The Phasor"). */
  title: string;
  /** One-line summary shown when collapsed. */
  summary: string;
  /** Content blocks rendered when expanded. */
  content: ContentBlock[];
}

/** A chapter groups related sections under a domain. */
export interface Chapter {
  /** Unique identifier (e.g. "language", "algebra"). */
  id: string;
  /** Chapter title (e.g. "Signals as Algebra"). */
  title: string;
  /** One-sentence summary, always visible. */
  summary: string;
  /** Which domain this chapter belongs to. */
  domain: GuideDomain;
  /** Sections within this chapter. */
  sections: Section[];
}
