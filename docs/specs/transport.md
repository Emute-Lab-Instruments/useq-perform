# Transport

> Spec: transport state machine, clock policy, indicator. Counterpart to [MAIN.md](MAIN.md).

1.1 The transport has exactly **three states**: `playing`, `paused`, `stopped`. Boots in `playing` if a runtime is available, else in `stopped`.

1.2 The transport is driven by an XState machine with these transitions:
- `playing` ←(PLAY)→ `paused` (PAUSE)
- `playing` ←(PLAY)→ `stopped` (STOP)
- `paused` ←(PLAY)→ `stopped` (STOP)
- any → `stopped` on REWIND (with a runtime-emitted rewind side-effect)

1.3 **State changes are bidirectional.** User-initiated transitions emit shared transport commands to the active runtime(s). Runtime-initiated transitions (e.g. firmware meta updates) sync the machine to match observed reality without re-emitting the command.

1.4 **Clock policy.** The local clock (rAF-driven `performance.now`) is used as the time source iff WASM is the only authoritative runtime for time. When hardware is connected, hardware-streamed time wins and the local clock stops.

1.5 In `wasm` or `none` mode, transport `stopped` resets the local clock to zero, `paused` freezes it, `playing` resumes from frozen position.

1.6 In `hardware` or `both` mode, transport state changes do not directly drive the clock; hardware streams time on channel 0 and the app follows.

1.7 The transport toolbar exposes Play/Pause/Stop/Rewind buttons; their enabled/disabled and visual state must reflect the current machine state and active runtime mode without lag.

1.8 **Connection indicator semantics** (see [runtime-modes.md](runtime-modes.md)): the transport surface visually distinguishes `none`, `wasm`, `hardware`, `both`. Hover/tooltip describes the precise state in plain language.

## Open / Deferred

2.1 **`schedule`/`unschedule` editor surface.** Whether quantised eval becomes a thin wrapper over a `schedule`-style runtime callback, or stays an editor-side hold, is undecided. Currently editor-side.
