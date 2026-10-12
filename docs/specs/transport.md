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
- `src/ui/adapters/toolbars.tsx` — toolbar adapter wiring (BPM refresh/commit, shortcut lookup)
- `src/ui/MainToolbar.tsx` — right-hand main toolbar and connection status chip
- `src/ui/ProgressBar.tsx` — bar-progress strip with beat ticks
- `src/ui/toolbar/BpmControl.tsx` — editable tempo chip
- `src/ui/toolbar/shortcutLabels.ts` — toolbar tooltip shortcut formatting

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
&nbsp;&nbsp;&nbsp;&nbsp;1.7.1 **Active state is lit, not faded.** The button for the current transport state (Play while `playing`, Pause while `paused`, Stop while `stopped`) is rendered as an active toggle (`aria-pressed="true"`, accent fill) and stays enabled; pressing it is a no-op, matching the machine's ignored events (§1.2). Only genuinely unavailable actions are disabled and look disabled: Pause while `stopped`, and every control in `none` mode (where nothing is lit). A state readout beside the buttons names the state ("Playing" / "Paused" / "Stopped", or "No runtime" in `none`) and pulses while playing (static under `prefers-reduced-motion`).
&nbsp;&nbsp;&nbsp;&nbsp;1.7.2 **Tooltips show shortcuts.** Toolbar tooltips (transport and main toolbar) append the user's active binding for the matching action-registry action, e.g. "Graph (Alt+G)", resolved from the live keybinding resolver ([keybindings.md §1.1, §1.3](keybindings.md)) and formatted per the OS modifier mapping (§1.5 there). Buttons with no registry action, or whose action is unbound, show the bare label. Accessible names do not include the shortcut. (see `src/ui/toolbar/shortcutLabels.ts`)
&nbsp;&nbsp;&nbsp;&nbsp;1.7.3 **Editable BPM.** When the WASM runtime can report `bpm`, the toolbar shows a tempo chip (spinbutton semantics). Click (or Enter/Space when focused) opens an inline text field: Enter commits, Escape or blur cancels. Vertical pointer drag scrubs (4 px per BPM, Shift for 0.1 steps) and commits once on release; wheel and ArrowUp/ArrowDown step (Shift: 0.1 for wheel, 10 for arrows) and commit after a short settle. Values are clamped to 20–300 and rounded to 0.1. A commit sends `(set-bpm n)` through the shared runtime evaluation fan-out (`@(set-bpm n)` to hardware, `(set-bpm n)` to WASM). The chip never takes focus without a gesture: scrubs leave focus in place, and a keyboard-ended edit returns focus to its previous owner. The displayed value refreshes on mount, after every evaluation (`codeEvaluated`), and on every runtime-session change — no polling. (see `src/ui/toolbar/BpmControl.tsx`, `src/ui/adapters/toolbars.tsx`, `src-useq/docs/specs/time.md` §1.5)
&nbsp;&nbsp;&nbsp;&nbsp;1.7.4 **Bar progress.** Under the buttons a strip shows the bar phase with subtle beat ticks at each beat boundary (`beats-per-bar` read from the runtime; 4 when unavailable). Its width follows the button row through layout. (see `src/ui/ProgressBar.tsx`)
&nbsp;&nbsp;&nbsp;&nbsp;1.7.5 **Layout.** The top transport strip and the right-hand main toolbar never overlap: the main toolbar sits below the strip. At ≤ 700 px wide, text labels (state word, BPM unit, engine label, connection label) collapse to icons and colour dots; at ≤ 480 px the transport buttons take the first row and the status chips move below. Sizes are em-based so large projected fonts scale without overlap; the main toolbar scrolls rather than overflowing the viewport.

1.8 **Connection indicator semantics** (see [runtime-modes.md §1.6](runtime-modes.md)): the main toolbar's first control is a labelled status chip that visually distinguishes `none`, `wasm`, `hardware`, `both` by text ("Offline", "Virtual uSEQ", "uSEQ hardware", "Hardware + virtual"), status colour, and dot shape. Hover/tooltip (and the accessible name) describes the precise state in plain language and what a click does; clicking toggles the hardware connection. The attention pulse (`animateConnect`) wobbles the chip, or flashes it without motion under `prefers-reduced-motion`. (see `src/ui/MainToolbar.tsx`)

## Open / Deferred

(none currently — quantised eval is now runtime-side and gated by the global quant phasor; see [code-evaluation.md §1.1](code-evaluation.md) and [`wire-protocol.md` §5.7](../../src-useq/docs/specs/wire-protocol.md).)
