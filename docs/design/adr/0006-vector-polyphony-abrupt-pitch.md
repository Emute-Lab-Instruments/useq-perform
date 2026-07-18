# ADR-0006: Vectors as polyphony; abrupt pitch by default

Date: 2026-07-18 · Status: Accepted (v1)

## Context

Polyphony in a continuous-signal language: voice allocators driven by
note events would import discrete-event semantics into a language whose
whole ontology is functions of time. Vector-valued params keep the
model pure and make voicing visible in source. Separately: what does a
pitch *change* sound like on a running voice — glide or jump?

## Decision

- **Vectors are the polyphony surface**: a vector-bound param fans out
  positionally to voices on defs declaring fan-out (`for`-regime
  semantics: static width, time-varying elements allowed). Scalars
  broadcast; widths must agree per node; width changes re-instantiate
  only added/removed voices; surviving positions keep DSP state.
- **Pitch changes are abrupt by default** (`step` smoothing class):
  re-voicing a chord jumps, it does not smear. Glide/portamento is a
  def author's declared choice (`slew` on the pitch param, typically
  with an exposed `:glide` time param) — an instrument character, never
  an engine side effect.
- No note events, no allocator, no retriggering: articulation is
  constructed from gate-shaped signals (sample-accurate via latch event
  channels, ADR-0003).

## Consequences

- The instrument's character: modular/continuous. Players think in
  gates, phasors, slews; voice-leading is manual and positional.
- Keyboard-paradigm expectations (noteOn, voice stealing) are
  deliberately unmet; that audience is served later, if at all, by a
  curated poly-voice def behind the contract.
- Vector-awareness is required through the whole control transport from
  day one (accepted cost).

## Deferred / revisit triggers

Poly NodeDefs with internal allocation (`synth-nodes.md` §8.4) if
demand is strong — behind the contract, not in the language. Revisit
positional voice mapping if manual voice-leading proves hostile in
practice.
