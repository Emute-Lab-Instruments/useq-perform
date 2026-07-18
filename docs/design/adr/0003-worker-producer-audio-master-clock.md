# ADR-0003: Worker producer, audio-master clock, epoch-tagged SAB ring

Date: 2026-07-18 · Status: Accepted (v1)

## Context

Control samples must travel from the WASM executor to the audio thread.
Adversarial review killed the original main-thread design three ways:
(1) a main-thread producer is rAF-paced (~16.7 ms, unbounded under
jank, halted in background tabs) — structurally slower than any sane
lookahead window; (2) sampling *ahead* of stateful signals needs a
defined state timeline; (3) `AudioContext.currentTime` and the app's
rAF clock drift with no specified mapping. A worklet-embedded second
executor was rejected earlier (WASM↔WASM state-sync problem).

## Decision

- **Worker producer from v1**: a dedicated Worker owns the executor
  while the engine runs, paced by `Atomics.wait` on a worklet-published
  frame index. Exactly one live executor instance; vis/probes read the
  same SAB.
- **Audio frame clock is master time** while the engine runs; transport
  time is a function of `currentFrame`. Producing ahead is running the
  *live* timeline forward of the DAC head — no projection fork in the
  audio path.
- **Epoch-tagged ring**: graph deltas activate at the first ring block
  bearing their epoch; producer pre-fills new-program samples before a
  switch arms. Ring flush + refill on pause/stop/seek/tempo change.
- **Latch params are event channels**: `(value, frameOffset)` edge
  records, applied sample-accurately (≤ 1 frame placement error).
- Producer liveness rule: sustained silence from the producer fades the
  engine out into `error` — never an indefinite drone.

## Consequences

- Audio is jank-proof and background-tab-proof; UI load degrades vis
  first, audio control last (whole-blocks-late only).
- Constant control latency ≈ lookahead × block (~16 ms default) —
  constant-and-tight over low-but-jittery. Gates are sample-tight
  *within* that constant offset.
- Hybrid rigs see a fixed hardware-leads-browser offset (ADR-0008).
- SAB requires cross-origin isolation (COOP/COEP) — a bootstrap-wide
  constraint (`?gist` fetches need CORS/credentialless).

## Deferred / revisit triggers

`postMessage` fallback transport is rejected, not deferred. Revisit
lookahead depth once real producer timing exists.
