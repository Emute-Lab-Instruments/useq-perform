# Runtime test-suite value audit — 2026-09-08

The suite has substantial value as a **regression safety net for the DAG compiler and runtime**, especially for failure atomicity, state identity, numerical health, and resource reclamation. Its evidence for general compiler soundness is narrower. **The current benchmark path is unsuitable for production performance claims**: it does not build as checked in, much of its corpus uses removed syntax, and its stateful execution loop differs from production.

The best next investment is to repair the connection between existing tests, current semantics, production execution, and CI, then strengthen independent oracles. More test cases alone would not address these weaknesses.

## Scope and provenance

This is an audit of the local working checkout, not release qualification:

- App HEAD: `85c7ff4752a18afe67ceaada15e59931268595d6`; the app has extensive pre-existing changes.
- App-recorded runtime gitlink: `3f73fcc81f14fadf7b8d1770f7feeb09c9042f7c`.
- Actual `src-useq` HEAD: `02299d22870f528f47b27f81fbd37ff4e2838f60`, branch `paper/iclc-2027-option-1`.
- The runtime's dirty marker is solely the pre-existing untracked `docs/factory-floor-plan.html`; its tracked compiler/test sources are clean.
- Native binaries were rebuilt with `ninja -C src-useq/build -j4`. The existing Meson configuration is debug, optimization 0, without sanitizers. The rebuild completed without compiler warnings.
- Existing WASM artifacts were exercised, not rebuilt. Their bytes match the manifest, and the manifest's input-tree hash matches current source: `75aae027c0df559861464286f7cae2d82f56aa8de20abaf8485127ad98a56b47`. The served app manifest records an older source identity despite matching artifact bytes and input-tree digest; release provenance should still be reconciled.

Source and fixture files were not changed. The benchmark build experiments used temporary scripts and binaries under `/tmp`, preserving the existing benchmark binaries.

## Executed evidence

| Check | Result | What the result establishes |
|---|---|---|
| Rebuilt native Meson suite | **39/39 registered suites passed** | Current host compiler/runtime regression baseline is green. Includes 574 executed Catch cases and 436,673 assertions. |
| Native YAML conformance | **82/85 passed**, 3 failed | The separate semantic corpus is not green, despite Meson passing. |
| Actual WASM YAML conformance | **82/85 passed**, the same 3 failed | Shared corpus produces the same case verdicts on both targets; this is not exhaustive numerical equivalence. |
| Selected app WASM tests: `realEngine`, `wasmInterpreter`, `wasmAbi` | **69 passed, 1 failed, 1 skipped** | The real-engine aggregate detects one of the same failing fixtures. The skip is the unused “artifacts missing” placeholder, not missing artifacts in this run. |
| Checked-in desktop benchmark build recipe, only output/cwd relocated | **Link failure** | Required `program_semantics.cpp` and `temporal_query.cpp` are absent from its source list. |
| Diagnostic benchmark build with those two sources added temporarily | Builds; **6/9 workloads fail compilation** | Corpus drift is a second, independent obstacle. Successful workloads: `minimal`, `math-dense`, `table-heavy`. Timings from this legacy loop are not production measurements. |
| Synthetic benchmark comparison checks | Missing workloads/metrics yield no regression; firmware `high-combined` at **10× baseline** also yields no gating regression | The comparison can pass incomplete evidence and does not apply its desktop smoke set to firmware workload names. |

Logs and provenance are retained in [the local evidence directory](../../.local/runtime-test-suite-audit-2026-09-08/provenance.json), including [native tests](../../.local/runtime-test-suite-audit-2026-09-08/native-tests.log), [native conformance](../../.local/runtime-test-suite-audit-2026-09-08/native-conformance.log), [WASM conformance](../../.local/runtime-test-suite-audit-2026-09-08/wasm-conformance.log), [app checks](../../.local/runtime-test-suite-audit-2026-09-08/app-wasm-tests.log), [benchmark build failure](../../.local/runtime-test-suite-audit-2026-09-08/bench-build.log), and [diagnostic corpus results](../../.local/runtime-test-suite-audit-2026-09-08/bench-diagnostic-results.json).

## Where the suite earns its keep

| Area | Assessment | Evidence and limitation |
|---|---|---|
| Parsing, lowering, constant folding, CSE, rejection rules | Strong example-based regression coverage | Direct node tests plus golden numerical examples; specific unsound IEEE rewrites such as `x/x → 1` have regression witnesses. These are examples, not coverage of every composition. |
| Shared-DAG traversal and GC | High value | The maximum-capacity shared-child adversary verifies reachability, topological order, and remapping. It targets a real class of silent dependency loss. |
| Live edits, rollback, state identity, reclamation | High value | Repeated edits, retained state, rejected candidates, arena exhaustion, source relocation, and bounded pool use receive executable checks. This directly protects live-coding behavior. |
| Stateful temporal behavior and numerical health | Strong selected examples | Golden, UGen, failure-mode, health, and projection tests cover tick ordering, continuity and fallback. Arbitrary histories and combinations are less well covered. |
| Compiler semantic preservation | Partial | The recursive reference evaluator is independent of the executor implementation but consumes the same compiled DAG. It cannot expose every shared lowering/folding/CSE error. |
| Native/WASM integration | Useful but incomplete | The full Python corpus can run against actual WASM. Native tests named “WASM-shaped” are serialization checks, not execution in WASM. App fakes protect host protocols, not C++ semantics. |
| Throughput, latency, allocation and target capacity | Weak as a current regression gate | Useful infrastructure exists, but stale benchmark construction, corpus, execution path, and comparisons prevent reliable current conclusions. Hardware evidence is separate. |

Key sources: [core node/compiler tests](../../src-useq/test/signal_engine/test_signal_engine.cpp), [golden semantics](../../src-useq/test/signal_engine/test_signal_engine_golden.cpp), [IEEE regression](../../src-useq/test/signal_engine/test_audit_fixes.cpp), [DAG traversal adversary](../../src-useq/test/signal_engine/test_node_pool_traversal.cpp), [resource reclamation](../../src-useq/test/signal_engine/test_resource_reclaim.cpp), and [state identity](../../src-useq/test/signal_engine/test_state_identity.cpp).

## Findings

### 1. Existing useful checks are disconnected from the default gate

`npm test` runs app Mocha and Vitest tests. The inspected [app CI workflow](../../.github/workflows/runtime-contracts.yml) builds/runs the native wire-protocol contract test, but does not run the full native Meson suite or the Python native/WASM conformance corpus. The runtime checkout contains no tracked CI workflow of its own. Meson registers the *conformance runner's resolution test*, not the corpus itself.

That separation is observable: 39/39 Meson suites passed while three YAML cases failed on both native and WASM. The registered tests took only about 3.6 seconds of summed subprocess runtime after rebuilding, so their marginal execution cost is small relative to rebuilding.

The failing fixtures are:

- `non-constant-phase-is-error`: `(saw 1)` is constant under current pure-waveform semantics, so it no longer supplies a dynamic `:phase`. A separate probe using `(saw t)` gets the intended type rejection from both `phasor` and `lfo`.
- `duplicate-active-id-rejected`: bare `saw` rejects the extra `:id` arguments with arity before reaching the intended state-writer collision.
- `recompile-same-id-is-fine`: the same bare-`saw` issue prevents the identity-continuity scenario from running.

Separate WASM probes using `phasor` preserve the latter two intentions: duplicate active IDs produce a boundary error, while two successive recompiles with one stable ID succeed. This supports fixture drift as the cause; it is not permission to discard the intended behavior. Current docs also contain modifier syntax ahead of this compiler's accepted surface, so substitutions require source/spec reconciliation.

The in-app witness runner supports `eval`/`sample`, but not tick, health, config, clear, or structured diagnostic expectations. Of the served 85 witnesses, **54 are supported and 31 are explicitly unsupported**. Its aggregate is consequently not equivalent to the full Python corpus. This is honestly reported by the runner, but easy to overlook in a broad “whole corpus” claim.

### 2. The independent oracle starts after the optimizer

[The reference differential test](../../src-useq/test/signal_engine/test_program_semantics.cpp) uses six expressions at seven times: 42 selected comparisons. [ProgramView construction](../../src-useq/uSEQ/src/signal_engine/program_semantics.cpp) copies `pool.nodes` after compilation. A compiler that generates the wrong graph can give the same wrong answer through both evaluators.

This test has real value for execution traversal and operation semantics. It is insufficient as the primary compiler-correctness oracle. The probe explicitly rejects `opt_level=0`; an optimization-disabled differential path described in the design document does not exist.

The grammar fuzz tests exercise hundreds of expressions and command-injection histories, but their principal invariant is “does not crash / outputs remain finite.” Since LKG fallback deliberately keeps output finite, that invariant cannot distinguish a healthy result from an incorrect graph hidden behind fallback. Fuzzing needs independent expected values, expected health, or state-transition models to detect that class of wrong answer.

Raw assertion volume is particularly misleading here: oscillator tests and firmware fuzzing account for roughly 88% of the 436,673 assertions. They are useful repetitions, not hundreds of thousands of independently checked compiler behaviors.

### 3. The performance harness measures an obsolete execution path

[The benchmark](../../src-useq/bench/bench_probe.cpp) and [firmware-profile endurance harness](../../src-useq/bench/firmware_profile_endurance.cpp) call:

```text
execute_all_outputs → commit_state → commit_outputs
```

[Firmware](../../src-useq/uSEQ/src/firmware/firmware.cpp) and [WASM projection](../../src-useq/wasm/wasm_projection.cpp) use:

```text
prepare_tick → commit_tick
```

The production transition computes state updates from the previous snapshot and evaluates output bodies against the current tick's simultaneous state. For advancing stateful execution, `prepare_tick` traverses the DAG twice. The benchmark executes it once. This changes both semantics and measured work; it is more serious than timing noise or a missing baseline.

Additional problems in [build.sh](../../src-useq/bench/build.sh) and [run_bench.py](../../src-useq/scripts/run_bench.py):

- The standalone source list omits the two newer translation units and fails linking.
- Six desktop workloads still use removed `usin`/`ucos` forms. Three of the four designated smoke workloads fail with current source.
- Existing probe binaries are rebuilt only when absent. Locally both predate current runtime HEAD. The runner stamps results with current Git HEAD without checking executable provenance.
- Missing benchmark metrics are skipped during comparison; missing workloads are not required. Firmware names do not intersect the desktop `SMOKE` set.
- Desktop recompile failures are recorded but do not make the probe fail; a zero-success recompile sequence can report a zero median. Firmware has a separate success-count capacity check.
- The main timing gate compares medians only. Compile p99 is recorded from 60 samples, and per-tick execution data are averages over batches. These do not establish worst-case latency or jitter.
- The tracked baseline `f72859d.json` lacks the host, compiler, flags, and corpus identity needed for a defensible modern comparison.

The native firmware test asserting an average tick below 1 ms is a coarse desktop smoke check. It does not assert that all setup evals succeeded, and it does not establish the device's timing margin.

### 4. Some evidence descriptions overstate what their assertions establish

[COVERAGE_LEDGER.md](../../src-useq/test/COVERAGE_LEDGER.md) still calls state unimplemented, treats hot-path allocation as untestable, and marks diagnostics persistence uncovered despite dedicated current suites. Its coverage totals and gap priorities are not reliable enough for decisions.

[The synth “native and WASM-shaped” test](../../src-useq/test/signal_engine/test_synth_wasm_abi.cpp) runs a native harness and inspects its serialized data. It does not instantiate a WASM module. Keep it as an ABI regression, but do not count it as native/WASM compiler equivalence.

[Oscillator guard-zone checks](../../src-useq/test/signal_engine/test_osc_sine_nodedef.cpp) detect writes outside buffers. Their surrounding “compute allocates nothing” explanation is stronger than the test: a heap allocation elsewhere can leave every sentinel intact. Scoped allocator instrumentation can test the real-time allocation contract without counting Catch's own allocations.

## Recommended order of investment

1. **Restore the existing regression gate.** Reconcile the three fixtures without weakening their semantic intent; refresh the ledger; run all native tests and the shared corpus against both native and actual WASM artifacts with explicit provenance. Distinguish source, native-wrapper, generated-WASM, browser, and device evidence.
2. **Repair performance measurement before optimizing.** Use the production tick transition, a shared build source inventory, valid workloads with numerical/health sanity checks, fresh identified binaries, complete required metrics, and profile-specific regression sets. Gate recompile success as well as speed. Establish a new baseline only after those repairs.
3. **Improve oracle independence.** Start with a small bounded source-expression generator and independent evaluator covering constants, time, arithmetic, conditionals, cells, and IEEE-sensitive cases. Add model-based state/edit traces and shrink failing programs. Validate the oracle with a few deliberate known-bad compiler mutations. Add scoped allocation checks and meaningful latency distributions rather than more compile-only acceptance rows.

The existing RP2040 profile/Wokwi infrastructure includes capacity, endurance, telemetry, p99 and maximum compile-time gates. It is useful and should be retained; it was not executed in this audit. Default host limits also differ from firmware limits (for example 1024 versus 360 nodes, 32 versus 16 state slots). Native success is not device qualification, and the RP2040 budget is not evidence for RP2350 timing.

No hardware, browser journey, sanitizer build, coverage instrumentation, or mutation campaign was run. No speedup, deadline guarantee, or complete compiler proof is claimed.

## Tracking

Audit: `work:6809ad38-ea94-426e-804e-08d70b8bd61d`. The following are proposed follow-ups, not started implementation:

- Regression gate and fixture/ledger reconciliation: `work:fc78b2ea-6aa6-4aa5-9659-0d21d43f9a0f`.
- Performance harness and reliable comparisons: `work:a1a7fdf2-fc33-4314-a403-5e00cf837428`.
- Independent semantic and allocation oracles: `work:5a6397d4-245b-444f-a7df-486861c4043b`.
