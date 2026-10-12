# Architecture review — 6 September 2026

The review below records the pre-repair snapshot. The implementation checkpoint at the end records the first authorized follow-up; original findings and path references remain historical evidence.

## Executive judgement

**Keep the architecture. Complete its ownership boundaries, remove duplicate execution paths, and make the evidence trustworthy. Do not rewrite the application or interpreter.**

This is not an undifferentiated prototype. It has several good foundations: canonical editor text, atomic document/identity persistence, a pure structural-editing core, typed runtime ports, Worker-owned WASM, bounded signal graphs, and failure-atomic audio graph activation. These are valuable engineering decisions, not complexity to remove on sight.

The main problem is that these decisions are only partly enforced. Some user actions use a second source-commit path. Some asynchronous work survives the lifetime or revision that created it. Some resources escape the fixed-capacity model. Some tests exercise a parallel implementation. Documentation and comments sometimes describe a stronger guarantee than the implementation supplies.

The most useful definition of an elegant project here is:

> A contributor can identify one owner for a fact, one path that changes it, the lifetime of deferred work, and the test that proves its failure behaviour.

Fewer files is not the goal. Fewer independent mechanisms for the same responsibility is.

## Scope and evidence

This review followed the application from bootstrap, document/input handling and evaluation through serial transport, Worker WASM, visualisation, audio synthesis, the shared C++ compiler/runtime, and hardware scheduling. It also inspected build entry points, CI, test harnesses, dependency use, and contributor-facing guidance. The editor, firmware, and audio/visualisation layers received separate bounded review passes; their principal findings were cross-checked during synthesis.

This was a **working-tree review**, not a certification of a released revision:

- Parent HEAD: [`85c7ff4`](https://github.com/Emute-Lab-Instruments/useq-perform/commit/85c7ff4752a18afe67ceaada15e59931268595d6), with substantial existing changes.
- Parent firmware gitlink: [`3f73fcc`](https://github.com/Emute-Lab-Instruments/uSEQ/commit/3f73fcc81f14fadf7b8d1770f7feeb09c9042f7c).
- Checked-out firmware: [`02299d2`](https://github.com/Emute-Lab-Instruments/uSEQ/commit/02299d22870f528f47b27f81fbd37ff4e2838f60), on `paper/iclc-2027-option-1`. Its dirty status at inspection was an untracked HTML report, not tracked source edits. It differs substantially from the parent pin.
- The available generated interpreter records identify an older dirty source state based on [`1081ae8`](https://github.com/Emute-Lab-Instruments/uSEQ/commit/1081ae850a8136881e4b02d73703257fb101b6cc), not either current source identity.
- Other work changed files during the review. Line references describe the inspected snapshot and must be rechecked before a repair.

No application or firmware code was changed. No firmware was rebuilt or flashed, and no production service was changed. This report is the only intentional repository addition. Archival notes, generated explorers, PCB design, every external interface in the firmware repository, and every UI state were not audited exhaustively. No browser performance profile, physical timing trace, listening test, or current target build was produced.

### Baseline actually executed

| Check | Result | What it establishes |
|---|---|---|
| `npm run src-useq:status` | Reports pin/checkout mismatch and dirty submodule | Source identities, not acceptance |
| `npm run typecheck` | Pass | Production TypeScript typecheck at that point in the review |
| `npm run lint` | Pass | Current configured checks; see F1 for a significant blind spot |
| `npm run check:protocol` | Pass | Generated protocol freshness |
| `npm run test:mocha` | 358 passing, 9 pending | Current integration/YAML suite and available artifact-backed cases |
| `npm run test:unit -- --maxWorkers=2` | 3,583 passing, 6 failing, 2 skipped; 232 files passed, 2 failed, 1 skipped | Broad current-tree baseline, not a clean release gate |

Five unit failures concern generated application identity, served bytes, firmware cleanliness, gitlink coherence, or compiler identity. One is the real-WASM witness `recompile-same-id-is-fine`, where `(a3 (saw 1 :id "pB"))` receives an unexpected-arguments error. These failures must not be suppressed, but they are **not six proven source regressions**. Rebuild a coherent candidate before assigning the witness disagreement to source or fixture semantics.

Small additional checks used extracted production functions with fake seams, ESLint stdin, native header compilation, and the existing generated WASM. These are identified below; they are not substitutes for full production-path regression tests.

## Architecture to preserve

```diagram
Keyboard / gamepad / menus / explicit imports
                       |
              Editor command boundary
                       |
       DocumentSession + CodeMirror EditorState
       visible text + identity + history + persistence
                       |
           Eval payload and source mapping
                       |
        Runtime session / selected typed ports
                 /                  \
       Hardware serial          WASM Worker
       framing + requests       interpreter + producer
                 |              /                 \
       Firmware adapter    visualisation      SAB control ring
                 |         past + future            |
       Shared signal core       |              AudioWorklet
       compile / publish       WebGL          graph + NodeDef DSP
       prepare / commit tick
                 |
        Physical I/O + I2C
```

The hardware/WASM split is a capability split, not complete interchangeability. The current firmware profile excludes host synthesis and temporal-query capabilities. A matching JSON envelope is not evidence of matching resource limits, timing, physical I/O, or all language behaviour.

Important boundaries to keep:

1. **Text remains canonical.** A structural tree derived from text is useful, not automatically a competing source of truth. Do not make two independently writable document models.
2. **One Worker owns the production interpreter.** Keep the separate isolated interpreter used by witnesses; it protects the live session.
3. **Audio owns live advancement while audio runs.** Visualisation must not advance state a second time. The worklet and Worker are necessary execution boundaries.
4. **Audio activation is a transaction.** Candidate preparation, producer mapping, epoch arm, and block-boundary acknowledgement address real failure modes. Do not replace them with an optimistic sequence of messages.
5. **The signal core is shared; adapters differ.** Preserve fixed graph capacities, publication rollback, last-known-good output, and target-specific capability exclusion.
6. **Legacy hardware support has a named consumer and retirement condition.** Do not delete it merely because it is old. Likewise, typed ports and pure planners do not need multiple implementations to justify themselves when they isolate a real external or testing boundary.

## Priority findings

### F1 — The architecture lint gate does not enforce ordinary TypeScript imports

**Priority: first campaign slice. Confirmed by an executed gate probe.**

[`eslint.config.js`](../../eslint.config.js) declares that foundation `lib` cannot import runtime or editors, but has no TypeScript-aware resolver configuration. Running the actual ESLint command on stdin with a filename under `src/lib/` produced:

- `import ... from "../runtime/runtimeCoordinator"`: exit 0.
- The same import ending in `.ts`: exit 1, restricted-path error.

This is not hypothetical: [`src/lib/menu/editorTarget.ts`](../../src/lib/menu/editorTarget.ts#L7-L11) imports the editor/router/structural adapter through extensionless paths. The green baseline therefore does not establish the advertised layering.

**Small repair:** make resolution understand the project's TS/TSX imports and add one positive and one negative test of the boundary policy itself. Then assess newly exposed violations by responsibility. Move editor-dependent menu adapters to the editor layer; leave pure menu data and planners in foundation code. Do not add broad exemptions to restore green.

**Acceptance:** prohibited imports fail both with and without extensions; legitimate composition-root imports still pass. CI must actually run this gate.

### F2 — Serial request cleanup crosses connection lifetimes

**Priority: high reliability. Confirmed with extracted production functions.**

[`resetProtocolState()`](../../src/transport/json-protocol.ts#L169-L195) rejects requests and resets their counter, but does not clear their timeout handles. [`writeJsonRequest()`](../../src/transport/json-protocol.ts#L468-L520) later lets each timeout unconditionally delete its request ID. IDs restart at `req-1`.

A small check executed the real reset/request/ID functions with fake timers: create old `req-1`, reset, create new `req-1`, fire the old timeout. The new request disappeared from the pending map. Its subsequent response cannot resolve the correct promise normally.

**Small repair:** clear timers during reset; make removal conditional on the exact pending entry; ensure IDs or a connection generation cannot collide across lifetimes. Audit the existing queued writer and late metadata delivery against the same lifetime, without inventing a general messaging framework.

**Acceptance:** reconnect with pending writes/timeouts; deliver stale timeout, stale write rejection, and late response. None may remove or update the new session's work.

### F3 — Hardware diagnostic authority is declared, but the UI has two writers

**Priority: high correctness. Confirmed in the current evaluation WIP.**

[`runtimeCodeEvaluation.ts`](../../src/runtime/runtimeCodeEvaluation.ts#L78-L124) correctly returns per-runtime outcomes and names hardware as diagnostic authority. But [`editorEvaluation.ts`](../../src/effects/editorEvaluation.ts#L249-L296) still applies WASM diagnostics independently of [`applyAuthoritativeHardwareDiagnostics()`](../../src/effects/editorEvaluation.ts#L444-L505).

Executing the current callback registration order with a fulfilled hardware error and successful WASM result produced `push:hardware failure`, then `clear`. The additional promise hop through `wasmOutcome()` lets WASM clear the supposedly authoritative hardware result. Hardware-only success also has no diagnostic-clear action, because its handler only acts on nonempty arrays. The hardware path does not share the per-view stale-result guard.

**Small repair:** one result-application path decides authority, clears or replaces the range, and applies one request/document revision guard. Keep per-runtime result details, but do not allow each runtime callback to independently own diagnostics or output health.

**Acceptance:** opposing hardware/WASM outcomes in both orders, hardware-only failure then success, stale responses after another eval, and edits during an in-flight eval. Test the composed production path, not only mocked diagnostic calls.

### F4 — Synthesis retains a Worker port after the runtime owner can replace it

**Priority: high lifecycle risk. Confirmed ownership mismatch; integrated recovery not exercised.**

[`bootstrap.ts`](../../src/runtime/bootstrap.ts#L398-L415) passes the current port object into the synthesis service once. [`browserWasmRuntime.ts`](../../src/runtime/browserWasmRuntime.ts#L145-L170) disposes and replaces that object after a Worker crash. Evaluation obtains the newly selected port. Synthesis still reads `options.workerPort`, including during [`SAB installation`](../../src/audio/synthesisService.ts#L1348-L1364) and [`recovery`](../../src/audio/synthesisService.ts#L1870-L1885).

Recovering an audio producer in the same Worker is not the same event as replacing the Worker. The two lifetimes need an explicit join. Otherwise the editor can recover while audio remains attached to the retired port. Bootstrap also only constructs audio when a port exists at that moment; enabling WASM later needs the same lifecycle review.

**Small repair:** make the runtime composition owner retire/rebind the dependent audio session on Worker-generation change. Capture a stable port for each transaction; do not simply look up a potentially different port halfway through prepare/commit.

**Acceptance:** crash the actual Worker, not only stop its producer; recover; evaluate and obtain finite nonzero audio samples from the replacement. Also test disabled-at-boot then enabled and disable/re-enable.

### F5 — Bounded graph storage is undermined by an unbounded symbol interner

**Priority: high firmware endurance. Confirmed source mechanism.**

[`symbol_intern.h`](../../src-useq/uSEQ/src/modulisp/lisp/symbol_intern.h#L16-L67) is a process-global growing map/vector. [`token.cpp`](../../src-useq/uSEQ/src/signal_engine/token.cpp#L284-L289) interns names before semantic acceptance. Graph rollback does not roll back those names. [`types.h`](../../src-useq/uSEQ/src/signal_engine/types.h#L37-L57) also makes the fixed cell array directly indexed by `SymbolID`.

Rejected or unrelated input with fresh names therefore consumes permanent heap and namespace IDs. A performer can exhaust useful definition IDs without filling the live cell table. The singleton also makes native multi-engine isolation harder to reason about.

**Small repair:** give interning a bounded session owner or a safe transactional checkpoint for newly created names. Preserve IDs referenced by published graphs. Do not reset a global table under live engines.

**Acceptance:** repeated unique rejected names must not reduce remaining usable capacity; a valid new definition must still work afterward. Include independent engine instances and session reset.

### F6 — Cold-eval stack storage exceeds the declared hardware stack budget

**Priority: investigate before a hardware release. Source/budget mismatch confirmed; physical overflow not measured.**

[`eval_cold()`](../../src-useq/uSEQ/src/signal_engine/cold_eval.cpp#L3383-L3386) puts `ParsedProgram` on the stack. [`compiler_pipeline.h`](../../src-useq/uSEQ/src/signal_engine/compiler_pipeline.h#L13-L21) includes the complete token array and diagnostics. [`rp2040_budget.json`](../../src-useq/scripts/rp2040_budget.json#L6-L10) declares 2,048 bytes of core-0 stack, with 512 bytes required remaining.

A native header-only compile using the firmware-capacity profile confirmed `sizeof(Token) == 16` and `sizeof(ParsedProgram) > 4096`. The 256-token array alone requires 4,096 bytes. This does not include graph-building frames or recursion. A syntactic depth bound of 64 is not evidence of safe stack-byte usage. Existing target ELF inspection also found a 2,048-byte reserved stack interval, but that artifact is not proven current.

**Small repair:** explicitly own cold-eval workspace outside the small call stack, accounting for nested dependent recompilation. Measure target frame use and choose the recursion bound from the remaining byte budget. Merely increasing one limit or adding one global scratch buffer is not sufficient analysis.

**Acceptance:** exact-target stack-use evidence and watermarks under ordinary, dependent, maximum accepted, and rejected nested compilation. Do not repeat the old parent `ALIGNMENT.md` RAM percentage as current evidence.

### F7 — WASM string results have no matching deallocation owner

**Priority: high browser-session endurance. Confirmed source contract and artifact experiment.**

[`wasm_host_session.cpp`](../../src-useq/wasm/wasm_host_session.cpp#L25-L38) allocates result strings with `malloc`; [`wasm_wrapper.cpp`](../../src-useq/wasm/wasm_wrapper.cpp#L59-L85) returns them from eval, and diagnostic accessors allocate too. The production [`Worker bindings`](../../src/runtime/workers/wasmRuntime.worker.ts#L285-L306) use string-return `cwrap` contracts.

[Emscripten 3.1.69's return conversion](https://github.com/emscripten-core/emscripten/blob/3.1.69/src/library_ccall.js) calls `UTF8ToString(ret)` and does not free the returned allocation. The JavaScript caller receives a string, not a pointer it can release.

On two fresh instances of the existing generated artifact, after warming up, another 1,000 diagnostic reads separated allocation markers by 16,040 bytes on the string-return path versus 40 bytes on a raw-pointer/free control. This supports the ownership diagnosis; it is not a browser memory profile or a rebuilt-current-source result.

**Small repair:** choose one ABI ownership rule. Borrowed per-instance result storage valid until the next relevant call is likely simplest for the single-threaded Worker. Alternatively, bind numeric pointers and consistently copy/free. Cover every allocated-string export, not just eval. Handle allocation failure if allocation remains.

**Acceptance:** long repeated eval/diagnostics/probe sessions reach stable retained memory, and successive results preserve their documented lifetime.

### F8 — Visualisation admission is not bounded when the Worker is slower than rAF

**Priority: high latency and performance. Confirmed admission mechanism and simulation.**

[`requestLocalSamplesThrough()`](../../src/effects/visualisationRuntime.ts#L457-L502) detects slow completion but still appends one request each frame. [`requestSampleAt()`](../../src/effects/visualisationRuntime.ts#L399-L439) clears older projection flags, keeping projection at the moving tail. It also copies the full pending queue for trace data outside the DEV guard.

A review check using the actual admission functions with simulated 60 Hz frames, 120 Hz target sampling, and 10 completions/second left 534 requests queued after ten seconds; the last completed time was 1.1 seconds. These are synthetic load parameters, not measured browser throughput. They disprove the comment that one admission per frame necessarily lets the queue drain.

**Small repair:** retain bounded normal catch-up, but coalesce obsolete waiting work under overload. Make the dropped-sample/time-step policy explicit for stateful signals; preserve exactly-once live advancement. Move trace-only snapshots inside the DEV guard.

**Acceptance:** delayed-port tests over sustained load show a fixed queue bound, monotonic committed time, and continuing future projection without stopping the clock first.

### F9 — Projection invalidation and capability availability need separate identities

**Priority: correctness. Two confirmed control-flow risks, not browser reproductions.**

1. [`visualisationSampler.ts`](../../src/effects/visualisationSampler.ts#L369-L515) captures invalidation state, awaits WASM, then unconditionally clears invalidation on reset-fill. A new input/settings invalidation received during the await can be erased by an old completion. Its lifetime guard does not identify the projection revision.
2. [`wasmRuntime.worker.ts`](../../src/runtime/workers/wasmRuntime.worker.ts#L610-L636) reports `supportsTickAndProject: false` while the audio producer owns advancement. [`wasmRuntimeWorkerPort.ts`](../../src/runtime/wasmRuntimeWorkerPort.ts#L390-L403) caches that as capability truth. The sampler stops attempting the combined path, and producer stop does not restore that capability. Temporary exclusion can become permanent degradation for the Worker lifetime.

**Small repair:** one invalidation revision protects future results; static ABI support remains separate from temporary permission to advance. Do not re-tick live state when discarding an obsolete future result.

**Acceptance:** deferred reset-fill with a mid-flight invalidation must retain the new reset request. Start audio, issue a combined request, stop audio, and verify that combined sampling resumes without violating audio's exclusive advancement window.

### F10 — Radial-menu commits can discard source that the structural path preserves

**Priority: high editor integrity. Confirmed source-loss path; not browser-exercised.**

[`menu/editorTarget.ts`](../../src/lib/menu/editorTarget.ts#L32-L86) replaces the document when top-level count changes or multiple forms differ. It prints structural children and joins them with newlines. The structural tree omits comments, so this fallback cannot preserve leading/trailing layout or inter-form comments. [`applyOp.ts`](../../src/editors/extensions/structure/adapter/applyOp.ts#L139-L202) already contains a different preservation path, including later surgical edits intended to retain identity continuity.

**Small repair:** share the existing editor-owned structural-result-to-source commit responsibility, including cursor intent and identity-preserving changes. Keep radial-menu planning pure. Do not add another printer/diff layer. Configuration/snippet/file imports should likewise use explicit editor commands rather than a parallel raw-dispatch policy.

**Acceptance:** real menu insertion among stateful forms preserves comments and untouched whitespace, retains surviving identities, places focus correctly, and produces one intended undo. Test import/snippet selection semantics explicitly rather than assuming they should all use one default selection.

### F11 — Grab state has no document owner, and its tests duplicate the implementation

**Priority: editor integrity and test trust. Confirmed ownership/test divergence; undo failure sequences not interactively reproduced.**

[`grabState.ts`](../../src/lib/gamepad/grabState.ts#L10-L50) stores active state, snapshot, and move count globally. [`actionHandlers.ts`](../../src/editors/commands/actionHandlers.ts#L352-L432) cancels by undoing that many entries on whichever view it receives. Neither owner disposal nor the inspected gamepad reset paths clear it. Intervening edits can invalidate the assumption that the next N undo entries belong to this grab.

Meanwhile [`testHarness.mjs`](../../test/testHarness.mjs#L664-L746) contains a second implementation of grab/start/cancel/move. The YAML cases can pass against that implementation without proving the production handler's behaviour. Test cleanup also removes state that production lifecycle paths leave behind.

**Small repair:** explicitly bind grab state to its editor lifetime and decide what an unrelated edit does to an active grab. Route YAML names through the production actions. Do not restore the saved text blindly; that could discard intervening user work.

**Acceptance:** grab/move/cancel, intervening keyboard edit, failed move, disconnect, disposal, and a different editor. Verify text, identity, focus, history and visual/logical grab state together.

### F12 — Hardware tick latency includes potentially blocking host and expander work

**Priority: release timing. Confirmed scheduling paths; physical delay unmeasured.**

[`firmware.cpp`](../../src-useq/uSEQ/src/firmware/firmware.cpp#L113-L135) performs compilation and serial response work before output execution. [`serial_protocol_encoding.cpp`](../../src-useq/uSEQ/src/firmware/serial_protocol_encoding.cpp#L84-L112) checks for some TX capacity, then writes a complete dynamically built response. That does not establish a nonblocking write of the complete payload. Exact blocking/partial-write behaviour depends on the target serial implementation.

The [`I2C broadcast`](../../src-useq/uSEQ/src/firmware/i2c_network.cpp#L464-L489) also runs before local output writes. A 71-byte frame at 400 kHz takes about 1.6 ms with acknowledgement bits, excluding overhead. One such frame per tick already conflicts with the general 1 kHz resource-profile target; additional expanders cost more. The firmware spec acknowledges the synchronous exception, so this is a budget/profile issue, not an undisclosed architectural surprise.

**Small repair:** bounded incremental serial TX with backpressure for reliable replies; a distinct bounded expander update rate or an explicitly lower supported timing profile. Do not move the interpreter to another core merely to conceal blocking.

**Acceptance:** stopped host reader, large diagnostics, maximum supported expanders, and a failed expander. Observe output gaps, watchdog behaviour and complete responses on the actual target.

## Smaller changes with high return

These are deliberately narrower than a folder reorganisation.

| Candidate | Evidence and smallest replacement | Acceptance |
|---|---|---|
| Remove the second worklet graph-mutation route | [`workletCore.ts`](../../src/audio/workletCore.ts#L704-L723) accepts direct `instantiate/update/retire` alongside prepared transactions. Direct handlers occupy roughly lines 1094–1342 and have a separate activation branch. Production service sends transaction envelopes. Verify harness consumers, migrate their scenarios, then remove the direct route and its staging state. Keep graph-delta types inside preparation. | All graph lifecycle/failure cases use prepare/commit/gate/ack; old top-level messages cannot mutate the live graph. |
| Make renderer scratch storage actually reusable | [`serialVisPlanning.ts`](../../src/ui/visualisation/serialVisPlanning.ts#L53-L85) sets array length to zero before looking up reusable objects. A repeated-call check confirmed sample objects are not reused. Retain a pool plus logical length. | Equal and alternating output sizes reuse warmed objects and return correct samples. |
| Remove redundant structural folding | The StateField folds after a document change, then [`applyOp.ts`](../../src/editors/extensions/structure/adapter/applyOp.ts#L565-L599) folds again for cursor restoration. Read the already-updated field. This is duplicate structural projection, not proof of a second full Lezer parse. | One fold per text transaction with unchanged source, focus, history and identities. |
| Transfer owned probe arrays | [`wasmRuntime.worker.ts`](../../src/runtime/workers/wasmRuntime.worker.ts#L697-L705) expands typed probe samples to a number array; the port reconstructs a typed array. Make one owned typed copy and transfer its buffer. Never detach the WASM heap. | Values, NaNs, count, and successive-result lifetime remain correct. |
| Replace the browser `buffer` dependency | Its inspected production use is [`stream-parser.ts`](../../src/transport/stream-parser.ts#L338-L342): copy bytes into `Buffer`, then read one little-endian double. `DataView` over the original byte offset/length does this natively. | Stream fixtures, chunk boundaries and nonzero byte-offset views pass. |
| Consider removing the small Effect island | Four production modules import `effect`; inspected uses wrap synchronous work/promises, run them immediately, or fan out transport calls. Use native functions/async operations if focused tests confirm error and concurrency semantics. Do not turn this into an XState/Solid rewrite. | Same transport error, concurrency and query-failure behaviour; dependency and wrappers disappear together. |
| Consolidate WASM state capture/restore | [`wasm_evaluation.cpp`](../../src-useq/wasm/wasm_evaluation.cpp#L83-L102) and [`wasm_projection.cpp`](../../src-useq/wasm/wasm_projection.cpp#L43-L73) manually enumerate overlapping live fields. Use one narrow snapshot responsibility with scoped restoration. | Every live field is unchanged after read-only sampling, including failure/early-return paths. |

The direct worklet handlers alone are about 250 lines of candidate deletion before associated staging cleanup. The `buffer` and small Effect island are two possible dependency removals. These are **review estimates, not measured savings or approved deletions**. Do not add independent estimates together and present them as a guaranteed net line reduction; migration tests and shared types can remain.

Large files deserve navigation help, but size is not a defect by itself. At inspection, `graph_builder.cpp` was about 4,000 lines, `cold_eval.cpp` about 3,650, and the two audio owners about 2,300 each. Delete duplicate responsibilities before splitting them. A split that leaves every new file dependent on the same private state only moves the difficulty.

## Contributor experience and repository structure

### The front door currently assumes the maintainer's machine

[`package.json`](../../package.json) invokes `portless` for development without declaring it as an npm dependency. `build:wasm` invokes `nix-shell`, while CI installs Emscripten separately but does not explicitly set up that Nix path. [`shell.nix`](../../src-useq/shell.nix#L1-L25) imports the ambient `<nixpkgs>` channel, so naming Nix does not pin the compiler environment. Recursive submodules use SSH URLs. These are setup prerequisites or reproducibility gaps, not evidence that every local build is broken.

**Recommended front door:** one documented clean-clone route for browser contributors, with explicit Node/toolchain prerequisites and no need for private estate services. Keep firmware development as a second route with its target tools and device requirements. CI should execute those documented routes from an empty checkout rather than rely on local generated assets.

Ergon is the maintainer's durable tracker, not something an external contributor should need to authenticate to before sending a small patch. This review could not register its task because the local Ergon configuration has no Amp profile; only profiles for other agent identities were present. It did not impersonate those actors or modify credentials. Importing approved findings into Ergon remains blocked on the correct agent identity.

### There are several competing orientation surfaces

The repository points readers among README, REPO_MAP, MAP, CLAUDE, MAIN specs, and ALIGNMENT. The documents contain useful information, but also disagree:

- Root guidance names the missing `docs/RUNTIME_CONTRACT.md`; the current contract is `docs/specs/runtime-contract.md`.
- CLAUDE's short build description omits the WASM step present in the manifest.
- README/CLAUDE describe the retired `ergo` task interface, while the deployed CLI uses a different lifecycle.
- MAIN §4.2 lists calibration as stable core; the calibration spec is aspirational and the generated schema explicitly rejects its requests.
- Parent ALIGNMENT has dated hardware resource claims superseded by further firmware work.

The documentation path check passes because it intentionally checks a narrow set of source-path forms. It is not a command, capability, or architectural consistency check.

**Recommended division:** README is the human front door; MAP is the concise ownership map; specs state current/aspirational behaviour; ADRs explain durable decisions; agent guidance contains only additional execution constraints. Do not maintain several copies of the command catalogue. No new documentation framework is needed.

### CI needs to distinguish fast feedback from candidate acceptance

The current workflow has useful unit, browser, Storybook and wire-contract coverage. However:

- It does not run the app's `npm run lint`; the explicit lint command is for Grammar Lab.
- `test:contracts` substantially overlaps the later full unit suite.
- Build prerequisites differ from the workflow's declared setup.
- The step called “Assert pinned src-useq status” only prints status; the actual coherence assertions are in tests elsewhere.
- Real-artifact tests may skip when artifacts are absent; warm artifacts can produce unrelated disagreements when present.
- Current-browser release smoke exists but is not the same check as the configured pinned-browser E2E job.

Use two clear grades with existing tools: **source feedback** (typecheck, effective lint, pure/component/editor tests) and **candidate acceptance** (clean source identities, generated assets, native/WASM conformance, browser flows, target build/resource evidence). Keep explicit “not measured” grades for physical I/O and listening. Do not weaken provenance tests so a dirty development checkout resembles a release.

### Remove misleading residue, not valuable history

The tracked old `@nextjournal` 0.3.2 patch is described as patch-package infrastructure, but the package now uses 0.3.3 and no patch-application script was found in the live pipeline. The `deps/modulisp` submodule also has no identified application build consumer in the inspected paths. Verify any external consumers before retiring either; otherwise label their real purpose rather than implying they are active build inputs.

Do not classify the whole visible directory listing as repository bloat. Many explorers, reports, caches, and local harness directories are already ignored. Keep historical evidence out of the onboarding path rather than automatically delete it.

Comments should retain invariant, reason and failure boundary. Long accounts of previous agents, fixes and task IDs belong in Git/ADRs when they no longer explain the current mechanism. The incorrect sampling-queue comment is a good example of why more explanation is not automatically more truth.

## Security note: native test logs are not safe sharing artifacts

The existing ignored `src-useq/build/meson-logs/testlog.txt` contains inherited credential-like environment assignments. The firmware review encountered them during a log-header inspection; a later check verified presence without printing values. No secret values are included in this report.

Do not publish or attach that log. Run native tests with a deliberately reduced environment and export sanitized result summaries instead of raw logs. If these logs or the inspection output have reached a broader audience, assess and rotate the affected credentials. Changing credentials or deleting existing evidence requires a separate operator decision.

## Recommended campaign

This is an order of work and acceptance criteria, **not a parallel task tracker or approval to implement**. Size means a bounded reviewable slice: S is usually local; M crosses a real boundary; hardware evidence can have additional elapsed time.

| Stage | Outcome | Suggested scope | Exit condition |
|---|---|---|---|
| 1. Establish truthful ground | A clean contributor path and checks whose names mean what they do | F1; CI/toolchain declaration; clean candidate/artifact separation; log handling. M. | A new checkout runs the documented path; a deliberately forbidden import fails; source/artifact identities are explicit. |
| 2. Close lifetime and resource holes | Reconnect, recovery, and long sessions do not consume or corrupt unrelated state | F2–F7. Separate small fixes from ABI/firmware changes. S–M each. | Focused failure-sequence tests plus WASM endurance and exact-target stack evidence. |
| 3. Restore editor ownership | All structural source commits preserve the document; tests call production actions | F10–F11 and redundant structural folding. M. | Menu/keyboard/gamepad/import parity, comments/identity/undo preservation, lifecycle tests. |
| 4. Bound work under load | Slow runtime work degrades fidelity, not responsiveness or state correctness | F8–F9, scratch reuse, probe transfer, F12 target timing. S–M plus physical observation. | Fixed backlog bound, continuing projection, stable warmed allocations, target timing within its declared profile. |
| 5. Prune duplicate mechanisms | Fewer things must be changed together for the next feature | Direct worklet route, optional dependency cuts, snapshot ownership, stale patch/build inputs. S–M. | Same supported behaviour with fewer mutation paths and no new broad abstraction. |
| 6. Make the project welcoming | A contributor knows where a small change belongs and how to prove it | Short ownership map, truthful capability table, contribution guide, one representative change walkthrough. S. | A guest completes a focused editor or runtime change without private setup knowledge. |

Run these as small behaviour-preserving reductions and focused fixes, not one “cleanup” branch. For each slice: capture the relevant failure, make the smallest owner-level repair, run the affected gate, update only the governing contract, and review before proceeding. Do not combine firmware ABI changes, editor semantics and directory renaming in one diff.

### Campaign scorecard

Prefer measures tied to maintenance and operation:

- Clean-clone time to first editor and first browser eval.
- One authoritative document commit path and one audio graph activation path.
- Number of justified boundary exceptions; a negative test proves enforcement.
- Maximum queued visualisation work and oldest queued age under a fixed load.
- Retained memory after a fixed eval/diagnostics/rejected-name endurance workload.
- Exact-target stack margin and output-gap distribution for declared profiles.
- Supported user journeys actually exercised through production dispatch.
- No mandatory green gate depends on a warm unidentified artifact.

Avoid targets such as “halve file count”, “remove every singleton”, “100% coverage”, “replace all custom code”, or “eliminate all TODOs”. They are easy to optimise without making the instrument better.

## Where to start

The first reviewable slice should be **effective import-boundary enforcement plus its own regression check**. It exposes the real dependency map and makes subsequent simplification durable. In parallel only where file ownership permits, address the concrete serial-lifetime and WASM-result leaks. The hardware stack discrepancy needs attention before claiming a safe target release.

The project can become an inviting, coherent instrument without abandoning its distinctive editor, visualisation or language design. The improvement comes from finishing the boundaries it already has—not adding another architectural layer to manage unfinished ones.

## Implementation checkpoint — F1, 6 September 2026

The first authorized slice repairs import-boundary enforcement without changing menu behaviour:

- ESLint now resolves extensionless TypeScript/TSX imports with the existing Node resolver. No dependency or boundary exception was added.
- Seven regression cases run the real ESLint configuration against virtual production filenames. Before the fix, the three extensionless negative cases failed; after it, all seven pass.
- Enabling resolution exposed 16 prohibited imports in seven radial-menu modules. Those modules and their seven test files now live in `src/editors/menu/`. Shared state, content and types stay in `src/lib/menu/`; the existing `MenuDispatcher` interface moved there unchanged so the gamepad pipeline does not depend on editor implementation.
- Callers, the YAML harness, the ownership map and affected spec paths follow the move. CI now invokes `npm run lint` after dependency installation.

Verification:

| Check | Result |
|---|---|
| Focused boundary/menu/gamepad/bootstrap suites | 564 tests passed across 24 files, including real CodeMirror integration |
| `npm run lint` | Passed, including documentation source paths |
| `npm run typecheck` | Passed |
| Full `npm test` run | Mocha: 358 passed, 9 pending. Unit: 3,590 passed, 6 failed, 2 skipped; 233 files passed, 2 failed, 1 skipped |

The full suite still fails in the same six baseline cases: five generated-asset/source-identity checks and the real-WASM witness reported above. None was suppressed or reclassified as passing. A coherent candidate build remains necessary before release acceptance. No visual behaviour, firmware source, generated runtime asset, or deployment was changed by this slice.

This is the feedback point, not completion of campaign stage 1. All edits remain local and uncommitted; unrelated working-tree changes were preserved. Ergon registration remains blocked on the missing Amp actor profile. The next useful decision is whether to continue with the isolated lifetime/resource fixes or first establish a coherent source/artifact candidate baseline.

## Candidate baseline checkpoint — 6 September 2026 (UTC)

**Fresh builds separate provenance failures from an incomplete language migration. Neither candidate is a fully accepted application baseline.** No application or firmware source was repaired in this step, and no test expectation was weakened.

Two isolated local Git checkouts contain the same application working-tree snapshot, including its existing uncommitted and untracked source work. Only their firmware pins differ:

- `.local/architecture-baseline/candidate/` uses the recorded firmware pin, [`3f73fcc`](https://github.com/Emute-Lab-Instruments/uSEQ/commit/3f73fcc81f14fadf7b8d1770f7feeb09c9042f7c).
- `.local/architecture-baseline/candidate-current/` uses a clean copy of the already checked-out newer firmware, [`02299d2`](https://github.com/Emute-Lab-Instruments/uSEQ/commit/02299d22870f528f47b27f81fbd37ff4e2838f60), for comparison only. This is not a promotion into the main working tree.

Local snapshot commits exist only inside these candidate repositories. Their exact commit/tree identities, compiler input digests, build versions, artifact hashes and final dirty states are recorded in `.local/architecture-baseline/receipt.json`. Logs and both candidates are retained beside that receipt (approximately 559 MiB in total). These are local evidence, not published releases or portable remote commits; the clones use local Git object alternates.

### Executed checks

`npm ci` installed the locked application dependencies in the first candidate; the second reused that installation. Both ran `npm run build` from absent generated outputs, with a reduced environment and compiler parallelism capped at two. The Nix shell resolved Emscripten 4.0.22 and Binaryen 125; its Node was 24.12.0, while app commands used the laptop's Node 22. The Nix package input still floats through `<nixpkgs>`: a successful local build does not establish a pinned, reproducible toolchain.

| Check | Recorded firmware pin | Newer checked-out firmware |
|---|---|---|
| Full interpreter + NodeDef + assets + Vite build | Passed | Passed |
| Compiler manifest verification; clean firmware source | Passed | Passed |
| Generated-asset identity and actual WASM ABI/integration tests | Passed | Passed |
| NodeDef binary inspection and runtime smoke at 44.1/48/96 kHz | Passed | Passed |
| Firmware conformance runner against the served WASM | 85 passed, 0 failed | 82 passed, 3 failed |
| Lint and production typecheck | Passed | Passed |
| Mocha integration/YAML suite | 358 passed, 9 pending | 358 passed, 9 pending |
| Full unit suite, two workers | 3,594 passed, 2 failed, 2 skipped | 3,595 passed, 1 failed, 2 skipped |

The conformance command was `USEQ_WASM_ARTIFACT_DIR="$PWD/../public/wasm" python3 scripts/run_conformance.py --target wasm`, from each candidate's `src-useq/` under its Nix shell. It executes all 85 cases, including diagnostic cases that the app's witness runner explicitly reports as unsupported. The NodeDef checks were `scripts/inspect_osc_sine_wasm.sh` and `node scripts/osc_sine_wasm_smoke.mjs`. Test and build logs are outside the candidate source trees so they cannot change the measured source status.

### What the comparison establishes

1. **The recorded pin is too old for the current reference-data work.** Its `symbols.def` lacks the newer `OP_META` declarations. The current generator silently defaults these fields, removes namespace applicability and reintroduces old names. Its build changes `assets/modulisp_reference_data.json` (279 insertions, 744 deletions), then two `generatedReferenceData.test.ts` assertions fail. That generated difference remains only in the isolated candidate. All six failures from the original warm-artifact baseline disappear in this candidate.
2. **The newer source still has a real corpus migration gap after rebuilding.** Its app and firmware checkouts remain clean after build, all five provenance failures disappear, and reference-data tests pass. The app's one remaining failure is `recompile-same-id-is-fine`. The full firmware runner also fails `duplicate-active-id-rejected` and `non-constant-phase-is-error`. All three YAML cases still use bare `saw` as a stateful oscillator. The newer compiler treats it as a pure shaper; corresponding C++ audit tests already use `lfo/saw` (`src-useq/test/signal_engine/test_audit_fixes.cpp`, A8/A9).
3. **Updating those three fixtures alone would not finish the documented syntax migration.** An in-memory probe using `lfo/saw` makes all three pass with their original assertions. However, the current firmware specs show `saw[lfo]` (`state.md` §6 and `state-identity.md` §3/§5), and direct evaluation of that form fails in the clean newer WASM. The editor does not lower brackets to slash syntax: `evalPayload.ts` injects identity and substitutes manual controls; `runtimeCodeEvaluation.ts` and the Worker forward that payload. The formatter only canonicalizes existing slash prefixes. The diagnostic-only probe can even match a generic `type` error caused by unsupported bracket syntax rather than the intended non-constant-phase failure. Fixture corrections need positive controls, not merely a green error-category assertion.

No corpus files were changed by the probes; they modified loaded cases in memory and ran the existing conformance executor. The newer candidate's app and firmware-conformance logs retain the original failures. The first bracket-syntax probe and the complete slash-versus-bracket comparison are retained as evidence, including the failed hypothesis.

### Boundary and next decision

Keep the newer language work separate from unrelated architectural cleanup. Complete or explicitly defer its bracket-modifier contract, migrate the stateful-oscillator witnesses with precise assertions, then validate a firmware promotion as one reviewable slice. Do not roll back the current editor work to make the old pin pass, and do not stamp old artifacts with a newer source identity.

The original workspace's firmware checkout, recorded gitlink, generated assets and unrelated work remain untouched. No hardware build, device flash, browser journey, listening test, deployment or release acceptance was performed. `npm ci` also reported 28 dependency advisories (3 low, 4 moderate, 15 high, 6 critical); reachability was not audited and no automatic dependency update was applied. Ergon registration is still blocked by the missing Amp actor profile.
