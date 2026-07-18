# ADR-0002: Faust-first DSP authoring behind a source-agnostic contract

Date: 2026-07-18 · Status: Accepted (v1)

## Context

NodeDef DSP must come from somewhere: hand-written C++/WASM (same
toolchain as firmware), Faust, Cmajor, or JS-engine libraries
(Elementary/Glicol/Tone). The decisive asset is Faust's standard library
— decades of vetted, antialiased, academically maintained DSP — and its
actively maintained web path (`faustwasm`, offline compilation to WASM).
Costs identified in adversarial review: whole-program compilation (one
WASM module per def), control-rate-only params (`setParamValue` once per
compute), memory-model configuration, a niche second language for
contributors, GPL compiler (generated code freely licensable).

## Decision

Defs are authored **Faust-first**, compiled **offline** to WASM (no
runtime libfaust in v1). The registry contract is **DSP-source-agnostic**
— hand-written WASM slots into the same entry shape. Build contract
(normative, `synthesis.md` §2.3): imported shared memory with
host-owned zone allocation; flush-to-zero on recursive paths; a param
addressing map; `linear`/`slew` smoothing baked into def source;
audio-rate-modulatable quantities as audio inputs, not params.

The vertical slice **must** stand up the host with a hand-written
trivial def first (sine), then bring in Faust defs — proving the
contract's source-agnosticism and isolating Faust-specific breakage
from host bugs.

## Consequences

- Filters, antialiasing, reverbs are free and trusted; the def library
  grows like a curated module market.
- Integration engineering (graph host, memory, conventions) is entirely
  ours — but is host work we'd owe under any DSP source.
- Faust's poly/MIDI machinery is bypassed entirely (voice fan-out is
  host instancing, per ADR-0006).
- Contributor conformance (smoothing conventions, ftz, addressing) is a
  review burden, not a compiler guarantee.

## Deferred / revisit triggers

Runtime libfaust (for the ADR-0001 DSL door) changes the licensing and
payload calculus — evaluate then. Revisit if per-def WASM call overhead
dominates profiles at target graph sizes (would push toward fewer,
fused modules).
