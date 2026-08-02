---
stability: draft
layer: behavioural
---

# Witness Substrate

> Spec: the shared substrate under the two canonical representations of
> ModuLisp semantics — the developer-facing [engine-ledger.md](engine-ledger.md)
> and the user-facing [the-machine.md](the-machine.md). A **witness** is a
> conformance case that both surfaces render: the Engine Ledger renders it as
> clause verification, the Machine/Guide renders a curated subset as pedagogy.
> One corpus, two renderings — the coupling that makes both representations
> canonical and prevents either from drifting from the engine.

### Source files

- `src-useq/test/conformance/**/*.yaml` — the conformance corpus (authoritative; lives in the firmware submodule, already dual-run against native and generated-WASM builds there)
- `src-useq/scripts/run_conformance.py` — the native runner; the reference for step vocabulary and default tolerance
- `scripts/harvest-witnesses.mjs` — build-time harvest of the corpus into a bundled JSON index
- `public/assets/witness-index.json` — (generated) the bundled index
- `src/lib/witness/types.ts` — witness/index/result types and the injected `WitnessEngine` seam
- `src/lib/witness/loader.ts` — fetch + validate the bundled index; clause lookups
- `src/lib/witness/runner.ts` — in-app witness runner against an injected isolated engine
- `src/runtime/witnessEngine.ts` — the real isolated engine over a second WASM instantiation

## 1. The corpus is the single source

1.1 A **witness** is one case in `src-useq/test/conformance/**/*.yaml`. The
corpus is authoritative and lives in the submodule; the app never maintains a
second copy of case content. The app consumes it via a build-time harvest
(§3). Editing a witness means editing the corpus in `src-useq` (separate
submodule commit, per repo convention).

1.2 Existing case shape (already in the corpus, unchanged):

```yaml
- name: fast-is-pointwise-time-scaling     # unique within the corpus
  spec: time-warps.md §3.1                  # clause reference (file + §)
  tags: [smoke, time-warps]
  steps:
    - eval: "(a1 (fast 2 t))"
    - sample: {output: a1, times: [0.0, 0.5, 1.0]}
      expect_values: [0.0, 1.0, 2.0]
```

1.3 The `spec:` field is the **clause mapping**: `<file> §<clause>` relative
to `src-useq/docs/specs/`. Multi-clause references may be comma-separated.
Every witness must carry a `spec:` reference; a witness without one is a
harvest-time warning.

1.4 New optional field `guide:` — a guide-block reference
(`<chapterId>/<blockId>`) marking the witness as pedagogically rendered in
the user guide. Absence means developer-surface-only. The guide side holds
the mirror reference (§4), and a test asserts the two directions agree.

## 2. Witness semantics

2.1 Step kinds the in-app runner must support at minimum: `eval` (evaluate a
top-level form) and `sample` (`output`, `times[]`, `expect_values[]`, with a
tolerance default matching the native runner's). Other step kinds present in
the corpus (diagnostics expectations, state-identity audits, etc.) may be
**unsupported** by the in-app runner initially.

2.1.1 The corpus step vocabulary is defined by the native runner
(`src-useq/scripts/run_conformance.py`): exactly one of `eval`, `tick`,
`sample`, `clear`, `health`, `config` is the operation, and `expect_value`,
`expect_values`, `expect_error`, `expect_diagnostic`, `tol` are expectations
attached to it. The default tolerance is `1e-9`, compared as
`abs(got - want) <= tol`.

2.1.2 As implemented (M1), the in-app runner executes `eval` and `sample`,
including the `expect_value`, `expect_values`, `expect_error`
(`true`/`false`/`allow`) and `tol` expectations. It does **not** execute
`tick`, `clear`, `health`, `config`, or `expect_diagnostic`. `tick` in
particular must not be approximated with `useq_update_time`: the native
`tick` commits outputs and state (establishing LKG), while
`useq_update_time` only moves the clock — the two are not the same
operation, and treating them as one would manufacture false verdicts. The
missing operations need new WASM exports (§5.1).

2.2 An unsupported step makes the witness result `unsupported` (grey), never
pass. The runner must not skip a step it does not understand and report the
remainder green. Verdicts: `pass` | `fail` | `unsupported` | `error`
(runner/engine fault, distinct from an expectation mismatch).

2.2.1 Support is decided **before** any step is executed: a witness with an
unsupported step is never partially run, so it cannot leave the engine in a
state that a later reader might mistake for a result. A supported witness
stops at its first non-`pass` step, because the engine's state is no longer
trustworthy for the remaining steps.

2.3 **Isolation is mandatory.** Running a witness must not mutate the user's
live session: no visible output changes, no cell definitions leaking, no
state-slot disturbance, no transport interaction. Preferred implementation: a
dedicated witness engine instance (second instantiation of the WASM module),
created lazily, reset (or re-instantiated) between witnesses. Evaluating
witness code in the live engine is forbidden even if followed by cleanup.

2.3.1 "Reset" is not available: `useq_init()` is idempotent
(`if (g_init_called) return;` in `src-useq/wasm/wasm_wrapper.cpp`) and there
is no `useq_clear` export, so **re-instantiation** is the only clean reset.
The runner therefore calls `createModule()` again per witness — the same
model as the native runner's fresh probe process per case. The isolated
module is never published to `globalThis.__useqWasmRuntime`, so no live-session
reader can observe it.

2.4 Witness sampling uses explicit times (pure evaluation at given `t`), not
wall-clock transport time. Results are deterministic per engine build;
tolerance handles float divergence (see `src-useq/docs/specs/compilation.md`
§4.2).

## 3. Harvest and bundling

3.1 `scripts/harvest-witnesses.mjs` runs as part of `build:assets`: parses
all corpus YAML, validates shape (unique names, well-formed `spec:` refs),
and emits `public/assets/witness-index.json` — an array of
`{name, specFile, clause, tags, guide?, steps, sourcePath}`.

3.1.1 As emitted, that array is carried in an envelope object alongside the
§3.3 aggregation and a schema version:
`{version, corpusDir, fileCount, witnessCount, witnesses: [...], bySpecFile}`.
Each witness additionally carries `specRefs` — all parsed `spec:` citations,
since a witness may cite several clauses; `specFile`/`clause` mirror the
first. `clause` is `null` for a citation that names a whole document with no
`§` (the corpus contains several, e.g. `outputs.md, failure-model.md §5`).

3.2 The index is bundled unconditionally (it is small); the developer UI that
renders it is devmode-gated. Harvest failures (parse error, duplicate name,
missing `spec:`) fail the build loudly — a witness that cannot be indexed is
drift by definition.

3.2.1 §1.3 calls a missing `spec:` a *warning* while §3.2 lists it among the
loud failures. As implemented, a missing `spec:` warns and a parse error,
duplicate name, empty `steps` or malformed `spec:` reference fails. This
contradiction should be resolved in the spec; the corpus currently has no
witness without a citation, so nothing depends on the choice yet.

3.3 The harvest also emits per-spec-file aggregation (clause → witness names)
so the Engine Ledger can badge clauses without re-scanning.

3.3.1 The aggregation is `bySpecFile[file] = {clauses: {clause: [names]},
documentWitnesses: [names]}`; clause-less citations land in
`documentWitnesses` so a whole-file badge can include them without inventing
a clause number.

## 4. Guide coupling

4.1 A guide playground block may carry `witnessRef: <case name>`. A repo test
asserts every `witnessRef` resolves to a corpus case, and (once `guide:`
back-references land in the corpus) that the two directions agree.

4.2 The pedagogical contract: a playground with a `witnessRef` teaches
*exactly* the behaviour the referenced case asserts. If the example drifts
from the case (either edited), the resolution test or the badge catches it.

## 5. Open / Deferred

5.1 Extending the in-app runner beyond `eval`/`sample`. On the pinned corpus
this is what the 30 `unsupported` witnesses need (84 total, 54 currently
`pass`):

- `expect_diagnostic` (11 witnesses) — needs `useq_last_diagnostics` category
  and span matching. This one is purely app-side; no new export required.
- `tick` (10) — needs a WASM export that advances time **and commits**
  outputs/state, matching the native probe's `tick`.
- `health` (5) — needs a per-output health readback comparable to the native
  probe's; `useq_active_diagnostics` is the likely source.
- `config` (2) — `failure_mode` maps to the existing `useq_set_failure_mode`;
  `opt_level` has no export.
- `clear` (2) — needs a `useq_clear` equivalent (also removes the
  re-instantiate-per-witness cost, §2.3.1).

5.2 `guide:` back-references in the corpus itself (requires submodule
commits; the app-side `witnessRef` direction lands first).

5.3 Authoring flow: promoting a guide example that lacks a witness into a new
corpus case ("teach it → prove it").
