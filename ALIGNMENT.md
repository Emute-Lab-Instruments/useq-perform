# ALIGNMENT.md

Opinionated, dated diagnosis of the gap between this repo and its best-possible
future. Counterpart to `MAP.md` ("what is"); this file is "how good is what is,
vs. what we need". Pruned ruthlessly. If an entry crystallises into "fix now",
promote it to a bead and delete it from here.

Last full pass: **2026-04-29**.

---

## Active push (Press Fire) — *complete, 2026-04-29*

All six original streams landed across two waves of parallel agents:

- **A1 — Visualisation consolidation** (`useq-perform-7hs`). Single
  `visualisationRuntime` owner; one rAF loop; one coalescing slot.
- **A2 — Off-main-thread WASM** (`useq-perform-d5r` probe batching,
  `useq-perform-nri` worker move). 40× call reduction + opt-in worker.
- **B — WebGL renderer** (`useq-perform-cqw`). Alternative
  `VisualisationRenderHook`; devmode-gated.
- **C — Hardware-mode test coverage** (`useq-perform-ln3`). 22 new
  lifecycle tests; paths 1–6 covered.
- **D — Settings reorg + doc sweep + serial-wait fix**
  (`useq-perform-9gu`, `-3yw`, `-vig`). devmode split, map/stable-core
  docs pruned, observed-readiness probe replaces 3500ms wait.
- **F — WASM-mode protocol parity** (`useq-perform-6cf` typed runtime
  ports, `useq-perform-pcx` JSON parity). Hardware and WASM share the same
  port abstraction and the same `hello` / `stream-config` / `eval` /
  `ping` shapes via `runtime/wasmJsonTransport.ts`.

Outside the active push, the User Guide content beads (`useq-perform-2i1`,
`-6ej`, `protocol-gr4`) continue per `docs/USER_GUIDE_SPEC.md` as their
own independent track.

---

## Mission

`useq-perform` is the live-coding interface for uSEQ — a single-user web app
that lets the author and a small community of fellow live coders fluently
write, evaluate, and visualise ModuLisp expressions, either against the uSEQ
Eurorack hardware over Web Serial or against an in-browser WASM build of the
same interpreter. The app must (a) give the user expressive editor + waveform
feedback at low latency, (b) keep hardware and WASM behaviourally interchangeable
so the local fast path is trustworthy, (c) scale visualisation to ~10–20
simultaneous channels without dropping frames, and (d) stay shaped so one
person can keep refactoring it without ceremony. Polish, multi-user concerns,
desktop apps, and broad browser support are explicitly *not* the mission.

---

## Top defects

Ranked by mission impact. Each entry: **what / why-it-blocks-the-mission /
cost (S–L) / date**.

### 1. src-useq branch/pin must be ship-clean before public build *(2026-05-02)*

> **Status: in Superbooth Phase 6.** Local development now has the
> `src-useq/` gitlink and checked-out submodule on the same bytecode-VM branch.
> The 2026-05-02 hygiene pass landed the local spec edits as submodule commit
> `1fc5350` on `feature/bytecode-vm-core`.

**What.** The old "pin trails trunk" diagnosis is no longer the exact state
of this checkout. The remaining ship work is to make the submodule state
public-branch/merge-clean, rebuild/copy WASM artifacts if needed, and smoke
the public build against the pinned artifact. Pre-existing `src-useq`
SIGSEGV/SIGABRT tests remain tracked in `useq-perform-jut`.

**Why it blocks the mission *at ship time*.** A shipped build runs the pinned
WASM artifact and gitlink, not whatever happens to be checked out locally.
Phase 6 must prove the pin, copied artifact, firmware branch, and smoke-tested
runtime all describe the same bytecode-VM world.

**Cost.** M (merge/release `src-useq`, fix or quarantine the SIGSEGV tests —
`bd useq-perform-jut` — rebuild WASM if the artifact changes, smoke-test).
Tracked in `bd useq-perform-gii8.62` / `bd useq-perform-xbe`.

### 2. Worker-backed WASM is default, but needs Superbooth verification *(2026-05-02)*

**What.** A worker-backed `WasmRuntimePort` is now selected by default in
`bootstrap.ts` when Web Workers are available. Sampling, eval, diagnostics,
and transport commands go through postMessage to
`src/runtime/workers/wasmRuntime.worker.ts`; the in-process port remains the
fallback.

**What still needs proof before we trust it on stage:**
1. The probe sampler (`ProbeConfig.evalExpressionAtTimes`) must call the
   active runtime port rather than bypassing the worker via direct
   in-process calls.
2. Diagnostics readback (`useq_last_diagnostics` /
   `useq_active_diagnostics`) must work through the worker boundary after
   `__useqWasmRuntime` is initialised in both contexts.
3. `evalOutputsInTimeWindow` returns `Map<string, TimeSample[]>` via
   structured-clone postMessage; profile at 15+ channels and add a
   transferable `Float64Array` path if postMessage dominates.

Tracked by `useq-perform-gii8.17`; older shorthand beads `sw0`/`cf4`/`oxk`
no longer exist in the database and should be re-filed as concrete children
when that issue starts.

**Cost.** S each for the three follow-up workstreams above.

### 3. Visualisation must finish the WebGL-only cutover *(2026-05-02)*

**What.** The Superbooth epic makes WebGL the only supported visualisation
renderer. `src/ui/visualisation/serialVisGL.ts` is the path to keep;
`serialVis.ts` and per-probe 2D canvas painters are legacy surfaces to remove
or replace during Phase 4.

**Why it blocks the mission.** Even with a perfect VM and an off-thread
sampler, a CPU path tracer caps perceived smoothness around the same channel
count. A WebGL renderer is independent work that can land in parallel and
both halve render cost and free CPU for sampling.

**Status.** `bd useq-perform-cqw` landed the WebGL2 painter. Phase 4 of
`useq-perform-gii8` owns the remaining work: stutter fix, probe WebGL, removal
of canvas fallback, and WebGL-only verification.

**Cost.** M-L (single shader path for analog lanes, separate digital-lane
path; the data already arrives as `Float64Array` so most plumbing is done).

### 4. Hardware-path test coverage gaps remain around timing + WASM parity *(2026-04-29)*

**What.** Web Serial event wiring, auto-reconnect on cable replug,
saved-port matching across sessions, bootloader-mode handoff, firmware
version gating, and the post-handshake flow now have automated coverage
in `src/transport/serialLifecycle.test.ts` (Stream C / `useq-perform-ln3`,
2026-04-29) on top of the original `serialComms.test.ts`.

One slice remains open:

- **Tests against the readiness probe.** The 3500ms hardcoded post-open
  wait was replaced with an observed-readiness probe in `useq-perform-vig`
  (Stream D-serial, 2026-04-29). Coverage of the probe loop — timeout
  cases, retry behaviour, legacy-firmware fallback — still needs to be
  written against the new contract (`useq-perform-0h2`).

**Why it blocked the mission.** Browser-local WASM is **first-class**
alongside hardware mode — both are the product. The asymmetry of having
a richer protocol on hardware than on WASM was a mission-fit problem;
Stream F landing closes that gap for `hello` / `stream-config` /
`eval` / `ping`. The remaining open slice is the readiness-probe test
coverage for the firmware probe (slice 1 above).

**Cost.** S for the timing-paths tests (write against the readiness
contract `vig` introduces).

### 5. Bootstrap WASM-on-main-thread blocks the eager preload from helping *(2026-04-29)*

**What.** `bootstrap.ts:206` fires `ensureUseqWasmLoaded()` early
("eagerly start loading WASM"), but the resulting module is wired
synchronously in the main thread on first use, so cold-start to first
useful frame is dominated by a wait that the architecture commits to
rather than mitigates.

**Why it blocks the mission.** Live-coding sessions are short-burst —
"open browser, plug in, write something" — so startup latency is the most
common UX. A worker-hosted WASM (defect 2) would also let the preload
actually run *concurrently* with the rest of bootstrap.

**Cost.** Folded into defect 2 for the WASM threading half. (The
companion 3500ms hardware-side serial-boot wait was replaced with an
observed-readiness probe under `useq-perform-vig`.)

---

## Open mission questions

Decisions still to make.

- **What "parity" between hardware and WASM actually requires.** The
  runtime contract enumerates a 6-command shared transport surface and
  disjoint capability sets. With WASM now confirmed first-class (resolved
  2026-04-29), Stream F is bringing the JSON `hello` and `stream-config`
  negotiation into the WASM path. **Open question**: should *behavioural*
  parity for `(useq-play)` etc. also be contract-tested end-to-end across
  both runtimes (a property-test surface), or is matching the wire
  protocol enough?

- **Inspector: permanent dev surface or migration aid?** It now hosts
  ~111 scenarios and has driven a real props-based refactor of the UI
  layer. If permanent, scenario coverage is a P1 concern; if migrational,
  the props refactor was the deliverable and Inspector itself can shrink.
  Affects whether `bd useq-perform-7m0` ("Inspector: Full visual coverage
  scenarios") deserves its P2 epic shape or should be aggressively
  narrowed.

---

## Deferred / accepted debt

Known-not-to-be-fixed; recorded so future sessions don't re-relitigate.

- **Camera, virtual gamepad, desktop/Electron, MIDI output, firmware-side
  MIDI** — explicitly cut from the stable core (`docs/specs/MAIN.md` §4.5).
  Browser MIDI input is now in scope for live-edit MIDI learn.
- **Single-user concerns** — no auth, no multitenancy, no telemetry, no
  scale story. Accepted.
- **Legacy text serial protocol** — kept as a bridge for pre-1.2.0
  firmware while the JSON path is the target. Tracked in
  `docs/specs/MAIN.md` §4.4 (compatibility cuts).
- **`?noModuleMode=true`, `?devmode=true`, mock controls/time, Storybook
  remnants** — internal tooling, can change shape without notice.
- **Pre-existing `src-useq` test SIGSEGVs** (`useq-perform-jut`) — known,
  not blocking the front-end mission directly, but blocking the submodule
  pin advance (defect 1).
- **`customThemes` still inside `AppSettings`** *(2026-04-29)*. Themes are
  runtime data, not user prefs; flagged for extraction to a themes store
  during the settings reorg (`useq-perform-9gu`). Deferred — touched 7
  files (settings store, normalisation, persistence, repository, default
  config, configLoader test, settings store test) which exceeded the
  100-LoC budget for that bead. File a follow-up to extract.
