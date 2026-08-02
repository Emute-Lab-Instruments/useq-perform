/**
 * Chapter 0: How uSEQ thinks.
 *
 * Spec: `docs/specs/the-machine.md` §3. The opening chapter of the Language
 * domain. Six ideas in order, schematic-first, prose-second — each one short
 * paragraph, one playground with a probe, one "try it" prompt.
 *
 * The primary playground of each section is the *same object* the schematic
 * shows for that idea (`MACHINE_IDEAS`), so the two renderings of the six
 * ideas cannot drift apart. `ch0-machine.test.ts` asserts that.
 *
 * Witness coupling (witnesses.md §4): every primary playground carries a
 * `witnessRef` naming the conformance case that proves the behaviour it
 * teaches. `witnessRefs.test.ts` parses the corpus and asserts they resolve.
 */

import type { Chapter, Playground } from "../guideTypes";
import {
  MACHINE_IDEAS,
  type MachineIdeaId,
} from "../../machine/machineModel";

/**
 * The playground the schematic shows for a given idea. Shared by reference,
 * not copied — if the schematic's example changes, the chapter's changes with
 * it, and the witness ref travels along.
 */
function ideaPlayground(id: MachineIdeaId): Playground {
  const idea = MACHINE_IDEAS.find((candidate) => candidate.id === id);
  if (!idea) {
    throw new Error(`ch0-machine: unknown machine idea "${id}"`);
  }
  return idea.playground;
}

export const chapter0: Chapter = {
  id: "machine",
  title: "How uSEQ Thinks",
  summary:
    "Six ideas that explain everything else: a clock runs, your code is a shape it reads, and the result lands on the jacks.",
  domain: "language",
  intro: [
    {
      type: "machine",
    },
    {
      type: "prose",
      text:
        "That diagram is not a picture — it is the module, live. The clock " +
        "turns when the transport is running, a row appears for every output " +
        "you have evaluated, and each jack draws the values it is actually " +
        "putting out. If nothing is moving, nothing is running. Click any of " +
        "the three parts to read what it does.",
    },
  ],
  sections: [
    // -----------------------------------------------------------------------
    // 1. Time flows in
    // -----------------------------------------------------------------------
    {
      id: "machine-time",
      title: "1. Time Flows In",
      summary: "A clock runs whether you are typing or not",
      content: [
        {
          type: "prose",
          text:
            "uSEQ has a clock, and it never stops to wait for you. It hands " +
            "your code the current time: `t`, counted in seconds since the " +
            "transport started. From `t` it derives the two numbers you will " +
            "use most — `beat` and `bar` — each a ramp that climbs from 0 to " +
            "1 and snaps back to 0 when the beat or bar turns over.",
        },
        {
          type: "prose",
          text:
            "You never advance time yourself. There is no “next step”, no " +
            "loop you write, no counter you increment. You describe what " +
            "should be true at each moment; the clock supplies the moments.",
        },
        {
          type: "playground",
          playground: ideaPlayground("time-flows-in"),
        },
        {
          type: "try-it",
          text:
            "Change `t` to `beat`, then to `bar`. `t` climbs forever; " +
            "`beat` and `bar` reset. Watch how the probe's shape changes " +
            "from a ramp that leaves the top of the window to one that " +
            "keeps coming back.",
        },
        {
          type: "deep-dive",
          title: "Why ramps, and not counters?",
          content: [
            {
              type: "prose",
              text:
                "A ramp from 0 to 1 is the most useful shape a clock can " +
                "hand you, because it is already the input every other " +
                "musical function wants. Feed a ramp to `sin` and you get an " +
                "LFO. Feed it to `from-list` and you get a sequencer. Feed it " +
                "to `>` and you get a gate. One number, and everything " +
                "downstream is a transformation of it.",
            },
            {
              type: "prose",
              text:
                "The counting versions exist too when you need them — " +
                "`beat-num` and `bar-num` count upwards and never wrap, and " +
                "`beat-dur` and `bar-dur` give you the length of a beat or a " +
                "bar in seconds at the current tempo.",
            },
          ],
        },
      ],
    },

    // -----------------------------------------------------------------------
    // 2. Your expression is a signal
    // -----------------------------------------------------------------------
    {
      id: "machine-signal",
      title: "2. Your Expression Is a Signal",
      summary: "Code is a shape time moves through, not a list of steps",
      content: [
        {
          type: "prose",
          text:
            "This is the idea that makes uSEQ feel different from most " +
            "programming. An expression does not run once and finish. It is " +
            "a shape the module re-reads at every instant, forever, until " +
            "you replace it.",
        },
        {
          type: "prose",
          text:
            "Write `bar` and you have not asked for a number — you have " +
            "described a ramp. Write `(* 0.5 bar)` and you have described a " +
            "shallower ramp. Write `(sin bar)` and you have described a " +
            "curve. The code sits still; time moves through it.",
        },
        {
          type: "playground",
          playground: ideaPlayground("expression-is-signal"),
        },
        {
          type: "try-it",
          text:
            "Wrap it: change `(a1 bar)` to `(a1 (sin bar))`, then to " +
            "`(a1 (* 0.5 (sin bar)))`. Each wrapper reshapes the same ramp. " +
            "Nothing “runs” — you are just describing a different shape.",
        },
        {
          type: "tip",
          text:
            "The signal you are transforming is almost always the *last* " +
            "argument. `(fast 2 bar)`, `(sin bar)`, `(* 0.5 bar)` — the thing " +
            "being shaped goes at the end, so wrapping reads left to right " +
            "like layers of an onion.",
        },
        {
          type: "deep-dive",
          title: "What “evaluated at every instant” really means",
          content: [
            {
              type: "prose",
              text:
                "In practice the module samples your expression thousands of " +
                "times a second and writes the answer to the jack. Because " +
                "each sample is computed from the current time and nothing " +
                "else, asking twice at the same moment gives the same answer " +
                "twice — the expression has no hidden position it is stepping " +
                "through. That is what makes wrapping in §4 possible at all: " +
                "if the answer depends only on the time you hand it, you can " +
                "hand it a different time.",
            },
            {
              type: "prose",
              text:
                "The exception is the handful of expressions that carry " +
                "memory on purpose — see §5.",
            },
          ],
        },
      ],
    },

    // -----------------------------------------------------------------------
    // 3. Values land on outputs
    // -----------------------------------------------------------------------
    {
      id: "machine-outputs",
      title: "3. Values Land on Outputs",
      summary: "a1–a8 and d1–d8 are the physical jacks",
      content: [
        {
          type: "prose",
          text:
            "`a1` through `a8` are the CV outputs on the front panel — " +
            "continuous voltages. `d1` through `d8` are the gate outputs — " +
            "on or off. Naming one is how a signal leaves the software and " +
            "reaches your patch cables: `(a3 0.1)` means “from now on, a3 " +
            "carries this”.",
        },
        {
          type: "prose",
          text:
            "Each output is independent. Assigning `a3` does not touch `a1`, " +
            "does not restart the clock, and does not disturb anything else " +
            "you have running. That is why you can build a patch one output " +
            "at a time while it plays.",
        },
        {
          type: "playground",
          playground: ideaPlayground("values-land-on-outputs"),
        },
        {
          type: "try-it",
          text:
            "Evaluate `(a3 0.1)`, then add `(a1 bar)` on a second line and " +
            "evaluate that too. Look at the schematic at the top of this " +
            "chapter: two rows, two jacks, and `a3` still sitting at its " +
            "constant while `a1` moves.",
        },
        {
          type: "tip",
          text:
            "Patch it: `a1` into a filter cutoff, `d1` into an envelope " +
            "gate. CV outputs sweep, gate outputs trigger. The difference is " +
            "not in the language — it is in which jack you named.",
        },
      ],
    },

    // -----------------------------------------------------------------------
    // 4. Wrapping bends time  (probe depth is the teacher — the-machine.md §3.2)
    // -----------------------------------------------------------------------
    {
      id: "machine-warps",
      title: "4. Wrapping Bends Time",
      summary: "fast, slow and offset hand the inside a different clock",
      content: [
        {
          type: "prose",
          text:
            "`fast`, `slow` and `offset` do not change what an expression " +
            "means. They change the clock it is handed. `(fast 2 t)` runs the " +
            "inside on a clock that moves twice as quickly, so half a second " +
            "in, the inside already reads one second.",
        },
        {
          type: "playground",
          playground: ideaPlayground("wrapping-bends-time"),
        },
        {
          type: "prose",
          text:
            "Wrappers nest, and each layer bends the clock that the layer " +
            "inside it sees. `(slow 4 (fast 2 bar))` is a ramp running at " +
            "half speed, because the two bends compose.",
        },
        {
          type: "playground",
          playground: {
            code: "(a1 (fast 2 (slow 4 t)))",
            annotation: "Two bends compose into one: half speed overall",
            outputs: ["a1"],
            bars: 2,
            witnessRef: "nested-warps-compose",
          },
        },
        {
          type: "try-it",
          text:
            "This is the one place a probe teaches better than any diagram. " +
            "Put a probe on the inner `bar` of `(a1 (fast 2 (sin bar)))`, " +
            "then walk its depth control from 0 upwards with the left and " +
            "right carets. At depth 0 you see the ramp on the module's own " +
            "clock. Step the depth up and you see the same ramp on the clock " +
            "the wrapper hands it — the wrapper turning on, one layer at a " +
            "time.",
        },
        {
          type: "deep-dive",
          title: "fast vs rate-as: speed changes that jump, and ones that don't",
          content: [
            {
              type: "prose",
              text:
                "`fast` is a substitution: it multiplies the time it hands " +
                "inwards. That makes it simple and predictable, but it also " +
                "means changing the factor while the patch is running can " +
                "make the inside jump — the new clock reads a different " +
                "value at the same instant, so a ramp that was halfway " +
                "through can restart somewhere else.",
            },
            {
              type: "prose",
              text:
                "When you want to change speed *without* that jump — for " +
                "instance while performing — use `rate-as`, which changes " +
                "how fast the inside's clock advances from now on instead of " +
                "rescaling all of history. Same musical intent, different " +
                "behaviour at the moment you change it.",
            },
          ],
        },
      ],
    },

    // -----------------------------------------------------------------------
    // 5. State remembers
    // -----------------------------------------------------------------------
    {
      id: "machine-state",
      title: "5. State Remembers",
      summary: "A few expressions carry memory between instants",
      content: [
        {
          type: "prose",
          text:
            "Most expressions forget everything between instants: ask them " +
            "twice at the same moment and you get the same answer twice. A " +
            "few do not. `integrate` accumulates whatever you feed it. " +
            "`defstate` keeps a value you update yourself. Filters, slews and " +
            "envelope followers carry memory internally.",
        },
        {
          type: "prose",
          text:
            "These are the expressions whose answer depends on where the " +
            "module has *been*, not only on what time it is. That is exactly " +
            "what you want for a rising envelope, a random walk, or a value " +
            "that glides instead of jumping — and exactly what you do not " +
            "want when you are trying to reason about a shape.",
        },
        {
          type: "playground",
          playground: ideaPlayground("state-remembers"),
        },
        {
          type: "try-it",
          text:
            "Change the rate: `(a1 (integrate 2))` climbs by 2 per second, " +
            "`(a1 (integrate 0.5))` by half that. Then try " +
            "`(a1 (integrate (sin bar)))` — it accumulates a signal, so it " +
            "wanders instead of climbing steadily.",
        },
        {
          type: "deep-dive",
          title: "Where memory lives when you edit the code",
          content: [
            {
              type: "prose",
              text:
                "A stateful expression owns a small piece of memory in the " +
                "module. When you re-evaluate an expression that is " +
                "recognisably the same one, it keeps that memory — an " +
                "envelope mid-rise stays mid-rise. When you write something " +
                "genuinely new, it gets fresh memory and starts from its " +
                "initial value.",
            },
            {
              type: "prose",
              text:
                "If you want a piece of state to survive edits reliably, " +
                "give it a name with `defstate` rather than leaving it " +
                "anonymous. A named state is unambiguous about which memory " +
                "you meant.",
            },
          ],
        },
      ],
    },

    // -----------------------------------------------------------------------
    // 6. Breaking code doesn't break sound  (the-machine.md §3.3)
    // -----------------------------------------------------------------------
    {
      id: "machine-failure",
      title: "6. Breaking Code Doesn't Break Sound",
      summary: "The last version that worked keeps playing",
      content: [
        {
          type: "prose",
          text:
            "This is the promise that makes live coding on stage survivable. " +
            "When an expression fails to compile, the output does not go " +
            "silent and the module does not stop. The last version that " +
            "worked keeps running while you fix the new one.",
        },
        {
          type: "prose",
          text:
            "The editor underlines what went wrong, the output is marked as " +
            "*holding last good* in the schematic at the top of this " +
            "chapter, and the patch keeps playing. Fix the expression, " +
            "evaluate again, and the new version takes over. You cannot " +
            "crash the gig.",
        },
        {
          type: "playground",
          playground: ideaPlayground("breaking-doesnt-break-sound"),
        },
        {
          type: "try-it",
          text:
            "Now break it. Evaluate `(a1 0.75)` above so a1 is running, then " +
            "edit it into something impossible — `(a1 (no-such 1))` — and " +
            "evaluate that. The error appears under the code, the schematic " +
            "marks a1 as holding, and a1 keeps putting out 0.75. Then type " +
            "`(a1 0.5)` and evaluate: the new value takes over immediately.",
        },
        {
          type: "playground",
          playground: {
            code: "(a1 (no-such 1))",
            annotation: "Evaluate this after the one above — a1 keeps playing",
            outputs: ["a1"],
            witnessRef: "successful-eval-replaces-program",
          },
        },
        {
          type: "tip",
          text:
            "One broken output does not affect the others. If `a2` fails to " +
            "compile, `a1` carries on exactly as before — the module never " +
            "throws away work that is still valid.",
        },
        {
          type: "deep-dive",
          title: "What “holding” means, precisely",
          content: [
            {
              type: "prose",
              text:
                "An output that is holding is running its **last known good** " +
                "program — the most recent version of that output's " +
                "expression that compiled cleanly. It is not frozen on one " +
                "value and it is not muted: it is still a live signal, still " +
                "following the clock. Only the *edit* was rejected.",
            },
            {
              type: "prose",
              text:
                "The rare case where an output has no last known good version " +
                "— you broke it on the very first evaluation — is shown " +
                "differently, because there is nothing to fall back to. The " +
                "output holds its last valid sample instead of a program.",
            },
          ],
        },
      ],
    },
  ],
};
