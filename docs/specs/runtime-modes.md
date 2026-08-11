---
stability: stable
layer: behavioural
---

# Runtime Modes

> Spec: hardware-vs-WASM runtime mode semantics. Counterpart to [MAIN.md](MAIN.md).
> See [runtime-contract.md](runtime-contract.md) for the editor↔runtime capability split.

## Source files

- `src/runtime/runtimeSession.ts` — mode combination matrix, `RuntimeConnectionMode` / `TransportMode` derivation
- `src/runtime/runtimeCoordinator.ts` — sole mutable owner of session transitions and active typed WASM-port selection
- `src/runtime/browserWasmRuntime.ts` — configured intent, Worker readiness/recovery, and actual-availability publication
- `src/runtime/runtimeSessionService.ts` — mode transitions, hardware connect/disconnect handling
- `src/runtime/runtimeCoordinator.ts` — canonical owner of runtime session state and active WASM-port selection
- `src/runtime/runtimeService.ts` — runtime session announcements, settings mutation surface
- `src/contracts/runtimeTypes.ts` — `RuntimeConnectionMode`, `TransportMode`, `RuntimeSessionInputs` type definitions
- `src/contracts/runtimeChannels.ts` — `connectionChanged` channel for mode-transition events
- `src/runtime/wasmRuntimeWorkerPort.ts` — sole production browser-local WASM port
- `src/runtime/workers/wasmRuntime.worker.ts` — Worker-local WASM instantiation and execution
- `src/runtime/activeWasmRuntimePort.ts` — compatibility read-through facade over coordinator port selection
- `src/runtime/runtimeTransportService.ts` — transport command fan-out to both runtimes
- `src/effects/transportOrchestrator.ts` — shared transport command dispatch
- `src/lib/appSettings.ts` — settings types including `runtime.*` and `wasm.*` knobs
- `src/transport/connector.ts` — `connectedToModule` flag (transport-internal)

1.1 The app has exactly **four runtime modes** at any moment: `none`, `wasm`, `hardware`, `both`. These are the values of the canonical `TransportMode` type. A related `RuntimeConnectionMode` (`hardware` / `browser` / `none`) is derived from the same session inputs and is what the connection indicator (§1.6) reads to distinguish hardware from WASM-only; note it uses `browser` where `TransportMode` uses `wasm`. (see `src/runtime/runtimeSession.ts`, `src/contracts/runtimeTypes.ts`)

1.2 **`none`** — no runtime is available. Eval is rejected with a user-visible message; transport controls are disabled or visually inert. The onboarding banner ([help.md §2](help.md)) is visible.

1.3 **`wasm`** — only the in-browser WASM interpreter is available. Default mode when the user opens the app cold without hardware connected. Indistinguishable from `hardware` as far as language semantics; visually differentiated in the connection indicator.

1.4 **`hardware`** — only real hardware is connected. Uncommon in practice (WASM is enabled by default) but a valid mode if the user has explicitly disabled WASM in settings, or if it's not supported for other reasons (e.g. lacking hardware resources).

1.5 **`both`** — hardware connected *and* WASM enabled. Hardware is authoritative for outputs; WASM complements with local sampling and visualisation. Must be visually distinct in the connection indicator from any single-runtime mode.
&nbsp;&nbsp;&nbsp;&nbsp;1.5.1 By default in `both`, WASM acts as a "visualisation shadow" for the hardware (see [MAIN.md §1.3.1](MAIN.md)): hardware drives outputs, WASM drives visual feedback.
&nbsp;&nbsp;&nbsp;&nbsp;1.5.2 **WASM must not bog down the hardware runtime.** WASM sampling, visualisation, and probe evaluation in `both` mode are best-effort: they may degrade their own quality (drop frames, reduce sample rate, skip channels) but must never steal cycles from the serial transport reader/writer or block on hardware I/O. Hardware-driven outputs are the contract; everything WASM does is local enrichment.
&nbsp;&nbsp;&nbsp;&nbsp;1.5.3 The browser represents this asymmetry through the single `visualisationSession` seam. Hardware time and streamed samples update the visible session immediately; WASM sampling, future projection, probes, and drift resync are queued/coalesced shadow operations. The session may discard stale shadow work, but it must not discard or delay hardware transport work.

1.6 **Mode determination is observable, not inferred from `connectedToModule` or settings.** `wasm.enabled` is configured intent; `wasm`/`both` becomes true only after a selected Worker completes its readiness handshake. Hardware connection facts cannot manufacture WASM availability. Any UI indicator showing "connected" must distinguish hardware from WASM-only — never collapse them.

1.7 **Mode transitions are seamless.** Connecting hardware while in `wasm` upgrades to `both` without losing editor state, console history, or vis state. On hardware connect, the app prompts the user: "Hardware connected. Send current program to device?" — letting the user decide whether to sync the current WASM state to hardware. The prompt fires on the `wasm` → `both` transition (a fresh hardware connect while WASM is running), never on a boot directly into `both` nor on disconnect, and is suppressed when the editor is empty; on confirm the current editor program is sent over serial. Disconnecting hardware while in `both` falls back to `wasm`. The user's evaluations across the boundary must continue to produce visible feedback. (see `src/runtime/runtimeSessionService.ts`, `src/effects/hardwareConnectPrompt.ts`)

1.8 Settings provide **`runtime.startLocallyWithoutHardware`** (default true): when true, the app boots into `wasm` mode without waiting for a hardware connection probe. (see `src/runtime/bootstrap.ts`, `src/runtime/appSettingsRepository.ts`)

1.9 Settings provide **`runtime.autoReconnect`** (default true): when true, on app load the app attempts to reconnect to a previously saved Web Serial port (matched by `usbVendorId`/`usbProductId`). (see `src/transport/connector.ts`)

1.10 Settings provide **`wasm.enabled`** (default true). When false: hardware is the only runtime; if hardware is also absent, mode is `none`. In `none` mode the editor still accepts input, but eval is rejected with a user-visible warning ("no runtime available — connect hardware or enable browser-local WASM"). The app must not silently drop evals. The gate is enforced at the top of `evaluate()` via `evalRejectionForNoRuntime()`. (see `src/lib/appSettings.ts`, `src/runtime/runtimeSession.ts`, `src/effects/noneModeGate.ts`, `src/effects/editorEvaluation.ts`)

1.11 The **shared transport command set** that fans out to both runtimes is exactly: `(useq-play)`, `(useq-pause)`, `(useq-stop)`, `(useq-rewind)`, `(useq-clear)`, `(useq-get-transport-state)`. Anything else is hardware-only or WASM-only and must not be silently sent to the wrong runtime. (see `src/contracts/useqRuntimeContract.ts`, `src/runtime/runtimeTransportService.ts`)

1.12 **WASM eval is Worker-only in production.** Eval, batch sampling, time advance, probes, state resync, failure-mode changes, diagnostics, and synthesis-producer control all cross one `WasmRuntimePort` Worker boundary. If `Worker` is unavailable or the Worker cannot load, browser-local WASM is unavailable: the app continues as hardware-only when hardware is usable, otherwise as `none`; it never runs the interpreter on the UI/serial thread. Renderer (WebGL) and editor remain on the main thread. The direct `wasmInterpreter.ts` loader exists only for isolated conformance witnesses and interpreter integration tests. (see `src/runtime/wasmRuntimeWorkerPort.ts`, `src/runtime/workers/wasmRuntime.worker.ts`, `src/runtime/witnessEngine.ts`)

1.13 **`connectedToModule` is a misnomer; do not treat it as "hardware is attached".** The legacy boolean `connectedToModule` in the transport layer means "JSON handshake completed against *some* serial port" — not "real uSEQ hardware is plugged in". Consumers deciding whether the hardware-mode capability set applies must use the runtime-mode signal (this spec), not `connectedToModule`. The variable persists only as a transport-internal flag and may be renamed without notice. (see `src/transport/connector.ts`)

1.14 **Runtime ownership is singular but capability-local.** `runtimeCoordinator.ts` is the only mutable owner of derived session state and selected port. `browserWasmRuntime.ts` owns Worker construction, readiness, one controlled replacement after a post-ready crash, and disposal; it publishes actual availability to the coordinator. `appLifecycle.ts` reacts to those transitions without deriving a second mode. On final recovery failure the selected port is cleared and mode truthfully downgrades to `hardware`/`none`. The serial edge reports hardware facts only. (see `src/runtime/runtimeCoordinator.ts`, `src/runtime/browserWasmRuntime.ts`, `src/runtime/appLifecycle.ts`, `src/runtime/wasmRuntimeWorkerPort.ts`)
