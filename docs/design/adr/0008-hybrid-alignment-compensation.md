# ADR-0008: Hybrid alignment — manual offset now, loopback auto-detect later

Date: 2026-07-18 · Status: Accepted (v1)

## Context

In hybrid rigs (hardware CV/gates + browser audio from one program),
hardware is near-immediate while browser audio pays control lookahead +
output latency: a constant ~16–30 ms flam between rack and room
(ADR-0003). Constant offsets are correctable; the question is when and
how.

## Decision

- v1 default: **uncompensated** — the offset is documented, constant,
  and honest.
- A manual **hybrid alignment offset** setting
  (`audio.alignmentOffsetMs`, default 0 = off, mutated via
  runtimeService like all settings): compensation is applied as a
  constant shift in the audio frame→transport-time mapping, i.e. the
  engine renders the program correspondingly earlier so browser audio
  meets the rack. Set by ear or by measurement.
- **Later: automatic detection via audio loopback** — patch a hardware
  output into an audio input, measure round-trip offset, set the value.
  The same loopback path doubles as an automatic 1V/oct CV calibration
  aid (`calibration.md`), so the plumbing serves two features.

## Consequences

- Hybrid performers get a one-knob fix today without any new signal
  path; the engine's time mapping already supports a constant shift.
- Compensation shifts *musical* time of audio rendering — audio-only
  users must never be affected (setting inert unless hardware
  connected).
- The loopback path, when built, creates the first audio *input*
  dependency — scoped to measurement, not to the patch graph (which
  stays output-only in v1).

## Deferred / revisit triggers

Auto-detection (`synthesis.md` §9.4). Per-output compensation (if
expander hardware shows meaningfully different output latencies).
