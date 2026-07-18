# Synthesis Engine — Feature Roadmap & v1 Epic

> **Audience: the agent (or human) creating the implementation epic in a
> fresh session.** This file is the source of truth for scope,
> sequencing, and acceptance. It is *derived from* the normative specs —
> where this file and a spec disagree, **the spec wins**; fix this file.
>
> Written 2026-07-18, after the design pass, adversarial review, UX
> fork analysis, and UI-variant decisions were all folded into the specs.

## 0. Read First (in this order)

1. `docs/design/adr/README.md` + the 8 ADRs — *why* each decision.
2. `docs/specs/synthesis.md` — app-side contract (engine, transport,
   modes, editor surfaces). Normative.
3. `src-useq/docs/specs/synth-nodes.md` — language-side contract (form,
   NodeDef contract, identity, lifecycle, vectors). Normative.
   **Lives in the `src-useq` submodule — commits there are separate.**
4. `docs/design/synthesis-ux-forks.md` — how the decisions feel to play.
5. `docs/design/mockups/synthesis-ui-playground.html` — chosen UI
   variants (decisions banner at top).
6. Repo conventions: root `CLAUDE.md` (spec-first culture, typed
   channels, persistence service, runtimeService mutation surface,
   import boundaries, test suites), `docs/GLOSSARY.md` (naming).

Key cross-cutting dependency: **app-side `state-identity.md` Phase 3**
(sidecar IDs across CodeMirror transactions) is a prerequisite for
synth-node identity (ADR-0005). It is on the v1 critical path but only
for M4 (editor identity features), not for first sound.

---

## 1. Full-Feature Roadmap

| Phase | Contents | Status |
|-------|----------|--------|
| **v1** (this epic) | Engine core, control transport, `synth` form + compiler surface, upsert/doc-sync lifecycle, ghost strip, 8-def Faust library, editor surfaces (rail, scopes, widgets, graph), runtime modes + settings, manual hybrid alignment, limits + failure containment | Specced, not started |
| **v1.x** | Loopback auto-alignment (+ shared plumbing with 1V/oct calibration, `calibration.md`), curated `voice/poly` def (allocation behind the contract), patch statements + named busses, identity-migrating rename for explicit names, library growth | Deferred, specced as doors (`synthesis.md` §9, `synth-nodes.md` §8) |
| **v2** | ModuLisp-embedded DSL → Faust (user-authored defs; needs libfaust-in-browser or compile service), per-binding rate/smoothing override, audio input + recording/export, feedback routing without delay defs, specialised widgets, graph direct manipulation | Deferred; contracts must not preclude (they currently don't — keep it that way) |

Also queued (documentation debt, do during v1): corpus edits listed in
both specs' **Status** blocks — `top-level.md` §1.4 gains `synth`;
`state-identity.md` (runtime) gains the `synth-node` resource kind;
GLOSSARY entries (NodeDef, synth node, voice, patch graph, control
channel, ghost); amendments to `runtime-modes.md` §1.5.2 and app
`MAIN.md` §2.10.

---

## 2. v1 Sub-Epic

### Definition of done (v1)

A performer with no hardware can open the app, write `synth` forms, and
play a set: multiple nodes, inline patching, vector voices,
click-free live editing, ghosts managed from the status strip, per-param
scopes on demand, knob/slider widgets, read-only patch graph with
composites, all failure modes contained (no drone, no glitch, no silent
death), and the same program driving hardware + browser audio in hybrid
mode with an optional manual alignment offset. All performance targets
of `synthesis.md` §8 measured (not necessarily all met — they are
aspirational); all normative MUSTs covered by tests.

### Milestones

Dependencies: M0 → M1 → M2 → M3 → M5; M4 parallel to M2/M3 after M1
(its identity tasks additionally gated on state-identity Phase 3).

---

#### M0 — Prerequisites

- **M0.1 Cross-origin isolation**: COOP/COEP headers in dev server and
  production hosting; `crossOriginIsolated` capability detection wired
  into bootstrap; degraded no-audio path with capability diagnostic
  (`synthesis.md` §6.3). Audit `?gist`/external fetches under COEP
  (CORS/credentialless).
- **M0.2 SAB ABI definition**: header layout (frame index, epochs,
  liveness), per-block channel records, fast-class layout, event-channel
  edge records, Atomics publication protocol, ABI version constant
  (`synthesis.md` §4.4–4.8). Deliverable: a typed contract module +
  spec-conformance unit tests, before any engine code consumes it.
- **M0.3 state-identity Phase 3** (parallel track, blocks only M4.3/4.4):
  sidecar IDs across CodeMirror transactions per
  `docs/specs/state-identity.md` §13.3.

#### M1 — First Sound (vertical slice)

Scope: one hand-written def, one node, no patching. Proves the whole
spine: language form → compiler artefact → Worker producer → SAB →
worklet host → sound.

- **M1.1 `synth` form, minimal**: parse/compile `(synth "osc/sine"
  :freq expr [:amp expr])` in the WASM interpreter; produce patch-graph
  + control-channel-table artefacts (`synth-nodes.md` §7.2); new WASM
  ABI exports for reading them (extend `src/contracts/wasmAbi.ts`
  pattern).
- **M1.2 Hand-written sine def** (C++/WASM, *not* Faust — ADR-0002):
  conforms to the registry entry shape, imported-memory, ftz.
- **M1.3 Worklet host skeleton**: single AudioWorkletProcessor, module
  transfer + on-thread instantiation between quanta (`synthesis.md`
  §3.2), single-node execution, fade-in/out gains.
- **M1.4 Worker producer v0**: Worker owns a WASM executor instance,
  paced by `Atomics.wait` on the worklet-published frame index; samples
  block-rate channels at future frames; audio-frame→transport-time
  mapping owned by transport (`synthesis.md` §4.1–4.3). Decide here how
  the Worker executor relates to the main-thread instance for vis (v0
  may keep both with audio-owned truth; converge per §4.1's
  one-instance goal before M5).
- **M1.5 Eval → engine wiring**: eval commits ship
  instantiate/update deltas; update-in-place swaps param graphs without
  DSP reset; failed evals no-op.
- **M1.6 Autoplay contract**: engine states off/suspended/running;
  global any-interaction resume, no dedicated action (`synthesis.md`
  §6.5); suspended indicator.
- **Acceptance**: `(synth "osc/sine" :freq (* 220 (pow 2 (floor (* 2
  bar)))))` audibly plays and re-evals click-free; dragging panels/
  opening menus never glitches audio; killing the Worker fades to
  silence within `PRODUCER_TIMEOUT_BLOCKS` (§4.7) and shows `error`.

#### M2 — Graph, Lifecycle, Failure

- **M2.1 Zone allocator + multi-node host**: host-owned shared memory,
  per-instance zones, port-offset wiring, topological block execution
  (`synthesis.md` §2.3, §3.1).
- **M2.2 Routing**: `(node "name")` refs + nested anonymous forms;
  eval-commit resolution + cycle detection against post-diff graph
  (`synth-nodes.md` §4).
- **M2.3 Full lifecycle diff**: def-change case, free, racing-fade
  resurrection, epoch-tagged deltas with pre-fill (`synth-nodes.md`
  §5.5–5.8, `synthesis.md` §4.4, §5.2).
- **M2.4 Doc-sync eval + free surfaces**: `eval.document` action with
  blast-radius announcement; `(free ...)`; `useq-clear` (`synthesis.md`
  §5.3).
- **M2.5 Ghost status strip**: count + hover-expand list with
  stop / fade-out / restore-code; last-active source retention +
  persistence (`synthesis.md` §5.3.1).
- **M2.6 Latch event channels**: `(value, frameOffset)` edge records,
  host edge synthesis into event ports, ≤ 1 frame placement error
  (`synthesis.md` §4.6).
- **M2.7 Failure containment**: non-finite substitution per channel,
  node health states into output-health surface, trap containment,
  overload rule, resource limits (`synth-nodes.md` §5.9,
  `synthesis.md` §3.5–3.6, §5.4).
- **M2.8 Transport events**: pause/stop/seek/tempo-change ring flush +
  refill semantics (`synthesis.md` §4.10).
- **Acceptance**: bass→filter chain with fan-out plays; deleting code
  never silences; doc-sync frees exactly the announced set; a NaN
  cutoff expression degrades to `fallback` without corrupting DSP; 65th
  node is rejected with a diagnostic, not a glitch.

#### M3 — Faust Pipeline & v1 Library

- **M3.1 Build tooling**: Faust → WASM offline pipeline enforcing the
  build contract (imported memory, `-ftz 2`, param addressing map);
  conformance validator run in CI (`synthesis.md` §2.3).
- **M3.2 The library**: `osc/saw`, `filt/svf`, `amp/vca`,
  `noise/white`, `fx/delay`, `voice/fm`, `out/stereo` (+ the M1 sine
  migrated or kept hand-written as the permanent contract test)
  (`synthesis.md` §2.4). Smoothing conventions per class
  (`synth-nodes.md` §2.4–2.5): pitch = `step`, glide only where
  declared.
- **M3.3 Vector voices**: fan-out instancing, width agreement,
  positional state carryover, width-change fades, plain-sum mix
  (`synth-nodes.md` §5.11–5.13).
- **M3.4 Golden DSP tests**: rendered-output regression per def
  (fixture WAV/hash), in the spirit of the firmware's golden signal
  tests.
- **Acceptance**: every def passes conformance + golden tests;
  `:freq [110 165 220]` produces three voices; re-voicing jumps
  (no glide) on default defs.

#### M4 — Editor Surfaces (parallel after M1)

- **M4.1 Node rail**: health rail + chip row + collapsed ghost line
  with click-to-expand param rows; malformed-form degradation
  (`synthesis.md` §7.2). Build on the DI extension pattern
  (`GutterConfig`-style factories) so Inspector scenarios can render it
  in isolation.
- **M4.2 Per-param scopes**: togglable, off by default, persisted;
  reuse probe/vis machinery (`synthesis.md` §7.2.1, §7.3).
- **M4.3 Identity UX** *(gated on M0.3)*: provenance-tracked hidden
  IDs; fork/link paste gestures + feedback chip; naming-anon migration
  (`synth-nodes.md` §5.1–5.3.1, `synthesis.md` §7.6).
- **M4.4 Param widgets** *(gated on live-edit integration)*: ghost-row
  materialisation (literal → live-edit wrapper escalation), knob +
  slider with `Ctrl+click` style toggle, min/max/step/curve config
  popover writing wrapper keywords (`synthesis.md` §7.4–7.4.1).
- **M4.5 Graph overview**: read-only nodes+cables from the compiled
  patch graph; control-binding dots with hover previews; composite
  expand/contract (nested chains + registry structure hints);
  cursor↔node highlight (`synthesis.md` §7.5–7.5.1, §2.1).
- **M4.6 Engine indicator**: off/suspended/running(+load%)/error chips
  in the transport-indicator family (`synthesis.md` §6.4).
- **Acceptance**: Inspector scenarios cover all states (running/
  fallback/error rails, ghost line expanded/collapsed, both widget
  styles, suspended banner, graph with a composite expanded); scenario
  validation green.

#### M5 — Hybrid, Performance, Hardening

- **M5.1 Runtime-mode integration**: audio capability orthogonal to
  modes; hardware+audio implies WASM producer; indicator matrix
  (`synthesis.md` §6.1–6.2).
- **M5.2 Manual alignment offset**: `audio.alignmentOffsetMs` setting
  (runtimeService surface, inert without hardware), constant shift in
  frame→time mapping (`synthesis.md` §4.5).
- **M5.3 Degradation priority**: probe/vis sheds before audio control;
  whole-blocks-late only; amend `runtime-modes.md` §1.5.2
  (`synthesis.md` §4.9).
- **M5.4 Crash recovery**: producer death → fade + `error`; reinit →
  re-eval LKG at fresh epoch; amend app `MAIN.md` §2.10
  (`synthesis.md` §5.5).
- **M5.5 Perf harness**: worklet-side frame-stamped counters in SAB
  header; measure all §8 targets; publish in devmode diagnostics.
- **M5.6 Docs debt**: corpus edits + GLOSSARY entries (roadmap table
  above); spec Status blocks cleared.
- **Acceptance**: full spec-conformance sweep (every MUST in both specs
  mapped to a test or explicitly waived); hybrid demo program plays
  aligned within ±2 ms after manual offset calibration by ear.

### Testing strategy (all milestones)

Per repo convention: Vitest unit/contract tests for module behaviour
and ABI conformance (`test:contracts` gains a `synthesis` group);
Mocha integration where eval flow is exercised; golden DSP renders for
defs (M3.4); Inspector scenarios for every editor surface state (M4);
structural YAML only where editor *command* semantics are touched
(paste gestures). The SAB ABI and NodeDef registry contracts get
dedicated conformance suites that hand-written and Faust defs must both
pass — that pairing *is* the source-agnosticism test (ADR-0002).

### Working agreements for the implementing agent

- Spec-first: implementation follows the two specs; if reality forces a
  contract change, update the spec in the same change and note it in
  the ADR's "revisit" section.
- New code TS/TSX under `src/`; typed channels, persistence service,
  runtimeService mutations, import boundaries (`npm run lint`).
- Firmware/WASM interpreter changes live in the `src-useq` submodule
  (separate commits; rebuild via `npm run build:assets`; check
  `npm run src-useq:status` first).
- Engine-side constants (`SYNTH_FADE_IN/OUT`, `CONTROL_LOOKAHEAD`,
  `PRODUCER_TIMEOUT_BLOCKS`, `MAX_SYNTH_*`, `SYNTH_MEMORY_MAX`,
  `OVERLOAD_BLOCKS`) are named exports in one contract module — specs
  reference them by name.
