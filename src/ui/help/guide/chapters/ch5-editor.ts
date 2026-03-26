import type { Chapter } from "../guideTypes";

export const chapter5: Chapter = {
  id: "editor",
  title: "Working with the Editor",
  summary: "Save your work, manage your patches, use the tools.",
  domain: "editor",
  sections: [
    // -----------------------------------------------------------------------
    // 5.1 Saving and Loading
    // -----------------------------------------------------------------------
    {
      id: "saving",
      title: "Saving and Loading",
      summary: "Your code auto-saves in the browser; save to file for backup",
      content: [
        {
          type: "prose",
          text: "Every change you make in the editor is automatically saved to your browser's localStorage. Close the tab, reopen it tomorrow — your code is still there.",
        },
        {
          type: "tip",
          text: "Auto-save is per-browser. If you switch browsers or clear site data, your code is gone. Use file save for anything you want to keep.",
        },
        {
          type: "prose",
          text: "The toolbar has *Save* and *Load* buttons for exporting your code to a `.txt` file and importing it back. Use these to back up your patches, share them, or move between machines.",
        },
        {
          type: "prose",
          text: "The *Snippets* tab in this help panel holds a library of reusable code fragments. You can drag any snippet into the editor, or save your own selections as new snippets for later.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    // 5.2 The Visualisation Panel
    // -----------------------------------------------------------------------
    {
      id: "visualisation",
      title: "The Visualisation Panel",
      summary: "See your signals as waveforms — toggle with Alt+G",
      content: [
        {
          type: "prose",
          text: "The visualisation panel shows your registered output expressions sampled over time. Each output channel — `a1`, `a2`, `d1`, `d2`, etc. — appears as a labelled trace so you can see exactly what your code is producing.",
        },
        {
          type: "prose",
          text: "Toggle the panel with `Alt+G`. When visible it updates continuously, giving you a real-time oscilloscope view of every active output.",
        },
        {
          type: "prose",
          text: "Analog channels (`a1`–`a3`) are drawn as continuous waveforms on a 0–1 vertical axis. Digital channels (`d1`–`d3`) are rendered as horizontal gate lanes — high or low, nothing in between. A vertical marker shows the current playback position, and the time window scrolls to keep it in view.",
        },
        {
          type: "tip",
          text: "The probe oscilloscopes in this guide use the same rendering engine as the main visualisation panel. What you see here is exactly what you will see there.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    // 5.3 Evaluation Modes
    // -----------------------------------------------------------------------
    {
      id: "eval-modes",
      title: "Evaluation Modes",
      summary:
        "Ctrl+Enter for immediate, Alt+Enter for quantised, Ctrl+Shift+Enter for preview",
      content: [
        {
          type: "prose",
          text: "There are three ways to evaluate code, each suited to a different situation.",
        },
        {
          type: "prose",
          text: "`Ctrl+Enter` — *Evaluate immediately.* The code is sent to the WASM interpreter and, if a module is connected, to the hardware at the same time. Changes take effect right now. Use this when you are experimenting or do not care about timing alignment.",
        },
        {
          type: "prose",
          text: "`Alt+Enter` — *Quantised evaluation.* The code is scheduled to take effect at the start of the next bar. This keeps your changes musically aligned — no awkward mid-beat jumps. Use this during a performance or whenever rhythmic continuity matters.",
        },
        {
          type: "prose",
          text: "`Ctrl+Shift+Enter` — *Preview in WASM only.* The code runs in the browser's built-in interpreter but is *not* sent to the connected module. Use this to test an idea without affecting your live output.",
        },
        {
          type: "tip",
          text: "When no hardware is connected, `Ctrl+Enter` and `Ctrl+Shift+Enter` behave the same way — both evaluate in the WASM interpreter only.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    // 5.4 Randomness
    // -----------------------------------------------------------------------
    {
      id: "randomness",
      title: "Randomness",
      summary: "random changes every beat; random' changes every tick",
      content: [
        {
          type: "prose",
          text: "`random` generates a new value on every beat. Between beats the value stays the same — it is deterministic within each beat window.",
        },
        {
          type: "prose",
          text: "With no arguments, `(random)` returns a float between 0 and 1. With one argument, `(random 10)` returns an integer from 0 to 9. With two arguments, `(random 3 7)` returns an integer in the range 3–6.",
        },
        {
          type: "prose",
          text: "`random'` (with a prime) has the same arities but is *volatile* — it produces a new value on every evaluation tick, not just every beat. The result changes continuously, which is useful for noise-like textures but less useful for stable per-beat values.",
        },
        {
          type: "prose",
          text: "You can control how often `random` changes by wrapping its time base with `fast` or `slow`. For example, `(random (fast 4 bar))` changes four times per bar instead of once per beat.",
        },
        {
          type: "playground",
          playground: {
            code: "(a1 (random))\n(a2 (random 3 7))",
            annotation:
              "random produces a new value every beat — try changing the range arguments",
            outputs: ["a1", "a2"],
          },
        },
        {
          type: "try-it",
          text: "Replace `random` with `random'` and watch how the output becomes noisy instead of stepping once per beat.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    // 5.5 Quick Function Reference
    // -----------------------------------------------------------------------
    {
      id: "function-reference",
      title: "Quick Function Reference",
      summary:
        "The most common functions at a glance — see Reference tab for the full list",
      content: [
        {
          type: "prose",
          text: "The table below lists the functions and operators you will use most often, grouped by purpose. For complete documentation, signatures, and examples, open the *Reference* tab.",
        },
        {
          type: "reference-table",
          rows: [
            // Wave shapers
            {
              name: "sin",
              signature: "(sin phasor)",
              description: "Sine wave shaper (0–1 output)",
            },
            {
              name: "sqr",
              signature: "(sqr phasor) | (sqr duty phasor)",
              description:
                "Square wave; optional duty cycle (0–1, default 0.5)",
            },
            {
              name: "tri",
              signature: "(tri phasor) | (tri duty phasor)",
              description:
                "Triangle wave; optional duty shifts the peak position",
            },
            {
              name: "saw",
              signature: "(saw phasor)",
              description: "Sawtooth — returns the phasor unchanged",
            },
            {
              name: "pulse",
              signature: "(pulse width phasor)",
              description: "Pulse wave with explicit width (0–1)",
            },

            // Sequencing
            {
              name: "from-list",
              signature: "(from-list [vals] phasor) | (from-list [vals] scale phasor)",
              description:
                "Step through values by phasor position; optional scale multiplier",
            },
            {
              name: "interp",
              signature: "(interp [points] phasor)",
              description:
                "Linear interpolation between control points (0–1 input)",
            },
            {
              name: "euclid",
              signature:
                "(euclid k n phasor) | (euclid k n offset pw phasor)",
              description:
                "Euclidean rhythm: k hits in n steps, optional offset and pulse width",
            },
            {
              name: "gates",
              signature: "(gates [pattern] phasor) | (gates [pattern] pw phasor)",
              description:
                "Gate sequence from a binary list; optional pulse width",
            },
            {
              name: "trigs",
              signature: "(trigs [pattern] phasor)",
              description:
                "Trigger sequence with per-step amplitude (0–9)",
            },

            // Time
            {
              name: "fast",
              signature: "(fast n phasor)",
              description: "Speed up a phasor by factor n",
            },
            {
              name: "slow",
              signature: "(slow n phasor)",
              description: "Slow down a phasor by factor n",
            },
            {
              name: "shift",
              signature: "(shift amount phasor)",
              description: "Phase-shift a phasor (0–1 wraps)",
            },
            {
              name: "bar",
              signature: "bar",
              description: "Phasor that ramps 0–1 once per bar",
            },
            {
              name: "beat",
              signature: "beat",
              description: "Phasor that ramps 0–1 once per beat",
            },
            {
              name: "phrase",
              signature: "phrase",
              description: "Phasor that ramps 0–1 once per phrase (4 bars)",
            },
            {
              name: "section",
              signature: "section",
              description: "Phasor that ramps 0–1 once per section (16 bars)",
            },

            // Math
            {
              name: "+",
              signature: "(+ a b ...)",
              description: "Addition / mixing",
            },
            {
              name: "-",
              signature: "(- a b)",
              description: "Subtraction",
            },
            {
              name: "*",
              signature: "(* a b ...)",
              description: "Multiplication / amplitude control",
            },
            {
              name: "/",
              signature: "(/ a b)",
              description: "Division",
            },
            {
              name: "%",
              signature: "(% a b)",
              description: "Modulo (remainder)",
            },
            {
              name: "floor",
              signature: "(floor x)",
              description: "Round down to integer",
            },
            {
              name: "ceil",
              signature: "(ceil x)",
              description: "Round up to integer",
            },
            {
              name: "abs",
              signature: "(abs x)",
              description: "Absolute value",
            },
            {
              name: "min",
              signature: "(min a b)",
              description: "Smaller of two values",
            },
            {
              name: "max",
              signature: "(max a b)",
              description: "Larger of two values",
            },
            {
              name: "scale",
              signature: "(scale inMin inMax outMin outMax signal)",
              description: "Map a signal from one range to another",
            },

            // Logic
            {
              name: "if",
              signature: "(if cond then else)",
              description: "Conditional: returns then when cond > 0, else otherwise",
            },
            {
              name: ">",
              signature: "(> a b)",
              description: "Greater than (returns 0 or 1)",
            },
            {
              name: "<",
              signature: "(< a b)",
              description: "Less than (returns 0 or 1)",
            },
            {
              name: ">=",
              signature: "(>= a b)",
              description: "Greater than or equal (returns 0 or 1)",
            },
            {
              name: "<=",
              signature: "(<= a b)",
              description: "Less than or equal (returns 0 or 1)",
            },
            {
              name: "=",
              signature: "(= a b)",
              description: "Equality (returns 0 or 1)",
            },

            // Inputs (variables, not functions)
            {
              name: "ain1",
              signature: "ain1",
              description: "CV input 1 (variable, not a function)",
            },
            {
              name: "ain2",
              signature: "ain2",
              description: "CV input 2 (variable, not a function)",
            },
            {
              name: "swm",
              signature: "swm",
              description:
                "Momentary switch: 1 while held, 0 otherwise (variable)",
            },
            {
              name: "swt",
              signature: "swt",
              description:
                "Toggle switch: returns -1, 0, or 1 (variable)",
            },

            // System
            {
              name: "set-bpm",
              signature: "(set-bpm n)",
              description: "Set tempo in beats per minute",
            },
            {
              name: "set-time-sig",
              signature: "(set-time-sig beats subdivisions)",
              description: "Set time signature (beats per bar)",
            },
            {
              name: "set-clock-ext",
              signature: "(set-clock-ext input divisor)",
              description: "Sync to external clock on given input",
            },
            {
              name: "set-clock-int",
              signature: "(set-clock-int)",
              description: "Switch back to internal clock",
            },
            {
              name: "def",
              signature: "(def name value)",
              description: "Bind a name to a value",
            },
          ],
        },
      ],
    },
  ],
};
