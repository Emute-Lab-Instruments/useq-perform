# ALIGNMENT.md

Opinionated, dated diagnosis of the gap between this repo and its best-possible
future. Counterpart to `MAP.md` ("what is"); this file is "how good is what is,
vs. what we need". Pruned ruthlessly. If an entry crystallises into "fix now",
promote it to a bead and delete it from here.

Last full pass: **2026-04-29**.

---

## Active push (Press Fire)

Five concurrent streams. Stream A1 lands first as a gating prerequisite;
the rest run in parallel against the boundary it defines.

- **A1 — Visualisation consolidation** *(prerequisite, lands first)*. Issue
  6. Single owner for sampling + state + render with one rAF loop.
- **A2 — Worker move** *(after A1)*. Issue 2. Off-thread WASM eval +
  transferable buffers.
- **B — WebGL renderer** *(after A1)*. Issue 3. GPU path for analog +
  digital lanes.
- **C — Hardware-mode test coverage** *(parallel, independent)*. Issue 4.
  Expand fake-Serial harness to cover reconnect, bootloader, version
  gating.
- **D — Settings reorg + doc sweep + serial-wait fix** *(complete,
  2026-04-29)*. devmode-gated settings split (`useq-perform-9gu`),
  REPO_MAP.md/STABLE_CORE.md pruned (`useq-perform-3yw`), 3500ms serial
  wait replaced with observed readiness (`useq-perform-vig`).
- **F — WASM-mode protocol parity** *(complete, 2026-04-29)*. `hello`
  + `stream-config` + `eval` + `ping` negotiation now layered in front
  of `wasmInterpreter` via `runtime/wasmJsonTransport.ts` +
  `runtime/wasmJsonHandlers.ts`. `WasmRuntimePort.evalCode` and
  `sendTransportCommand` flow through the same JSON shapes as hardware;
  sampling helpers stay direct.

Each stream is a bd dependency chain rooted in a P1 entry-bead so
`bd ready` returns the active heads when an agent claims work.

Outside the active push, the User Guide content beads (`useq-perform-tef`,
`-2i1`, `-6ej`, `protocol-gr4`) continue per
`docs/USER_GUIDE_SPEC.md` as their own independent track.

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

### 1. Submodule pin lags 70 commits behind the firmware/WASM trunk — *pre-ship only* *(2026-04-29)*

> **Status: not in active push.** Local dev runs against the checked-out
> submodule (the new code), so day-to-day work is unaffected. This entry
> stays in ALIGNMENT.md as a flag for "before shipping a release, deal with
> this." It re-enters the active push the moment a v1.2.0 ship is on the
> table.

**What.** `npm run src-useq:status` reports `pinnedCommit cfa7fb1`,
`checkedOutCommit 15c8424`, branch `feature/bytecode-vm-core`, dirty.
Between those two commits sit the bytecode VM (tree-walker deleted), the
"signal engine" reactive-graph rewrite, the full structured-diagnostics
pipeline, an X-macro symbol table, native for-loop compilation, and ~50 e2e
firmware tests with 162k+ assertions.

**Why it blocks the mission *at ship time*.** A shipped build runs the
*pinned* WASM, not the checked-out one — so any release without advancing
the pin would put the tree-walker (not the bytecode VM) into users' hands.
The 10–20 channel goal rests on the bytecode VM landing for users.

**Cost.** M (decide branch strategy in `src-useq`, fix or quarantine the
SIGSEGV tests blocking the merge — `bd useq-perform-jut` — advance the pin,
rebuild WASM, smoke-test). Tracked in `bd useq-perform-xbe`.

### 2. WASM eval on the main thread is now opt-out, not opt-in *(2026-04-29)*

**What.** A worker-backed `WasmRuntimePort` landed via `useq-perform-nri`
(commit `1a0871e`) behind the `?wasmInWorker=true` URL flag. With the flag
set, sampling, eval, and transport commands all go through postMessage to
`src/runtime/workers/wasmRuntime.worker.ts` — the main thread is freed.
Probe batching from `useq-perform-d5r` (40× WASM-call reduction) makes the
worker move much cheaper than it would have been per-sample.

**What's still missing for "default on":**
1. The probe sampler (`ProbeConfig.evalExpressionAtTimes`) still calls the
   in-process WASM directly (`useq-perform-sw0`); with the flag on it
   silently bypasses the worker.
2. Diagnostics readback (`useq_last_diagnostics` /
   `useq_active_diagnostics`) isn't piped across the worker boundary
   (`useq-perform-cf4`); editor squiggles silently degrade with the flag on.
3. `evalOutputsInTimeWindow` returns `Map<string, TimeSample[]>` via
   structured-clone postMessage — at 15+ channels this may dominate
   (`useq-perform-oxk`); transferable `Float64Array` companion path is the
   fallback if profiling shows it.

Until those three close, `wasmInWorker` is dev-only and the channel-count
goal is bounded by what the in-process path can handle.

**Cost.** S each for the three follow-up beads above.

### 3. Visualisation rendering is 2D Canvas; render-frame becomes the second bottleneck at scale *(2026-04-29)*

**What.** `src/ui/visualisation/serialVis.ts` is a 542-line 2D-canvas path
tracer. At 15 channels the baseline shows `render-frame` averaging 2.3ms /
max 5.7ms and growing roughly linearly. There is no GPU path, no shader,
no instanced draws. Inline probes have their own per-probe canvas painters.

**Why it blocks the mission.** Even with a perfect VM and an off-thread
sampler, a CPU path tracer caps perceived smoothness around the same channel
count. A WebGL renderer is independent work that can land in parallel and
both halve render cost and free CPU for sampling.

**Status.** `bd useq-perform-cqw` (Stream B) landed an experimental WebGL2
painter (`src/ui/visualisation/serialVisGL.ts`) registered as an alternative
`VisualisationRenderHook`, gated behind a devmode setting (`visualisation.renderer`).
Default remains `"canvas"` until parity (visual fidelity, line-width on browsers
that ignore WebGL `lineWidth>1`, performance vs the current 2D path at 15+
channels) is validated. Inline probes still use per-probe 2D canvases — separate
follow-up work.

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

- **MIDI, camera, virtual gamepad, desktop/Electron** — explicitly cut
  from the stable core (`STABLE_CORE.md` §"Out of scope"). Don't bring
  back without a mission case.
- **Single-user concerns** — no auth, no multitenancy, no telemetry, no
  scale story. Accepted.
- **Legacy text serial protocol** — kept as a bridge for pre-1.2.0
  firmware while the JSON path is the target. Tracked in
  `STABLE_CORE.md` §Compatibility Cuts.
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
