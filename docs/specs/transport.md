---
stability: stable
layer: behavioural
---

# Transport

> Spec: transport state machine, clock policy, indicator. Counterpart to [MAIN.md](MAIN.md).

## Source files

- `src/machines/transport.machine.ts` — XState transport state machine (`playing`, `paused`, `stopped`)
- `src/effects/transportOrchestrator.ts` — transport command dispatch to active runtimes
- `src/effects/transportClock.ts` — clock policy and internal-clock startup semantics (`shouldUseLocalClock`, `applyClockPolicy`, `startInternalClock`)
- `src/effects/visualisationRuntime.ts` — single rAF loop owning local-time advancement and sampling/rendering
- `src/runtime/runtimeTransportService.ts` — fan-out of shared transport commands to both runtimes
- `src/transport/connector.ts` — serial port lifecycle, auto-reconnect, `connectedToModule`
- `src/transport/json-protocol.ts` — capability negotiation and JSON wire protocol driver (hello, ping, stream-config, eval)
- `src/transport/legacy-protocol.ts` — pre-1.2 firmware probe, raw eval writer, and one-response capture
- `src/transport/stream-parser.ts` — universal serial stream/framed-JSON/legacy-text parser
- `src/transport/serial-utils.ts` — low-level serial port utilities
- `src/transport/webSerialHostPort.ts` — Web Serial `RuntimePort` implementation
- `src/transport/upgradeCheck.ts` — firmware version upgrade check
- `src/transport/types.ts` — transport type definitions
- `src/contracts/useqProtocolSchema.ts` — canonical JSON-v1 validation and runtime-support catalog generated from the pinned firmware schema
- `src/contracts/useqRuntimeContract.ts` — shared transport command set constants
- `src/ui/TransportToolbar.tsx` — transport toolbar UI (Play/Pause/Stop/Rewind/Clear buttons)
- `src/ui/adapters/toolbars.tsx` — toolbar adapter wiring

1.1 The transport has exactly **three states**: `playing`, `paused`, `stopped`. The state machine boots in `paused` if a runtime is available, else in `stopped`. **Exception — browser-local (hardware-optional) startup auto-runs**: when the app starts on the WASM runtime, app lifecycle sends a `play` command to the WASM interpreter so the program runs immediately on load (instant feedback; the music-never-stops principle). The machine's *state value* still reads `paused` until a user transition — the auto-run only nudges the interpreter. With hardware attached, the user starts playback explicitly. (see `src/machines/transport.machine.ts`, `src/runtime/appLifecycle.ts`)

1.2 The transport is driven by an XState machine. Per-state event handlers (see `src/machines/transport.machine.ts`):
- `playing`: `PAUSE` → `paused` (emit pause); `STOP` → `stopped` (emit stop); `REWIND` → `stopped` (emit rewind + stop). `PLAY` is **ignored** when already playing.
- `paused`: `PLAY` → `playing` (emit play); `STOP` → `stopped` (emit stop); `REWIND` → `stopped` (emit rewind + stop). `PAUSE` is ignored.
- `stopped`: `PLAY` → `playing` (emit play); `REWIND` stays `stopped` (emit rewind only, no stop). `PAUSE`/`STOP` are ignored.

Global events handled in every state, used to keep the machine in sync without re-emitting transport commands or to track the runtime mode:
- `SYNC` `{ state }` — runtime→machine sync (§1.3). Transitions to the given state and fires the corresponding `syncWasm*` action (which pushes the state into the WASM runtime); it never re-emits a transport command, so there is no hardware feedback loop.
- `UPDATE_MODE` `{ mode }` — records the active runtime mode (`hardware`/`wasm`/`both`/`none`) in machine context without changing the transport state.
- `CLEAR` — a mode-less side-effect that emits `(useq-clear)` to the active runtime(s); it fires the `emitClear` action and does **not** change the transport state.

1.3 **State changes are bidirectional.** User-initiated transitions emit shared transport commands to the active runtime(s). Runtime-initiated transitions (e.g. firmware meta updates) sync the machine to match observed reality without re-emitting the command. (see `src/effects/transportOrchestrator.ts`, `src/runtime/runtimeTransportService.ts`)

1.4 **Clock policy.** The **internal clock** (rAF-driven `performance.now`) is used as the time source iff WASM is the only authoritative runtime for time (`shouldUseLocalClock()` = not connected to hardware **and** WASM enabled). This is not a "mock" — it is the computer's real clock, used whenever hardware is not providing time. When hardware is connected, hardware-streamed time wins and the internal clock stops. When browser audio is present, the audio frame clock supersedes rAF only while the synthesis engine is `running`; `suspended` has no advancing audio frames, so the local visualisation clock remains active until user activation succeeds. The rAF loop and local-time advancement live in `src/effects/visualisationRuntime.ts` (a single loop driving both sampling and rendering), while `src/effects/transportClock.ts` owns the transport policy and startup semantics. (see `src/effects/transportClock.ts`, `src/effects/visualisationRuntime.ts`)

1.5 In `wasm` mode (the only mode where `shouldUseLocalClock()` is true — `none` mode has WASM disabled, so the internal clock never runs there), transport `stopped` resets the internal clock to zero, `paused` freezes it, `playing` resumes from frozen position. (see `src/effects/transportClock.ts`, `src/effects/visualisationRuntime.ts`)

1.6 In `hardware` or `both` mode, transport state changes do not directly drive the clock. After a JSON handshake, the editor sends a `stream-config` request at the configured rate (`DEFAULT_STREAM_MAX_RATE_HZ`, default **100 Hz**). The default subscribes only the **input** channels (on-change); output channels (`s1`–`s8`) are **not** subscribed by default, and firmware always streams time regardless of subscription. On the wire, time arrives on **channel 1** (output index 1 in `IoConfig`) and is stored at internal buffer index 0; subscribed channels follow on their own wire channels. Legacy firmware has no `stream-config`; the parser accepts its already-configured 11-byte stream frames. In both cases hardware time wins. The WASM shadow is best-effort for JSON hardware and disabled for legacy hardware. (see `src/effects/transportClock.ts`, `src/transport/stream-parser.ts`, `src/runtime/jsonProtocol.ts` `buildDefaultStreamConfig()`)

1.9 **Protocol selection is capability-based and legacy-safe.** On each port open the editor first sends one newline-terminated `@(useq-report-firmware-info)` probe. This ordering matters because pre-1.2 firmware would interpret a JSON hello as scheduled ModuLisp. A framed version response fixes the connection to `legacy`; otherwise the editor retries JSON `hello`, whose successful response fixes it to `json`. A current device's unsolicited `ready` frame may trigger hello immediately. User code is never sent while the mode is still `negotiating`; the drivers do not fall through into each other after selection.

1.10 In legacy mode, leading `@` and unprefixed forms cross the wire unchanged so the old firmware retains immediate-versus-quantised behaviour. JSON mode removes the historical leading `@` and uses structured eval. JSON-only requests reject in legacy mode rather than pretending to succeed.

1.7 The transport toolbar exposes five buttons: Play, Pause, Stop, Rewind, and Clear. Play/Pause/Stop/Rewind reflect transport state changes; Clear is a mode-less side-effect that sends `CLEAR` to the machine (emitting `(useq-clear)` to the runtime) without changing state (§1.2). Their enabled/disabled and visual state must reflect the current machine state and active runtime mode without lag; in `none` mode Rewind and Clear are disabled. (see `src/ui/TransportToolbar.tsx`, `src/ui/adapters/toolbars.tsx`, `src/contracts/useqRuntimeContract.ts`)

1.8 **Connection indicator semantics** (see [runtime-modes.md](runtime-modes.md)): the transport surface visually distinguishes `none`, `wasm`, `hardware`, `both`. Hover/tooltip describes the precise state in plain language.

## Open / Deferred

(none currently — quantised eval is now runtime-side and gated by the global quant phasor; see [code-evaluation.md §1.1](code-evaluation.md) and [`wire-protocol.md` §5.7](../../src-useq/docs/specs/wire-protocol.md).)
