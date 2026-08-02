---
stability: draft
layer: behavioural
---

# The Machine (user representation)

> Spec: the **user-facing canonical representation** of how uSEQ thinks — a
> live, explorable schematic of the signal model plus its integration into
> the user guide. Audience: complete beginners through intermediate live
> coders. Substrate: [witnesses.md](witnesses.md). Developer-facing
> counterpart: [engine-ledger.md](engine-ledger.md). Builds on
> [user-guide.md](user-guide.md) (whose principles — one path, every code
> block a playground, show-don't-tell, progressive disclosure — apply here
> unchanged) and [help.md](help.md).

### Source files

- `src/ui/help/machine/MachinePanel.tsx` — the schematic surface (`MachinePanel` pure view + `WiredMachinePanel`; guide-embedded and standalone)
- `src/ui/help/machine/machineModel.ts` — schematic layout model (regions, the six ideas, row/spark derivations)
- `src/ui/help/machine/machineEvents.ts` — subscriptions wiring real stores/channels to schematic animation
- `src/ui/help/guide/chapters/ch0-machine.ts` — "How uSEQ thinks" opening guide chapter
- `src/ui/styles/machine.css` — schematic styling, in theme variables
- Existing: `src/ui/help/guide/` (GuideTab, Playground, LiveProbe, contentBlocks), `src/utils/outputHealthStore.ts`, `src/contracts/*Channels.ts`, visualisation store/transport clock

## 1. Frame

1.1 The Machine is the authoritative **mental model** of ModuLisp for users.
It renders six ideas, at user altitude, deliberately hiding mechanism
(no passes, no node graphs, no slots):

1. **Time flows in** — a clock streams `t` (and beat/bar phasors) continuously.
2. **Your expression is a signal** — evaluated at every instant; code is a
   function of time, not a sequence of steps.
3. **Values land on outputs** — a1–a8/d1–d8/s1–s8 are the module's jacks.
4. **Wrapping bends time** — `fast`/`slow`/`offset` hand the inner
   expression a different clock.
5. **State remembers** — some expressions carry memory between instants
   (`integrate`, UGens, `defstate`).
6. **Breaking code doesn't break sound** — on error, the last good version
   keeps playing (the LKG guarantee; "you cannot crash the gig").

1.2 **The honesty rule: no animation without a real event.** Every visual
state change in the schematic is driven by an actual signal from the running
app — transport time, a real evaluation, a real health transition, real
output values. No canned loops, no simulated activity. If the runtime is
unavailable (hardware-only mode, [runtime-modes.md](runtime-modes.md)), the
schematic renders in a visibly-quiescent state, mirroring probe behaviour
([probes.md](probes.md) §1.6.3).

1.3 The Machine never *causes* engine activity beyond what its embedded
playgrounds run (which follow guide-playground isolation rules and the
witness isolation contract, witnesses.md §2.3).

## 2. The schematic

2.1 A single scene with three regions, left to right: **clock** (animated
phasor driven by real transport time), **program** (the evaluated
expressions, one row per active output), **outputs** (jack row with live
values/waveform sparks, sourced from the same sampling infrastructure as the
visualisation store).

2.2 Live behaviours (each mapped to its real source):

- Transport play/stop/tempo → clock region state (transport machine).
- User evaluates a form in the main editor → the corresponding program row
  flashes and updates (eval events on the runtime channels).
- Per-output health → row state: `running` steady, `error`/`fallback` shows
  the broken-but-still-sounding LKG state distinctly (outputHealthStore).
- Output values → live sparks on the jacks (visualisation store sampling).

2.3 Zoom/progressive disclosure: the scene is legible at a glance; selecting
a region reveals its idea's one-paragraph explanation and an embedded
playground (guide content blocks, §3). No deeper zoom in M1 (per-node views
are the Ledger's territory).

2.4 The schematic appears in two places: as the opening block of the guide's
"How uSEQ thinks" chapter (§3) and standalone (dockable/openable surface,
exact chrome per [overlays.md](overlays.md) conventions — implementation
picks the lightest fit).

## 3. Guide chapter 0 — "How uSEQ thinks"

3.1 A new opening chapter under the Language domain presenting the six ideas
in order, schematic-first, prose-second. Each idea: one short paragraph, one
playground with probe, one "try it" prompt. Existing chapters 1–5 follow
unchanged (renumbering is presentational only).

3.2 Idea 4 (wrapping bends time) uses a playground whose probe demonstrates
depth — the existing contextual-probe depth control ([probes.md](probes.md)
§1.4) is the experiential teacher of time substitution; the chapter names
the experience, not the mechanism.

3.3 Idea 6 (failure) is demonstrative: a playground preloaded with working
code and a "now break it" prompt; the user edits it into an error, hears/sees
the signal continue, sees the health indicator and diagnostic. This is the
user-altitude rendering of `src-useq/docs/specs/failure-model.md`.

3.4 Intermediate-tier content lives in deep-dive collapsibles
([user-guide.md](user-guide.md) principle 4), e.g. "fast is stateless time
substitution — use `rate-as` for phase-coherent speed changes"
(compilation.md §3.9), phrased in user language.

## 4. Witness coupling

4.1 Playground blocks in chapter 0 (and progressively in existing chapters)
carry `witnessRef` per witnesses.md §4: each teaching example is backed by a
conformance case, so the guide cannot teach behaviour the engine does not
have. A repo test asserts all refs resolve.

4.2 Where a wanted teaching example has no corpus case yet, the example may
land without a ref plus a tracked task to promote it (witnesses.md §5.3) —
never a silently unverified example presented as canonical.

## 5. Diagnostics deep-linking (user side)

5.1 Diagnostics rendered to users may link to the relevant guide
section/idea (e.g. top-level-only rejection → outputs/ideas material), the
user-altitude twin of the Ledger's clause links
([engine-ledger.md](engine-ledger.md) §4). M1 wires a small static
category→section map; richness is deferred.

## 6. Acceptance (M1)

6.1 The schematic runs in the guide and standalone; with WASM running, all
four live behaviours in §2.2 demonstrably animate from real events (component
tests may drive stores/channels directly).

6.2 Chapter 0 ships with six ideas, ≥4 playgrounds carrying resolving
`witnessRef`s, and the break-it LKG demonstration working against the real
bundled engine.

6.3 Hardware-only mode renders the quiescent state; no dead animation.

6.4 `npm run typecheck`, `npm run lint`, `npm run test:unit` green; no new
import-boundary violations.

## 6a. Implementation notes (M1, 2026-08-02)

Deviations and clarifications recorded at implementation time. These are notes
on how M1 landed, not amendments to the intent above.

6a.1 **`witnessRef` lives on `Playground`, not on `PlaygroundBlock`.** §4.1 and
witnesses.md §4.1 say "playground block". The field went on the `Playground`
payload (`guideTypes.ts`) because that is where `code` lives — the ref must
travel with the thing that must match the case. `PlaygroundBlock` is a thin
wrapper around it, so nothing is lost.

6a.2 **Jack sparks read the sampler's past buffers, not
`VisExpression.samples`.** The `samples` field on the visualisation store is
always `[]` in production (`visualisationSampler.ts` writes it only for DEV
tracing); the real per-output history lives in the sampler's `PastBuffer`s,
reachable via `getRenderData()`. The schematic reads those, re-derived
whenever `visStore.currentTime` changes — i.e. once per real sampler frame.

6a.3 **Two test seams, and why.** Component tests drive the real transport
machine, the real `codeEvaluated` channel, the real `outputHealthStore` and
the real visualisation store. Two things are injected rather than driven,
because both would otherwise require a booted WASM engine with no public
seam to push through: the per-output `SampleWindow` (a real `PastBuffer`, the
exact object the sampler hands over) and the runtime-liveness predicate. The
code path under test is the production one in both cases.

6a.4 **The schematic never creates the transport orchestrator.** Per §1.3 it
reads it through a new `peekTransportOrchestrator()` accessor, which returns
`null` rather than constructing the singleton (construction subscribes to the
runtime service and starts applying clock policy). No transport running is
rendered as "stopped", not as invented motion.

6a.5 **Standalone chrome (§2.4)** is an ordinary chrome panel in
`src/ui/adapters/panels.tsx` (`toggleMachinePanel()`), so it joins the LIFO
overlay stack and inherits Escape dismissal and reference-counted scroll lock
(overlays.md §1.1–1.2) without introducing a new surface kind.

6a.6 **Chapter opening block.** `Chapter` gained an optional `intro:
ContentBlock[]` rendered above the (collapsed-by-default) sections, so the
schematic is genuinely the chapter's opening block rather than hidden inside
a collapsed section. A new `machine` content-block type renders it.

## 7. Open / Deferred

7.1 Deeper zoom levels bottoming out in Ledger views (devmode crossover).

7.2 Gamepad navigation of the schematic ([gamepad.md](gamepad.md)).

7.3 Corpus `guide:` back-references (witnesses.md §5.2).

7.4 Onboarding integration: first-run flow landing new users in chapter 0.
