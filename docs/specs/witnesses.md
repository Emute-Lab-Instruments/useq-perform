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
- `scripts/harvest-witnesses.mjs` — (to be created) build-time harvest of the corpus into a bundled JSON index
- `public/assets/witness-index.json` — (generated) the bundled index
- `src/lib/witness/types.ts` — (to be created) witness/index/result types
- `src/lib/witness/runner.ts` — (to be created) in-app witness runner against the bundled WASM engine

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

2.2 An unsupported step makes the witness result `unsupported` (grey), never
pass. The runner must not skip a step it does not understand and report the
remainder green. Verdicts: `pass` | `fail` | `unsupported` | `error`
(runner/engine fault, distinct from an expectation mismatch).

2.3 **Isolation is mandatory.** Running a witness must not mutate the user's
live session: no visible output changes, no cell definitions leaking, no
state-slot disturbance, no transport interaction. Preferred implementation: a
dedicated witness engine instance (second instantiation of the WASM module),
created lazily, reset (or re-instantiated) between witnesses. Evaluating
witness code in the live engine is forbidden even if followed by cleanup.

2.4 Witness sampling uses explicit times (pure evaluation at given `t`), not
wall-clock transport time. Results are deterministic per engine build;
tolerance handles float divergence (see `src-useq/docs/specs/compilation.md`
§4.2).

## 3. Harvest and bundling

3.1 `scripts/harvest-witnesses.mjs` runs as part of `build:assets`: parses
all corpus YAML, validates shape (unique names, well-formed `spec:` refs),
and emits `public/assets/witness-index.json` — an array of
`{name, specFile, clause, tags, guide?, steps, sourcePath}`.

3.2 The index is bundled unconditionally (it is small); the developer UI that
renders it is devmode-gated. Harvest failures (parse error, duplicate name,
missing `spec:`) fail the build loudly — a witness that cannot be indexed is
drift by definition.

3.3 The harvest also emits per-spec-file aggregation (clause → witness names)
so the Engine Ledger can badge clauses without re-scanning.

## 4. Guide coupling

4.1 A guide playground block may carry `witnessRef: <case name>`. A repo test
asserts every `witnessRef` resolves to a corpus case, and (once `guide:`
back-references land in the corpus) that the two directions agree.

4.2 The pedagogical contract: a playground with a `witnessRef` teaches
*exactly* the behaviour the referenced case asserts. If the example drifts
from the case (either edited), the resolution test or the badge catches it.

## 5. Open / Deferred

5.1 Extending the in-app runner to diagnostics-expectation steps (needed
before `diagnostics/` and `failure-model/` witnesses can go green in-app).

5.2 `guide:` back-references in the corpus itself (requires submodule
commits; the app-side `witnessRef` direction lands first).

5.3 Authoring flow: promoting a guide example that lacks a witness into a new
corpus case ("teach it → prove it").
