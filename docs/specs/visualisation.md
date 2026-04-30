# Visualisation

> Spec: visualisation panel, sampling, palette. Counterpart to [MAIN.md](MAIN.md).

1.1 The visualisation panel renders **time-series traces** for active outputs and probed expressions on a single canvas surface.

1.2 The time axis is **centred on now**: the canvas centre column corresponds to the current transport time; left half is past samples; right half is future samples (predicted by sampling WASM at `t > now`).

1.3 The window duration is `visualisation.windowDuration` seconds (default 10). Sample density is `visualisation.sampleCount` per window (default 100). Line width is `visualisation.lineWidth` (default 1.5; clamped 0.5–5).

1.4 **Future samples are visually distinct.** Default rendering uses lower alpha for future segments; `visualisation.futureDashed` (boolean) toggles dashed rendering for future segments.

1.5 **Lane layout.** Digital outputs are rendered as step-mode binary traces in stacked lanes. Analogue outputs are rendered as continuous traces in stacked lanes. Lane height is derived from drawable area divided by lane count. The channel set is dynamic — determined by the hello handshake for hardware (the main uSEQ module has 3 analogue + 3 digital; expanders add more) and by the output recognition pattern (a1–a8, d1–d8, s1–s8) for WASM.

1.6 **Empty state.** When no expressions are assigned and no probes exist, the panel shows a placeholder ("No expressions selected") and consumes near-zero CPU.

1.7 **Sampling source.** Future samples come from WASM `evalOutputsInTimeWindow`. Past samples come from the same source (WASM is the authoritative model) or, in hardware-only mode, from the hardware-streamed serial buffers.

1.8 **Sampling guards.** At most one batch is in flight at a time. If a newer time arrives while a batch is running, the latest pending time is sampled once the current run completes (single pending-time slot). A slow batch must never overwrite a fresher one — this invariant follows from strict serialization, not from post-hoc sequence-counter discard.

1.9 **Render frequency** is animation-frame paced. The renderer no-ops when the panel is not visible. Rendering must remain smooth (≥ 30 FPS) at the documented channel target — see [MAIN.md §3.3](MAIN.md).

1.10 **Palette is theme-coupled.** Switching to a light theme switches the visualisation palette; a dark theme uses a dark palette. Custom palettes are not user-editable in v1. See [themes.md](themes.md).

1.11 The visualisation panel must continue to render correctly across runtime transitions (see [runtime-modes.md §1.7](runtime-modes.md)). A hardware connect/disconnect must not blank the canvas or lose in-flight traces.

## Open / Deferred

2.1 **Render parity for WebGL renderer.** WebGL2 painter ships behind a devmode setting. Default-on requires visual-fidelity parity, line-width handling on browsers that ignore WebGL `lineWidth>1`, and per-channel performance ≥ the canvas path.
