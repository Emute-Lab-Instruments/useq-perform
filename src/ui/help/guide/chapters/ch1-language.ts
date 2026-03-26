/**
 * Chapter 1: The Language
 *
 * Migrated and expanded from the lisp-syntax and structural-editing lessons
 * in lessonData.ts. Content follows docs/USER_GUIDE_SPEC.md Chapter 1.
 */

import type { Chapter, VisSignal } from "../guideTypes";

// ---------------------------------------------------------------------------
// DSP helpers — small building blocks for static VisSignal lambdas
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

/** Simple from-list: pick item by phasor. */
const fromList = (list: number[], p: number): number => {
  const idx = Math.min(Math.floor(frac(p) * list.length), list.length - 1);
  return list[idx];
};

/** scale(value, inMin, inMax, outMin, outMax). */
const scale = (
  v: number,
  _inMin: number,
  _inMax: number,
  outMin: number,
  outMax: number,
): number => outMin + (v - _inMin) / (_inMax - _inMin) * (outMax - outMin);

// ---------------------------------------------------------------------------
// Chapter 1
// ---------------------------------------------------------------------------

export const chapter1: Chapter = {
  id: "language",
  title: "The Language",
  summary: "ModuLisp has one rule: everything is a list, function first.",
  domain: "language",
  sections: [
    // -----------------------------------------------------------------------
    // 1.1 Why Parentheses?
    // -----------------------------------------------------------------------
    {
      id: "why-parens",
      title: "Why Parentheses?",
      summary: "The one rule: (function arg1 arg2 ...)",
      content: [
        {
          type: "prose",
          text:
            "ModuLisp is a dialect of Lisp — one of the oldest and simplest programming " +
            "languages. The syntax has exactly *one* rule: everything is a list wrapped " +
            "in parentheses, and the first item in the list is always the function.",
        },
        {
          type: "prose",
          text:
            "In most languages you'd write `1 + 2`. In ModuLisp you write `(+ 1 2)`. " +
            "The operator goes first, then its arguments. That's it — there's no other " +
            "syntax to learn. No commas, no semicolons, no operator precedence to remember.",
        },
        {
          type: "playground",
          playground: {
            code: "(+ 1 2)",
            annotation: "The one rule: (function arg1 arg2 ...)",
          },
        },
        {
          type: "prose",
          text:
            "Why is this useful for music? Because nesting is effortless. " +
            "`(* 0.5 (+ 1 2))` means \"add 1 and 2, then multiply by 0.5\". You never " +
            "need to worry about whether `*` binds tighter than `+` — the parentheses " +
            "make the grouping explicit. Each pair of parentheses is one operation.",
        },
        {
          type: "playground",
          playground: {
            code: "(* 0.5 (+ 1 2))",
            annotation: "Inner expression evaluates first: (* 0.5 3) -> 1.5",
          },
        },
        {
          type: "prose",
          text:
            "Output functions like `a1` and `d1` assign a signal to a hardware output. " +
            "You can have as many top-level expressions as you like — each one is " +
            "evaluated independently.",
        },
        {
          type: "playground",
          playground: {
            code: "(a1 (sin bar))",
            annotation: "a1 sends the signal to CV output 1",
            signals: [
              { label: "a1", channel: "a1", fn: (p) => usin(p) },
            ],
          },
        },
        {
          type: "playground",
          playground: {
            code: "(def speed 4)\n(d1 (sqr (fast speed bar)))",
            annotation: "def binds a name — use it anywhere below",
            signals: [
              {
                label: "d1",
                channel: "d1",
                fn: (p) => usqr(fast(4, p)),
                digital: true,
              },
            ],
          },
        },
        {
          type: "prose",
          text:
            "Vectors use square brackets: `[1 0.5 0 0.8]`. These are used for data — " +
            "lists of values that a function like `from-list` will read from. Square " +
            "brackets hold data, parentheses run code.",
        },
        {
          type: "playground",
          playground: {
            code: "(a1 (from-list [0.2 0.5 0.8 0.3] bar))",
            annotation: "Square brackets = data, parentheses = code",
            signals: [
              { label: "a1", channel: "a1", fn: (p) => fromList([0.2, 0.5, 0.8, 0.3], p) },
            ],
          },
        },
      ],
    },

    // -----------------------------------------------------------------------
    // 1.2 Naming Things
    // -----------------------------------------------------------------------
    {
      id: "naming",
      title: "Naming Things",
      summary: "def binds a name to a value for reuse",
      content: [
        {
          type: "prose",
          text:
            "`def` binds a name to a value: `(def speed 4)`. Once defined, you can " +
            "use the name anywhere below it. Names make your code readable and " +
            "changeable — update the definition and every use follows.",
        },
        {
          type: "playground",
          playground: {
            code: "(def speed 4)\n(d1 (sqr (fast speed bar)))",
            annotation: "Change speed to 8 and hear the difference",
            signals: [
              {
                label: "d1",
                channel: "d1",
                fn: (p) => usqr(fast(4, p)),
                digital: true,
              },
            ],
          },
        },
        {
          type: "tip",
          text:
            "Good names act as documentation. `(def lfo-rate 0.25)` tells the reader " +
            "what the value is for, even months later.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    // 1.3 Outputs and Inputs
    // -----------------------------------------------------------------------
    {
      id: "outputs-inputs",
      title: "Outputs and Inputs",
      summary:
        "a1\u2013a3 send CV, d1\u2013d3 send gates, ain1/ain2/swm/swt read hardware",
      content: [
        {
          type: "prose",
          text:
            "uSEQ has three analogue outputs (`a1`, `a2`, `a3`) that send continuous " +
            "CV in the 0\u20131 range, and three digital outputs (`d1`, `d2`, `d3`) " +
            "that send binary gates (0 or 1). Each output is a function that takes one " +
            "argument — the signal to send.",
        },
        {
          type: "prose",
          text:
            "For inputs, `ain1` and `ain2` are analogue CV inputs, `swm` is the " +
            "momentary push-button, and `swt` is the three-position toggle switch " +
            "(returns -1, 0, or 1). These are *bare variables*, not function calls — " +
            "write `ain1`, not `(ain1)`.",
        },
        {
          type: "playground",
          playground: {
            code: "(a1 ain1)",
            annotation: "Echo CV input directly to output",
          },
        },
        {
          type: "playground",
          playground: {
            code: "(d1 swm)",
            annotation: "Momentary switch controls a gate output",
          },
        },
        {
          type: "tip",
          text:
            "`swt` returns -1, 0, or 1 for the three positions of the toggle switch. " +
            "Use it to choose between modes or settings in your patch.",
        },
        {
          type: "reference-table",
          rows: [
            { name: "a1, a2, a3", signature: "(a1 signal)", description: "Send continuous CV (0\u20131) to analogue output" },
            { name: "d1, d2, d3", signature: "(d1 signal)", description: "Send binary gate (0/1) to digital output" },
            { name: "ain1, ain2", signature: "ain1", description: "Read analogue CV input (bare variable)" },
            { name: "swm", signature: "swm", description: "Momentary push-button (bare variable, 0 or 1)" },
            { name: "swt", signature: "swt", description: "Three-position toggle (bare variable, -1/0/1)" },
          ],
        },
      ],
    },

    // -----------------------------------------------------------------------
    // 1.4 The Last Argument Convention
    // -----------------------------------------------------------------------
    {
      id: "last-arg",
      title: "The Last Argument Convention",
      summary:
        "The signal you're transforming is always the last argument",
      content: [
        {
          type: "prose",
          text:
            "In ModuLisp, the signal you're transforming is the *last* argument. This " +
            "means you wrap operations around a signal like layers of an onion. Read " +
            "inside-out: the innermost expression is the raw signal, the outermost is " +
            "the final transform.",
        },
        {
          type: "playground",
          playground: {
            code: "(fast 4 bar)",
            annotation: "Take bar, make it 4x faster",
            signals: [
              { label: "a1", channel: "a1", fn: (p) => fast(4, p) },
            ],
          },
        },
        {
          type: "playground",
          playground: {
            code: "(scale 0 1 0.2 0.8 (sin bar))",
            annotation: "Take sin of bar, then scale it to 0.2\u20130.8",
            signals: [
              { label: "a1", channel: "a1", fn: (p) => scale(usin(p), 0, 1, 0.2, 0.8) },
            ],
          },
        },
        {
          type: "playground",
          playground: {
            code: "(fast 4 (shift 0.25 bar))",
            annotation: "Take bar, shift it, then speed it up",
            signals: [
              { label: "a1", channel: "a1", fn: (p) => fast(4, shift(0.25, p)) },
            ],
          },
        },
        {
          type: "tip",
          text:
            "Anywhere you can write a number, you can write an expression instead. " +
            "That's where modulation comes from — replacing a fixed value with a moving one.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    // 1.5 Structural Editing
    // -----------------------------------------------------------------------
    {
      id: "structural-editing",
      title: "Structural Editing",
      summary:
        "The editor keeps parentheses balanced — reshape code without breaking it",
      content: [
        {
          type: "prose",
          text:
            "Because ModuLisp code is made of nested lists, the editor understands the " +
            "*structure* of your code — not just the characters. This means you can " +
            "reshape expressions without manually counting parentheses. The parentheses " +
            "will always stay balanced.",
        },
        {
          type: "prose",
          text:
            "*Slurp forward* (`Ctrl-]`): Expand the current list to pull the next " +
            "form inside. If your cursor is inside `(+ 1)` and `2` is after it, " +
            "slurp pulls `2` inside to get `(+ 1 2)`.",
        },
        {
          type: "try-it",
          text:
            "Place your cursor inside `(fast 4)` and press `Ctrl-]` to slurp `bar` into it.",
        },
        {
          type: "playground",
          playground: {
            code: "(a1 (fast 4) bar)",
            annotation: "Slurp forward: Ctrl-] pulls the next form in",
          },
        },
        {
          type: "prose",
          text:
            "*Barf forward* (`Ctrl-'`): The opposite — push the last item out of " +
            "the current list. `(fast 4 bar)` barfs to `(fast 4) bar`.",
        },
        {
          type: "try-it",
          text:
            "Place your cursor inside `(fast 4 bar)` and press `Ctrl-'` to barf `bar` back out.",
        },
        {
          type: "playground",
          playground: {
            code: "(a1 (fast 4 bar))",
            annotation: "Barf forward: Ctrl-' pushes the last form out",
          },
        },
        {
          type: "prose",
          text:
            "*Unwrap* (`Alt-s`): Remove the surrounding parentheses, lifting the " +
            "contents into the parent.",
        },
        {
          type: "try-it",
          text:
            "Place your cursor on `sin` and press `Alt-s` to unwrap the `(sin bar)` parentheses.",
        },
        {
          type: "playground",
          playground: {
            code: "(a1 (* 0.5 (sin bar)))",
            annotation: "Unwrap: Alt-s removes surrounding parens",
          },
        },
        {
          type: "prose",
          text:
            "*Kill* (`Ctrl-k`): Delete everything from the cursor to the end of " +
            "the current list.",
        },
        {
          type: "try-it",
          text:
            "Place your cursor after `0.5` and press `Ctrl-k` to kill the rest of the inner list.",
        },
        {
          type: "playground",
          playground: {
            code: "(a1 (* 0.5 (sin (fast 8 bar)) (tri bar)))",
            annotation: "Kill: Ctrl-k deletes to end of current list",
          },
        },
        {
          type: "prose",
          text: "Practice combining these commands to restructure code freely:",
        },
        {
          type: "playground",
          playground: {
            code: "(a1 (+ (* 0.5 (sin (fast 4 bar)))\n       (* 0.5 (tri bar))))",
            annotation: "Combine slurp, barf, unwrap to restructure",
            signals: [
              {
                label: "a1",
                channel: "a1",
                fn: (p) => 0.5 * usin(fast(4, p)) + 0.5 * utri(p),
              },
            ],
          },
        },
        {
          type: "reference-table",
          rows: [
            { name: "Slurp forward", signature: "Ctrl-]", description: "Pull next form into current list" },
            { name: "Barf forward", signature: "Ctrl-'", description: "Push last form out of current list" },
            { name: "Slurp backward", signature: "Ctrl-[", description: "Pull previous form into current list" },
            { name: "Barf backward", signature: "Ctrl-;", description: "Push first form out of current list" },
            { name: "Unwrap", signature: "Alt-s", description: "Remove surrounding parentheses" },
            { name: "Kill", signature: "Ctrl-k", description: "Delete to end of current list" },
          ],
        },
      ],
    },

    // -----------------------------------------------------------------------
    // 1.6 Tempo and Timing
    // -----------------------------------------------------------------------
    {
      id: "tempo",
      title: "Tempo and Timing",
      summary: "set-bpm controls the speed of beat, bar, phrase, section",
      content: [
        {
          type: "prose",
          text:
            "`set-bpm` sets the tempo in beats per minute. This controls how fast " +
            "`beat` runs, and since `bar`, `phrase`, and `section` are all derived " +
            "from `beat`, the entire timing hierarchy follows.",
        },
        {
          type: "playground",
          playground: {
            code: "(set-bpm 120)",
            annotation: "Set the tempo to 120 BPM",
          },
        },
        {
          type: "prose",
          text:
            "`set-time-sig` controls how many beats make a bar. `(set-time-sig 4 4)` " +
            "means four beats per bar — the default.",
        },
        {
          type: "playground",
          playground: {
            code: "(set-time-sig 4 4)",
            annotation: "Four beats per bar (the default time signature)",
          },
        },
        {
          type: "prose",
          text:
            "The phasor hierarchy: `beat` is the fastest — one ramp per beat. `bar` " +
            "spans one full bar (4 beats in 4/4). `phrase` spans 4 bars. `section` " +
            "spans 4 phrases. Each level is just a slower phasor.",
        },
        {
          type: "deep-dive",
          title: "External clock sync",
          content: [
            {
              type: "prose",
              text:
                "If you have external gear sending clock pulses, use `set-clock-ext` " +
                "to sync. `(set-clock-ext 1 1)` means \"listen on gate input 1, " +
                "one pulse per beat\". `(set-clock-ext 2 4)` syncs to gate input 2 " +
                "with a divisor of 4. Use `(reset-clock-int)` or `(reset-clock-ext)` " +
                "to reset.",
            },
            {
              type: "playground",
              playground: {
                code: "(set-clock-ext 1 1)",
                annotation: "Sync to gate input 1, one pulse per beat",
              },
            },
          ],
        },
        {
          type: "prose",
          text:
            "Your first signal: a square wave that cycles once per bar. `(d1 (sqr bar))` " +
            "sends a gate that is high for the first half of each bar and low for the second.",
        },
        {
          type: "playground",
          playground: {
            code: "(d1 (sqr bar))",
            annotation: "A square wave cycling once per bar",
            signals: [
              {
                label: "d1",
                channel: "d1",
                fn: (p) => usqr(p),
                digital: true,
              },
            ],
          },
        },
      ],
    },
  ],
};
