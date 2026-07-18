# Synthesis Engine: How the Design Forks the Instrument

> Working design document, **not normative**. Companion to
> `docs/specs/synthesis.md` and `src-useq/docs/specs/synth-nodes.md`.
> Each story walks a player through real moments; at each moment where a
> design decision changes what they experience, a **fork box** shows what
> the chosen path feels like and what the roads not taken would have felt
> like.
>
> Tags: **[LOCKED]** = decided and load-bearing (reversing is expensive);
> **[REVISITABLE]** = decided but cheap to change before implementation;
> **[OPEN]** = deliberately deferred.
>
> Two lenses used throughout:
> **ergonomics** — the moment-to-moment feel under the fingers;
> **ergodynamics** — how the instrument bends your practice over weeks:
> what it makes effortless, what it quietly discourages, what kind of
> musician it grows.

---

## Story 1 — First Sound (Mara, no hardware, first session)

Mara opens the app on a laptop. No module, no MIDI, nothing. She pastes
an example from the guide:

```clojure
(synth "voice/fm" :freq (* 110 (pow 2 (floor (* 2 bar)))))
```

She hits eval. **Nothing happens** — the indicator shows the engine as
`suspended` and a banner says "press any key or click to enable sound."
She taps a key; sound fades in.

> **Fork — autoplay handling [REVISITABLE mechanics, LOCKED constraint]**
> The browser imposes the gesture requirement; the fork is how it feels.
> *Chosen*: eval attempts resume, and failure is loud (indicator +
> one-click affordance). *Alternative* (silent retry until a gesture
> happens to arrive): Mara's first-ever eval produces silence with no
> explanation — she concludes the app is broken and leaves. This fork
> costs nothing musically and everything in first-session survival.

The FM voice has a dozen parameters; she bound one. The node card shows
her `:freq` row plus ghosted rows: `:amp 0.3`, `:mod-ratio 2`,
`:mod-amt 100`… all sounding at curated defaults.

> **Fork — omitted params fall back to defaults [LOCKED]**
> *Chosen*: one bound param = a complete, musical sound; the ghost rows
> teach her what else is controllable, and she grows a patch by
> *claiming* parameters one at a time. *Alternative* (all params
> required, TimeLines-style): her first form is nine lines of
> boilerplate before any sound; honest, but the on-ramp is a wall.
> Ergodynamics: defaults make "start small, colonise gradually" the
> natural practice — but they also mean players can perform for months
> without knowing what `:mod-ratio` does. The ghost rows exist to keep
> the invitation visible.

> **Fork — high-level defs exist at all [LOCKED]**
> `voice/fm` is a curated instrument, not a rack primitive. *Chosen*
> (both ends of the ladder): first sound in one line, and the same
> session can drop down to `osc/saw → filt/svf → amp/vca` when she's
> ready. *Alternative* (low-level only, purist modular): first sound
> requires understanding patching; steeper, more "honest," far fewer
> people make it past day one.

---

## Story 2 — The Set (Theo, solo standalone performance)

Theo is 25 minutes into a live set. Screen projected. Four nodes
sounding.

**Moment 1: the typo.** Mid-build, he evaluates a form with a
misspelled param. Inline squiggle, console message — and the music does
not so much as flinch: the previous version of that node keeps playing.

> **Fork — failed evals are no-ops (LKG) [LOCKED]**
> Inherited from the language's failure model, extended to nodes.
> *Chosen*: errors are silent-to-the-audience, visible-to-Theo. The
> stakes of hitting eval stay low, so he evals *often* — small steps,
> high frequency. *Alternative* (error = node stops): every eval is
> Russian roulette; performers respond by evaluating rarely and
> rehearsing evals silently, which kills the improvisational core of
> live coding. This is arguably the single most important ergonomic
> decision and it was nearly free.

**Moment 2: the delete that doesn't silence.** Theo deletes the pad's
four lines from the buffer — decluttering his screen for the next
section — and evaluates a new bass form. **The pad keeps playing.** Its
gutter entry shows "sounding, not in document."

> **Fork — upsert + document-sync free model [REVISITABLE]**
> *Chosen*: per-form eval never frees; deleting text is a *visual* act,
> not a musical one. Freeing is deliberate: click the ×, write
> `(free "pad")`, or run the whole-document sync eval.
> *Feel*: the screen is a scratchpad, the sound is a rack — you can
> tidy one without touching the other. Cost: **what you see stops being
> what you hear**, and the gutter indicator becomes load-bearing; a
> player who doesn't internalise the two-layer model will be haunted by
> ghost pads.
> *Alternative A (editor-tracked truth)*: deleting the form kills the
> pad on next eval. What-you-see-is-what-you-hear restored — but now
> **text editing is performance**: an accidental cut, an undo, a
> half-finished refactor all have audible consequences. Screen-tidying
> becomes impossible mid-set.
> *Alternative B (explicit free only, no doc-sync)*: same scratchpad
> feel, but no "make reality match the document" gesture; after a messy
> improv session the only cleanup is hunting ghosts one by one or the
> nuclear `useq-clear`.
> Ergodynamics of the chosen path: players develop a *rhythm* —
> improvise with upserts, periodically doc-sync to consolidate, like
> committing after exploratory coding. The doc-sync action is also the
> "prepare next section" gesture: curate the buffer silently, then one
> action makes the world match it. That's a genuinely new performance
> move that neither alternative offers.

**Moment 3: the fearless refactor.** Theo restructures the pad's form —
wraps the whole thing in a `(slow 2 ...)`, reformats it, moves it below
the bass. On eval: nothing resets. The node's hidden ID rides the
editor's change map (the state-identity sidecar machinery), so identity
follows *the thing he's been editing*, not its shape. Later he copies
the form to make a variation: plain `Ctrl+V` gives a fresh node — a
chip flashes **forked** — while `Ctrl+Shift+V` pastes a **linked
variant** of the same node, letting him keep two versions in the buffer
and A/B them by evaluating one or the other.

> **Fork — provenance-tracked auto IDs + explicit paste gestures
> [REVISITABLE]**
> *Chosen*: hidden IDs are sidecar metadata mapped through editor
> transactions; identity survives any edit the editor can trace — wrap,
> move, reformat, rewrite-in-place — and breaks only when provenance
> genuinely ends (delete-and-retype, paste-as-fork). Zero ceremony
> *and* essentially no surprise resets; the fork/link paste pair
> surfaces the one remaining identity decision exactly when it arises,
> with visible feedback. Naming an anonymous node later *migrates* its
> state rather than resetting it.
> *Alternative (structure-keyed hashing)*: cheap to implement, but big
> refactors re-key — surprise state resets punishing exactly the
> players who edit most fluently.
> *Alternative (explicit names required, TimeLines-style)*: predictable
> and projector-readable, at the cost of ceremony on every throwaway
> drone.
> Residual tax of the chosen path: anonymous nodes have no stable
> *human* handle ("what is that node called?" — "·anon·7f3a") — naming
> stays worthwhile for anything you'll reference, patch into, or talk
> about, and is now state-safe to do late.

**Moment 4: the flurry.** Building to the drop, Theo re-evaluates the
same form five times in four seconds, tweaking a number each time. No
clicks, no stacking copies — each eval swaps the param graphs in place;
when he briefly frees and immediately re-declares, the release fade
cancels and the same instance fades back in.

> **Fork — update-in-place + racing-fade resurrection [LOCKED]**
> *Chosen*: rapid iteration is the *intended* gesture; DSP state
> (filter memory, phase) survives parameter surgery, so tweaking feels
> like turning knobs on a running rack, not swapping racks.
> *Alternative (SC-style: each eval a fresh synth, performer manages
> freeing)*: five evals = five stacked pads unless he frees manually —
> the classic SC live-coding footgun the declarative diff exists to
> remove. *Alternative (immediate free, no fade)*: every mistake is a
> click at concert volume.

---

## Story 3 — Chords Without a Keyboard (Ana, coming from synths)

Ana wants a three-note pad. She writes `:freq [110 165 220]` and gets
three voices. Then she tries to "play a chord progression" and runs
into the instrument's soul.

She changes the vector to `[130 195 260]`. The voices don't retrigger —
voice 0 keeps its filter state and phase while its frequency **jumps**
to 130: abrupt by default, gliding only if the def declares portamento.
There was no note-on. There is never a note-on. To get plucked attacks
she must *sequence gates as signals*:

```clojure
:gate (sqr (* 4 beat))
```

> **Fork — vectors as the polyphony surface [LOCKED — this is the
> character-defining decision]**
> *Chosen*: polyphony is N continuous voices whose parameters are
> functions of time. Consequences that define the instrument:
> - chord changes are *voice re-targetings*, not note events — abrupt
>   by default (`step` smoothing on pitch params), gliding only where a
>   def declares it (portamento is an instrument character, not an
>   engine side effect); articulation is something you construct;
> - rhythm lives in gate-shaped *signals*, giving sample-accurate,
>   pattern-as-math rhythmic control (with the latch/event-channel
>   machinery making those edges tight);
> - voice count is visible in the source (`[110 165 220]` *is* the
>   voicing) — nothing is hidden in an allocator's head;
> - positional identity means re-voicing a chord can move the "wrong"
>   voice (shrink `[110 165 220]` → `[165 220]` and it's voice 3 that
>   dies while voice 0 jumps up a fifth). Voice-leading is *manual*.
> *Alternative (voice allocators + note events)*: Ana's keyboard
> instincts work day one — noteOn, envelope, steal policy. But discrete
> events would now live *inside* a language whose entire semantics is
> continuous functions of time: two ontologies in one instrument, and
> the modular/Eurorack character (everything is a voltage) diluted.
> Ergodynamics: the chosen path *grows modular players*. People who
> stay will think in gates, slews, and phasors, and will do things
> keyboard-paradigm tools can't (a chord that is a chord for only 30%
> of each bar; voice 2's detune as a function of voice 1's gate). People
> who need a piano will bounce. That's a real audience choice, made
> consciously — the palette can later partially soften it with a
> `voice/poly` NodeDef that embeds allocation behind the contract
> (deferred, language spec §8.4).

---

## Story 4 — The Hybrid Rig (Dev, Eurorack + browser)

Dev runs uSEQ hardware into a modular skiff and wants the browser to
add a stereo pad and delay under it. Same program: `a1`/`d1` forms
drive the rack, `synth` forms drive the room.

**Moment 1: the flam.** He binds the *same* expression to a hardware
gate and to a browser envelope gate. The rack hits ~20 ms before the
browser does — hardware CV is near-immediate, browser audio pays
lookahead + output latency.

> **Fork — Worker producer with ~6-block lookahead [LOCKED], hybrid
> alignment uncompensated [OPEN]**
> The lookahead buys unbreakable audio under UI load — the browser
> never glitches because Dev dragged a panel. The price is a constant
> ~16–30 ms offset against hardware. *Chosen*: constant-and-tight beats
> low-but-jittery — a fixed flam is *correctable*: a manual alignment
> offset setting (off by default) shifts the engine's time mapping to
> meet the rack, and automatic detection via audio loopback (shared
> plumbing with 1V/oct calibration) is on the roadmap; jitter reads as
> sloppiness and can never be fixed. *Alternative
> (main-thread producer, minimal lookahead)*: occasionally lower
> latency, but any UI jank becomes an audible pothole *in the browser's
> own audio* — and background-tabbing the app kills sound entirely.
> Note the deliberate asymmetry with gate accuracy: latency is ~16 ms
> but gate *placement error* is ≤ 1 frame — internal rhythm is
> sample-tight even though the whole browser layer sits slightly behind
> the rack.

**Moment 2: the stress test.** Dev opens the settings panel while
twelve vis lanes render. Under load, the vis stutters first; the pad
never does.

> **Fork — degradation priority: vis sheds before audio [REVISITABLE]**
> *Chosen*: the audience never hears your UI. *Alternative* (all
> sampling equal, per the current runtime-modes rule): under load,
> arbitrary params freeze while pretty waveforms keep drawing — exactly
> backwards for a performance instrument.

**Moment 3: the crash.** Mid-set, the WASM executor dies. The browser
pad **fades to silence over ~60 ms** and the engine indicator goes red;
the rack keeps playing untouched. Reinit succeeds; the pad fades back.

> **Fork — producer liveness → fade-out, loud recovery [LOCKED]**
> *Chosen*: the failure mode is a clean dropout — musically survivable,
> visually attributed. *Alternative* (naive hold-last-values forever):
> the failure mode is an **infinite drone at concert volume** with no
> UI acknowledgement — the single worst thing this instrument could
> ever do on a stage. *Alternative* (silent auto-recovery, the current
> app rule for vis-shadow WASM): fine when WASM only draws waveforms;
> indistinguishable-from-haunted when WASM makes sound.

---

## Story 5 — The Wall (Ren, power user, month three)

Ren wants a specific West-coast wavefolder. The palette has no
`fx/fold`. There is nothing they can type to make one: the NodeDef
registry is curated and closed, and ModuLisp cannot express audio-rate
DSP.

> **Fork — fixed curated NodeDef palette [LOCKED for v1]**
> *Chosen*: quality floor is high (every def antialiased, smoothed,
> denormal-safe), the palette is legible and teachable, and the
> contract means a def added later serves everyone. The ceiling is
> real: power users hit it, and their pressure valve is *requesting or
> contributing defs* (Faust authorship + registry conformance), not
> live-patching new DSP. *Alternative (ModuLisp extended to audio
> rate)*: no ceiling — and no floor; every performance one aliasing
> `(sin (* t 1e6))` away from disaster, plus years of DSP-library work
> before the palette matches Faust's day one. *Alternative
> (user-loadable arbitrary worklets)*: maximum openness, no quality or
> safety contract on the audio thread.
> *Deferred door (now specced)*: a ModuLisp-embedded DSL compiling to
> Faust (language spec §8.8) — user-authored low-level defs entering
> the registry through the same contract. The wall eventually gets a
> gate without giving up the floor.
> Ergodynamics: the wall *shapes the community* — expressivity lives in
> the control language (where uSEQ is genuinely novel), and the DSP
> layer accretes slowly and curated, like a hardware module market
> rather than an npm registry.

Ren also notices `:cutoff` feels slightly smoothed when they drive it
with a fast square. The slew is the def's, declared in the registry;
there's no user-facing override.

> **Fork — per-param rate/smoothing declared by the def author
> [REVISITABLE at the contract level]**
> *Chosen*: users never annotate rates; every param behaves correctly
> by default (no zipper noise, no lagging gates) at the cost of
> occasional "why is it rounding my square wave?" moments — whose
> answer is "use the gate-class param / the audio input, that's what
> it's for." *Alternative (user-specified rates per binding)*: maximal
> control, and a new failure class — zipper noise and gate-smearing as
> *user errors*, in a tool trying to keep the floor high. The middle
> path — a per-binding override at the use site — is now explicitly
> specced as deferred (language spec §8.9): the transport carries class
> per channel, so the door is open and the floor stays default.

And when Ren tries `:in (node "delay1")` *inside* `fx/delay`'s own
chain to make feedback: compile error — cycles need a delay def.

> **Fork — no free-form feedback in v1 [OPEN]**
> *Chosen*: the graph stays topologically sortable and block-executable;
> feedback is a curated capability of defs built for it. *Alternative
> (arbitrary single-block-delay feedback, à la modular)*: the true
> no-rules patching feel, at the cost of a scheduler redesign and a
> whole family of self-oscillation footguns. Deferred, not refused —
> this one should be revisited when the graph executor is real.

---

## The Forks, Ranked by How Much Instrument They Decide

| # | Fork | Tag | What it decides |
|---|------|-----|-----------------|
| 1 | Vectors as polyphony (no note events) | LOCKED | The *soul*: continuous/modular character; who the instrument is for |
| 2 | Upsert + doc-sync free model | REVISITABLE | The performance grammar: screen-as-scratchpad vs screen-as-truth; the doc-sync "commit" move |
| 3 | LKG no-op on failed eval | LOCKED | Eval anxiety ≈ 0 → high-frequency improvisation |
| 4 | Fixed curated palette (Faust defs) | LOCKED v1 | Where expressivity lives (control language) and how the DSP layer grows |
| 5 | Provenance-tracked auto IDs + fork/link paste gestures | REVISITABLE | Zero ceremony; resets only on true provenance loss; identity decisions surface at paste time |
| 6 | Worker producer / ~16 ms constant latency, sample-tight gates | LOCKED | Unbreakable audio; hybrid flam (manual offset option, loopback auto-detect later); tight internal rhythm |
| 7 | Update-in-place + fades everywhere | LOCKED | Tweaking feels like knobs on a running rack |
| 8 | Def-declared rates/smoothing; abrupt pitch default | REVISITABLE | Floor over control; portamento is a def choice; per-binding override specced-deferred |
| 9 | Defaults + ghost rows + high-level defs | LOCKED | The on-ramp: one line to music, grow by claiming params |
| 10 | Vis sheds before audio; crash = fade + loud | REVISITABLE / LOCKED | What failure sounds like on a stage |

Reading the column: #1–#4 are the instrument's identity; if any of
those feels wrong in the gut, raise it *now*. #5's original risk
(surprise state resets on refactor) has been engineered out via
provenance tracking; #8's escape hatches are specced as deferred
(per-binding rate override; the ModuLisp→Faust DSL for the palette
ceiling). Decision rationale now lives in `adr/` alongside this
document.
