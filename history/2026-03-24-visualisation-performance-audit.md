# Frontend Visualisation Performance Audit

Date: 2026-03-24

Issue: `useq-perform-3gr`

## Scope

Audit the frontend visualisation path when running against the browser-local WASM interpreter, with emphasis on periodic slowdown while visualising simple expressions such as `(a1 bar)`.

## Environment Notes

- Repo checkout: `/home/w1n5t0n/src/useq-perform`
- `src-useq` status at audit time:
  - pinned commit: `470f09c5752f8640de108c7aa44a8e0e16cd7cc7`
  - checked out commit: `b59c72ba24e4704fc4a5ccc761728c53fab9a8eb`
  - dirty: `true`
- Runtime under test was the copied local WASM artifact from `src-useq/wasm/useq.js`

## Visualisation Path

1. Browser-local startup starts the WASM runtime and the local clock.
2. `src/effects/localClock.ts` advances time on every `requestAnimationFrame`.
3. Every clock tick calls `resampleExpressions(currentTime)`.
4. `src/effects/visualisationSampler.ts` tries batch sampling through `evalOutputsInTimeWindow(...)`.
5. On failure it falls back to repeated `evalOutputAtTime(...)` calls for every sample.
6. `src/ui/visualisation/serialVis.ts` redraws the canvas on its own `requestAnimationFrame` loop.

## Findings

### 1. Batch sampling is effectively broken at runtime

Severity: high

The frontend probes optional batch exports with `module.cwrap(...)` and treats any returned function as usable. In the audited runtime, `cwrap("useq_eval_outputs_time_window", ...)` returns a function, but invoking it throws:

`TypeError: func is not a function`

Observed facts:

- Required exports behave normally:
  - `useq_init`
  - `useq_eval`
  - `useq_update_time`
  - `useq_eval_output`
- Optional batch-related exports do not:
  - `useq_eval_outputs_time_window`
  - `useq_eval_outputs_time_window_into`
  - `useq_last_error`
- `module._useq_eval_outputs_time_window` and `module._useq_last_error` were `undefined` in the loaded module even though `cwrap(...)` returned callable-looking wrappers.

Impact:

- Every visualisation refresh falls back to per-sample output evaluation.
- The app pays for exception throwing before it even reaches the fallback path.
- The browser does much more JS/WASM crossing than intended.

Evidence:

- `src/runtime/wasmInterpreter.ts` probes optional exports with `tryCwrap(...)`.
- `src/effects/visualisationSampler.ts` catches batch failures and falls back to per-sample evaluation.
- Instrumented browser run showed repeated `TypeError: func is not a function` for every attempted `useq_eval_outputs_time_window(...)` call.

### 2. The sampler recomputes identical windows multiple times between visible waveform changes

Severity: high

`src/effects/localClock.ts` calls `resampleExpressions(...)` on every animation frame. But `src/effects/visualisationSampler.ts` snaps the sample window start to the sampling grid:

- sample window start is quantised with `Math.floor(rawStart / step) * step`

That means the sample set only changes when the snapped window boundary advances. On the audited run:

- requested sample count: `133`
- sampled span changed in steps of about `0.030303s`
- display cadence was about `8.3ms`

So the same `[start, end, count]` window was requested around 3-4 times before the sample grid actually moved.

Impact:

- Wasteful repeated sampling even when the sample data would be identical.
- More exception/fallback churn while batch sampling is broken.
- More CPU variance on high-refresh-rate displays.

### 3. Per-sample fallback multiplies work even for a single expression

Severity: medium-high

For one visualised expression, the sampler currently does:

- one separate `evalOutputAtTime("bar", time)` for the progress bar
- one failed batch sampling attempt
- fallback to `count` individual `evalOutputAtTime(exprType, t)` calls

Instrumented run for a simple `(a1 bar)` visualisation showed:

- about `1214` time updates
- about `125170` `useq_eval_output(...)` calls
- about `1863` failed `useq_eval_outputs_time_window(...)` calls

That is far above the intended batch-sampled path for a single waveform.

### 4. The canvas render loop runs continuously even when the panel is hidden or no expressions are active

Severity: medium

`src/runtime/bootstrap.ts` starts `makeVis()` unconditionally during bootstrap. `src/ui/visualisation/serialVis.ts` then keeps its own `requestAnimationFrame` loop alive forever.

Observed idle behaviour on a fresh browser-local page with no user interaction:

- the app still scheduled hundreds of animation callbacks within a few seconds

Impact:

- Background CPU use even when the visualisation is not visible
- Unnecessary contention with editor/UI work

This was not the primary bottleneck in the measured run, but it is easy waste and compounds with the sampling path.

### 5. Draw cost is not the primary problem in the audited case

Severity: low

In the instrumented headed-browser run:

- the two hot animation callbacks stayed below 1 ms most of the time
- the waveform draw callback was materially cheaper than the wasted sampling path

Conclusion:

- the visible slowdown is not primarily caused by canvas stroke cost for the simple case
- the main problem is wasted sampling work and the broken batch capability path

## Code References

- `src/runtime/wasmInterpreter.ts`
  - optional export probing and batch evaluator setup
- `src/effects/visualisationSampler.ts`
  - batch sampling, fallback sampling, snapped sample windows
- `src/effects/localClock.ts`
  - per-frame resample trigger
- `src/ui/visualisation/serialVis.ts`
  - always-on canvas animation loop
- `src/runtime/bootstrap.ts`
  - unconditional `makeVis()` startup

## Recommended Fix Order

1. Fix optional WASM export detection.
   - Do not trust `cwrap(...)` alone for optional exports.
   - Verify the raw export exists or perform a cheap runtime call during capability probing.
   - If the export is absent, disable batch mode once and stop throwing per frame.

2. Stop resampling on every display frame.
   - Recompute only when the snapped sample window changes, or cap sampling to a fixed rate such as 30-60 Hz.
   - Keep `currentTime` updates on every frame so the waveform still scrolls smoothly between sample refreshes.

3. Avoid repeated fallback retries.
   - Once batch mode is known broken for the session, memoize that and go straight to the chosen fallback path.

4. Stop or park the canvas loop when the visualisation panel is hidden and when there are no active expressions.

5. Fold the bar read into the same sampled window or derive it from existing samples where possible.

## Expected Outcome After Fixes

For `(a1 bar)` and similar simple waveforms, the frontend should:

- avoid per-frame exception throwing
- avoid per-sample fallback when batch helpers are unavailable
- reduce duplicate sample recomputation on high-refresh displays
- keep the waveform scrolling smooth by separating display cadence from sample-refresh cadence

Those changes should make the WASM-backed visualisation behave like a local fast path instead of a heavy per-frame recomputation loop.
