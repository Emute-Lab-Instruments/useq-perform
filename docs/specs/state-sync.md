---
stability: aspirational
layer: behavioural
---

# State Sync

> Spec: WASM↔hardware drift detection and recalibration. Counterpart to [MAIN.md](MAIN.md).
> See [runtime-modes.md](runtime-modes.md) for the `both` mode semantics this feature builds on.

## Source files

- `src/effects/driftDetector.ts` — per-output EMA drift scoring, threshold logic, cooldown
- `src/effects/stateSyncOrchestrator.ts` — subscribes to drift channel, drives snapshot request → apply cycle
- `src/contracts/runtimeChannels.ts` — `driftDetected` channel, `DriftDetectedDetail` payload
- `src/contracts/runtimeTypes.ts` — `StateSnapshot` and related types
- `src/contracts/runtimePorts.ts` — `requestStateSnapshot()` on `WebSerialHostPort`, `applyStateSnapshot()` on `WasmRuntimePort`
- `src/contracts/wasmAbi.ts` — `useq_apply_state_snapshot` optional WASM export
- `src/runtime/jsonProtocol.ts` — `JsonGetStateRequest` type, `buildGetStateRequest()` builder
- `src/transport/json-protocol.ts` — `sendGetState()` wire function
- `src/transport/webSerialHostPort.ts` — `requestStateSnapshot()` implementation
- `src/runtime/wasmRuntimePort.ts` — `applyStateSnapshot()` in-process implementation
- `src/runtime/wasmRuntimeWorkerPort.ts` — `applyStateSnapshot()` worker proxy
- `src/runtime/workers/wasmRuntimeWorkerProtocol.ts` — `ApplyStateSnapshotRequest/Response`
- `src/runtime/workers/wasmRuntime.worker.ts` — worker-side `applyStateSnapshot` handler
- `src/runtime/appLifecycle.ts` — orchestrator init/teardown wiring
- `src/effects/visualisationSampler.ts` — drift sample recording in `applyTickValues()`

## Problem

In `both` mode (runtime-modes.md §1.5), hardware is authoritative for outputs while WASM acts as a visualisation shadow. The two interpreters run independently — they share source code and transport commands but maintain completely separate internal state (cell values, `defstate` accumulators, oscillator phases, live-edit slots). If they drift apart, the WASM visualisation silently shows the wrong future.

### Drift vectors

| Vector | Mechanism | Severity |
|--------|-----------|----------|
| Eval ordering | Serial latency means hardware may process evals in different order or timing | Medium |
| Time skew | WASM clock is updated from hardware stream, but discretely; accumulator-based state amplifies small timing errors | High — compounds |
| Missed eval | Serial write fails silently; hardware has stale code while WASM has new | High |
| State-dependent expressions | `(defstate)` and `(integrate)` produce path-dependent values — same code + different history = different output | High |
| Live-edit slots | Slots pushed to WASM instantly but to hardware via serial — timing gap | Low |
| Hardware restart | Device reboots mid-session; reloads flash state which may differ from WASM | High |

## Architecture

The system has three layers:

```
┌──────────────────────────────────────────────────────┐
│  Layer 1: Drift Detection (editor-only)              │
│  Compares hardware stream values against WASM ticks  │
│  Publishes driftDetected channel when EMA > threshold│
└─────────────────────┬────────────────────────────────┘
                      │
┌─────────────────────▼────────────────────────────────┐
│  Layer 2: State Snapshot Protocol                    │
│  get-state → hardware, state-snapshot ← response     │
│  useq_apply_state_snapshot() → WASM                  │
└─────────────────────┬────────────────────────────────┘
                      │
┌─────────────────────▼────────────────────────────────┐
│  Layer 3: State Sync Orchestrator                    │
│  Subscribes to drift channel, drives request→apply   │
│  Manages cooldown, in-flight state, user feedback    │
└──────────────────────────────────────────────────────┘
```

## §1 Drift Detection

1.1 Drift detection is only active in `both` mode. The detector enables itself on `connectionChanged` events where `transportMode === "both"` and disables on any other mode.

1.2 **Comparison source.** Hardware streams output values into `serialBuffers[]` at the rate configured by `stream-config` (typically 30Hz). WASM independently computes the same outputs during visualisation sampling. The drift detector compares the most recent hardware stream value for each output against the corresponding WASM tick value. No new data channels are needed.

1.3 **Per-output scoring.** For each output `name`, the relative error is:

```
error = |hw_value - wasm_value| / max(|hw_value|, ε)
```

where `ε = 1e-9`. An exponential moving average (EMA) with `α = 0.15` smooths per-output scores to filter quantisation noise and timing jitter.

1.4 **Threshold logic.**

- `aggregate_ema < 0.05` → in sync, no action.
- `aggregate_ema ≥ 0.05` → hard drift; publish `driftDetected` channel event.

The aggregate is the mean of all per-output EMA scores.

1.5 **Cooldown.** After each drift event, detection is suppressed for 2 seconds (settling window). After each `codeEvaluated` event, detection is suppressed for 1 second (both runtimes need time to converge after expression changes).

1.6 **Integration point.** Drift samples are recorded inside `applyTickValues()` in the visualisation sampler — the existing per-frame tick path. No separate polling loop.

## §2 State Snapshot Protocol

2.1 **Request (editor → hardware):**

```json
{ "type": "get-state", "requestId": "req-42" }
```

2.2 **Response (hardware → editor):**

```json
{
  "requestId": "req-42",
  "success": true,
  "type": "state-snapshot",
  "state": {
    "transport": { "playing": true, "timeOffset": 0.0 },
    "time": 14.3271,
    "cells": {
      "bpm": { "type": "number", "value": 120 },
      "my-scale": { "type": "data", "values": [0, 2, 4, 5, 7, 9, 11] },
      "wobble": { "type": "callable", "source": "(fn (x) (* x (sin (* x 6.28))))" }
    },
    "outputs": {
      "a1": { "source": "(sine 1)", "health": "running", "lkgValue": 0.7071 },
      "d1": { "source": "(> (phasor 2) 0.5)", "health": "running", "lkgValue": 1.0 }
    },
    "stateSlots": [
      { "id": "my-phase", "value": 0.4231 },
      { "id": "accum", "value": 12.7 }
    ],
    "liveSlots": [
      { "id": "knob1", "value": 0.5, "min": 0.0, "max": 1.0 }
    ]
  }
}
```

2.3 **Version gating.** If the firmware does not support `get-state`, the request times out (5s). The orchestrator handles this gracefully — it logs a warning and does not retry.

2.4 **Firmware implementation status.** The `get-state` handler does not yet exist in the firmware (`src-useq/`). The editor-side protocol types, wire function, and port method are implemented and will resolve to `null` until the firmware adds the handler. This is by design — Layer 1 (drift detection) provides diagnostic value independently.

## §3 State Application (WASM ABI)

3.1 **WASM export:** `useq_apply_state_snapshot(json_str) → int`

Takes a JSON-serialised `StateSnapshot` (§2.2 `.state` payload). Re-evaluates all cell definitions and output source text from the snapshot in the correct order (cells before outputs), then patches state slot values and live-edit slots to match. Returns `0` on success, non-zero on failure.

3.2 **WASM implementation status.** The `useq_apply_state_snapshot` export does not yet exist in `src-useq/wasm/wasm_wrapper.cpp`. The editor probes it as an optional export (`src/contracts/wasmAbi.ts`) and degrades gracefully when it's absent — `applyStateSnapshot()` returns `false`.

3.3 **Projection invalidation.** After a successful snapshot apply, the orchestrator calls `invalidateFutureProjections()` to force a reset-fill of the visualisation's future projection buffers. This ensures the visualisation reflects the resynced state immediately.

## §4 Orchestration

4.1 The orchestrator is initialised during `startBrowserLocalRuntime()` in `appLifecycle.ts` and torn down on `app.stop()`.

4.2 **Sync cycle:**

1. `driftDetected` channel fires.
2. Orchestrator calls `hwPort.requestStateSnapshot()`.
3. If snapshot received, calls `wasmPort.applyStateSnapshot(snapshot)`.
4. On success: resets drift scores, invalidates future projections, logs to console.
5. On failure: logs warning, does not retry (next drift event will trigger a fresh attempt).

4.3 **Concurrency guard.** Only one sync cycle can be in-flight at a time. If drift fires while a sync is in progress, it is ignored.

4.4 **User visibility.** Drift events and sync results are surfaced via the console store:

- `"WASM state drifted from hardware on a1, d1 — resyncing…"` (on drift detect)
- `"WASM state resynced with hardware."` (on success)
- `"State resync skipped — firmware does not support state snapshots yet."` (on null snapshot)
- `"State resync failed — WASM apply_state_snapshot not available."` (on WASM export missing)

## §5 Types

### StateSnapshot (src/contracts/runtimeTypes.ts)

```typescript
interface StateSnapshot {
  transport: { playing: boolean; timeOffset: number };
  time: number;
  cells: Record<string, StateSnapshotCell>;
  outputs: Record<string, StateSnapshotOutput>;
  stateSlots: StateSnapshotSlot[];
  liveSlots: StateSnapshotLiveSlot[];
}
```

### DriftDetectedDetail (src/contracts/runtimeChannels.ts)

```typescript
interface DriftDetectedDetail {
  perOutput: Record<string, number>;
  aggregate: number;
}
```

## Open / Deferred

6.1 **Output-only snapshot.** If bandwidth becomes a problem, add `{ "type": "get-state", "outputs": ["a1", "d1"] }` to request only specific output subtrees. The full snapshot is typically 2-5KB so this is unlikely to matter at 30Hz serial bandwidth.

6.2 **Revision-gated delta.** Cells already have a `revision` counter in the firmware. An incremental snapshot (`{ "since": { "cellRev": 7 } }`) could reduce payload size for large cell tables. Deferred — full snapshot is simple and correct.

6.3 **Digital output drift scoring.** Digital outputs (d1–d8) flip between 0/1 and may show spurious drift due to aliasing between hardware and WASM sampling phases. A future refinement could weight analog outputs more heavily or use a different comparison metric for digital outputs.

6.4 **Automatic drift detection threshold tuning.** The current EMA alpha (0.15) and threshold (0.05) are empirically chosen starting points. May need tuning based on real-world usage with hardware.

6.5 **UI drift indicator.** A subtle visual indicator in the connection status area could show real-time drift scores. Currently drift is only visible via console messages.
