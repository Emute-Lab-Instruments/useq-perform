# Runtime Modes

> Spec: hardware-vs-WASM runtime mode semantics. Counterpart to [MAIN.md](MAIN.md).
> See `../RUNTIME_CONTRACT.md` for the editor↔runtime capability split.

1.1 The app has exactly **four runtime modes** at any moment: `none`, `wasm`, `hardware`, `both`.

1.2 **`none`** — no runtime is available. Eval is rejected with a user-visible message; transport controls are disabled or visually inert. The onboarding banner ([help.md §2](help.md)) is visible.

1.3 **`wasm`** — only the in-browser WASM interpreter is available. Default mode when the user opens the app cold without hardware connected. Indistinguishable from `hardware` as far as language semantics; visually differentiated in the connection indicator.

1.4 **`hardware`** — only real hardware is connected. Uncommon in practice (WASM is enabled by default) but a valid mode if the user has explicitly disabled WASM in settings, or if it's not supported for other reasons (e.g. lacking hardware resources).

1.5 **`both`** — hardware connected *and* WASM enabled. Hardware is authoritative for outputs; WASM complements with local sampling and visualisation. Must be visually distinct in the connection indicator from any single-runtime mode.
&nbsp;&nbsp;&nbsp;&nbsp;1.5.1 By default in `both`, WASM acts as a "visualisation shadow" for the hardware (see [MAIN.md §1.3.1](MAIN.md)): hardware drives outputs, WASM drives visual feedback.

1.6 **Mode determination is observable, not inferred from `connectedToModule`.** Any UI indicator showing "connected" must distinguish hardware from WASM-only — never collapse them.

1.7 **Mode transitions are seamless.** Connecting hardware while in `wasm` upgrades to `both` without losing editor state, console history, or vis state. Disconnecting hardware while in `both` falls back to `wasm`. The user's evaluations across the boundary must continue to produce visible feedback.

1.8 Settings provide **`runtime.startLocallyWithoutHardware`** (default true): when true, the app boots into `wasm` mode without waiting for a hardware connection probe.

1.9 Settings provide **`runtime.autoReconnect`** (default true): when true, on app load the app attempts to reconnect to a previously saved Web Serial port (matched by `usbVendorId`/`usbProductId`).

1.10 Settings provide **`wasm.enabled`** (default true). When false: hardware is the only runtime; if hardware is also absent, mode is `none`.

1.11 The **shared transport command set** that fans out to both runtimes is exactly: `(useq-play)`, `(useq-pause)`, `(useq-stop)`, `(useq-rewind)`, `(useq-clear)`, `(useq-get-transport-state)`. Anything else is hardware-only or WASM-only and must not be silently sent to the wrong runtime.

## Open / Deferred

2.1 **Worker-default for WASM.** Worker-backed `WasmRuntimePort` is opt-in (`?wasmInWorker=true`). Making it default-on requires: probe sampler also routes through the port, diagnostics readback piped across the worker boundary, and batch sampling profiled at 15+ channels.
