# ADR-0001: Control-rate language, fixed NodeDef palette

Date: 2026-07-18 · Status: Accepted (v1)

## Context

Making uSEQ Perform a standalone instrument requires audio-rate DSP in
the browser. Three architectures were considered: (a) extend ModuLisp
itself to audio rate in an AudioWorklet; (b) pair ModuLisp with a
separate DSP language; (c) a fixed virtual rack driven by uSEQ outputs.
The precedent is TimeLines (Haskell → SuperCollider): control signals as
pure functions of time driving a fixed SynthDef set.

## Decision

ModuLisp semantics stay control-rate. Audio-rate DSP lives in a
**curated, fixed registry of NodeDefs** (SynthDef analogy): some
low-level (oscillator, filter, VCA), some high-level (complete voices).
Programs instantiate arbitrary numbers of each, patch them at runtime
(inline routing in v1), and drive every parameter with a ModuLisp
expression; omitted params fall back to curated static defaults.

## Consequences

- Expressivity concentrates in the control language — where uSEQ is
  novel — rather than in DSP authoring.
- High quality floor: every def is antialiased, smoothed, denormal-safe
  by construction; users cannot produce broken DSP.
- Real ceiling for power users: the palette is closed in v1. Pressure
  valve is contributing defs through the registry contract.
- CV-vs-audio remains a type distinction (unlike hardware modular);
  audio-rate modulation exists only via defs' declared audio inputs.

## Deferred / revisit triggers

A ModuLisp-embedded DSL compiling to Faust (user-authored low-level
defs entering the same registry, `synth-nodes.md` §8.8) is the planned
door through the ceiling. Revisit palette-closedness if def-contribution
friction visibly throttles the instrument's growth.
