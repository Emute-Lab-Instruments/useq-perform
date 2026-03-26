/**
 * Chapter 4: Rhythm and Composition
 *
 * Covers Euclidean rhythms, boolean rhythm algebra, step sequencing
 * (from-list, gates, trigs), external inputs, and layering.
 *
 * Migrates content from the "boolean-rhythm" and "layering" lessons
 * in lessonData.ts.
 */

import type { Chapter, VisSignal } from "../guideTypes";

// ---------------------------------------------------------------------------
// DSP helpers — small building blocks used in static signal lambdas
// ---------------------------------------------------------------------------

/** Fractional part, always positive. Maps any number into 0-1. */
const frac = (x: number): number => ((x % 1) + 1) % 1;

/** Unipolar sine: phasor 0-1 -> one full sine cycle mapped to 0-1. */
const usin = (p: number): number =>
  0.5 + 0.5 * Math.sin(2 * Math.PI * p);

/** Square wave: phasor -> 0 or 1 (50% duty). */
const usqr = (p: number): number => (frac(p) < 0.5 ? 1 : 0);

/** Triangle wave: phasor -> 0-1-0. */
const utri = (p: number): number => {
  const f = frac(p);
  return f < 0.5 ? f * 2 : 2 - f * 2;
};

/** fast(n, phase): speed up by factor n. */
const fast = (n: number, p: number): number => frac(p * n);

/** shift(offset, phase): phase-shift a phasor. */
const shift = (offset: number, p: number): number => frac(p + offset);

/** scale(value, inMin, inMax, outMin, outMax). */
const scale = (
  v: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number => outMin + ((v - inMin) / (inMax - inMin)) * (outMax - outMin);

/** Euclidean rhythm: k hits spread across n steps. */
const euclid = (k: number, n: number, p: number): number => {
  const step = Math.floor(frac(p) * n);
  return Math.floor(((step + 1) * k) / n) - Math.floor((step * k) / n) > 0
    ? 1
    : 0;
};

/** Euclidean rhythm with offset. */
const euclidOff = (
  k: number,
  n: number,
  off: number,
  p: number,
): number => {
  const step = ((Math.floor(frac(p) * n) - off) % n + n) % n;
  return Math.floor(((step + 1) * k) / n) - Math.floor((step * k) / n) > 0
    ? 1
    : 0;
};

/** Simple from-list: pick item by phasor position. */
const fromList = (list: number[], p: number): number => {
  const idx = Math.min(Math.floor(frac(p) * list.length), list.length - 1);
  return list[idx];
};

/** Gates: gate sequence with pulse width. */
const gates = (list: number[], pw: number, p: number): number => {
  const n = list.length;
  const pos = frac(p) * n;
  const idx = Math.min(Math.floor(pos), n - 1);
  const within = pos - idx;
  return list[idx] && within < pw ? 1 : 0;
};

/** Trigs: trigger sequence with amplitude (0-9 mapped to 0-1). */
const trigs = (list: number[], pw: number, p: number): number => {
  const n = list.length;
  const pos = frac(p) * n;
  const idx = Math.min(Math.floor(pos), n - 1);
  const within = pos - idx;
  return within < pw ? list[idx] / 9 : 0;
};

// ---------------------------------------------------------------------------
// Chapter 4
// ---------------------------------------------------------------------------

export const chapter4: Chapter = {
  id: "rhythm",
  title: "Rhythm and Composition",
  summary: "Rhythms are just functions that return 0 or 1.",
  domain: "language",
  sections: [
    // -----------------------------------------------------------------
    // 4.1 Euclidean Rhythms
    // -----------------------------------------------------------------
    {
      id: "euclidean",
      title: "Euclidean Rhythms",
      summary: "euclid distributes K hits evenly across N steps",
      content: [
        {
          type: "prose",
          text: "The `euclid` function is one of the most musical tools in ModuLisp. Given a number of hits K and a number of steps N, it distributes the hits as evenly as possible across the steps. The result is a gate signal: 1 where a hit falls, 0 elsewhere.",
        },
        {
          type: "playground",
          playground: {
            code: ";; 3 hits in 8 steps\n(d1 (euclid 3 8 bar))",
            annotation: "The classic tresillo rhythm: 3 hits across 8 steps",
            signals: [
              { label: "d1: euclid(3,8)", channel: "d1", fn: (p) => euclid(3, 8, p), digital: true },
            ],
            outputs: ["d1"],
          },
        },
        {
          type: "try-it",
          text: "Change the 3 to 5 — you get a Cuban cinquillo. Try 7 hits in 8 steps for an almost-full pattern with one gap.",
        },
        {
          type: "prose",
          text: "Different K/N combinations produce rhythms from many musical traditions. `(euclid 5 8 bar)` is the Cuban cinquillo. `(euclid 7 16 bar)` produces a dense West African bell pattern. All from the same function, just different numbers.",
        },
        {
          type: "playground",
          playground: {
            code: ";; classic patterns side by side\n(d1 (euclid 3 8 bar))\n(d2 (euclid 5 8 bar))\n(d3 (euclid 7 16 bar))",
            annotation: "Three classic Euclidean rhythms",
            signals: [
              { label: "d1: 3/8", channel: "d1", fn: (p) => euclid(3, 8, p), digital: true },
              { label: "d2: 5/8", channel: "d2", fn: (p) => euclid(5, 8, p), digital: true },
              { label: "d3: 7/16", channel: "d3", fn: (p) => euclid(7, 16, p), digital: true },
            ],
            outputs: ["d1", "d2", "d3"],
          },
        },
        {
          type: "prose",
          text: "`euclid` also accepts optional offset and pulse width arguments. The 5-arity form `(euclid K N offset pulseWidth phasor)` rotates the pattern by *offset* steps and sets the gate width. This lets you create canons from a single Euclidean pattern — same hits, different starting positions.",
        },
        {
          type: "playground",
          playground: {
            code: ";; same pattern, offset by 2 steps, 30% pulse width\n(d1 (euclid 3 8 bar))\n(d2 (euclid 3 8 2 0.3 bar))",
            annotation: "Offset creates a canon from the same pattern",
            signals: [
              { label: "d1: euclid(3,8)", channel: "d1", fn: (p) => euclid(3, 8, p), digital: true },
              {
                label: "d2: offset 2",
                channel: "d2",
                fn: (p) => euclidOff(3, 8, 2, p),
                digital: true,
              },
            ],
            outputs: ["d1", "d2"],
          },
        },
        {
          type: "try-it",
          text: "Try different offset values (0 through 7) and listen to how the same rhythm shifts against itself. Offset 4 on a 3/8 pattern creates a tight interlock.",
        },
        {
          type: "deep-dive",
          title: "The Bjorklund algorithm",
          content: [
            {
              type: "prose",
              text: "Euclidean rhythms are generated by the Bjorklund algorithm, originally developed for neutron accelerator timing at Los Alamos. Godfried Toussaint connected it to world music, showing that the \"maximally even\" distribution of K among N produces rhythms found across African, Middle Eastern, and Latin American traditions. The algorithm is equivalent to computing the Euclidean GCD — hence the name. For each step, it checks whether `floor((step+1)*K/N)` differs from `floor(step*K/N)`. If so, that step gets a hit.",
            },
          ],
        },
      ],
    },

    // -----------------------------------------------------------------
    // 4.2 Boolean Rhythm Algebra
    // -----------------------------------------------------------------
    {
      id: "boolean-rhythm",
      title: "Boolean Rhythm Algebra",
      summary: "AND, OR, XOR on rhythms using multiplication, addition, subtraction",
      content: [
        {
          type: "prose",
          text: "Boolean algebra on rhythms produces powerful results. Because rhythms are just signals that output 0 or 1, ordinary arithmetic *is* logic. Take two Euclidean patterns and combine them with three operations:",
        },
        {
          type: "prose",
          text: "*AND* (multiply): both patterns must hit at the same time. The result is sparse and syncopated — only the points of agreement survive. `(* pat-a pat-b)` outputs 1 only when both inputs are 1.",
        },
        {
          type: "prose",
          text: "*OR* (`min` of sum and 1): either pattern contributes a hit. Dense and busy. `(min 1 (+ pat-a pat-b))` outputs 1 when at least one input is 1.",
        },
        {
          type: "prose",
          text: "*XOR* (absolute difference): hits where *one* pattern fires but not the other. This fills in the gaps between them. `(abs (- pat-a pat-b))` outputs 1 when exactly one input is 1.",
        },
        {
          type: "prose",
          text: "Three fundamentally different rhythms from two source patterns, using nothing but multiplication, addition, and subtraction.",
        },
        {
          type: "playground",
          playground: {
            code: `(def pat-a (euclid 3 8 bar))
(def pat-b (euclid 5 8 bar))

;; AND: both must hit
(d1 (* pat-a pat-b))
;; OR: either hits
(d2 (min 1 (+ pat-a pat-b)))
;; XOR: one but not both
(d3 (abs (- pat-a pat-b)))`,
            annotation: "Three rhythms from two sources via arithmetic",
            signals: [
              { label: "euclid(3,8)", channel: "d1", fn: (p) => euclid(3, 8, p), digital: true },
              { label: "euclid(5,8)", channel: "d2", fn: (p) => euclid(5, 8, p), digital: true },
              {
                label: "AND",
                channel: "d1",
                fn: (p) => euclid(3, 8, p) * euclid(5, 8, p),
                digital: true,
              },
              {
                label: "OR",
                channel: "d2",
                fn: (p) => Math.min(1, euclid(3, 8, p) + euclid(5, 8, p)),
                digital: true,
              },
              {
                label: "XOR",
                channel: "d3",
                fn: (p) => Math.abs(euclid(3, 8, p) - euclid(5, 8, p)),
                digital: true,
              },
            ] as VisSignal[],
            outputs: ["d1", "d2", "d3"],
          },
        },
        {
          type: "try-it",
          text: "Swap `pat-b` to `(euclid 7 16 bar)` and watch how all three derived rhythms change. Then try feeding the AND result into another boolean operation with a third pattern.",
        },
        {
          type: "deep-dive",
          title: "Why arithmetic is logic",
          content: [
            {
              type: "prose",
              text: "When signals are restricted to 0 and 1, arithmetic collapses into boolean logic. Multiplication becomes AND because 1*1=1 and anything times 0 is 0. Addition becomes OR (clamped to 1) because 0+0=0, and any nonzero sum means at least one input was 1. Subtraction with `abs` becomes XOR because |1-1|=0 (both on cancels out), |1-0|=1, |0-1|=1. You don't need special logic operators — the same algebra you use for continuous signals handles binary ones too.",
            },
          ],
        },
      ],
    },

    // -----------------------------------------------------------------
    // 4.3 Sequencing with from-list, gates, and trigs
    // -----------------------------------------------------------------
    {
      id: "sequencing",
      title: "Sequencing with from-list, gates, and trigs",
      summary: "Step sequences, gate patterns, and trigger sequences with amplitude",
      content: [
        {
          type: "prose",
          text: "While Euclidean rhythms are generated algorithmically, sometimes you want to spell out a pattern step by step. ModuLisp has three sequencing functions for this: `from-list` for values, `gates` for on/off patterns, and `trigs` for triggers with amplitude control.",
        },

        // from-list
        {
          type: "prose",
          text: "`from-list` reads values from a vector, using a phasor to choose which one. The phasor divides the cycle into equal slices, one per item. As the phasor sweeps from 0 to 1, it steps through the list in order.",
        },
        {
          type: "playground",
          playground: {
            code: ";; step through three voltage levels\n(a1 (from-list [0.2 0.5 0.8] bar))",
            annotation: "Three values stepped across one bar",
            signals: [
              {
                label: "a1",
                channel: "a1",
                fn: (p) => fromList([0.2, 0.5, 0.8], p),
              },
            ],
            outputs: ["a1"],
          },
        },
        {
          type: "prose",
          text: "The 3-arity form adds a scale factor: `(from-list [0.2 0.5 0.8] 5 bar)` multiplies each value by 5 before outputting. Useful when your list holds small fractions and you want a wider range.",
        },
        {
          type: "playground",
          playground: {
            code: ";; scaled output: each value multiplied by 5\n(a1 (from-list [0.2 0.5 0.8] 5 bar))",
            annotation: "Same list, scaled by 5 for wider voltage range",
            signals: [
              {
                label: "a1: scaled",
                channel: "a1",
                fn: (p) => fromList([0.2, 0.5, 0.8], p) * 5,
              },
            ],
            outputs: ["a1"],
          },
        },

        // gates
        {
          type: "prose",
          text: "`gates` outputs a gate sequence: each element is 1 (on) or 0 (off). The phasor steps through the list, outputting a gate pulse for each 1. The default pulse width is 50%.",
        },
        {
          type: "playground",
          playground: {
            code: ";; 8-step gate pattern\n(d1 (gates [1 0 1 1 0 1 0 1] bar))",
            annotation: "A hand-written gate pattern",
            signals: [
              {
                label: "d1: gates",
                channel: "d1",
                fn: (p) => gates([1, 0, 1, 1, 0, 1, 0, 1], 0.5, p),
                digital: true,
              },
            ],
            outputs: ["d1"],
          },
        },
        {
          type: "prose",
          text: "Add a pulse width argument to control how long each gate stays high. `(gates [1 0 1 1] 0.3 bar)` gives 30% pulse width — short, snappy triggers instead of wide gates.",
        },
        {
          type: "playground",
          playground: {
            code: ";; narrow gates: 30% pulse width\n(d1 (gates [1 0 1 1] 0.3 bar))",
            annotation: "Pulse width controls gate duration",
            signals: [
              {
                label: "d1: pw=0.3",
                channel: "d1",
                fn: (p) => gates([1, 0, 1, 1], 0.3, p),
                digital: true,
              },
            ],
            outputs: ["d1"],
          },
        },
        {
          type: "try-it",
          text: "Change the pulse width from 0.3 to 0.9 — the gates get so wide they almost overlap. Try 0.05 for tiny trigger spikes.",
        },

        // trigs
        {
          type: "prose",
          text: "`trigs` is like `gates`, but each step has an amplitude from 0 to 9 instead of just on/off. A value of 9 is full amplitude, 5 is about half, and 0 is silence. This gives you velocity-sensitive trigger sequences.",
        },
        {
          type: "playground",
          playground: {
            code: ";; accented trigger pattern\n(a1 (trigs [9 0 5 0 7 0 3 0] bar))",
            annotation: "0-9 values encode velocity per step",
            signals: [
              {
                label: "a1: trigs",
                channel: "a1",
                fn: (p) => trigs([9, 0, 5, 0, 7, 0, 3, 0], 0.1, p),
              },
            ],
            outputs: ["a1"],
          },
        },

        // comparison
        {
          type: "prose",
          text: "When to use which? Use `from-list` for CV sequences — melodies, voltage contours, parameter changes. Use `gates` for binary rhythm patterns where every hit is equal. Use `trigs` when you need per-step amplitude — accents, velocity-sensitive drum patterns, or dynamics.",
        },
        {
          type: "reference-table",
          rows: [
            {
              name: "from-list",
              signature: "(from-list [values] phasor)",
              description: "Step through values by phasor position. Optional scale factor as second arg.",
            },
            {
              name: "gates",
              signature: "(gates [0|1 ...] phasor)",
              description: "Binary gate sequence. Optional pulse width arg before phasor.",
            },
            {
              name: "trigs",
              signature: "(trigs [0-9 ...] phasor)",
              description: "Trigger sequence with per-step amplitude 0-9. Optional pulse width.",
            },
          ],
        },
        {
          type: "deep-dive",
          title: "Gates vs trigs vs from-list under the hood",
          content: [
            {
              type: "prose",
              text: "All three functions use the same core mechanism: divide the phasor cycle into N equal slices (where N is the list length), then look up the current slice. `from-list` returns the raw value. `gates` treats nonzero values as 1 and applies a pulse width window within each slice. `trigs` maps the 0-9 range to 0.0-1.0 amplitude and applies a (typically narrow) pulse width. The pulse width determines what fraction of each step is \"on\" — the rest returns to 0.",
            },
          ],
        },
      ],
    },

    // -----------------------------------------------------------------
    // 4.4 Using External Inputs
    // -----------------------------------------------------------------
    {
      id: "external-inputs",
      title: "Using External Inputs",
      summary: "Read CV and switches to make patches interactive",
      content: [
        {
          type: "prose",
          text: "uSEQ has two CV inputs (`ain1`, `ain2`), a momentary switch (`swm`), and a toggle switch (`swt`). These are *bare variables*, not function calls — write `ain1`, not `(ain1)`. They return a value that updates in real time as you turn knobs or flip switches.",
        },
        {
          type: "prose",
          text: "`ain1` and `ain2` return a value from 0 to 1 based on the CV voltage at the input jack. Patch an LFO, envelope, or manual voltage source into the input, and use the variable anywhere you would write a number.",
        },
        {
          type: "playground",
          playground: {
            code: ";; CV controls oscillator speed\n(d1 (sqr (fast (scale 0 1 1 8 ain1) bar)))",
            annotation: "ain1 (0-1) maps to speed 1x-8x via scale",
            signals: [
              {
                label: "d1: slow",
                channel: "d1",
                fn: (p) => usqr(fast(1, p)),
                digital: true,
              },
              {
                label: "d1: mid",
                channel: "d1",
                fn: (p) => usqr(fast(4, p)),
                digital: true,
              },
              {
                label: "d1: fast",
                channel: "d1",
                fn: (p) => usqr(fast(8, p)),
                digital: true,
              },
            ],
            outputs: ["d1"],
          },
        },
        {
          type: "prose",
          text: "`swm` returns 1 while the momentary switch is held down, 0 otherwise. Use it with `if` to switch between patterns on the fly.",
        },
        {
          type: "playground",
          playground: {
            code: ";; switch toggles between two euclidean patterns\n(d2 (if swm (euclid 7 16 bar) (euclid 3 8 bar)))",
            annotation: "Hold the switch for the dense pattern, release for sparse",
            signals: [
              {
                label: "d2: sparse (swm=0)",
                channel: "d2",
                fn: (p) => euclid(3, 8, p),
                digital: true,
              },
              {
                label: "d2: dense (swm=1)",
                channel: "d2",
                fn: (p) => euclid(7, 16, p),
                digital: true,
              },
            ],
            outputs: ["d2"],
          },
        },
        {
          type: "prose",
          text: "`swt` is a three-position toggle returning -1, 0, or 1. Use nested `if` to select among three options. This gives you a hardware preset selector.",
        },
        {
          type: "playground",
          playground: {
            code: `;; three-way waveform selector
(a1 (if (> swt 0) (sin bar)
       (if (< swt 0) (tri bar)
           (saw bar))))`,
            annotation: "Toggle switch selects sin / saw / tri",
            signals: [
              { label: "a1: sin (swt=1)", channel: "a1", fn: (p) => usin(p) },
              { label: "a1: saw (swt=0)", channel: "a1", fn: (p) => frac(p) },
              { label: "a1: tri (swt=-1)", channel: "a1", fn: (p) => utri(p) },
            ],
            outputs: ["a1"],
          },
        },
        {
          type: "try-it",
          text: "Replace the waveforms with Euclidean patterns at different densities. A three-way rhythm selector is a powerful live performance tool.",
        },
        {
          type: "deep-dive",
          title: "Attenuverters: scaling external input",
          content: [
            {
              type: "prose",
              text: "Raw CV inputs might not cover the range you need. Use `scale` to map `ain1` from its 0-1 range to whatever your parameter expects: `(scale 0 1 60 240 ain1)` maps the knob to a BPM range. You can also invert the input with `(- 1 ain1)` so that turning the knob clockwise *decreases* the value. Combining inversion and scaling is called attenuation — the same thing an attenuverter module does in hardware.",
            },
          ],
        },
        {
          type: "tip",
          text: "Remember: `ain1`, `ain2`, `swm`, and `swt` are bare variables. Writing `(ain1)` will try to call a function named ain1 and fail.",
        },
      ],
    },

    // -----------------------------------------------------------------
    // 4.5 Layering
    // -----------------------------------------------------------------
    {
      id: "layering",
      title: "Layering",
      summary: "Complex patches are simple operations stacked, one layer at a time",
      content: [
        {
          type: "prose",
          text: "Everything in the previous sections composes. You can layer techniques freely: shape a phasor, multiply to gate it, add to mix, scale to fit the range, use the result as a parameter to something else.",
        },
        {
          type: "prose",
          text: "A complex patch is just simple operations stacked. Start with one phasor, add one layer at a time, and listen to how each layer changes the signal. The probe next to each example shows each stage so you can *see* the algebra at work.",
        },
        {
          type: "playground",
          playground: {
            code: `;; layer 1: base rhythm
(def base (euclid 5 8 bar))

;; layer 2: gated sine
(def tone (* base (sin (fast 16 bar))))

;; layer 3: envelope
(def shaped (* tone (- 1 (fast 8 bar))))

;; layer 4: stereo spread
(a1 shaped)
(a2 (shift 0.125 shaped))`,
            annotation: "Four layers, one clear signal chain",
            signals: [
              {
                label: "euclid(5,8)",
                channel: "a1",
                fn: (p) => euclid(5, 8, p),
                digital: true,
              },
              {
                label: "gated sine",
                channel: "a1",
                fn: (p) => euclid(5, 8, p) * usin(fast(16, p)),
              },
              {
                label: "shaped",
                channel: "a1",
                fn: (p) => {
                  const gate = euclid(5, 8, p);
                  const tone = gate * usin(fast(16, p));
                  const env = 1 - fast(8, p);
                  return tone * env;
                },
              },
              {
                label: "offset copy",
                channel: "a2",
                fn: (p) => {
                  const gate = euclid(5, 8, shift(0.125, p));
                  const tone = gate * usin(fast(16, shift(0.125, p)));
                  const env = 1 - fast(8, shift(0.125, p));
                  return tone * env;
                },
              },
            ] as VisSignal[],
            outputs: ["a1", "a2"],
          },
        },
        {
          type: "prose",
          text: "There is no limit to nesting depth. A signal controlling the speed of a signal that controls the threshold of a signal that gates another signal — this is normal. Each layer wraps the previous one, and because the subject is always the last argument, you can read the code inside-out: innermost is the raw signal, outermost is the final shaping.",
        },
        {
          type: "prose",
          text: "The key to reading nested ModuLisp is to start from the inside and work out. In `(a1 (* (euclid 5 8 bar) (sin (fast 16 bar))))`, start at `bar` (raw phasor), then `fast 16` (speed it up), then `sin` (shape it), then `* (euclid ...)` (gate it), then `a1` (output it). Each parenthesised layer adds one transformation.",
        },
        {
          type: "try-it",
          text: "Add a fifth layer: multiply `shaped` by `(sin (fast 0.5 bar))` to add a slow tremolo. Then try replacing the Euclidean pattern with a `gates` sequence.",
        },
        {
          type: "deep-dive",
          title: "The last-argument convention in practice",
          content: [
            {
              type: "prose",
              text: "ModuLisp consistently places the signal being transformed as the last argument. `(fast 4 bar)` takes `bar` and speeds it up. `(scale 0 1 0.2 0.8 sig)` takes `sig` and rescales it. This convention means you always wrap operations around a signal like layers of an onion. When you want to add a new transformation, you wrap the existing expression in a new pair of parentheses with the operation and its parameters first, and the expression you are transforming stays at the end. This is why structural editing commands like slurp and barf are so powerful — they let you add and remove layers without retyping.",
            },
          ],
        },
      ],
    },
  ],
};
