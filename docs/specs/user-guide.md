# User Guide Spec

Design specification for the unified uSEQ Perform user guide. This replaces the current fragmented system (beginner/advanced markdown guides + separate lessons tab) with a single, progressive, interactive document.

## Status

**Draft specification** — not yet implemented. This document describes the target architecture, content structure, interaction design, and implementation plan.

---

## Design Principles

### 1. One guide, one path

No beginner/advanced split. No separate "lessons" tab. One scrollable, progressive document that takes a user from plugging in the USB cable to composing polyrhythmic sequences. Every concept appears exactly once, in the right place.

### 2. Every code block is a playground

No read-only code. Every example is an editable CodeMirror editor with a probe oscilloscope alongside it. Users can tweak values immediately and see the signal change. Every playground is draggable into the main editor.

### 3. Show, don't tell

The probe oscilloscope is the primary teaching tool, not the prose. Waveforms make abstract algebra visceral. Where possible, the guide should present two probes side-by-side to show before/after or component/composite relationships.

### 4. Progressive disclosure

The guide is a single document but not a wall of text. Each chapter has a visible summary. Deep-dive sections (the algebraic "why") are collapsible — visible to curious users, hidden from those who just want to patch. The default state shows enough to be useful; expanding shows the full theory.

### 5. Signal comes last — and we say so

The "last argument is the signal" convention is called out early and reinforced throughout. Code examples are written to highlight the wrapping/layering pattern. This is ModuLisp's key ergonomic insight and users need to internalise it.

### 6. Algebra before API

The guide teaches *operations* (multiply, add, compare, threshold) before *functions* (sqr, euclid, interp). Once users understand that multiplication is a VCA, they can use any function — they don't need a catalogue. The reference tab exists for lookup; the guide teaches thinking.

### 7. Hardware grounds the theory

Every algebraic concept is immediately connected to a physical patching scenario. "Multiplication is a VCA" isn't just math — it's "patch d1 into your envelope generator's gate input and hear this." The guide alternates between theory and application.

### 8. Show all arities

Many ModuLisp functions accept optional arguments (`euclid` with/without offset and pulse width, `tri` with/without duty, `random` with/without range). The guide should introduce the simplest arity first, then show the extended forms as a natural "and you can also..." progression. This prevents users from getting stuck using only the basic form when a convenient shortcut exists.

---

## Content Structure

The guide is organised into chapters, grouped under two top-level domains:

- **Language** — ModuLisp: how to think with signals and algebra
- **Editor** — uSEQ Perform: how to use the tool, connect hardware, manage code

These domains appear as **inner tabs** or a **visual grouping** within the Guide tab, so users can orient themselves: "Am I learning the language or the tool?" The same Language/Editor distinction should be mirrored in the Reference tab (language functions vs editor shortcuts/settings).

Each chapter has:
- A **title** and **one-sentence summary** (always visible)
- **Sections** (collapsed by default) containing prose, playgrounds, and probes
- **Deep-dive blocks** (collapsible) for algebraic theory
- **"Try it" prompts** — guided experiments with specific instructions

### Onboarding Banner (not part of the guide)

A dismissible inline banner positioned near the Connect button in the main editor toolbar. Content:

> **Welcome to uSEQ!** Connect your module via USB, or use the built-in virtual interpreter to explore without hardware. [Connect] [Dismiss]

- Appears on first visit and whenever no connection is detected (unless dismissed)
- Dismissal persists to localStorage
- Not part of the guide — it's part of the main editor UI

---

### Chapter 1: The Language `[Language]`

> ModuLisp has one rule: everything is a list, function first.

**Sections:**

1.1 **Why Parentheses?**
- The one rule: `(function arg1 arg2 ...)`
- Comparison with conventional notation: `1 + 2` vs `(+ 1 2)`
- Why prefix is better for music: no precedence, effortless nesting
- Playground: `(+ 1 2)` → result in console
- Playground: `(* 0.5 (+ 1 2))` → nested evaluation
- Vectors for data: `[1 0.5 0 0.8]` — square brackets hold data, parentheses run code

1.2 **Naming Things**
- `def` binds a name to a value: `(def speed 4)`
- Use names anywhere: `(d1 (sqr (fast speed bar)))`
- Names make code readable and changeable
- Playground with def + use

1.3 **Outputs and Inputs**
- Output functions: `a1`–`a3` (CV, continuous 0–1), `d1`–`d3` (pulse, binary 0/1)
- Input functions: `ain1`, `ain2` (CV inputs), `swm` (momentary switch), `swt` (toggle switch, returns -1/0/1)
- Playground: `(a1 ain1)` — echo CV input to output
- Playground: `(d1 swm)` — momentary switch controls gate

1.4 **The Last Argument Convention**
- In ModuLisp, the signal you're transforming is the last argument
- This means you wrap operations around a signal like layers of an onion
- `(fast 4 bar)` — take bar, make it fast
- `(scale 0 1 0.2 0.8 (sin bar))` — take sin of bar, scale it
- `(fast 4 (shift 0.25 bar))` — take bar, shift it, then make it fast
- Read inside-out: innermost is the raw signal, outermost is the final transform

1.5 **Structural Editing** *(cross-domain: Editor skill taught in Language context)*
- The editor understands code structure — parentheses always stay balanced
- Slurp forward (`Ctrl-]`): pull next form into current list
- Barf forward (`Ctrl-'`): push last form out of current list
- Slurp backward (`Ctrl-[`): pull previous form into current list
- Barf backward (`Ctrl-;`): push first form out of current list
- Unwrap (`Alt-s`): remove surrounding parentheses
- Kill (`Ctrl-k`): delete to end of current list
- Each command gets an interactive playground with a starting state and "try it" prompt

1.6 **Tempo and Timing**
- Playground: `(set-bpm 120)`
- What BPM controls: the speed of `beat`, and therefore `bar`, `phrase`, `section`
- Playground: `(set-time-sig 4 4)` — what time signature means here (beats per bar)
- External clock: `(set-clock-ext 1 1)` — sync to gate input 1 with divisor 1 (one pulse per beat). `(set-clock-ext 2 4)` syncs to gate input 2 with a divisor of 4
- Reset: `(reset-clock-int)` / `(reset-clock-ext)`
- Your first signal: `(d1 (sqr bar))` — a square wave that cycles once per bar
- Playground with probe showing the square wave

---

### Chapter 2: Signals as Algebra `[Language]`

> Everything is built from one ramp and four arithmetic operations.

This is the conceptual heart of the guide. Each section follows the pattern: analogy → playground → probe → deep-dive (collapsible).

**Sections:**

2.1 **The Phasor**
- `bar` is a ramp from 0 to 1 that repeats. That's it.
- `beat`, `bar`, `phrase`, `section` are all phasors at different speeds
- `sqr`, `sin`, `tri`, `saw` are just different ways of reshaping the ramp
- `saw` is literally the identity function — it returns the phasor unchanged
- `fast` and `slow` change the speed: `(fast 4 bar)` = four ramps per bar
- Playgrounds: raw bar, fast 4 bar, sin bar, tri bar (each with probe)

  > **Deep dive: What is a phasor?**
  > A phasor is a number that increases linearly from 0 to 1 and wraps. Every repeating signal in ModuLisp is derived from a phasor by applying a shaping function. The waveform generators (sin, sqr, tri) take a phasor as input and return a value between 0 and 1. This is why `fast` works: it just multiplies the phasor before the shaper sees it. `(fast 2 bar)` is `(% (* 2 bar) 1)` — the ramp goes twice as fast because we multiplied time.

2.2 **Multiplication is a Volume Knob**
- Multiply by 0–1 to control amplitude (VCA)
- Multiply by another signal = modulation (tremolo, AM, gating)
- Playground: `(* 0.5 (sin bar))` vs `(sin bar)` (with both in the probe)
- Playground: `(* (sin (fast 8 bar)) (tri bar))` — tremolo
- The number can be replaced by any signal — that's what modulation *is*

  > **Deep dive: Multiplication as amplitude control**
  > In a eurorack system, a VCA takes a signal input and a CV input. The output is the signal multiplied by the CV. In ModuLisp, `(* cv signal)` is a VCA. When cv is 0, the output is 0 (silence). When cv is 1, the output passes through unchanged. When cv oscillates, you get tremolo or amplitude modulation. Ring modulation is just two signals multiplied together with no DC offset.

2.3 **Addition is Mixing**
- Add two signals = they play simultaneously (mixer)
- Add a constant = DC offset (bias a signal into a range)
- Scale each input before adding to control the mix
- Playground: 50/50 mix of two sines
- Playground: offset sine to 0.5 ± 0.25
- `scale` is just multiplication + addition: maps one range to another

  > **Deep dive: Scale and range mapping**
  > `(scale inMin inMax outMin outMax signal)` maps a signal from one range to another. Under the hood it's `outMin + (signal - inMin) * (outMax - outMin) / (inMax - inMin)`. The signal comes last so you can wrap `scale` around any expression.

2.4 **Comparison: Turning Continuous into Discrete**
- `>`, `<`, `>=` turn a smooth signal into a gate (0 or 1)
- Same sine, different thresholds = different rhythms
- Moving threshold = evolving rhythm
- Playground: `(d1 (> (sin bar) 0.3))` with sine + threshold in probe

2.5 **Inversion and Complement**
- `(- 1 x)` flips a signal (musical inversion)
- Complement of a rhythm = the rests become hits
- Two complementary patterns = interlocking call-and-response

2.6 **Staircase Voltages**
- `floor` turns a ramp into discrete steps (sample-and-hold)
- Multiply phasor by N, floor, divide by N = N-step staircase
- `from-list` / `seq` is floor + lookup under the hood
- Playground: 4-step staircase vs raw ramp (both in probe)

2.7 **The Zero Window Trick**
- 0 × anything = 0, 1 × anything = itself
- Square wave = gate that opens and closes
- Non-overlapping windows: play different signals in each time slot, sum them
- This is how algebra becomes a sequencer
- Playground: gated sine, then two-part sequence

  > **Deep dive: Arbitrary sequencing from algebra**
  > Any sequence of N different expressions can be built by: (1) creating N non-overlapping window functions that are 1 during their slot and 0 elsewhere, (2) multiplying each expression by its window, (3) summing. The `from-list` function does this internally, but the explicit version reveals the mechanism — and once you see it, you can build windows of any shape, not just equal-width time slots.

2.8 **Phase Shifting**
- `shift` moves when a pattern happens within its cycle
- Same pattern at different offsets = canon / round
- Three offset copies = interlocking rhythms from one source
- Swing and shuffle are small phase offsets

2.9 **Modulo and Polyrhythm**
- `%` divides time into equal slices (reveals what `fast` does internally)
- Non-integer divisions create polyrhythm (3-against-4)
- Playground: 4-pulse and 3-pulse overlaid in probe

---

### Chapter 3: Modulation and Expression `[Language]`

> Replace any number with a signal and you've invented modulation.

**Sections:**

3.1 **Signals Controlling Signals**
- Anywhere you write a number, you can write a signal
- This is the modular synthesis insight: nesting = patching
- Speed controlled by LFO = accelerating rhythms
- Pulse width controlled by sine = PWM
- Playground: fixed speed vs LFO-controlled speed

3.2 **Building Envelopes**
- `(- 1 bar)` = decay envelope
- Triangle = attack-release envelope (duty controls ratio)
- Multiply oscillator × envelope × gate = rhythmic plucks
- Squaring a decay curves it (exponential)
- Playground: decay, AR, plucks (each with probe)

3.3 **Crossfading**
- `if` = hard switch between two signals
- Multiplication blend: `(+ (* x sigA) (* (- 1 x) sigB))`
- Bar as crossfade position: morph over time
- Playground: hard switch vs smooth crossfade

3.4 **Interpolation**
- `interp` connects control points with straight lines
- Custom voltage contours: melodies, modulation curves, envelope shapes
- Combine with `fast` to repeat, `scale` to fit range
- Playground: 5-point contour, repeated + scaled

---

### Chapter 4: Rhythm and Composition `[Language]`

> Rhythms are just functions that return 0 or 1.

**Sections:**

4.1 **Euclidean Rhythms**
- `euclid` distributes K hits evenly across N steps
- Basic: `(euclid 3 8 bar)` — 3 hits in 8 steps
- With offset and pulse width: `(euclid 3 8 2 0.3 bar)` — offset by 2 steps, 30% pulse width
- Playground: `(euclid 3 8 bar)`, `(euclid 5 8 bar)`, `(euclid 7 16 bar)`
- Classic patterns: 3/8, 5/8, 7/16
- Show how offset creates canons from the same euclidean pattern

4.2 **Boolean Rhythm Algebra**
- AND (multiply two gate signals): both must hit
- OR (min 1 of sum): either hits
- XOR (abs of difference): one but not both
- Three different rhythms from two Euclidean sources
- Playground with all five patterns overlaid in probe

4.3 **Sequencing with from-list, gates, and trigs**
- `from-list` reads values by phasor position: `(from-list [0.2 0.5 0.8] bar)`
- 3-arity form scales output: `(from-list [0.2 0.5 0.8] 5 bar)` — values scaled by 5
- `gates` for gate sequences with pulse width: `(gates [1 0 1 1 0 1 0 1] bar)` (3-arity) or `(gates [1 0 1 1] 0.3 bar)` (with explicit pulse width)
- `trigs` for trigger sequences with amplitude (0–9): `(trigs [9 0 5 0 7 0 3 0] bar)` — amplitude encodes velocity
- Show `gates` vs `trigs` vs `from-list` side-by-side with probes to clarify when to use each

4.4 **Using External Inputs**
- `ain1` / `ain2`: read CV inputs (with attenuverter explanation)
- Use CV to control speed, threshold, mix amount
- `swm`: momentary switch (1 while held, 0 otherwise)
- `swt`: toggle switch (returns -1, 0, or 1)
- `if` with switch for mode selection
- Playground: ain1 controlling speed, swm toggling patterns, swt selecting waveforms

4.5 **Layering**
- Complex patches are simple operations stacked
- Build up one layer at a time: phasor → shape → gate → envelope → mix
- Each layer wraps the previous one (last argument convention)
- Read code inside-out
- Playground: 4-layer build-up with probes showing each stage

---

### Chapter 5: Working with the Editor `[Editor]`

> Save your work, manage your patches, use the tools.

**Sections:**

5.1 **Saving and Loading**
- Browser auto-save (localStorage)
- Save/load to file
- Code snippets library (link to snippets tab)

5.2 **The Visualisation Panel**
- What it shows: registered output expressions sampled over time
- How to toggle it (Alt+G)
- Reading the display: analog vs digital channels, time window, current position
- Connection to the probes in this guide

5.3 **Evaluation Modes**
- Ctrl+Enter: evaluate immediately
- Alt+Enter: schedule for start of next bar (quantised)
- Ctrl+Shift+Enter: preview in WASM only (no send to module)

5.4 **Randomness**
- `random`: new value every beat (deterministic per beat). `(random)` for 0–1 float, `(random 10)` for 0–9 integer, `(random 3 7)` for range 3–6
- `random'`: new value every evaluation tick (truly volatile), same arity options
- Use `fast` / `slow` to control how often `random` changes: `(random (fast 4 bar))` changes 4x per bar
- Playground showing `random` vs `random'` side-by-side with probes

5.5 **Useful Functions Reference**
- Quick reference table of the most common functions, grouped by purpose
- Wave shapers: sin, sqr, tri, saw, pulse
- Sequencing: from-list, interp, euclid, gates, trigs
- Time: fast, slow, shift, bar, beat, phrase, section
- Math: +, -, *, /, %, floor, ceil, abs, min, max, scale
- Logic: if, >, <, >=, <=, =
- Inputs: ain1, ain2, swm, swt
- System: set-bpm, set-time-sig, set-clock-ext, set-clock-int, def
- "See the Reference tab for the complete function list"

---

## Interaction Design

### Playground Component

Each code example is rendered as a **playground** — a self-contained interactive unit:

```
┌─ annotation ──────────────────────────── ⠿ drag ─┐
│ ┌─ editor ─────────────────┐ ┌─ probe ─────────┐ │
│ │ (a1 (* 0.5 (sin bar)))   │ │ ~~~waveform~~~  │ │
│ │                          │ │                 │ │
│ └──────────────────────────┘ └─────────────────┘ │
└──────────────────────────────────────────────────┘
```

- **Editor** (left): Editable CodeMirror with clojure-mode syntax highlighting. Cursor hidden until clicked. Full structural editing support.
- **Probe** (right): MiniVis canvas showing the signal(s) this code produces. **Live-linked to editor content via the WASM interpreter** — as the user edits code, the probe re-evaluates through the WASM interpreter (debounced ~300ms) and updates the waveform. Falls back to static JS lambdas if WASM is not yet loaded.
- **Drag handle**: Entire playground is draggable. Dropping into the main editor inserts the code.
- **Annotation**: One-line description above the playground.

### Live Probe Architecture

Each playground maintains a small evaluation loop:

1. Editor content changes → debounce 300ms
2. Extract output expressions from code (parse for `(a1 ...)`, `(d1 ...)` etc.)
3. Evaluate each expression across 200 time points via `evalOutputAtTime()` from `wasmInterpreter.ts`
4. Feed sample arrays to MiniVis for rendering

**Fallback**: Each playground still declares static `VisSignal[]` lambdas as the initial/fallback display. These render immediately without waiting for WASM. Once WASM loads and the user edits, live signals replace the static ones.

**Error handling**: If WASM evaluation throws (syntax error, undefined symbol), the probe shows the last successful render with a subtle error indicator. The user can keep editing without the probe flashing on every keystroke.

### Deep-Dive Blocks

Collapsible sections marked with a distinct visual treatment:

```
▶ Deep dive: What is a phasor?
```

Clicking expands to show the full algebraic explanation. Default state is collapsed. Stays open once expanded (per session, not persisted).

### "Try It" Prompts

Inline callouts that suggest a specific experiment:

```
💡 Try changing 0.3 to 0.7 — watch how the gate gets shorter.
```

These appear between playgrounds, guiding the user's exploration. They reference specific numbers or parameters in the preceding playground.

### Section Collapse and Expand

Sections within each chapter are **collapsed by default**, showing only their title and a one-line summary. Users click to expand a section and reveal its prose, playgrounds, and deep-dives.

```
Chapter 3: Signals as Algebra
  ▶ 3.1 The Phasor — bar is a ramp from 0 to 1 that repeats
  ▼ 3.2 Multiplication is a Volume Knob — multiply to control amplitude
     [expanded content: prose, playgrounds, deep-dives...]
  ▶ 3.3 Addition is Mixing — add signals to play them simultaneously
  ...
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  [Expand All]
```

- Clicking a section header toggles it open/closed
- **"Expand All" / "Collapse All"** button at the top of each chapter
- Expanded state is session-only (not persisted to localStorage)
- Deep-dive blocks within an expanded section have their own independent collapse state

This keeps the document scannable — users see the full chapter outline at a glance and drill into whichever section they need, without being overwhelmed by a wall of content.

### Lazy Mounting

Playgrounds (CodeMirror editors + MiniVis canvases) are **only mounted when scrolled into view**, using `IntersectionObserver` with a **rootMargin buffer of 200px** (mounts slightly before entering viewport, unmounts after leaving). This means:

- Collapsed sections have zero mounted editors (nothing to observe)
- Expanding a section creates observer entries for its playgrounds
- Scrolling through an expanded chapter smoothly mounts/unmounts as needed
- Total mounted editors at any time: typically 3-5, never 30

### Chapter Navigation

- **Sticky chapter title** at the top of the scroll area showing current chapter
- **Table of contents** collapsible at the top (like a book's TOC)
- **Next chapter** button at the bottom of each chapter
- **Progress indicator** (subtle, e.g. "Chapter 3 of 6" in the title bar)

---

## Implementation Architecture

### Data Model

```typescript
type GuideDomain = "language" | "editor";

interface Chapter {
  id: string;
  title: string;
  summary: string;          // one-sentence, always visible
  domain: GuideDomain;      // "language" or "editor"
  sections: Section[];
}

interface Section {
  id: string;
  title: string;
  summary: string;          // one-line, shown when collapsed
  content: ContentBlock[];
}

type ContentBlock =
  | { type: "prose"; text: string }
  | { type: "playground"; playground: Playground }
  | { type: "deep-dive"; title: string; content: ContentBlock[] }
  | { type: "try-it"; text: string }
  | { type: "tip"; text: string }
  | { type: "reference-table"; rows: ReferenceRow[] };

interface Playground {
  code: string;
  annotation?: string;
  /** Static fallback signals — rendered immediately before WASM loads. */
  signals?: VisSignal[];
  /** Output names to extract for live WASM probing (e.g. ["a1", "d1"]). */
  outputs?: string[];
}

interface VisSignal {
  label: string;
  fn: (phase: number) => number;
  digital?: boolean;
}
```

### Component Hierarchy

```
GuideTab                    (replaces LessonsTab + UserGuideTab)
├── GuideTableOfContents    (collapsible, sticky)
│   ├── TOCEntry            (click to scroll, hover shows dismiss marker)
│   └── ExpandAll/CollapseAll
├── DomainDivider           (visual section break: "━━ LANGUAGE ━━" / "━━ EDITOR ━━")
├── GuideChapter            (one per chapter, in domain groups)
│   ├── ChapterHeader       (title + summary + "Expand All" button)
│   ├── GuideSection        (collapsed by default, expandable)
│   │   ├── SectionHeader   (title + summary, click to expand)
│   │   ├── Prose           (parsed markdown-ish text)
│   │   ├── Playground      (editor + live probe + drag, lazy-mounted)
│   │   │   ├── CodeEditor  (editable CodeMirror, Ctrl+Enter sends to module)
│   │   │   └── LiveProbe   (WASM eval → MiniVis, debounced 300ms)
│   │   ├── DeepDive        (collapsible block, independent state)
│   │   ├── TryIt           (inline callout)
│   │   └── ReferenceTable  (compact function table)
│   └── NextChapter         (navigation to next)
└── GuideProgress           (chapter N of M indicator)
```

### TOC Interaction

The table of contents is always visible (sticky at the top of the guide scroll area). Each entry has:
- **Click** → smooth-scroll to the section
- **Hover** → shows a small dismiss/mark-done icon
- **Click dismiss icon** → section entry greys out and moves toward the bottom of the TOC
- Dismissed state persisted to localStorage
- Dismissed sections remain accessible (still in the document, just de-emphasised in TOC)

### What Gets Replaced

| Current                     | New                                    |
|-----------------------------|----------------------------------------|
| `LessonsTab`                | `GuideTab`                             |
| `LessonView`                | `GuideSection`                         |
| `lessonData.ts`             | `guideData.ts`                         |
| `MiniVis`                   | `MiniVis` (reused) + `LiveProbe` (new) |
| `UserGuideTab`              | Deleted                                |
| `UserGuideContent`          | Deleted                                |
| `ExperienceLevelSelector`   | Deleted                                |
| `userguide_beginner.md`     | Deleted                                |
| `userguide_advanced.md`     | Deleted                                |
| `helpContentPreloader.ts`   | Simplified (no guide HTML)             |
| `KeybindingsTab`            | Content → Reference > Editor sub-tab   |
| `HelpPanel` tabs            | Guide \| Reference \| Snippets         |
| (none)                      | Onboarding banner (new, in toolbar)    |
| (none)                      | Starter snippets data (new)            |

### HelpPanel Tabs (After)

```
Guide | Reference | Snippets
```

Each of Guide and Reference has an inner **Language / Editor** domain grouping (either as inner tabs or as a visual section split). This gives users a consistent mental model: "Am I looking up something about the language or the tool?"

- **Guide > Language**: Chapters 2–5 (syntax, algebra, modulation, rhythm)
- **Guide > Editor**: Chapters 1 and 6 (getting started, editor tools)
- **Reference > Language**: Function reference (current ModuLispReferenceTab)
- **Reference > Editor**: Keyboard shortcuts (current KeybindingsTab content), settings reference

The standalone Keybindings tab is removed. Its content moves into Reference > Editor and is also taught in-context in Guide > Editor (structural editing in Chapter 2.5, eval modes in Chapter 6.3).

### CSS

The existing `lessons.css` is extended to cover the new block types (deep-dive, try-it, reference-table, chapter navigation). The `userguide.css` file is deleted. Playground styling reuses the existing `.lesson-example` pattern.

---

## Content Migration Plan

### From current lessons → guide chapters

| Current Lesson                | Target Location          |
|-------------------------------|--------------------------|
| "Why the Parentheses?"        | Chapter 1, Section 1.1   |
| "Structural Editing"          | Chapter 1, Section 1.5   |
| "The Phasor"                  | Chapter 2, Section 2.1   |
| "Multiplication is a VCA"     | Chapter 2, Section 2.2   |
| "Addition is Mixing"          | Chapter 2, Section 2.3   |
| "Comparison"                  | Chapter 2, Section 2.4   |
| "Inversion and Complement"    | Chapter 2, Section 2.5   |
| "Staircase Voltages"          | Chapter 2, Section 2.6   |
| "Zero Window Trick"           | Chapter 2, Section 2.7   |
| "Phase as Memory"             | Chapter 2, Section 2.8   |
| "Modulo: Patterns"            | Chapter 2, Section 2.9   |
| "Signals as Knobs"            | Chapter 3, Section 3.1   |
| "Envelopes"                   | Chapter 3, Section 3.2   |
| "Crossfading"                 | Chapter 3, Section 3.3   |
| "Interp: Drawing Shapes"      | Chapter 3, Section 3.4   |
| "Boolean Rhythm Algebra"      | Chapter 4, Section 4.2   |
| "Layering"                    | Chapter 4, Section 4.5   |

### New content needed

| Section                       | Source                           |
|-------------------------------|----------------------------------|
| Onboarding banner             | New (inline near Connect button) |
| 1.2 Naming Things             | Extracted from current lessons   |
| 1.3 Outputs and Inputs        | Advanced guide + reference data  |
| 1.4 Last Argument Convention  | Extracted from current lessons   |
| 1.6 Tempo and Timing          | New (from reference data)        |
| 4.1 Euclidean Rhythms         | Advanced guide (rewrite + probe) |
| 4.3 Sequencing                | New (from reference data)        |
| 4.4 Using External Inputs     | Advanced guide (rewrite + probe) |
| 5.1–5.5 Editor/Tools          | Beginner guide + new content     |
| All deep-dive blocks          | New                              |
| All try-it prompts            | New                              |
| Starter snippets (~10)        | New (all four categories)        |
| Reference > Editor sub-tab    | Migrate from KeybindingsTab      |

---

## Resolved Decisions

1. **Probes are live via WASM.** Playgrounds evaluate code through the WASM interpreter as the user edits (debounced 300ms). Static JS lambdas serve as immediate fallback before WASM loads and as the initial render.

2. **WASM loads eagerly at app startup** (non-blocking). If the user opens the help panel before WASM is ready, probes show a subtle "loading interpreter..." indicator. Once loaded, probes go live immediately.

3. **Sections collapsed by default, lazy-mount on scroll.** Sections show title + summary when collapsed. Expanding reveals content. Playgrounds mount via `IntersectionObserver` with 200px rootMargin buffer. "Expand All" / "Collapse All" per chapter. Typically 3-5 editors mounted at any time.

4. **Deep-dive state is session-only.** Not persisted. Resets on tab change.

5. **Keybindings tab removed.** Content moves to Reference > Editor (as a shortcut lookup) and is taught in-context in Guide chapters 2 and 6.

6. **Starter snippets ship.** All four categories: rhythm patterns, modulation shapes, melodic sequences, and interactive patches. ~8-10 snippets total, tagged by category.

7. **Guide domain split: visual sections** (not inner tabs). Language and Editor chapters appear in one scroll, separated by prominent section dividers. Flatter hierarchy than tabs-within-tabs.

8. **Reference tab gets inner tabs**: Language (function reference) | Editor (keybindings, settings). Mirrors the guide's domain split but with actual tabs since Reference is lookup-oriented.

9. **Chapter 1 (Getting Started) removed.** Connection is handled by a separate onboarding banner. Hardware reference (outputs, inputs, controls) moves into Chapter 2.3 (Outputs and Inputs) and Chapter 5.4 (Using External Inputs). The guide opens directly with language content.

10. **Onboarding is an inline banner** next to the Connect button, not a modal or guide chapter. Banner explains: connect via USB, or use the built-in virtual interpreter if you don't have hardware. Dismissible, reappears if no connection detected.

11. **Playground eval is full** — Ctrl+Enter in a playground works exactly like the main editor (sends to WASM and to connected module). No sandboxing.

12. **TOC with interactive progress.** Table of contents shows all chapters/sections with click navigation. On hover, a dismiss marker appears on each entry. Clicking it greys out the entry and moves it toward the bottom of the TOC. Dismissed state persisted to localStorage.

## Open Questions

1. **Live probe performance budget.** Evaluating 200 time-points per output through WASM on every keystroke (even debounced) could be heavy with complex expressions. Need to profile and set a timeout — if evaluation takes >50ms, skip the update and show a "complex expression" indicator.

2. **Starter snippet content.** Exact code and tags for the ~10 starter snippets need writing. Should align with guide chapters so users recognise patterns they learned.

3. **Onboarding banner persistence.** Should the banner reappear on every session without a connection, or only on first visit? If the user dismisses it, when does it come back?
