# Transport

> Spec: transport state machine, clock policy, indicator. Counterpart to [MAIN.md](MAIN.md).

## Source files

- `src/machines/transport.machine.ts` — XState transport state machine (`playing`, `paused`, `stopped`)
- `src/effects/transportOrchestrator.ts` — transport command dispatch to active runtimes
- `src/effects/transportClock.ts` — clock policy: when to use internal vs hardware time
- `src/effects/localClock.ts` — rAF-driven internal clock (`startLocalClock`, `stopLocalClock`)
- `src/runtime/runtimeTransportService.ts` — fan-out of shared transport commands to both runtimes
- `src/transport/connector.ts` — serial port lifecycle, auto-reconnect, `connectedToModule`
- `src/transport/json-protocol.ts` — JSON wire protocol driver (hello, ping, stream-config, eval)
- `src/transport/stream-parser.ts` — serial stream framing and parsing
- `src/transport/serial-utils.ts` — low-level serial port utilities
- `src/transport/webSerialHostPort.ts` — Web Serial `RuntimePort` implementation
- `src/transport/upgradeCheck.ts` — firmware version upgrade check
- `src/transport/types.ts` — transport type definitions
- `src/contracts/useqRuntimeContract.ts` — shared transport command set constants
- `src/ui/TransportToolbar.tsx` — transport toolbar UI (Play/Pause/Stop/Rewind buttons)
- `src/ui/adapters/toolbars.tsx` — toolbar adapter wiring

1.1 The transport has exactly **three states**: `playing`, `paused`, `stopped`. Boots in `paused` if a runtime is available, else in `stopped`. The user must explicitly start playback. (see `src/machines/transport.machine.ts`)

1.2 The transport is driven by an XState machine with these transitions: (see `src/machines/transport.machine.ts`)
- `playing` ←(PLAY)→ `paused` (PAUSE)
- `playing` ←(PLAY)→ `stopped` (STOP)
- `paused` ←(PLAY)→ `stopped` (STOP)
- any → `stopped` on REWIND (with a runtime-emitted rewind side-effect)

1.3 **State changes are bidirectional.** User-initiated transitions emit shared transport commands to the active runtime(s). Runtime-initiated transitions (e.g. firmware meta updates) sync the machine to match observed reality without re-emitting the command. (see `src/effects/transportOrchestrator.ts`, `src/runtime/runtimeTransportService.ts`)

1.4 **Clock policy.** The **internal clock** (rAF-driven `performance.now`) is used as the time source iff WASM is the only authoritative runtime for time. This is not a "mock" — it is the computer's real clock, used whenever hardware is not providing time. When hardware is connected, hardware-streamed time wins and the internal clock stops. (see `src/effects/transportClock.ts`, `src/effects/localClock.ts`)

1.5 In `wasm` or `none` mode, transport `stopped` resets the internal clock to zero, `paused` freezes it, `playing` resumes from frozen position. (see `src/effects/localClock.ts`)

1.6 In `hardware` or `both` mode, transport state changes do not directly drive the clock; after the JSON handshake completes, the editor sends a `stream-config` request that enables output streaming at the configured rate (default 30Hz). Once enabled, hardware streams time on channel 0 and output values on channels 1+; the app follows hardware time. Transport commands are sent to both runtimes in `both` mode, but WASM transport state is best-effort — hardware-streamed time overrides WASM's internal clock regardless. (see `src/effects/transportClock.ts`, `src/transport/stream-parser.ts`, `src/transport/json-protocol.ts` `sendDefaultStreamConfig()`)

1.7 The transport toolbar exposes Play/Pause/Stop/Rewind buttons; their enabled/disabled and visual state must reflect the current machine state and active runtime mode without lag. (see `src/ui/TransportToolbar.tsx`, `src/ui/adapters/toolbars.tsx`)

1.8 **Connection indicator semantics** (see [runtime-modes.md](runtime-modes.md)): the transport surface visually distinguishes `none`, `wasm`, `hardware`, `both`. Hover/tooltip describes the precise state in plain language.

## Open / Deferred

(none currently — quantised eval is now runtime-side and gated by the global quant phasor; see [code-evaluation.md §1.1](code-evaluation.md) and [`wire-protocol.md` §5.7](../../src-useq/docs/specs/wire-protocol.md).)
