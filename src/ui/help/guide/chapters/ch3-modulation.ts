/**
 * Chapter 3 — Modulation and Expression
 *
 * Migrated from lessonData.ts lessons: signals-as-knobs, envelopes,
 * crossfade, interp-shapes. Expanded with deep-dives, try-it prompts,
 * and additional playgrounds per USER_GUIDE_SPEC.md.
 */

import type { Chapter, VisSignal } from "../guideTypes";

// ---------------------------------------------------------------------------
// DSP helpers — pure JS signal functions for static probe fallbacks
// ---------------------------------------------------------------------------

/** Fractional part, always positive. Maps any number into 0-1. */
const frac = (x: number): number => ((x % 1) + 1) % 1;

/** Unipolar sine: phasor 0->1 -> one full sine cycle mapped to 0-1. */
const usin = (p: number): number =>
  0.5 + 0.5 * Math.sin(2 * Math.PI * p);

/** Square wave: phasor -> 0 or 1 (50% duty). */
const usqr = (p: number): number => (frac(p) < 0.5 ? 1 : 0);

/** Triangle wave: phasor -> 0->1->0. */
const utri = (p: number): number => {
  const f = frac(p);
  return f < 0.5 ? f * 2 : 2 - f * 2;
};

/** Triangle wave with configurable duty (attack fraction). */
const utriDuty = (duty: number, p: number): number => {
  const f = frac(p);
  if (f < duty) return f / duty;
  return 1 - (f - duty) / (1 - duty);
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

/** Clamp to 0-1. */
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Pulse wave with configurable width (0-1). */
const upulse = (width: number, p: number): number =>
  frac(p) < width ? 1 : 0;

/** Linear interpolation between list values over a phasor. */
const interp = (list: number[], p: number): number => {
  const f = frac(p);
  const segments = list.length - 1;
  const pos = f * segments;
  const idx = Math.min(Math.floor(pos), segments - 1);
  const t = pos - idx;
  return list[idx] * (1 - t) + list[idx + 1] * t;
};

// ---------------------------------------------------------------------------
// Section 3.1 — Signals Controlling Signals
// ---------------------------------------------------------------------------

const signalsAsKnobs = {
  id: "signals-as-knobs",
  title: "Signals Controlling Signals",
  summary: "Anywhere you write a number, you can write a signal",
  content: [
    {
      type: "prose" as const,
      text: `Anywhere you write a number, you can write a signal. This is the modular synthesis insight translated to code: every number is a knob, and every knob can be automated by another signal.

In hardware you'd patch a cable from one module's output to another's input. In ModuLisp you *nest* one expression inside another. The inner expression's output feeds the outer expression's parameter. Nesting is patching.

The "last argument" convention makes this natural: you wrap transformations around a signal, and each wrapper can have its parameters driven by other signals. \`(fast speed bar)\` — replace \`speed\` with an LFO and you get accelerating and decelerating rhythms. Replace any fixed number with a signal and you've invented modulation.`,
    },
    {
      type: "playground" as const,
      playground: {
        code: ";; static speed\n(d1 (sqr (fast 4 bar)))",
        annotation: "Fixed at 4x — the speed is a constant",
        signals: [
          { label: "fixed 4x", channel: "d1", fn: (p: number) => usqr(fast(4, p)), digital: true },
        ] satisfies VisSignal[],
        outputs: ["d1"],
      },
    },
    {
      type: "playground" as const,
      playground: {
        code: `;; speed controlled by a sine LFO
(d1 (sqr (fast (+ 2 (* 6 (sin (slow 2 bar))))
               bar)))`,
        annotation: "Rhythmic acceleration — speed is a signal!",
        bars: 2,
        signals: [
          {
            label: "variable speed",
            channel: "d1",
            fn: (p: number) => {
              const speed = 2 + 6 * usin(p * 0.5);
              return usqr(fast(speed, p));
            },
            digital: true,
          },
        ] satisfies VisSignal[],
        outputs: ["d1"],
      },
    },
    {
      type: "try-it" as const,
      text: "Change the `6` to `2` — the speed swing narrows. Try `12` for dramatic acceleration.",
    },
    {
      type: "playground" as const,
      playground: {
        code: `;; pulse width modulated by another signal
(d1 (pulse (* 0.5 (+ 1 (sin bar)))
           (fast 4 bar)))`,
        annotation: "Width = signal, timing = signal",
        signals: [
          {
            label: "PWM",
            channel: "d1",
            fn: (p: number) => {
              const width = 0.5 * (1 + Math.sin(2 * Math.PI * p));
              return upulse(clamp01(width), fast(4, p));
            },
            digital: true,
          },
        ] satisfies VisSignal[],
        outputs: ["d1"],
      },
    },
    {
      type: "deep-dive" as const,
      title: "Nesting is patching",
      content: [
        {
          type: "prose" as const,
          text: `In a eurorack system, patching a cable routes one module's output into another module's CV input. The result depends on what's being controlled — speed, amplitude, filter cutoff, pulse width.

In ModuLisp, every function argument is a CV input. Writing \`(fast 4 bar)\` is like a cable carrying the constant voltage 4 into the "speed" input. Writing \`(fast (sin bar) bar)\` replaces that cable with a sine LFO — the speed now undulates.

This generalises without limit. Any argument at any nesting depth can be replaced with an arbitrarily complex signal. There's no special "modulation" syntax — nesting *is* modulation. A signal controlling the speed of a signal that controls the threshold of a gate is just three nested expressions.`,
        },
      ],
    },
    {
      type: "try-it" as const,
      text: "In the PWM example, replace `(sin bar)` with `(tri (fast 2 bar))` — notice how the width envelope changes shape.",
    },
  ],
};

// ---------------------------------------------------------------------------
// Section 3.2 — Building Envelopes
// ---------------------------------------------------------------------------

const envelopes = {
  id: "envelopes",
  title: "Building Envelopes",
  summary: "Attack-decay shapes from first principles — no ADSR needed",
  content: [
    {
      type: "prose" as const,
      text: `No dedicated ADSR module needed — you can build attack-decay shapes from math.

\`(- 1 bar)\` starts at 1 and falls to 0 over one bar — a simple decay. A triangle wave *is* an attack-release envelope, and its duty parameter controls the attack/release ratio: \`(tri 0.3 bar)\` gives 30% attack and 70% release.

Multiply an oscillator by an envelope and you get a shaped burst — a pluck, a swell, a fade. Multiply that by a gate pattern and you get rhythmic plucks.`,
    },
    {
      type: "playground" as const,
      playground: {
        code: ";; simple decay\n(a1 (- 1 bar))",
        annotation: "Starts at 1, falls to 0 — the simplest envelope",
        signals: [
          { label: "decay", channel: "a1", fn: (p: number) => 1 - p },
        ] satisfies VisSignal[],
        outputs: ["a1"],
      },
    },
    {
      type: "playground" as const,
      playground: {
        code: ";; attack-release via triangle (30% attack)\n(a1 (tri 0.3 bar))",
        annotation: "tri's 2-arity: (tri duty phasor) — duty controls the ratio",
        signals: [
          { label: "AR 30/70", channel: "a1", fn: (p: number) => utriDuty(0.3, p) },
        ] satisfies VisSignal[],
        outputs: ["a1"],
      },
    },
    {
      type: "try-it" as const,
      text: "Change `0.3` to `0.7` — now the attack is slow and the release is short. Try `0.1` for a sharp transient.",
    },
    {
      type: "playground" as const,
      playground: {
        code: `;; rhythmic plucks: envelope * oscillator * gate
(a1 (* (- 1 (fast 4 bar))
       (sin (fast 32 bar))
       (sqr (fast 4 bar))))`,
        annotation: "Envelope shapes each burst",
        signals: [
          {
            label: "plucks",
            channel: "a1",
            fn: (p: number) => {
              const env = 1 - fast(4, p);
              const osc = usin(fast(32, p));
              const gate = usqr(fast(4, p));
              return env * osc * gate;
            },
          },
        ] satisfies VisSignal[],
        outputs: ["a1"],
      },
    },
    {
      type: "deep-dive" as const,
      title: "Exponential vs linear envelopes",
      content: [
        {
          type: "prose" as const,
          text: `A linear decay \`(- 1 bar)\` drops at a constant rate. Natural sounds decay exponentially — fast at first, then slowing down. You can approximate this by squaring the decay:

\`(def env (- 1 (fast 4 bar)))\`
\`(a1 (* env env))\`

Squaring a 0-to-1 ramp pulls the curve toward zero faster at the start and makes it linger near zero at the end. Cubing \`(* env env env)\` makes the effect even more dramatic. This is how you get plucky, percussive decays without any special envelope function.

For an exponential attack, invert: \`(def atk (fast 4 bar))\` then \`(* atk atk)\` gives a slow start that accelerates — useful for swells and risers.`,
        },
        {
          type: "playground" as const,
          playground: {
            code: `;; linear vs exponential decay
(def env (- 1 (fast 4 bar)))
;; linear:
(a1 env)
;; exponential (squared):
(a2 (* env env))`,
            annotation: "Squaring curves the decay — more natural, more percussive",
            signals: [
              { label: "a1: linear", channel: "a1", fn: (p: number) => 1 - fast(4, p) },
              {
                label: "a2: squared",
                channel: "a2",
                fn: (p: number) => {
                  const e = 1 - fast(4, p);
                  return e * e;
                },
              },
            ] satisfies VisSignal[],
            outputs: ["a1", "a2"],
          },
        },
      ],
    },
    {
      type: "try-it" as const,
      text: "In the plucks example, replace `(- 1 (fast 4 bar))` with `(tri 0.1 (fast 4 bar))` — you get a sharp attack followed by a decay.",
    },
  ],
};

// ---------------------------------------------------------------------------
// Section 3.3 — Crossfading
// ---------------------------------------------------------------------------

const crossfade = {
  id: "crossfade",
  title: "Crossfading",
  summary: "if is a hard switch, multiplication is a smooth fade",
  content: [
    {
      type: "prose" as const,
      text: `\`if\` makes a hard cut between two signals — like a switch module. But you can crossfade smoothly using multiplication and addition.

The formula: use a value \`x\` (0-1) to blend between signal A and signal B:
\`(+ (* x signalA) (* (- 1 x) signalB))\`

When x = 0 you hear only B. When x = 1 you hear only A. In between, they blend proportionally. This is exactly what a crossfader does in hardware — one signal fades up as the other fades down.`,
    },
    {
      type: "playground" as const,
      playground: {
        code: `;; hard switch: sine in first half, triangle in second
(a1 (if (> bar 0.5)
  (sin (fast 8 bar))
  (tri (fast 4 bar))))`,
        annotation: "Hard cut — if is a switch",
        signals: [
          {
            label: "hard switch",
            channel: "a1",
            fn: (p: number) => (p > 0.5 ? usin(fast(8, p)) : utri(fast(4, p))),
          },
        ] satisfies VisSignal[],
        outputs: ["a1"],
      },
    },
    {
      type: "playground" as const,
      playground: {
        code: `;; smooth crossfade: bar is the blend position
(a1 (+ (* bar (sin (fast 8 bar)))
       (* (- 1 bar) (tri (fast 4 bar)))))`,
        annotation: "Multiplication is a fade, not a switch",
        signals: [
          {
            label: "crossfade",
            channel: "a1",
            fn: (p: number) => p * usin(fast(8, p)) + (1 - p) * utri(fast(4, p)),
          },
        ] satisfies VisSignal[],
        outputs: ["a1"],
      },
    },
    {
      type: "try-it" as const,
      text: "Replace `bar` with `(sin bar)` as the blend position — now the crossfade sweeps back and forth instead of going one way.",
    },
    {
      type: "playground" as const,
      playground: {
        code: `;; crossfade controlled by an LFO
(def blend (sin (slow 2 bar)))
(a1 (+ (* blend (sin (fast 8 bar)))
       (* (- 1 blend) (tri (fast 4 bar)))))`,
        annotation: "An LFO drives the blend — evolving texture",
        bars: 2,
        signals: [
          {
            label: "LFO blend",
            channel: "a1",
            fn: (p: number) => {
              const blend = usin(p * 0.5);
              return blend * usin(fast(8, p)) + (1 - blend) * utri(fast(4, p));
            },
          },
          {
            label: "blend position",
            channel: "a1",
            fn: (p: number) => usin(p * 0.5),
          },
        ] satisfies VisSignal[],
        outputs: ["a1"],
      },
    },
    {
      type: "deep-dive" as const,
      title: "Crossfade is just weighted addition",
      content: [
        {
          type: "prose" as const,
          text: `The crossfade formula \`(+ (* x A) (* (- 1 x) B))\` is a *linear interpolation* between A and B, controlled by x. Mathematically: \`output = x * A + (1 - x) * B\`.

This is the same operation as a VCA crossfader module, a DJ mixer's crossfade knob, or the blend control on a waveshaper. The insight is that multiplication by a 0-1 value is a volume control, and two complementary volume controls (x and 1-x) always sum to the full signal level — no energy is lost.

You can extend this to three-way blends by splitting the 0-1 range into overlapping windows, but for most musical purposes the two-signal crossfade covers what you need.`,
        },
      ],
    },
    {
      type: "try-it" as const,
      text: "Try crossfading between two `from-list` sequences — you get a morphing melody as one note set dissolves into another.",
    },
  ],
};

// ---------------------------------------------------------------------------
// Section 3.4 — Interpolation
// ---------------------------------------------------------------------------

const interpolation = {
  id: "interpolation",
  title: "Interpolation",
  summary: "Draw arbitrary voltage shapes with control points",
  content: [
    {
      type: "prose" as const,
      text: `\`interp\` takes a list of values and smoothly interpolates between them over the course of one phasor cycle. Think of it as drawing a shape — you place control points and the signal connects them with straight lines.

This is how you create custom voltage contours: melody lines, modulation curves, envelope shapes — anything that isn't a standard waveform. The values in the list are your waypoints, and the phasor determines how fast you travel between them.`,
    },
    {
      type: "playground" as const,
      playground: {
        code: ";; custom voltage contour\n(a1 (interp [0 1 0.3 0.8 0] bar))",
        annotation: "Five control points, one bar",
        signals: [
          { label: "contour", channel: "a1", fn: (p: number) => interp([0, 1, 0.3, 0.8, 0], p) },
        ] satisfies VisSignal[],
        outputs: ["a1"],
      },
    },
    {
      type: "try-it" as const,
      text: "Add more values to the list — `[0 1 0.3 0.8 0.5 0.1 0]` — and watch the shape gain more segments.",
    },
    {
      type: "playground" as const,
      playground: {
        code: `;; repeated and scaled
(a1 (scale 0 1 0.2 0.9
       (interp [0 1 0 0.5 0] (fast 2 bar))))`,
        annotation: "fast repeats the shape, scale fits the range",
        signals: [
          {
            label: "repeated+scaled",
            channel: "a1",
            fn: (p: number) =>
              scale(interp([0, 1, 0, 0.5, 0], fast(2, p)), 0, 1, 0.2, 0.9),
          },
        ] satisfies VisSignal[],
        outputs: ["a1"],
      },
    },
    {
      type: "playground" as const,
      playground: {
        code: `;; interp as a melody contour
(a1 (interp [0.2 0.5 0.5 0.8 0.3 0.6 0.4 0.2]
            (fast 2 bar)))`,
        annotation: "Eight notes, smoothly connected — a melodic phrase",
        signals: [
          {
            label: "melody",
            channel: "a1",
            fn: (p: number) =>
              interp([0.2, 0.5, 0.5, 0.8, 0.3, 0.6, 0.4, 0.2], fast(2, p)),
          },
        ] satisfies VisSignal[],
        outputs: ["a1"],
      },
    },
    {
      type: "deep-dive" as const,
      title: "Combining interp with fast and scale",
      content: [
        {
          type: "prose" as const,
          text: `\`interp\` on its own draws one shape per phasor cycle. Wrapping it with \`fast\` repeats the shape: \`(interp [0 1 0] (fast 4 bar))\` draws four arcs per bar.

Wrapping with \`scale\` remaps the output range: \`(scale 0 1 0.3 0.7 (interp ...))\` compresses the full 0-1 shape into the 0.3-0.7 range. This is useful for targeting a specific voltage range on an output.

You can also use \`interp\` as a modulation source for other parameters. For instance, \`(fast (interp [2 8 4 1] bar) bar)\` creates a rhythm whose speed changes according to your custom contour — fast, then slow, then medium, all within one bar.`,
        },
        {
          type: "playground" as const,
          playground: {
            code: `;; interp driving speed — custom acceleration curve
(d1 (sqr (fast (interp [2 8 4 1] bar)
               bar)))`,
            annotation: "Speed follows a custom contour over one bar",
            signals: [
              {
                label: "speed contour",
                channel: "d1",
                fn: (p: number) => interp([2, 8, 4, 1], p) / 8,
              },
              {
                label: "gated output",
                channel: "d1",
                fn: (p: number) => {
                  const speed = interp([2, 8, 4, 1], p);
                  return usqr(fast(speed, p));
                },
                digital: true,
              },
            ] satisfies VisSignal[],
            outputs: ["d1"],
          },
        },
      ],
    },
    {
      type: "try-it" as const,
      text: "Use `interp` to build an envelope shape: `(a1 (* (interp [0 1 0.8 0.3 0] (fast 4 bar)) (sin (fast 32 bar))))` — custom pluck contour.",
    },
  ],
};

// ---------------------------------------------------------------------------
// Chapter 3 — Modulation and Expression
// ---------------------------------------------------------------------------

export const chapter3: Chapter = {
  id: "modulation",
  title: "Modulation and Expression",
  summary:
    "Replace any number with a signal and you've invented modulation.",
  domain: "language",
  sections: [signalsAsKnobs, envelopes, crossfade, interpolation],
};
