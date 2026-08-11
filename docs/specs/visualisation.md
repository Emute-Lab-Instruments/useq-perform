---
stability: evolving
layer: behavioural
---

# Visualisation

> Spec: visualisation panel, sampling, past/future semantics, output classification, palette. Counterpart to [MAIN.md](MAIN.md).
> See also [../../src-useq/docs/specs/state.md](../../src-useq/docs/specs/state.md) (state semantics, phase coherence), [../../src-useq/docs/specs/signal-model.md](../../src-useq/docs/specs/signal-model.md) (implicit lifting, pure-by-default model), and [../../src-useq/docs/specs/visualisation-projection.md](../../src-useq/docs/specs/visualisation-projection.md) (WASM projection-fork ABI and engine invariants).

### Source files

- `src/effects/visualisationSession.ts` — sole production seam for clock, expression, view-data, probes, hardware→WASM shadow, and teardown
- `src/effects/visualisationRuntime.ts` — sole rAF/local-time owner and serialized sample-request queue
- `src/effects/visualisationSampler.ts` — WASM tick-and-project execution, projection scheduling, and expression lifecycle
- `src/effects/visualisationBuffers.ts` — exclusive owner of per-output past/future rolling-buffer allocation, capacity, and render lookup
- `src/effects/visualisationSamplingPolicy.ts` — live-loop safety bounds and projection-relevant identity, applied after general app-settings normalization
- `src/lib/PastBuffer.ts` — the `PastBuffer` FIFO rolling-buffer class used for both past and future halves
- `src/effects/adaptiveQuality.ts` — pressure detection, adaptive quality levers (§1.7.1)
- `src/ui/visualisation/serialVisGL.ts` — WebGL canvas/program/VBO lifecycle, segment drawing, and 2D overlay; owns mount/resize geometry (`activateGLCanvas`/`ensureGLCanvasGeometry`)
- `src/ui/visualisation/serialVisPlanning.ts` — DOM-free lane layout, past/future sample assembly, boundary policy, and pixel-matched rate planning
- `src/ui/visualisation/webglLineRenderer.ts` — low-level WebGL line rasteriser
- `src/ui/VisLegend.tsx` — vis legend UI component
- `src/utils/visualisationStore.ts` — reactive store for current time, registered expressions, and settings-derived state; rolling sample buffers live in `visualisationBuffers.ts`
- `src/contracts/visualisationChannels.ts` — typed pub/sub channels for vis events
- `src/contracts/visualisationEvents.ts` — vis event type definitions
- `src/ui/adapters/visualisationPanel.ts` — panel visibility and render-hook wiring through the visualisation session
- `src/contracts/wasmAbi.ts` — WASM ABI export declarations (§7)

## 1. Panel and Rendering

1.1 The visualisation panel renders **time-series traces** for active outputs and probed expressions on a single WebGL-backed surface. The Superbooth 2026 target is WebGL-only; the legacy 2D canvas renderer is not part of the stable renderer surface. (see `src/ui/visualisation/serialVisGL.ts`, `src/ui/visualisation/webglLineRenderer.ts`)

1.2 The time axis is **centred on now**: the surface centre column corresponds to the current transport time; the left half shows **recorded past values**; the right half shows **projected future values**.

1.3 The window duration is `visualisation.windowDuration` seconds (default 10). Sample density is `visualisation.sampleCount` per window (default 100). Line width is `visualisation.lineWidth` (default 1.5; clamped 0.5–5).

1.4 **Future samples are visually distinct.** Default rendering uses lower alpha for future segments; `visualisation.futureDashed` (boolean) toggles dashed rendering for future segments.

1.5 **Lane layout.** Digital outputs are rendered as step-mode binary traces in stacked lanes. Analogue outputs are rendered as continuous traces in stacked lanes. Lane height is derived from drawable area divided by lane count. The channel set is dynamic — determined by the hello handshake for hardware (the main uSEQ module has 3 analogue + 3 digital; expanders add more) and by the output recognition pattern (a1–a8, d1–d8, s1–s8) for WASM.

1.5.1 **Per-variant channel selection.** When the buffer holds multiple variants for the same output (`(a1 …)` written more than once), a **per-output toggle** picks which variant is sampled and rendered for that lane — at most one variant per output is active for vis at any time. Eval implicitly toggles the just-evaluated form's vis on; explicit user toggle (gutter play button or `vis.toggleAtHalo` action) overrides. Soft eval does not toggle. Toggling on a variant that is not the currently-running one triggers implicit soft-sampling of that variant in WASM, independent of what the module is producing. Full contract: [expression-gutter.md §3](expression-gutter.md).

1.6 **Empty state.** When no expressions are assigned and no probes exist, the panel shows a placeholder ("No expressions selected") and consumes near-zero CPU. The placeholder is drawn by the renderer's 2D overlay. (see `src/ui/visualisation/serialVisGL.ts`)

1.7 **Render frequency** is animation-frame paced. The renderer no-ops when the panel is not visible. Rendering must remain smooth (≥ 30 FPS) at the documented channel target — see [MAIN.md §3.3](MAIN.md).

1.7.1 **Adaptive quality under sustained frame pressure.** (see `src/effects/adaptiveQuality.ts`) When `visualisation.adaptiveQuality` is enabled (default `true`), the rAF loop measures committed-tick elapsed times and derives a *pressure level* (0 = normal, 1 = mild, 2 = severe). Any tick `≥ 50ms` (i.e. ≤ 20fps) is a *miss*; 3+ misses in the last 8 ticks step up to mild, 6+ to severe. Step-down only happens after 16 consecutive normal ticks (hysteresis to avoid oscillation under bursty load). Three levers engage in increasing-cost-of-quality-loss order: (a) defer non-urgent future-frontier extension while coverage remains sufficient (the future trace stops extending until pressure releases or coverage guard bands require it); (b) double (mild) or quadruple (severe) the effective probe refresh interval — the persisted `probeRefreshIntervalMs` is unchanged, the multiplier is applied at read time; (c) halve (mild) or quarter (severe) the pixel-matched past-buffer sample rate (§2.2.1) before pushing it to the sampler, reducing buffer size and per-paint GPU work proportionally. When `adaptiveQuality` is `false`, pressure detection still runs but consumers always see level 0.

1.8 **Palette is theme-coupled.** Switching to a light theme switches the visualisation palette; a dark theme uses a dark palette. Custom palettes are not user-editable in v1. See [themes.md](themes.md).

1.9 The visualisation panel must continue to render correctly across runtime transitions (see [runtime-modes.md §1.7](runtime-modes.md)). A hardware connect/disconnect must not blank the rendering surface or lose in-flight traces.

1.10 **One session boundary.** Production consumers access visualisation state and behaviour only through `visualisationSession`. Its `clock`, `expressions`, `view`, `probes`, and `shadow` facets own the public behavior; `begin()`/`dispose()` own their joint lifetime. Dispose stops rAF/local time, clears queued work, detaches the render hook, invalidates late probe results, and stops state sync before the UI root is removed. The runtime, sampler, buffer, store, and drift-resync modules are implementation details. Hardware time enters synchronously through `clock.acceptHardwareTime()`: it updates the visible clock immediately and merely queues/coalesces best-effort WASM shadow sampling, so visualisation work cannot backpressure the serial transport path.

---

## 2. Past Values — Recorded History

Past values are ground truth: what the signal engine actually produced as time advanced.

2.1 **Recording model.** The browser-local WASM engine is ticked on a monotonic sampling timeline, not limited to one tick per animation frame. The target live tick rate is `pixelMatchedPastRate × visualisation.temporalSampleRateMultiplier`, where the multiplier is clamped to `0.05..1.0`. A multiplier of `1.0` means every horizontal visual sample column can receive its own state-advancing temporal sample. Each committed tick computes all active output values, commits state, and records the results into a **per-output rolling buffer**. This tick stream is the authoritative source of past values.

2.2 **Rolling buffer shape.** (see `src/effects/visualisationBuffers.ts` for buffer ownership, `src/lib/PastBuffer.ts` for the FIFO class) Each active output maintains a FIFO buffer of recorded samples. All outputs are sampled at the same committed tick times. The buffer is time-aligned at constant sample rate, so index arithmetic suffices for time lookups — no (time, value) pairs needed.

2.2.1 **Pixel-matched buffer capacity and tick density.** The rolling buffer's capacity is derived from rendering-surface pixel width: `bufferSampleRate = floor(canvasWidth / 2) / (windowDuration / 2)` when future projection is visible, and `bufferSampleRate = canvasWidth / windowDuration` when the past occupies the full surface. The renderer recomputes this on surface resize and integer-snaps it to avoid sub-pixel re-allocation. The live WASM tick target is configurable up to this same rate (§2.1), so `temporalSampleRateMultiplier = 1.0` gives literal one-sample-per-column past recording for the effective visual rate. Lower multipliers intentionally trade temporal fidelity for CPU headroom.

2.2.2 The pixel-matched capacity applies to the **past buffer only**. Future projection uses its own projection-batch density (§3.1.1), which may be lower. The visual transition between past and future density at `t = now` is acceptable because the future half is already visually distinguished (lower alpha or dashed, §1.4).

2.3 **History depth.** The buffer retains `visualisation.windowDuration / 2 + visualisation.historyHeadroom` seconds of history (default headroom: 5 seconds). `visualisation.maxHistorySeconds` (default 30) caps the total history regardless of headroom. Widening the vis window beyond the buffer simply shows a shorter past.

2.4 **Past values are never overwritten on expression change.** When the user evaluates a new expression for an output, the rolling buffer retains all samples recorded under the old expression. The past half of the vis panel shows what actually happened, including the old expression's trace right up to the moment of change.

2.5 **Visual discontinuity at expression boundaries.** When a new expression produces different values from the old one, there will be a visible discontinuity at the moment of change (past values from old expression, future values from new expression). This is intentional — the visualisation is honest about what happened vs what will happen.

2.6 **Hardware-only mode.** In hardware-only mode (WASM unavailable), past values come from hardware-streamed serial buffers. The rolling buffer accumulates from the serial stream parser instead of from WASM ticks.

2.7 **Buffer lifecycle.** A rolling buffer is created when an output is registered for visualisation and destroyed when unregistered. Buffers survive expression changes and runtime transitions (hardware connect/disconnect). A WASM crash in `both` mode preserves the existing buffer contents; recording resumes after WASM reinitialisation (see [MAIN.md §2.10](MAIN.md)).

---

## 3. Future Values — Projection Fork And Frontier

Future values are projections: what the signal engine would produce if conditions held steady from this moment forward.

3.1 **Projection model — clone once, extend the frontier.** (see `src/effects/visualisationRuntime.ts`, `src/effects/visualisationSampler.ts`) The future half is stored in a **per-output rolling buffer** (same `PastBuffer` type as the past half), but the state used to produce it is not the live runtime state. For performance on constrained devices, the WASM runtime owns a persistent **projection fork** rather than recomputing the whole future window every frame:

- `projectionStartTime` — the live time at which the fork was created.
- `projectionFrontierTime` — the newest projected sample time.
- `projectionState` — a clone of the engine state advanced up to `projectionFrontierTime`.
- frozen external inputs / live-edit values captured at fork creation.

Future buffers are populated in two ways:

- **Reset + fill** (on invalidation): after the live tick at `t = now`, clone live state, clear future buffers, and sequentially project from just after `now` to `now + windowDuration/2 + futureLeadSeconds`. This populates the visible future and records the new frontier.
- **Frontier extension** (steady state): append a small batch beginning just after the current frontier and ending beyond the visible future edge. This advances the projection fork itself, not the live state. The batch size is small but greater than one sample (default target: 4 samples; implementations may tune 2-8 based on cost).

Future buffers are **stable between invalidation events**. The already-projected near future is not recomputed every frame; only the far frontier advances. This eliminates the jitter caused by full-window per-frame recomputation while avoiding the incorrect "single future sample at now" shape.

3.1.1 **Boundary ownership.** The live tick owns the exact `t = now` value. Projection starts strictly after `now`; it must not advance state a second time at the same timestamp. The renderer may use the live tick value as a boundary anchor when drawing the future segment, but that anchor is not a separately stepped projection sample.

3.1.2 **Future sample density.** Reset-fill uses `max(visualisation.sampleCount / windowDuration, visualisation.minFutureSampleRate)` as the projection density, with `minFutureSampleRate` defaulting to 30 Hz unless profiling proves that lower is required. Frontier extension uses the same density when choosing its next batch times. Adaptive quality may temporarily defer non-urgent extension work, but it must not change the absolute timestamps already stored in the future buffer.

3.2 **State-advancing eval vs projection fork.** The per-frame tick (§2.1) advances the WASM engine's live state. Future projection never mutates live state. On reset, the fork starts from a snapshot of live state at `t = now`. On extension, the fork advances from its own `projectionFrontierTime` to the new frontier. Rewinding/replaying from `now` to the frontier every frame is explicitly not the steady-state model; rewind happens only on invalidation.

3.3 **External input assumption.** Expressions that reference external inputs (`ain1`, `ain2`, `swm`, `swt`, `rot`, etc.) are projected assuming those inputs hold their **current values** for the entire future window. The projection does not attempt to predict input changes.

3.4 **Stateful future stepping.** Expressions with declared state (`defstate`, `integrate`, UGens) are stepped sequentially inside the projection fork. `dt` is computed between adjacent projection sample times; the first projection step after reset uses `dt = firstProjectionTime - now` from the post-live-tick snapshot. Reset + fill and steady-state extension use the same stepping contract; there is no special one-sample jump from live `now` to the far edge. This is exact for linear state updates (e.g. `(+ phase (* freq dt))`) and an acceptable approximation for nonlinear updates. See [../../src-useq/docs/specs/state.md §2–6](../../src-useq/docs/specs/state.md) for state semantics.

3.5 **On expression change.** When the user evaluates a new expression for an output, the future buffer is **cleared and reset-filled** under the new expression. The projection fork starts from the engine's current live state — matching the firmware's state-identity-by-symbol-name semantics (state.md §4.2). The old past buffer is untouched (§2.4).

3.6 **`futureLeadSeconds`.** The future projection extends beyond the visible window by `visualisation.futureLeadSeconds` (default 1, max 8) to provide lookahead for probes and smooth scrolling.

3.7 **Invalidation triggers.** A future buffer is cleared and reset-filled when:
- The output's expression is re-evaluated (code eval).
- Settings that affect projection (window duration, sample count, future lead) change.
- The vis toggle for that output swaps to a different variant ([expression-gutter.md §3.6](expression-gutter.md)).
- (Planned) A referenced external input or live-edit value changes — requires per-output dependency tracking via `useq_output_dependencies` (§7.4). Currently uses conservative invalidation (all outputs cleared on any eval).

3.8 **Future frontier coverage.** The renderer needs future coverage through `now + windowDuration/2 + futureLeadSeconds`. The sampler asks the WASM runtime to extend the projection fork whenever `projectionFrontierTime` is behind that target plus a small guard band. The guard band should be expressed in seconds or samples, not in wall-clock frames, so variable rAF cadence does not create sawtooth coverage. Extension sample times are deterministic: for old frontier `F`, requested end `E`, and count `N`, samples are at `F + step`, `F + 2*step`, ..., `E`, where `step = (E - F) / N`.

3.9 **No interpolation across the past/future boundary.** Past and future are separate semantic streams. The renderer must not build one continuous polyline that lets the GPU interpolate from the newest past sample to the oldest future sample. It draws past and future as separate ranges/batches that meet at `t = now` only if both streams actually contain a sample there.

---

## 4. Output Classification and Projection Scheduling

Not all outputs need the same future-projection work. The engine classifies each output and schedules reset/extension work accordingly.

4.1 **Three output classes.** Each active output is classified based on its dependency graph. Classification controls when the projection fork is reset and how conservative the sampler must be about stale future data; it does not require full-window recomputation every frame.

| Class | Condition | Future work |
|---|---|---|
| **Pure** | Expression is a closed-form function of `t` only (no state, no external inputs, no cells referencing inputs) | Reset on expression change; frontier extension may be stateless. |
| **Input-dependent** | Expression references external inputs (`ain1`, `ain2`, `swm`, `swt`, `rot`, etc.) but has no declared state | Reset on expression change, or when a referenced input changes by more than `visualisation.inputEpsilon` (default 0.01). |
| **Stateful** | Expression uses `defstate`, `integrate`, UGens, or `rate-as` with state-bearing children | Reset on expression/classification changes; otherwise extend the projection fork from its frontier while visible. Do not rewind to `now` every frame. |

4.2 **Classification source.** Output classification is determined by the WASM engine via a new ABI export `useq_output_classifications` (§7.3). The engine already knows the dependency graph from compilation — this export surfaces it.

4.3 **Per-output dependency metadata.** A new ABI export `useq_output_dependencies` (§7.4) returns, for each output, which external input channels it references. This enables per-output invalidation: when `ain1` changes significantly, only outputs that reference `ain1` have their future projection reset.

4.4 **Input-change detection.** External input values are tracked frame-to-frame. When any input's absolute change exceeds `visualisation.inputEpsilon`, the sampler identifies which outputs depend on that input (via §4.3) and marks their future projections stale. Stale projections are reset-filled in the next projection pass.

4.5 **Classification is recomputed on expression change.** When an output's expression is re-evaluated, its classification may change (e.g. a pure expression replaced by a stateful one). The engine re-queries classification after each eval.

4.6 **Invisible outputs.** Outputs that are not visible in the vis panel (collapsed, scrolled off, or the panel is hidden) are excluded from returned render data, but not necessarily from engine stepping. The projection fork must step every runtime-active output needed to keep `prev_output_values`, declared state, and dependency closures correct. As an initial conservative rule, the WASM runtime steps all active outputs and returns only requested visible channels; dependency-closure stepping is a later optimisation.

---

## 5. Per-Frame Sampling Loop

5.1 **The per-frame loop has three phases**, executed in order: (see `src/effects/visualisationSampler.ts`)

1. **Tick past**: Advance the WASM engine through any live sampling timestamps required to catch up to `now`. Intermediate ticks commit live state and record past values. The latest tick in the frame also owns future projection work.
2. **Reset or extend future**: If the projection is stale (code eval, settings/input change), clear future buffers, reset the projection fork from live state at `now`, and fill the visible future. Otherwise, if the projection frontier is behind the required coverage, extend the fork by a small future batch at the frontier.
3. **Render**: If rendering is requested and the panel is visible, invoke the render hook.

5.2 **Combined tick-and-project ABI call.** (see `src/effects/visualisationSampler.ts`, `src/contracts/wasmAbi.ts`) For performance, the tick and projection phases are combined into a single WASM boundary crossing via `useq_tick_and_project` (§7.2). This function ticks live state at `t = now`, clones or extends the persistent projection fork, and returns both the live tick values and the future samples that should be appended or replace the future buffers. One JS↔WASM transition per frame instead of separate tick/refill/edge calls. The sampler probes the export at runtime — when present, the per-frame loop uses it; when absent, the sampler degrades to a slower compatibility path.

5.3 **Sampling guards.** At most one tick-and-project cycle is in flight at a time. Browser-local mode may queue multiple monotonic catch-up sample times while a call is running; external hardware time updates coalesce to the newest time. A slow batch must never overwrite a fresher one — this invariant follows from strict serialization, not from post-hoc sequence-counter discard.

5.4 **Render data assembly.** (see `src/ui/visualisation/serialVisPlanning.ts`) The renderer receives two data sources per output: past samples from the past rolling buffer and future samples from the future rolling buffer. Both are `PastBuffer` instances. The planning layer assembles independent segments split at `t = now`; `serialVisGL.ts` draws the past at full alpha and the future at reduced alpha. The boundary is exact, with no cross-stream interpolation.

5.5 **Shift, don't rebuild.** As time advances, the past buffer grows by one sample per committed tick and the future buffer grows by small frontier-extension batches. The render path reads from the rolling buffers directly — no per-frame allocation on the hot path ([MAIN.md §3.5](MAIN.md)).

5.6 **Smooth-scrolling guarantee.** Past samples are at fixed absolute times in the rolling buffer. The `time → X` mapping shifts by `deltaTime` each frame, but this shift is continuous — there is no sample-grid recomputation. Combined with pixel-matched sample density (§2.2.1), each waveform feature moves smoothly leftward at exactly the rate time advances, producing analog-oscilloscope-like scrolling. Frame-to-frame `deltaTime` variance (rAF jitter) affects only the scroll *speed*, not the waveform *shape*.

---

## 6. Interaction with Expression Changes and Failures

6.1 **Expression change.** When the user evaluates a new expression for output `X`:
1. Past buffer for `X` is **preserved** (shows old expression's values).
2. Future projection for `X` is **invalidated** and reset-filled under the new expression.
3. Output classification for `X` is re-queried.
4. Other outputs' past buffers and live output state are unaffected by the editor-side visualisation reset. Their future buffers may be reset conservatively until dependency metadata proves they are independent.

6.2 **Expression change with state.** If the new expression uses declared state (`defstate`, `integrate`, UGens), the future projection forks from the engine's current live state at `t = now`. State identity is by symbol name — a `defstate phase` keeps its accumulated value even if the update body changes (state.md §4.2, §4.4). This matches the firmware's recompilation semantics and means the future projection accurately represents what will happen.

6.3 **Failed evaluation.** If a new expression fails to compile or evaluate:
1. Past buffer is **preserved** (unchanged).
2. Future projection retains the **last successful projection** (not resampled under broken code).
3. The output falls back to LKG semantics ([MAIN.md §2.1](MAIN.md)).
4. A diagnostic surfaces in the editor.

6.4 **Runtime error during future projection.** If a stateful future projection encounters a NaN, non-finite value, or runtime error at some sample `s`:
1. Samples before `s` are valid and rendered.
2. Samples from `s` onward are omitted (the trace ends).
3. The past buffer is unaffected.

6.5 **Atomic frontier extension.** Steady-state frontier extension is atomic. If extension fails, the projection fork rolls back to its previous frontier and the editor appends no samples. Reset-fill may return a valid prefix only if the engine can also leave the fork at the last valid sample; otherwise the editor keeps the last successful future projection and marks it stale.

---

## 7. WASM ABI Additions

This section specifies new WASM ABI exports required by the faithful-past / projected-future architecture. These extend the existing ABI surface in [../../src/contracts/wasmAbi.ts](../../src/contracts/wasmAbi.ts). (see `src/contracts/wasmAbi.ts`)

7.1 **`useq_tick_all_outputs(time_seconds: number) → pointer`** — Evaluate all active outputs at the given time, **commit state** (advance `g_prev_tick_time`, update `prev_output_values`), and return all output values. Unlike `useq_eval_output` (which evaluates the full graph per call), this evaluates the graph exactly once. Returns a pointer to a `Float64Array` of `MAX_OUTPUTS` values (caller reads via `HEAPF64`). Invalid outputs contain `NaN`.

7.2 **`useq_tick_and_project(outputs_json: string, tick_time: number, projection_mode: number, projection_end: number, projection_sample_count: number, buffer_ptr: number, buffer_length: number) → number`** — Combined live tick + projection-fork operation in a single call:
1. Tick the live engine at `tick_time` (state-advancing, as §7.1) and write the tick value for each requested output into `buffer_ptr[0..num_channels-1]` (NaN for inactive outputs).
2. If `projection_mode == 0`, no future projection is performed.
3. If `projection_mode == 1` (`reset-fill`), discard any existing projection fork, clone live state after the `tick_time` live tick, project from just after `tick_time` to `projection_end` at `projection_sample_count` deterministic sample times, and set `projectionFrontierTime = projection_end`.
4. If `projection_mode == 2` (`extend-frontier`), advance the existing projection fork from its current frontier toward `projection_end`, producing `projection_sample_count` new samples after the previous frontier. For old frontier `F`, samples are at `F + step`, `F + 2*step`, ..., `projection_end`, where `step = (projection_end - F) / projection_sample_count`. The first returned extension sample must be strictly greater than the previous frontier time; it must not be `tick_time`.
5. Projection values are laid out row-major after the tick row: row `c` (for the `c`-th requested output) starts at offset `num_channels + c * projection_sample_count` and contains `projection_sample_count` consecutive doubles. Inactive outputs are NaN-filled.
6. Required buffer size is `num_channels + num_channels * projection_sample_count` doubles.
7. Returns the number of requested output channels (= number of names parsed from `outputs_json`), or `-1` on error (with `s_last_error` populated).

7.2.1 **Projection metadata.** The editor must be able to read `projectionFrontierTime` and whether the returned projection samples are replacement data (`reset-fill`) or append data (`extend-frontier`). This may be returned by a companion metadata export, encoded in an out-parameter struct, or represented by separate ABI functions if that is simpler for Emscripten. The semantics are normative; the concrete C ABI shape may change before shipping.

7.2.2 **Compatibility note.** The older experimental `useq_tick_and_project(outputs_json, tick_time, project_end, num_future_samples, ...)` shape is insufficient for frontier extension because `num_future_samples == 1` collapses to `tick_time` in existing batch helpers. Conforming implementations must either use the projection-mode ABI above or otherwise guarantee that steady-state extension samples are generated at the projection frontier, not at `t = now`.

7.3 **`useq_output_classifications() → pointer`** — Return a packed byte array (one byte per `MAX_OUTPUTS` slot):
- `0` = inactive (no valid expression)
- `1` = pure (closed-form function of `t` only)
- `2` = input-dependent (references external inputs, no declared state)
- `3` = stateful (uses `defstate`, `integrate`, UGens, or `rate-as` with state children)

The classification is recomputed by the compiler on each `useq_eval`. The returned pointer is to WASM-side static storage (caller reads via `HEAPU8`; valid until next `useq_eval`).

7.4 **`useq_output_dependencies(output_index: number) → pointer`** — For the given output, return a bitmask of referenced external input channels as a `uint32`. Bit `i` is set if the output's expression graph reads `g_hw_inputs[i]`. Returns `0` if the output is inactive, pure, or has no input dependencies. The returned value is a simple integer (no heap allocation).

7.5 All new exports are **optional** (probed at runtime via `probeOptionalWasmExport`). If absent, the sampler falls back to the existing per-frame full-window batch evaluation (§5 degrades gracefully to the pre-faithful-past behaviour).

---

## 8. Settings

New settings introduced by this spec (all under the `visualisation` section):

| Key | Type | Default | Description |
|---|---|---|---|
| `historyHeadroom` | number | 5 | Extra seconds of past samples retained beyond the visible window half |
| `maxHistorySeconds` | number | 30 | Hard cap on total history depth per output (seconds) |
| `inputEpsilon` | number | 0.01 | Absolute change threshold for external inputs to trigger future re-projection |
| `adaptiveQuality` | boolean | `true` | Enable pressure-driven quality degradation (§1.7.1). When `false`, pressure detection still runs but levers are inert. |
| `minFutureSampleRate` | number | 30 | Minimum projection density in Hz for future reset-fill and extension batches. |
| `temporalSampleRateMultiplier` | number | 1.0 | Live WASM tick density as a fraction of the effective pixel-matched past-buffer sample rate. Clamped to 0.05–1.0. |

Existing settings with unchanged semantics: `windowDuration`, `sampleCount`, `lineWidth`, `futureDashed`, `futureLeadSeconds`.

---

## Open / Deferred

9.2 **Non-uniform future sample distribution (deferred).** The general "adaptive quality" idea has *partially* shipped — see §1.7.1 for the pressure-detection-and-three-levers system (defer non-urgent future-frontier extension, slow probe refresh, halve buffer rate). What remains deferred is specifically the orthogonal idea that *distant* future samples matter less than *near*-future ones, and so a non-uniform sample distribution (denser near `t = now`, sparser at the edges) could reduce projection work for stateful outputs without a uniform quality cut. This is more invasive (changes the projection batching shape) and is deferred until profiling shows the uniform projection density is a bottleneck even after §1.7.1's measures engage.

9.3 **Hardware readback for past values.** In `both` mode, past values could come from hardware readback (actual voltages) rather than WASM ticks. This would require the serial protocol to stream output values at a sufficient rate. Deferred — WASM ticks are faithful enough for v1.

9.4 **Probe past/future semantics.** Probes ([probes.md](probes.md)) currently batch-sample across a per-probe time window. Whether probes should adopt the same faithful-past / projected-future split as the main vis panel is an open question. The per-probe surface is narrow; the benefit of recorded past for probes may not justify the added complexity.

9.5 **Stateful future projection accuracy at coarse `dt`.** The current spec steps future projections at vis sample density. For nonlinear state updates (`(defstate x 0 (+ x (* (sin x) dt)))`), large `dt` causes Euler-method truncation error. A future refinement could detect nonlinear state bodies and use a finer intermediate step rate. Deferred — linear accumulation dominates musical use cases.

9.6 **True pixel-matched sample density.** Shipped for browser-local WASM past recording via §2.1/§2.2.1 when `temporalSampleRateMultiplier = 1.0`. Remaining optimisation work is batching multiple past samples into one WASM boundary crossing if profiling shows high per-sample overhead on constrained devices.
