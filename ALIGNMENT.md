# Alignment

Last full review: **2026-08-05**.

## Mission

`useq-perform` is the live-coding interface for uSEQ. It must provide a
low-latency editor and visual account of ModuLisp programs against either the
pinned firmware profile or the browser-local generated-WASM profile. Valid
evaluations must publish coherently, rejected evaluations must leave the
running result unchanged, and every equivalence or performance claim must name
the execution profile and observation that supports it. The project remains a
single-user application maintained by a small team; multi-user operation,
desktop packaging, and broad browser compatibility are outside its mission.

## Top defects

### 1. The editor migration is prepared but not yet observed in production *(2026-08-05)*

**What.** One editor now negotiates protocol-v1 JSON or the bounded legacy
text adapter, preserves a rollback storage bridge, and can advertise a
same-origin firmware beta manifest. The current public editor has not yet been
archived at `/legacy/`; no beta manifest or UF2 is published; and neither path
has been exercised against physical pre-1.2 and beta hardware in the release
browser.

**Why it blocks the mission.** Parser and integration tests do not prove the
actual Web Serial devices, BOOTSEL handoff, static-host deployment, or a
rollback that preserves a user's program.

**Rough cost.** S-M: execute the cutover checklist in
`docs/design/firmware-compatibility-and-beta-release.md`, retain the physical
A/B record, then close ergo `6fc96486`.

### 2. Firmware-profile execution is not yet observed *(2026-08-02)*

**What.** The common language corpus passes through the native and generated-
WASM probes, and the `musicthing` firmware profile compiles and links. There is
not yet a host runner using the exact firmware capacities and adapter path, nor
a physical-device execution record for the release candidate.

**Why it blocks the mission.** Desktop execution and target buildability do not
establish behavior at the firmware profile's exact resource boundaries or at
its physical I/O boundary.

**Rough cost.** M: complete the exact-profile runner tracked in ergo
`2f440020`, select its representable corpus, and record physical-device checks
separately.

### 3. Browser scheduling and audible output need direct observations *(2026-08-02)*

**What.** Automated tests cover compiler-to-control mapping, prepare/commit/
activation ordering, graph execution, generated assets, and the browser-facing
interfaces. They do not establish real Worker/AudioWorklet scheduling over
time or audible output on a physical audio device.

**Why it blocks the mission.** Unit and integration models cannot determine
whether a browser maintains the required block cadence, nor whether the final
audio path is perceptually correct.

**Rough cost.** S-M: run and retain the browser timing observation and the
listening procedure in `docs/synthesis/LISTENING_GUIDE.md` for the integrated
revision.

### 4. Target runtime headroom is incompletely measured *(2026-08-02)*

**What.** The current target build uses 92.3% of static RAM and 17.0% of flash.
No target stack watermark has been measured under combined compilation,
protocol, and runtime workloads.

**Why it blocks the mission.** Static fit does not establish adequate runtime
headroom at the most constrained supported profile.

**Rough cost.** M: add a stack-watermark observation and representative
combined workloads before making a target-headroom claim.

### 5. Clause-level evidence is not yet complete *(2026-08-02)*

**What.** The Engine Ledger exposes the specification corpus and existing
conformance witnesses, but some normative clauses still have no executable
witness and the physical-target subset is absent.

**Why it blocks the mission.** Aggregate suite success cannot establish every
normative clause or every execution profile.

**Rough cost.** M-L: split compound clauses where necessary, complete stable
case identifiers and clause references, add the serial/physical subset, and
make missing joins fail the intended evidence grade.

## Open mission questions

- Which common-capability cases must execute on physical hardware before a
  release may describe firmware and generated WASM as behaviorally
  interchangeable?
- Should exact firmware-profile conformance run for every release, or only
  when compiler limits, adapters, or target toolchains change?
- Is the Engine Ledger a permanent development surface or a temporary means
  of completing the clause-to-witness relation?

## Deferred / accepted debt

- `setTimeout(0)` remains the documented Worker producer pacing mechanism;
  ADR-0003 records the conditions for reconsidering `Atomics.wait`.
- Generated capability and served-bundle records are deterministic but
  intentionally unsigned until a publisher-authentication requirement and
  trust anchor exist.
- Camera input, virtual gamepad, desktop packaging, MIDI output, firmware-side
  MIDI, authentication, multitenancy, and telemetry remain outside the stable
  product boundary in `docs/specs/MAIN.md`.
- The legacy text serial adapter remains only while supported users still run
  pre-1.2 firmware. It guarantees core editor→hardware eval and incoming time/
  value streams, not current ModuLisp semantics or JSON-only features. Remove
  it after the supported population is upgraded and the `/legacy/` rollback
  endpoint has passed its announced retirement window.
