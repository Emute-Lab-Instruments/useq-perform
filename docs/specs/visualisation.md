# Visualisation

> Spec: visualisation panel, sampling, past/future semantics, output classification, palette. Counterpart to [MAIN.md](MAIN.md).
> See also [../../src-useq/docs/specs/state.md](../../src-useq/docs/specs/state.md) (state semantics, phase coherence) and [../../src-useq/docs/specs/signal-model.md](../../src-useq/docs/specs/signal-model.md) (implicit lifting, pure-by-default model).

## 1. Panel and Rendering

1.1 The visualisation panel renders **time-series traces** for active outputs and probed expressions on a single canvas surface.

1.2 The time axis is **centred on now**: the canvas centre column corresponds to the current transport time; the left half shows **recorded past values**; the right half shows **projected future values**.

1.3 The window duration is `visualisation.windowDuration` seconds (default 10). Sample density is `visualisation.sampleCount` per window (default 100). Line width is `visualisation.lineWidth` (default 1.5; clamped 0.5–5).

1.4 **Future samples are visually distinct.** Default rendering uses lower alpha for future segments; `visualisation.futureDashed` (boolean) toggles dashed rendering for future segments.

1.5 **Lane layout.** Digital outputs are rendered as step-mode binary traces in stacked lanes. Analogue outputs are rendered as continuous traces in stacked lanes. Lane height is derived from drawable area divided by lane count. The channel set is dynamic — determined by the hello handshake for hardware (the main uSEQ module has 3 analogue + 3 digital; expanders add more) and by the output recognition pattern (a1–a8, d1–d8, s1–s8) for WASM.

1.6 **Empty state.** When no expressions are assigned and no probes exist, the panel shows a placeholder ("No expressions selected") and consumes near-zero CPU.

1.7 **Render frequency** is animation-frame paced. The renderer no-ops when the panel is not visible. Rendering must remain smooth (≥ 30 FPS) at the documented channel target — see [MAIN.md §3.3](MAIN.md).

1.7.1 **Adaptive quality under sustained frame pressure.** When `visualisation.adaptiveQuality` is enabled (default `true`), the rAF loop measures committed-tick elapsed times and derives a *pressure level* (0 = normal, 1 = mild, 2 = severe). Any tick `≥ 50ms` (i.e. ≤ 20fps) is a *miss*; 3+ misses in the last 8 ticks step up to mild, 6+ to severe. Step-down only happens after 16 consecutive normal ticks (hysteresis to avoid oscillation under bursty load). Three levers engage in increasing-cost-of-quality-loss order: (a) skip the per-frame future-buffer edge push (the future trace stops extending until pressure releases); (b) double (mild) or quadruple (severe) the effective probe refresh interval — the persisted `probeRefreshIntervalMs` is unchanged, the multiplier is applied at read time; (c) halve (mild) or quarter (severe) the pixel-matched past-buffer sample rate (§2.2.1) before pushing it to the sampler, reducing buffer size and per-paint GPU work proportionally. When `adaptiveQuality` is `false`, pressure detection still runs but consumers always see level 0.

1.8 **Palette is theme-coupled.** Switching to a light theme switches the visualisation palette; a dark theme uses a dark palette. Custom palettes are not user-editable in v1. See [themes.md](themes.md).

1.9 The visualisation panel must continue to render correctly across runtime transitions (see [runtime-modes.md §1.7](runtime-modes.md)). A hardware connect/disconnect must not blank the canvas or lose in-flight traces.

---

## 2. Past Values — Recorded History

Past values are ground truth: what the signal engine actually produced as time advanced.

2.1 **Recording model.** Each animation frame, the WASM engine is **ticked to `t = now`**: a state-advancing evaluation that computes all active output values at the current time, commits state, and records the results into a **per-output rolling buffer**. This tick is the authoritative source of past values.

2.2 **Rolling buffer shape.** Each active output maintains a FIFO buffer of recorded samples. All outputs are sampled at the same times (one tick per frame). The buffer is time-aligned at constant sample rate, so index arithmetic suffices for time lookups — no (time, value) pairs needed.

2.2.1 **Pixel-matched buffer capacity.** The rolling buffer's *capacity* is derived from canvas pixel width: `bufferSampleRate = floor(canvasWidth / 2) / (windowDuration / 2)` (recomputed on canvas resize, integer-snapped to avoid sub-pixel re-allocation). This is a **capacity** target, not a literal sample density: tick cadence is unchanged (§2.1 — one push per rAF frame, ~30 Hz), so the GPU's line rasteriser interpolates between actual sample points along the time axis. Pixel-matched capacity eliminates the sub-pixel **feature drift** the spec actually cares about: each pushed sample maps to a stable absolute-time column, so a peak/edge in the waveform doesn't hop between columns as time advances. *True* one-sample-per-column rendering would require either a higher tick rate (§9.6.A) or a multi-sample-per-tick batch (§9.6.C); see deferred section.

2.2.2 The pixel-matched capacity applies to the **past buffer only**. Future projection uses `visualisation.sampleCount / 2` (§3.1), which may be lower. The visual transition between past and future density at `t = now` is acceptable because the future half is already visually distinguished (lower alpha or dashed, §1.4).

2.3 **History depth.** The buffer retains `visualisation.windowDuration / 2 + visualisation.historyHeadroom` seconds of history (default headroom: 5 seconds). `visualisation.maxHistorySeconds` (default 30) caps the total history regardless of headroom. Widening the vis window beyond the buffer simply shows a shorter past.

2.4 **Past values are never overwritten on expression change.** When the user evaluates a new expression for an output, the rolling buffer retains all samples recorded under the old expression. The past half of the vis panel shows what actually happened, including the old expression's trace right up to the moment of change.

2.5 **Visual discontinuity at expression boundaries.** When a new expression produces different values from the old one, there will be a visible discontinuity at the moment of change (past values from old expression, future values from new expression). This is intentional — the visualisation is honest about what happened vs what will happen.

2.6 **Hardware-only mode.** In hardware-only mode (WASM unavailable), past values come from hardware-streamed serial buffers. The rolling buffer accumulates from the serial stream parser instead of from WASM ticks.

2.7 **Buffer lifecycle.** A rolling buffer is created when an output is registered for visualisation and destroyed when unregistered. Buffers survive expression changes and runtime transitions (hardware connect/disconnect). A WASM crash in `both` mode preserves the existing buffer contents; recording resumes after WASM reinitialisation (see [MAIN.md §2.10](MAIN.md)).

---

## 3. Future Values — Projected from Now

Future values are projections: what the signal engine would produce if conditions held steady from this moment forward.

3.1 **Projection model — event-driven, not per-frame.** The future half is stored in a **per-output rolling buffer** (same `PastBuffer` type as the past half). Future buffers are populated in two ways:

- **Batch refill** (on invalidation): batch-evaluate from `t = now` to `t = now + windowDuration/2 + futureLeadSeconds` at ~30 Hz sample density via `evalOutputsInTimeWindow` (save/restore). This populates the full visible future in one call.
- **Per-frame extension**: each frame, one sample is evaluated at the far edge of the future window (`t = now + windowDuration/2 + futureLeadSeconds`) via save/restore and pushed to the future buffer. This extends coverage as time advances, without recomputing the existing data.

Future buffers are **stable between invalidation events** — the same data is drawn frame after frame, eliminating the jitter that per-frame recomputation caused.

3.2 **State-advancing eval vs read-only projection.** The per-frame tick (§2.1) advances the WASM engine's live state. The future projection does **not** advance live state — it uses the existing save/restore mechanism in `execute_batch_sequential` (snapshot state before projection, restore after). The projection forks from the live state at `t = now`.

3.3 **External input assumption.** Expressions that reference external inputs (`ain1`, `ain2`, `swm`, `swt`, `rot`, etc.) are projected assuming those inputs hold their **current values** for the entire future window. The projection does not attempt to predict input changes.

3.4 **Stateful future stepping.** For batch refills, expressions with declared state (`defstate`, `integrate`, UGens) are stepped sequentially at vis sample density, with `dt` computed from the inter-sample time step. This is exact for linear state updates (e.g. `(+ phase (* freq dt))`) and an acceptable approximation for nonlinear updates. Per-frame extension evaluates a single point at the far edge — this is a one-step jump from the current time, which is an approximation for stateful signals. See [../../src-useq/docs/specs/state.md §2–6](../../src-useq/docs/specs/state.md) for state semantics.

3.5 **On expression change.** When the user evaluates a new expression for an output, the future buffer is **cleared and batch-refilled** under the new expression. The projection forks from the engine's current live state — matching the firmware's state-identity-by-symbol-name semantics (state.md §4.2). The old past buffer is untouched (§2.4).

3.6 **`futureLeadSeconds`.** The future projection extends beyond the visible window by `visualisation.futureLeadSeconds` (default 1, max 8) to provide lookahead for probes and smooth scrolling.

3.7 **Invalidation triggers.** A future buffer is cleared and batch-refilled when:
- The output's expression is re-evaluated (code eval).
- Settings that affect projection (window duration, sample count, future lead) change.
- (Planned) A referenced external input or live-edit value changes — requires per-output dependency tracking via `useq_output_dependencies` (§7.4). Currently uses conservative invalidation (all outputs cleared on any eval).

---

## 4. Output Classification and Projection Scheduling

Not all outputs need their future re-projected every frame. The engine classifies each output and schedules projection work accordingly.

4.1 **Three output classes.** Each active output is classified based on its dependency graph:

| Class | Condition | Future re-projected when |
|---|---|---|
| **Pure** | Expression is a closed-form function of `t` only (no state, no external inputs, no cells referencing inputs) | Expression changes |
| **Input-dependent** | Expression references external inputs (`ain1`, `ain2`, `swm`, `swt`, `rot`, etc.) but has no declared state | Expression changes, **or** a referenced input changes by more than `visualisation.inputEpsilon` (default 0.01) |
| **Stateful** | Expression uses `defstate`, `integrate`, UGens, or `rate-as` with state-bearing children | Every frame (state at `t = now` evolves each tick) |

4.2 **Classification source.** Output classification is determined by the WASM engine via a new ABI export `useq_output_classifications` (§7.3). The engine already knows the dependency graph from compilation — this export surfaces it.

4.3 **Per-output dependency metadata.** A new ABI export `useq_output_dependencies` (§7.4) returns, for each output, which external input channels it references. This enables per-output invalidation: when `ain1` changes significantly, only outputs that reference `ain1` have their future re-projected.

4.4 **Input-change detection.** External input values are tracked frame-to-frame. When any input's absolute change exceeds `visualisation.inputEpsilon`, the sampler identifies which outputs depend on that input (via §4.3) and marks their future projections stale. Stale projections are recomputed in the next frame's projection pass.

4.5 **Classification is recomputed on expression change.** When an output's expression is re-evaluated, its classification may change (e.g. a pure expression replaced by a stateful one). The engine re-queries classification after each eval.

4.6 **Invisible outputs.** Outputs that are not visible in the vis panel (collapsed, scrolled off, or the panel is hidden) are excluded from both ticking and future projection. Their rolling buffers still accumulate if the panel is merely scrolled (the output exists but isn't rendered), but projection work is skipped.

---

## 5. Per-Frame Sampling Loop

5.1 **The per-frame loop has three phases**, executed in order:

1. **Tick past**: Advance the WASM engine to `t = now`. This evaluates all active outputs, commits state, records output values into their past rolling buffers.
2. **Invalidate or extend future**: If the future is marked stale (code eval, settings change), clear future buffers and batch-refill from `t = now` forward. Otherwise, if any future buffer's coverage is running out (newest time < visible window edge), batch-refill. Otherwise, push one sample at the far future edge per output.
3. **Render**: If rendering is requested and the panel is visible, invoke the render hook.

5.2 **Combined tick-and-project ABI call.** For performance, the tick and future-extension phases can be combined into a single WASM boundary crossing via `useq_tick_and_project` (§7.2). This function ticks at `t = now` (advancing state), then projects forward (with save/restore), returning both the tick values and the future samples. One JS↔WASM transition per frame instead of two. (Not yet implemented — current code uses separate `evalOutputAtTime` + `evalOutputsInTimeWindow` calls.)

5.3 **Sampling guards.** At most one tick-and-project cycle is in flight at a time. If a newer time arrives while a call is running, the latest pending time is sampled once the current run completes (single pending-time slot). A slow batch must never overwrite a fresher one — this invariant follows from strict serialization, not from post-hoc sequence-counter discard.

5.4 **Render data assembly.** The renderer receives two data sources per output: past samples from the past rolling buffer and future samples from the future rolling buffer. Both are `PastBuffer` instances. The renderer stitches them at `t = now` — past segment draws from the past buffer (full alpha), future segment draws from the future buffer (reduced alpha). The boundary is exact, no blending or interpolation.

5.5 **Shift, don't rebuild.** As time advances, both buffers grow by one sample per frame. The render path reads from the rolling buffers directly — no per-frame allocation on the hot path ([MAIN.md §3.5](MAIN.md)).

5.6 **Smooth-scrolling guarantee.** Past samples are at fixed absolute times in the rolling buffer. The `time → X` mapping shifts by `deltaTime` each frame, but this shift is continuous — there is no sample-grid recomputation. Combined with pixel-matched sample density (§2.2.1), each waveform feature moves smoothly leftward at exactly the rate time advances, producing analog-oscilloscope-like scrolling. Frame-to-frame `deltaTime` variance (rAF jitter) affects only the scroll *speed*, not the waveform *shape*.

---

## 6. Interaction with Expression Changes and Failures

6.1 **Expression change.** When the user evaluates a new expression for output `X`:
1. Past buffer for `X` is **preserved** (shows old expression's values).
2. Future projection for `X` is **invalidated** and resampled under the new expression.
3. Output classification for `X` is re-queried.
4. Other outputs are unaffected.

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

---

## 7. WASM ABI Additions

This section specifies new WASM ABI exports required by the faithful-past / projected-future architecture. These extend the existing ABI surface in [../../src/contracts/wasmAbi.ts](../../src/contracts/wasmAbi.ts).

7.1 **`useq_tick_all_outputs(time_seconds: number) → pointer`** — Evaluate all active outputs at the given time, **commit state** (advance `g_prev_tick_time`, update `prev_output_values`), and return all output values. Unlike `useq_eval_output` (which evaluates the full graph per call), this evaluates the graph exactly once. Returns a pointer to a `Float64Array` of `MAX_OUTPUTS` values (caller reads via `HEAPF64`). Invalid outputs contain `NaN`.

7.2 **`useq_tick_and_project(tick_time: number, project_end: number, num_future_samples: number, buffer_ptr: number, buffer_length: number) → number`** — Combined tick + future projection in a single call:
1. Tick the engine at `tick_time` (state-advancing, as §7.1).
2. Project all active outputs from `tick_time` to `project_end` at `num_future_samples` evenly spaced times. For stateful outputs, this uses save/restore internally — live state is not corrupted.
3. Write tick values (one per active output) followed by projection values (active_outputs × num_future_samples) into the caller-provided heap buffer at `buffer_ptr`.
4. Return the number of active outputs, or `-1` on error.

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

Existing settings with unchanged semantics: `windowDuration`, `sampleCount`, `lineWidth`, `futureDashed`, `futureLeadSeconds`.

---

## Open / Deferred

9.2 **Non-uniform future sample distribution (deferred).** The general "adaptive quality" idea has *partially* shipped — see §1.7.1 for the implemented pressure-detection-and-three-levers system (skip future edge push, slow probe refresh, halve buffer rate). What remains deferred is specifically the orthogonal idea that *distant* future samples matter less than *near*-future ones, and so a non-uniform sample distribution (denser near `t = now`, sparser at the edges) could reduce projection work for stateful outputs without a uniform quality cut. This is more invasive (changes the projection batching shape) and is deferred until profiling shows the uniform projection density is a bottleneck even after §1.7.1's measures engage.

9.3 **Hardware readback for past values.** In `both` mode, past values could come from hardware readback (actual voltages) rather than WASM ticks. This would require the serial protocol to stream output values at a sufficient rate. Deferred — WASM ticks are faithful enough for v1.

9.4 **Probe past/future semantics.** Probes ([probes.md](probes.md)) currently batch-sample across a per-probe time window. Whether probes should adopt the same faithful-past / projected-future split as the main vis panel is an open question. The per-probe canvas is narrow; the benefit of recorded past for probes may not justify the added complexity.

9.5 **Stateful future projection accuracy at coarse `dt`.** The current spec steps future projections at vis sample density. For nonlinear state updates (`(defstate x 0 (+ x (* (sin x) dt)))`), large `dt` causes Euler-method truncation error. A future refinement could detect nonlinear state bodies and use a finer intermediate step rate. Deferred — linear accumulation dominates musical use cases.

9.6 **True pixel-matched sample density (paths to literal one-sample-per-column).** §2.2.1 currently makes buffer *capacity* pixel-matched but leaves tick cadence at ~30 Hz. The GPU rasterises between sample points; sub-pixel feature drift is eliminated, but the trace is still drawn from sparser data than the past-half's pixel column count. Two paths to closing this gap, in increasing order of correctness and cost:

  - **9.6.A — Pixel-matched tick rate.** Drive the WASM tick at `bufferSampleRate` (typically 100–200 Hz at desktop resolutions) instead of rAF. Each tick pushes one sample; the past buffer has one sample per pixel column literally. Cost: 3–7× current per-second WASM work. Becomes affordable once §5.2 (`useq_tick_and_project`) lands, since it folds the per-tick round-trips from 3 to 1. Best long-term direction.
  - **9.6.C — Multi-sample-per-tick batch (hybrid).** Keep tick at rAF but each tick batches `N = bufferSampleRate / rAFRate` samples (typically N=3–5) covering `[t-Δ, t]` and pushes them all to the past buffer. Density approaches pixel-matched without raising the tick rate. Cost: requires the WASM engine to do batched past sampling efficiently — closely tied to `useq_tick_and_project`'s batching shape (§7.2 already projects N future samples per call; the same machinery can serve a small recent-past window). A reasonable v2 once the combined ABI is in.

  Until either lands, the spec's promise in §2.2.1 is "feature stability under time advance" rather than "literal one sample per column".
