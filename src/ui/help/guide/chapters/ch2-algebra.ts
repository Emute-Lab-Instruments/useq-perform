/**
 * Chapter 2 — "Signals as Algebra"
 *
 * Migrated and expanded from lessonData.ts lessons: phasor, multiplication,
 * addition, comparison, inversion, staircase, zero-window, phase-canon, modulo.
 * Each section adds deep-dive theory and try-it prompts.
 */

import type { Chapter, VisSignal } from "../guideTypes";

// ---------------------------------------------------------------------------
// DSP helpers — small building blocks used in static signal lambdas
// ---------------------------------------------------------------------------

/** Fractional part, always positive. Maps any number into 0-1. */
const frac = (x: number): number => ((x % 1) + 1) % 1;

/** Unipolar sine: phasor 0->1 -> one full sine cycle mapped to 0->1. */
const usin = (p: number): number =>
  0.5 + 0.5 * Math.sin(2 * Math.PI * p);

/** Square wave: phasor -> 0 or 1 (50% duty). */
const usqr = (p: number): number => (frac(p) < 0.5 ? 1 : 0);

/** Triangle wave: phasor -> 0->1->0. */
const utri = (p: number): number => {
  const f = frac(p);
  return f < 0.5 ? f * 2 : 2 - f * 2;
};

/** Pulse wave with configurable width (0-1). */
const _upulse = (width: number, p: number): number =>
  frac(p) < width ? 1 : 0;

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

/** clamp to 0-1. */
const _clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Simple from-list: pick item by phasor. */
const fromList = (list: number[], p: number): number => {
  const idx = Math.min(Math.floor(frac(p) * list.length), list.length - 1);
  return list[idx];
};

/** Euclidean rhythm: k hits spread across n steps. */
const _euclid = (k: number, n: number, p: number): number => {
  const step = Math.floor(frac(p) * n);
  return Math.floor(((step + 1) * k) / n) - Math.floor((step * k) / n) > 0
    ? 1
    : 0;
};

/** Linear interpolation between list values over a phasor. */
const _interp = (list: number[], p: number): number => {
  const f = frac(p);
  const segments = list.length - 1;
  const pos = f * segments;
  const idx = Math.min(Math.floor(pos), segments - 1);
  const t = pos - idx;
  return list[idx] * (1 - t) + list[idx + 1] * t;
};

// ---------------------------------------------------------------------------
// Chapter 2
// ---------------------------------------------------------------------------

export const chapter2: Chapter = {
  id: "algebra",
  title: "Signals as Algebra",
  summary:
    "Everything is built from one ramp and four arithmetic operations.",
  domain: "language",
  sections: [
    // =====================================================================
    // 2.1 The Phasor
    // =====================================================================
    {
      id: "phasor",
      title: "The Phasor",
      summary:
        "bar is a 0-to-1 ramp that repeats — every signal starts here.",
      content: [
        {
          type: "prose",
          text: "The single most important idea in ModuLisp: `bar` is a number that climbs from 0 to 1 and resets, over and over. That's it — a ramp.",
        },
        {
          type: "prose",
          text: "Every waveform, every rhythm, every sequence is built by *doing something* to this ramp. `sqr`, `sin`, `tri`, `saw` — they aren't magic, they're just different ways of bending the ramp into shapes. In fact, `saw` literally returns the ramp unchanged.",
        },
        {
          type: "playground",
          playground: {
            code: "(a1 bar)",
            annotation: "The raw ramp — watch it climb from 0 to 1",
            signals: [{ label: "a1", channel: "a1", fn: (p) => p }],
            outputs: ["a1"],
          },
        },
        {
          type: "prose",
          text: "The ramp is called a *phasor*. There's a whole family of them at different time-scales: `beat`, `bar`, `phrase`, `section`. They all work the same way — 0 to 1, repeat — just at different speeds.",
        },
        {
          type: "prose",
          text: "Waveform shapers reshape the phasor into familiar shapes. `sin` produces a smooth sine curve, `sqr` produces a square wave, `tri` a triangle, and `saw` returns the ramp unchanged.",
        },
        {
          type: "playground",
          playground: {
            code: ";; four shapers applied to bar\n(a1 (sin bar))\n(a2 (sqr bar))\n(a3 (tri bar))",
            annotation:
              "sin, sqr, and tri are just different lenses on the same ramp",
            signals: [
              { label: "sin", channel: "a1", fn: (p) => usin(p) },
              { label: "sqr", channel: "a2", fn: (p) => usqr(p), digital: true },
              { label: "tri", channel: "a3", fn: (p) => utri(p) },
            ],
            outputs: ["a1", "a2", "a3"],
          },
        },
        {
          type: "try-it",
          text: "Replace `sin` with `saw` in the playground above — notice that it looks identical to the raw `bar` ramp. That's because `saw` *is* the identity function on a phasor.",
        },
        {
          type: "prose",
          text: "`fast` and `slow` change the speed: `(fast 4 bar)` gives you four ramps per bar. Notice how the signal you're transforming — `bar` — is the *last* argument. This is a convention in ModuLisp: the thing you're working on comes last, so you can wrap operations around it like layers.",
        },
        {
          type: "playground",
          playground: {
            code: "(a1 (fast 4 bar))",
            annotation: "Same ramp, 4x per bar",
            signals: [{ label: "a1", channel: "a1", fn: (p) => fast(4, p) }],
            outputs: ["a1"],
          },
        },
        {
          type: "playground",
          playground: {
            code: "(d1 (> bar 0.5))",
            annotation: "A threshold turns the ramp into a gate",
            signals: [
              { label: "bar", channel: "d1", fn: (p) => p },
              {
                label: "d1: > 0.5",
                channel: "d1",
                fn: (p) => (p > 0.5 ? 1 : 0),
                digital: true,
              },
            ],
            outputs: ["d1"],
          },
        },
        {
          type: "try-it",
          text: "Change `(fast 4 bar)` to `(fast 7 bar)` — you get seven ramps per bar. Try `(slow 2 bar)` to halve the speed so the ramp takes two bars to complete.",
        },
        {
          type: "deep-dive",
          title: "What is a phasor?",
          content: [
            {
              type: "prose",
              text: "A phasor is a number that increases linearly from 0 to 1 and wraps. Every repeating signal in ModuLisp is derived from a phasor by applying a shaping function. The waveform generators (`sin`, `sqr`, `tri`) take a phasor as input and return a value between 0 and 1.",
            },
            {
              type: "prose",
              text: "This is why `fast` works: it just multiplies the phasor before the shaper sees it. `(fast 2 bar)` is `(% (* 2 bar) 1)` — the ramp goes twice as fast because we multiplied time. The shaper doesn't know or care that time was sped up; it just sees a phasor that completes more cycles.",
            },
            {
              type: "prose",
              text: "The phasor model means there is no distinction between audio-rate oscillators and LFOs — they are the same thing at different speeds. A `(sin (fast 440 bar))` is an audio sine wave; `(sin (slow 4 bar))` is a slow modulation source. The algebra doesn't change.",
            },
          ],
        },
      ],
    },

    // =====================================================================
    // 2.2 Multiplication is a Volume Knob
    // =====================================================================
    {
      id: "multiplication",
      title: "Multiplication is a Volume Knob",
      summary:
        "Multiply by 0-1 to control amplitude — that's a VCA.",
      content: [
        {
          type: "prose",
          text: "Multiplying a signal by a number between 0 and 1 reduces its amplitude — exactly like turning down a volume knob or sending a signal through a VCA.",
        },
        {
          type: "prose",
          text: "Multiply by 0 and the signal disappears entirely. Multiply by 1 and it's unchanged. Multiply by 0.5 and it's half strength.",
        },
        {
          type: "playground",
          playground: {
            code: "(a1 (sin bar))\n(a2 (* 0.5 (sin bar)))",
            annotation: "Full amplitude vs half volume",
            signals: [
              { label: "a1: full", channel: "a1", fn: (p) => usin(p) },
              { label: "a2: x0.5", channel: "a2", fn: (p) => 0.5 * usin(p) },
            ],
            outputs: ["a1", "a2"],
          },
        },
        {
          type: "try-it",
          text: "Change `0.5` to `0.1` and watch the waveform shrink. Then try `1.5` — the signal clips above 1.",
        },
        {
          type: "prose",
          text: "The crucial leap: anywhere you write a number, you can write *another signal* instead. Multiply a triangle by a sine and the sine becomes a tremolo — an automated volume knob, turning itself. That's what modulation *is*.",
        },
        {
          type: "playground",
          playground: {
            code: "(a1 (* (sin (fast 8 bar))\n       (tri bar)))",
            annotation: "Tremolo — a signal IS a volume knob",
            signals: [
              { label: "tri (envelope)", channel: "a1", fn: (p) => utri(p) },
              {
                label: "tremolo",
                channel: "a1",
                fn: (p) => usin(fast(8, p)) * utri(p),
              },
            ],
            outputs: ["a1"],
          },
        },
        {
          type: "try-it",
          text: "Replace `(tri bar)` with `(sin (slow 2 bar))` for a slower modulation sweep. Try changing the fast multiplier from 8 to 16 for a more rapid carrier.",
        },
        {
          type: "deep-dive",
          title: "Multiplication as amplitude control",
          content: [
            {
              type: "prose",
              text: "In a eurorack system, a VCA takes a signal input and a CV input. The output is the signal multiplied by the CV. In ModuLisp, `(* cv signal)` is a VCA. When cv is 0, the output is 0 (silence). When cv is 1, the output passes through unchanged. When cv oscillates, you get tremolo or amplitude modulation.",
            },
            {
              type: "prose",
              text: "Ring modulation is just two signals multiplied together with no DC offset. The sum and difference frequencies appear — a classic metallic timbre. In ModuLisp that's simply `(* (sin (fast 3 bar)) (sin (fast 7 bar)))` — no special module required.",
            },
          ],
        },
      ],
    },

    // =====================================================================
    // 2.3 Addition is Mixing
    // =====================================================================
    {
      id: "addition",
      title: "Addition is Mixing",
      summary:
        "Add two signals together to hear them simultaneously.",
      content: [
        {
          type: "prose",
          text: "Adding two signals together is like mixing two audio sources — they play simultaneously, like two speakers in the same room.",
        },
        {
          type: "prose",
          text: "When you mix, you usually want to scale each signal down first so the total stays in range. `(+ (* 0.5 signalA) (* 0.5 signalB))` gives you a 50/50 mix.",
        },
        {
          type: "playground",
          playground: {
            code: ";; 50/50 mix of two sines\n(a1 (+ (* 0.5 (sin bar))\n       (* 0.5 (sin (fast 3 bar)))))",
            annotation: "Two sines mixed together",
            signals: [
              {
                label: "mix",
                channel: "a1",
                fn: (p) => 0.5 * usin(p) + 0.5 * usin(fast(3, p)),
              },
            ],
            outputs: ["a1"],
          },
        },
        {
          type: "try-it",
          text: "Change the mix ratio: try `(* 0.8 ...)` for the first sine and `(* 0.2 ...)` for the second. One dominates while the other adds subtle colour.",
        },
        {
          type: "prose",
          text: "Adding a *constant* shifts the entire signal up or down. In eurorack terms, that's a DC offset — biasing a signal into a particular voltage range. `(+ 0.5 (* 0.25 (sin bar)))` gives you a sine centered at 0.5, swinging only +/-0.25.",
        },
        {
          type: "playground",
          playground: {
            code: ";; sine centered at 0.5, swinging +/-0.25\n(a1 (+ 0.5 (* 0.25 (sin bar))))",
            annotation: "DC offset — biasing a signal",
            signals: [
              {
                label: "offset sine",
                channel: "a1",
                fn: (p) =>
                  0.5 + 0.25 * Math.sin(2 * Math.PI * p),
              },
            ],
            outputs: ["a1"],
          },
        },
        {
          type: "prose",
          text: "This brings up an important pattern: `scale` is really just multiplication and addition combined. `(scale 0 1 0.2 0.8 (sin bar))` maps the 0-1 sine into the 0.2-0.8 range. The signal comes last, so you can wrap `scale` around any expression.",
        },
        {
          type: "playground",
          playground: {
            code: ";; scale maps 0-1 into any range you need\n(a1 (scale 0 1 0.2 0.8 (sin bar)))",
            annotation: "scale wraps the signal (last arg)",
            signals: [
              { label: "sin (raw)", channel: "a1", fn: (p) => usin(p) },
              {
                label: "scaled",
                channel: "a1",
                fn: (p) => scale(usin(p), 0, 1, 0.2, 0.8),
              },
            ],
            outputs: ["a1"],
          },
        },
        {
          type: "try-it",
          text: "Try `(scale 0 1 0 0.5 (sin bar))` to compress the sine into the bottom half of the range. Then try swapping the output min/max: `(scale 0 1 0.8 0.2 ...)` inverts the signal.",
        },
        {
          type: "deep-dive",
          title: "Scale and range mapping",
          content: [
            {
              type: "prose",
              text: "`(scale inMin inMax outMin outMax signal)` maps a signal from one range to another. Under the hood it's `outMin + (signal - inMin) * (outMax - outMin) / (inMax - inMin)`. The signal comes last so you can wrap `scale` around any expression.",
            },
            {
              type: "prose",
              text: "When `outMin > outMax`, `scale` inverts the signal — this is equivalent to `(- 1 x)` for 0-1 signals but generalises to any range. This makes `scale` a universal range adapter: you never need to manually compute offsets and multipliers.",
            },
          ],
        },
      ],
    },

    // =====================================================================
    // 2.4 Comparison: Turning Continuous into Discrete
    // =====================================================================
    {
      id: "comparison",
      title: "Comparison: Turning Continuous into Discrete",
      summary:
        "Thresholding turns a smooth signal into a binary gate.",
      content: [
        {
          type: "prose",
          text: "Every comparison operator — `>`, `<`, `>=` — turns a continuous signal into a yes/no decision. This is how analog becomes digital: pick a threshold, and the signal is either above it or below it.",
        },
        {
          type: "playground",
          playground: {
            code: "(d1 (> (sin bar) 0.3))",
            annotation: "Fires when sine crosses 0.3",
            signals: [
              { label: "sine", channel: "d1", fn: (p) => usin(p) },
              {
                label: "d1: >0.3",
                channel: "d1",
                fn: (p) => (usin(p) > 0.3 ? 1 : 0),
                digital: true,
              },
            ],
            outputs: ["d1"],
          },
        },
        {
          type: "prose",
          text: "The same sine wave with different thresholds gives you completely different rhythms. A low threshold fires early and stays on longer; a high one fires late with a short pulse.",
        },
        {
          type: "playground",
          playground: {
            code: "(d1 (> (sin bar) 0.3))\n(d2 (> (sin bar) 0.7))",
            annotation: "Same sine, two thresholds — two rhythms",
            signals: [
              { label: "sine", channel: "d1", fn: (p) => usin(p) },
              {
                label: "d1: >0.3",
                channel: "d1",
                fn: (p) => (usin(p) > 0.3 ? 1 : 0),
                digital: true,
              },
              {
                label: "d2: >0.7",
                channel: "d2",
                fn: (p) => (usin(p) > 0.7 ? 1 : 0),
                digital: true,
              },
            ],
            outputs: ["d1", "d2"],
          },
        },
        {
          type: "try-it",
          text: "Change `0.3` to `0.7` in the first playground — watch how the gate gets shorter. Try `0.9` for a very brief trigger near the peak.",
        },
        {
          type: "prose",
          text: "Now use a *moving* threshold for rhythms that evolve over time: the trigger pattern shifts as the threshold drifts.",
        },
        {
          type: "playground",
          playground: {
            code: ";; moving threshold — rhythm morphs over time\n(d1 (> (sin (fast 4 bar))\n       (* 0.5 (+ 1 (sin (slow 4 bar))))))",
            annotation: "Threshold drifts with a slow LFO",
            bars: 4,
            signals: [
              {
                label: "fast sine",
                channel: "d1",
                fn: (p) => usin(fast(4, p)),
              },
              {
                label: "threshold",
                channel: "d1",
                fn: (p) => 0.5 * (1 + Math.sin(2 * Math.PI * p * 0.25)),
              },
            ] as VisSignal[],
            outputs: ["d1"],
          },
        },
        {
          type: "deep-dive",
          title: "Thresholding as rhythm generation",
          content: [
            {
              type: "prose",
              text: "A comparator is the simplest possible rhythm generator. Any signal that oscillates will cross a threshold twice per cycle — once going up, once coming down. The duty cycle (how long the gate stays high) depends on where you set the threshold relative to the signal's range.",
            },
            {
              type: "prose",
              text: "When you threshold a sine wave, the resulting gate width is non-linear: small changes near 0 or 1 have a large effect on pulse width, while changes near 0.5 barely matter. This is why a slowly moving threshold creates evolving rhythms — the gate width accelerates and decelerates as the threshold sweeps.",
            },
          ],
        },
      ],
    },

    // =====================================================================
    // 2.5 Inversion and Complement
    // =====================================================================
    {
      id: "inversion",
      title: "Inversion and Complement",
      summary:
        "(- 1 x) flips a signal — rests become hits, ups become downs.",
      content: [
        {
          type: "prose",
          text: "`(- 1 x)` flips a signal upside down within the 0-1 range. What went up now goes down — musically, that's inversion.",
        },
        {
          type: "playground",
          playground: {
            code: "(a1 (tri bar))\n(a2 (- 1 (tri bar)))",
            annotation: "Triangle and its mirror",
            signals: [
              { label: "tri", channel: "a1", fn: (p) => utri(p) },
              { label: "1 - tri", channel: "a2", fn: (p) => 1 - utri(p) },
            ],
            outputs: ["a1", "a2"],
          },
        },
        {
          type: "prose",
          text: "For rhythms, the complement of a pattern fills in the rests. If your kick pattern hits on beats 1 and 3, `(- 1 kick)` hits on 2 and 4. Together they make a solid stream, but split across two outputs they create call-and-response.",
        },
        {
          type: "playground",
          playground: {
            code: "(d1 (sqr (fast 4 bar)))\n(d2 (- 1 (sqr (fast 4 bar))))",
            annotation: "Pattern and its complement — the gaps filled in",
            signals: [
              {
                label: "d1: sqr",
                channel: "d1",
                fn: (p) => usqr(fast(4, p)),
                digital: true,
              },
              {
                label: "d2: complement",
                channel: "d2",
                fn: (p) => 1 - usqr(fast(4, p)),
                digital: true,
              },
            ],
            outputs: ["d1", "d2"],
          },
        },
        {
          type: "try-it",
          text: "Patch both d1 and d2 to different sound sources — you'll hear a continuous rhythm split between two voices. Try replacing `sqr` with `(> (sin bar) 0.3)` for an asymmetric split.",
        },
        {
          type: "deep-dive",
          title: "Complement and musical inversion",
          content: [
            {
              type: "prose",
              text: "The complement operation `(- 1 x)` is its own inverse: applying it twice returns the original signal. This means any pair of complementary signals perfectly tiles the 0-1 space — their sum is always exactly 1 at every point in time.",
            },
            {
              type: "prose",
              text: "For continuous signals, inversion flips the contour: ascending becomes descending, peaks become troughs. For binary gates, it swaps highs and lows — every rest becomes a hit. This is a fundamental symmetry operation: one pattern generates its own counterpart for free.",
            },
          ],
        },
      ],
    },

    // =====================================================================
    // 2.6 Staircase Voltages
    // =====================================================================
    {
      id: "staircase",
      title: "Staircase Voltages",
      summary:
        "floor turns a smooth ramp into discrete steps for pitched sequences.",
      content: [
        {
          type: "prose",
          text: "`floor` turns a smooth ramp into steps — like sample-and-hold. Each step is a held value, a discrete level. This is how you get *pitched sequences* from a ramp.",
        },
        {
          type: "prose",
          text: "Multiply the phasor by a number before flooring to choose how many steps. `(floor (* 4 bar))` gives you 4 steps. Divide back down to get values in 0-1.",
        },
        {
          type: "playground",
          playground: {
            code: ";; 4 discrete steps per bar\n(a1 (/ (floor (* 4 bar)) 4))",
            annotation: "Staircase from a ramp",
            signals: [
              { label: "bar (ramp)", channel: "a1", fn: (p) => p },
              { label: "4 steps", channel: "a1", fn: (p) => Math.floor(p * 4) / 4 },
            ],
            outputs: ["a1"],
          },
        },
        {
          type: "playground",
          playground: {
            code: ";; 8 steps — finer resolution\n(a1 (/ (floor (* 8 bar)) 8))",
            annotation: "More steps, same ramp",
            signals: [
              { label: "bar (ramp)", channel: "a1", fn: (p) => p },
              { label: "8 steps", channel: "a1", fn: (p) => Math.floor(p * 8) / 8 },
            ],
            outputs: ["a1"],
          },
        },
        {
          type: "try-it",
          text: "Try `(/ (floor (* 3 bar)) 3)` for a 3-step staircase. Change the multiplier and divisor together to get any number of steps.",
        },
        {
          type: "prose",
          text: "`from-list` (aka `seq`) is really just `floor` + lookup under the hood. But the explicit version shows you *why* it works — and once you see that, you can build your own step patterns by manipulating the math directly.",
        },
        {
          type: "playground",
          playground: {
            code: ";; from-list does the same thing with named values\n(a1 (from-list [0.2 0.5 0.8 0.3] bar))",
            annotation: "Pick values by phasor position",
            signals: [
              {
                label: "from-list",
                channel: "a1",
                fn: (p) => fromList([0.2, 0.5, 0.8, 0.3], p),
              },
            ],
            outputs: ["a1"],
          },
        },
        {
          type: "try-it",
          text: "Add more values to the vector: `[0.2 0.5 0.8 0.3 0.1 0.9 0.4 0.6]` gives you an 8-step sequence. The phasor automatically divides the bar evenly across all entries.",
        },
        {
          type: "deep-dive",
          title: "Quantisation and the floor function",
          content: [
            {
              type: "prose",
              text: "The staircase pattern — multiply, floor, divide — is a general quantisation recipe. `(/ (floor (* N x)) N)` maps a continuous value onto N equally-spaced levels. This is identical to what an analogue sample-and-hold does: capture a value at discrete moments and hold it until the next capture.",
            },
            {
              type: "prose",
              text: "`from-list` generalises this by allowing each step to have an arbitrary value instead of a uniform spacing. Internally it computes `floor(phasor * length)` to pick the index, then returns the value at that index. Understanding this decomposition lets you build non-uniform step patterns: use `interp` for gliding transitions, or multiply the phasor by a non-integer for steps that don't align with the beat.",
            },
          ],
        },
      ],
    },

    // =====================================================================
    // 2.7 The Zero Window Trick
    // =====================================================================
    {
      id: "zero-window",
      title: "The Zero Window Trick",
      summary:
        "Multiply by 0 to silence, by 1 to pass — algebra becomes a sequencer.",
      content: [
        {
          type: "prose",
          text: "This is the big one — the moment where algebra becomes a sequencer.",
        },
        {
          type: "prose",
          text: "Anything multiplied by zero is zero. Anything multiplied by one is itself. A square wave alternates between 0 and 1. So multiplying a signal by a square wave is a gate opening and closing: the signal plays during the \"1\" half and goes silent during the \"0\" half.",
        },
        {
          type: "playground",
          playground: {
            code: ";; sine, but only during the first half of the bar\n(a1 (* (sqr bar) (sin (fast 8 bar))))",
            annotation: "Gate = multiply by square wave",
            signals: [
              { label: "window", channel: "a1", fn: (p) => usqr(p), digital: true },
              {
                label: "gated sine",
                channel: "a1",
                fn: (p) => usqr(p) * usin(fast(8, p)),
              },
            ],
            outputs: ["a1"],
          },
        },
        {
          type: "try-it",
          text: "Replace `(sqr bar)` with `(sqr (fast 2 bar))` to gate the sine four times per bar (two on, two off). Each \"on\" window is now a quarter of a bar.",
        },
        {
          type: "prose",
          text: "Now the leap: if you have *non-overlapping* windows — each one equals 1 during its time slot and 0 everywhere else — you can play a *different* signal in each slot, then add them all together. The sum is a sequence of arbitrary expressions, built from nothing but multiplication and addition.",
        },
        {
          type: "playground",
          playground: {
            code: ";; different signals in each half, summed together\n(a1 (+ (* (sqr bar) (sin (fast 8 bar)))\n       (* (- 1 (sqr bar)) (tri (fast 4 bar)))))",
            annotation: "Two windows x two signals = a sequence",
            signals: [
              {
                label: "window A",
                channel: "a1",
                fn: (p) => usqr(p),
                digital: true,
              },
              {
                label: "window B",
                channel: "a1",
                fn: (p) => 1 - usqr(p),
                digital: true,
              },
              {
                label: "sum (sequence)",
                channel: "a1",
                fn: (p) =>
                  usqr(p) * usin(fast(8, p)) +
                  (1 - usqr(p)) * utri(fast(4, p)),
              },
            ],
            outputs: ["a1"],
          },
        },
        {
          type: "try-it",
          text: "Try adding a third window by splitting the bar into thirds. Use `(> (from-list [1 0 0] bar) 0.5)` for window A, `(> (from-list [0 1 0] bar) 0.5)` for window B, and `(> (from-list [0 0 1] bar) 0.5)` for window C.",
        },
        {
          type: "deep-dive",
          title: "Arbitrary sequencing from algebra",
          content: [
            {
              type: "prose",
              text: "Any sequence of N different expressions can be built by: (1) creating N non-overlapping window functions that are 1 during their slot and 0 elsewhere, (2) multiplying each expression by its window, (3) summing. The `from-list` function does this internally, but the explicit version reveals the mechanism — and once you see it, you can build windows of any shape, not just equal-width time slots.",
            },
            {
              type: "prose",
              text: "This is the algebraic foundation of all sequencing. A step sequencer is just N windows times N values, summed. An arpeggiator is N windows times N pitch values. A drum pattern is N windows times N trigger shapes. The zero-window trick unifies them all under one operation: gated summation.",
            },
          ],
        },
      ],
    },

    // =====================================================================
    // 2.8 Phase Shifting
    // =====================================================================
    {
      id: "phase-shift",
      title: "Phase Shifting",
      summary:
        "shift moves when a pattern happens — canons, swing, and interlocking rhythms.",
      content: [
        {
          type: "prose",
          text: "`shift` moves *when* a pattern happens within its cycle. Same pattern, different starting point — like echoes in a cave, or a musical round where voices enter one after another singing the same melody.",
        },
        {
          type: "playground",
          playground: {
            code: "(d1 (sqr (fast 4 bar)))",
            annotation: "Original rhythm",
            signals: [
              {
                label: "d1",
                channel: "d1",
                fn: (p) => usqr(fast(4, p)),
                digital: true,
              },
            ],
            outputs: ["d1"],
          },
        },
        {
          type: "playground",
          playground: {
            code: "(d1 (sqr (fast 4 bar)))\n(d2 (sqr (fast 4 (shift 0.125 bar))))",
            annotation: "Same pattern, offset by half a step",
            bars: 2,
            signals: [
              {
                label: "d1: original",
                channel: "d1",
                fn: (p) => usqr(fast(4, p)),
                digital: true,
              },
              {
                label: "d2: +1/8",
                channel: "d2",
                fn: (p) => usqr(fast(4, shift(0.125, p))),
                digital: true,
              },
            ],
            outputs: ["d1", "d2"],
          },
        },
        {
          type: "prose",
          text: "Three copies of the same rhythm, each offset by a fraction, create interlocking patterns that feel complex but share a single source. Change the source and all three copies change together.",
        },
        {
          type: "playground",
          playground: {
            code: "(d1 (sqr (fast 4 bar)))\n(d2 (sqr (fast 4 (shift 0.125 bar))))\n(d3 (sqr (fast 4 (shift 0.25 bar))))",
            annotation: "Three-voice canon — interlocking from one source",
            bars: 2,
            signals: [
              {
                label: "d1: original",
                channel: "d1",
                fn: (p) => usqr(fast(4, p)),
                digital: true,
              },
              {
                label: "d2: +1/8",
                channel: "d2",
                fn: (p) => usqr(fast(4, shift(0.125, p))),
                digital: true,
              },
              {
                label: "d3: +1/4",
                channel: "d3",
                fn: (p) => usqr(fast(4, shift(0.25, p))),
                digital: true,
              },
            ],
            outputs: ["d1", "d2", "d3"],
          },
        },
        {
          type: "try-it",
          text: "Try replacing `sqr` with `(> (sin ...) 0.3)` — the canon now uses an asymmetric pulse. Change the shift amounts to `0.333` and `0.666` for evenly spaced entries.",
        },
        {
          type: "prose",
          text: "Phase offsets are also how you create swing, shuffle, or humanized feel — nudge some hits slightly early or late.",
        },
        {
          type: "deep-dive",
          title: "Phase as time displacement",
          content: [
            {
              type: "prose",
              text: "`shift` adds a constant to the phasor before wrapping: `(shift 0.25 bar)` is equivalent to `(% (+ 0.25 bar) 1)`. Because the phasor wraps, this doesn't change the pattern itself — it only changes *when* it starts. A shift of 0.5 delays by half a cycle; a shift of 0.25 delays by a quarter.",
            },
            {
              type: "prose",
              text: "Swing is a musically important application: in a 4-step pattern, shifting every other step slightly forward creates the uneven \"swung\" feel common in jazz and electronic music. You can achieve this by computing separate shifted copies and windowing them together, or by using a non-linear phasor that speeds up and slows down within each beat.",
            },
          ],
        },
      ],
    },

    // =====================================================================
    // 2.9 Modulo and Polyrhythm
    // =====================================================================
    {
      id: "modulo",
      title: "Modulo and Polyrhythm",
      summary:
        "% divides time into slices — non-integer divisions create polyrhythm.",
      content: [
        {
          type: "prose",
          text: "The modulo operator `%` divides time into equal slices. `(% (* 4 bar) 1)` makes four sub-ramps within one bar — this is exactly what `(fast 4 bar)` does internally.",
        },
        {
          type: "playground",
          playground: {
            code: ";; (fast 4 bar) unmasked: 4 sub-ramps via modulo\n(a1 (% (* 4 bar) 1))",
            annotation: "Modulo reveals what fast does",
            signals: [
              { label: "4 sub-ramps", channel: "a1", fn: (p) => fast(4, p) },
            ],
            outputs: ["a1"],
          },
        },
        {
          type: "try-it",
          text: "Try `(% (* 4 bar) 0.5)` — the wrap point changes, giving you a different ramp shape. Compare with `(% (* 4 bar) 1)` to see the difference.",
        },
        {
          type: "prose",
          text: "But the real power is *non-integer* divisions. Three ramps in the space of four beats creates a 3-against-4 polyrhythm — the two rates don't align, producing a constantly shifting relationship.",
        },
        {
          type: "playground",
          playground: {
            code: ";; 3-against-4 polyrhythm\n(d1 (sqr (fast 4 bar)))\n(d2 (> (% (* 3 bar) 1) 0.5))",
            annotation: "Two rates that don't evenly divide",
            bars: 2,
            signals: [
              {
                label: "d1: 4-pulse",
                channel: "d1",
                fn: (p) => usqr(fast(4, p)),
                digital: true,
              },
              {
                label: "d2: 3-pulse",
                channel: "d2",
                fn: (p) => (fast(3, p) > 0.5 ? 1 : 0),
                digital: true,
              },
            ],
            outputs: ["d1", "d2"],
          },
        },
        {
          type: "prose",
          text: "Polyrhythm from pure arithmetic: no special sequencer, just division and remainder. You can layer any combination of rates — 5 against 4, 7 against 8, 3 against 5 — and the algebra handles the alignment for you.",
        },
        {
          type: "try-it",
          text: "Add a third output: `(d3 (> (% (* 5 bar) 1) 0.5))` for a 3-against-4-against-5 polyrhythm. Listen to how the three patterns interlock and drift.",
        },
        {
          type: "deep-dive",
          title: "Modulo as time division",
          content: [
            {
              type: "prose",
              text: "Modulo is the mathematical operation behind all clock division and multiplication. `(% (* N bar) 1)` produces N ramps per bar — it multiplies the clock by N. `(% bar (/ 1 N))` divides the clock by N, producing one ramp every N bars. These are the same operations that hardware clock modules perform, but expressed as arithmetic.",
            },
            {
              type: "prose",
              text: "Non-integer modulo ratios are what make polyrhythm possible. When you overlay `(fast 3 bar)` and `(fast 4 bar)`, the downbeats align only once per bar. The space between alignments is where rhythmic tension lives. West African and South Indian musical traditions are built on exactly these non-aligned cycles — and in ModuLisp, they're a single arithmetic expression.",
            },
          ],
        },
      ],
    },
  ],
};
