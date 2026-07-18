# ADR-0007: Rate & smoothing classes declared by the def, not the user

Date: 2026-07-18 · Status: Accepted (v1)

## Context

Every param needs a sampling rate (how often the control signal is
read) and a smoothing behaviour (what happens between reads). Making
users annotate these creates a new failure class — zipper noise and
smeared gates as *user errors* — in a tool whose value is a high floor.

## Decision

Rate class (`block` / `fast`) and smoothing class
(`step` / `linear` / `slew` / `latch`) are declared **per param in the
NodeDef contract** by the def author. Users never annotate them in v1.
Ownership split: `linear`/`slew` implemented inside the def
(conformance requirement); `step` and `latch` applied host-side
(`latch` via sample-accurate edge synthesis). Defaults with teeth:
gates are `latch` (never interpolated), pitch-class params are `step`
(ADR-0006).

## Consequences

- Correct-by-default sound; def review carries the conformance burden.
- Occasional expert friction ("why is my square wave rounded?") whose
  answer is "use the param class built for that" — acceptable while the
  floor matters more than the ceiling.
- Registry metadata must be trustworthy: declared classes are normative
  for def authors and hosts.

## Deferred (explicitly specced, out of v1)

**Per-binding override** (`synth-nodes.md` §8.9): a user-side surface
to override rate/smoothing at the use site for power users. The
contract and transport must not preclude it (a channel's class is
per-channel data, not global). Trigger to implement: repeated real
cases where def-declared classes block a legitimate technique.
